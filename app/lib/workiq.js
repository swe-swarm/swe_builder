/**
 * WorkIQ CLI wrapper — pulls M365 customer context via WorkIQ.
 *
 * Spawns `workiq ask -q "..."` child processes to query 4 M365 sources
 * (Emails, Meetings, SharePoint SDR, Teams). Assembles results into a
 * consolidated markdown file with a document version map for deduplication.
 */

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { getToken } = require("../../tools/lib/http");
const { downloadFile, GRAPH_BASE } = require("../../tools/lib/graph-sharepoint");

// ───────────────────────────────────────────────────────────────────────────
// Availability check
// ───────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the `workiq` CLI is installed and responds to --version.
 */
async function isWorkIQAvailable() {
  try {
    const bin = process.platform === "win32"
      ? path.join(process.env.APPDATA || "", "npm", "workiq.cmd")
      : "workiq";
    execSync(`"${bin}" --version`, { stdio: "ignore", timeout: 5000, shell: true });
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Query execution
// ───────────────────────────────────────────────────────────────────────────

/**
 * Check if a WorkIQ error message indicates an authentication failure.
 * Uses specific patterns to avoid false positives on content that
 * mentions auth-related words (e.g. emails about SSO setup).
 *
 * @param {string} error  Error message from runWorkIQQuery
 * @returns {boolean}
 */
function isAuthError(error) {
  if (!error) return false;
  const lower = error.toLowerCase();
  return lower.includes("not authenticated")
    || lower.includes("sign in")
    || lower.includes("token expired")
    || lower.includes("token invalid")
    || lower.includes("refresh token")
    || lower.includes("unauthorized")
    || lower.includes("401")
    || lower.includes("authentication required")
    || lower.includes("authentication failed");
}

/**
 * Run a WorkIQ query with automatic retries on failure.
 * Auth errors are retried once (token refresh race), other errors up to maxRetries.
 * Supports an AbortController signal to cancel in-flight queries when another
 * query detects auth failure (kills the child process immediately).
 *
 * @param {string} question  Natural language question
 * @param {number} timeoutMs Kill the process after this many ms (default 120s)
 * @param {number} maxRetries Maximum retry attempts (default 2, so 3 total attempts)
 * @param {AbortSignal} [signal] Optional abort signal to cancel the query
 * @returns {Promise<{content: string, error: string|null, authFailed: boolean}>}
 */
async function runWorkIQQueryWithRetry(question, timeoutMs = 120_000, maxRetries = 2, signal) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check if aborted before starting attempt
    if (signal?.aborted) {
      return { content: "", error: "Aborted", authFailed: false };
    }

    const result = await runWorkIQQuery(question, timeoutMs, signal);

    // Success — return immediately
    if (!result.error) return { ...result, authFailed: false };

    // Auth error — retry once (token might be refreshing), then give up
    if (isAuthError(result.error)) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      return { ...result, authFailed: true };
    }

    // Non-auth error — retry with backoff
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }

    return { ...result, authFailed: false };
  }

  return { content: "", error: "All retry attempts exhausted", authFailed: false };
}

/**
 * Run WorkIQ queries in batches to avoid the Windows WAM broker bug (#71)
 * that crashes after 3+ simultaneous MSAL auth calls in console apps.
 *
 * The pre-flight checkWorkIQAuth() warms the MSAL cache, and batching
 * ensures only 2 concurrent token acquisitions hit WAM at a time.
 *
 * @param {Array<{id, label, question}>} queries
 * @param {{ batchSize?: number, signal?: AbortSignal, onProgress?: function }} opts
 * @returns {Promise<{results: Array<{id, label, question, content, error}>, authAborted: boolean}>}
 */
async function runQueriesBatched(queries, { batchSize = 2, signal, onProgress } = {}) {
  const results = [];
  let completed = 0;
  let authAborted = false;

  for (let i = 0; i < queries.length; i += batchSize) {
    if (authAborted || signal?.aborted) break;

    const batch = queries.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async (q) => {
        if (authAborted || signal?.aborted) return;

        if (onProgress) onProgress(q.id, q.label, "running");
        const result = await runWorkIQQueryWithRetry(q.question, 120_000, 2, signal);
        completed++;

        if (result.authFailed) {
          authAborted = true;
          return;
        }

        const entry = { ...q, content: result.content, error: result.error };
        results.push(entry);
        if (onProgress) {
          onProgress(q.id, q.label, result.error ? "error" : "done", completed, queries.length);
        }
      })
    );
  }

  return { results, authAborted };
}

/**
 * Pre-flight auth check — run a cheap query to verify WorkIQ session is active.
 * Uses "What is my name?" which targets the /me Graph endpoint only (2-4s).
 * Returns { ok, error }.
 */
async function checkWorkIQAuth() {
  const result = await runWorkIQQuery("What is my name?", 20_000);
  if (!result.error) return { ok: true, error: null };
  if (isAuthError(result.error)) return { ok: false, error: result.error };
  // Spawn errors or total failures mean WorkIQ is broken, not just unauthed
  if (result.error.startsWith("Spawn error")) return { ok: false, error: result.error };
  // Non-auth query errors (timeout, empty response) — auth likely works
  return { ok: true, error: null };
}

/**
 * Run a single WorkIQ query. Returns { content, error }.
 * @param {string} question  Natural language question
 * @param {number} timeoutMs Kill the process after this many ms (default 120s)
 * @param {AbortSignal} [signal] Optional abort signal to kill the child process
 */
function runWorkIQQuery(question, timeoutMs = 120_000, signal) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    // On Windows, `.cmd` files require shell or `cmd /c` to execute.
    // Using `cmd /c workiq` with question as a separate array element keeps
    // the question out of shell parsing (no injection risk).
    const args = process.platform === "win32"
      ? ["/c", "workiq", "ask", "-q", question]
      : ["ask", "-q", question];
    const cmd = process.platform === "win32" ? "cmd" : "workiq";

    // Check if already aborted before spawning
    if (signal?.aborted) {
      resolve({ content: "", error: "Aborted" });
      return;
    }

    const child = spawn(cmd, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Wire abort signal to kill the child process
    const onAbort = () => {
      if (!killed) {
        killed = true;
        try { child.kill("SIGTERM"); } catch {}
        resolve({ content: "", error: "Aborted" });
      }
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      killed = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      try { child.kill("SIGTERM"); } catch {}
      resolve({ content: "", error: `Query timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve({ content: "", error: `Spawn error: ${err.message}` });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (killed) return; // already resolved via timeout or abort

      // Use shared isAuthError() for both stderr and stdout to keep patterns in one place.
      // stderr is always reliable. Only check stdout when exit code != 0
      // (avoids false positives on content mentioning "authentication", "sign in", etc.)
      const authInStderr = isAuthError(stderr);
      const authInStdout = code !== 0 && isAuthError(stdout);

      if (authInStderr || authInStdout) {
        resolve({
          content: "",
          error: "WorkIQ not authenticated. Run `workiq ask -q \"test\"` in a terminal to sign in.",
        });
        return;
      }

      if (code !== 0 && !stdout.trim()) {
        resolve({ content: "", error: `WorkIQ exited with code ${code}: ${stderr.trim().slice(0, 200)}` });
        return;
      }

      resolve({ content: stdout.trim(), error: null });
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Query templates
// ───────────────────────────────────────────────────────────────────────────

const TIME_RANGE_LABELS = {
  "30d": "in the last 30 days",
  "90d": "in the last 90 days",
  "180d": "in the last 6 months",
  "1y": "in the last year",
};

/**
 * Build a search phrase that includes the customer name and any aliases.
 * e.g., "BlueYonder" + ["BY", "Blue Yonder"] → "BlueYonder (also known as BY, Blue Yonder)"
 *
 * @param {string} customer  Primary name
 * @param {string[]} aliases  Alternative names / abbreviations
 * @returns {string}
 */
function buildNamePhrase(customer, aliases) {
  if (!aliases || aliases.length === 0) return customer;
  return `${customer} (also known as ${aliases.join(", ")})`;
}

/**
 * Build the 4 query objects for a customer pull.
 * Focused on the four highest-value M365 sources: Emails, Meetings,
 * SharePoint SDR (CLSCMS), and Teams conversations.
 *
 * @param {string} customer  Customer/company name
 * @param {string} timeRange "30d" | "90d" | "180d" | "1y"
 * @param {string[]} [aliases]  Alternative names / abbreviations
 * @returns {Array<{id: number, label: string, question: string}>}
 */
function buildQueries(customer, timeRange, aliases) {
  const tr = TIME_RANGE_LABELS[timeRange] || TIME_RANGE_LABELS["90d"];
  const name = buildNamePhrase(customer, aliases);

  return [
    {
      id: 1,
      label: "Emails",
      question: `Find all emails mentioning ${name} ${tr}. For each: date, participants, summary of decisions and action items. IMPORTANT: If any email has document attachments (SDR, specs, presentations, spreadsheets), open each attachment and summarize the actual content inside — not just the filename. List the attachment name, date sent, content summary, and how it differs from or updates previous versions.`,
    },
    {
      id: 2,
      label: "Meetings",
      question: `Find all meetings about ${name} or with ${name} participants ${tr}. For meetings that have transcripts available, include verbatim quotes from key discussions — speaker name and what they said about decisions, requirements, blockers, and action items. For all meetings: summarize outcomes, decisions, action items, attendees, and any documents or files shared.`,
    },
    {
      id: 3,
      label: "SharePoint SDR",
      question: `Find all Solution Discovery Reports and customer documents for ${name} in the SharePoint site teams/CLSCMS/account. For each document list: exact file name, last modified date, modified by, version number if available, and a brief content summary. Sort by most recently modified first.`,
    },
    {
      id: 4,
      label: "Teams",
      question: `Find all Teams messages, channel discussions, and chat threads mentioning ${name} ${tr}. Summarize key conversations, decisions, and blockers. IMPORTANT: For any files or attachments shared in chats, open them and summarize the actual content inside — not just the filename. Note file names, who shared them, dates, and content summaries.`,
    },
  ];
}

// ───────────────────────────────────────────────────────────────────────────
// Deduplication
// ───────────────────────────────────────────────────────────────────────────

// Patterns that indicate a document reference in WorkIQ output
const DOC_PATTERNS = [
  /[\w\s-]+\.(?:docx|pptx|xlsx|pdf)/gi,
  /(?:SDR|Solution Discovery Report)[\w\s.-]*(?:v\d+)?/gi,
  /(?:Requirements|Specification|Use Case)[\w\s.-]*(?:v\d+)?/gi,
];

// Date patterns: 2026-03-15, March 15 2026, 03/15/2026, etc.
const DATE_PATTERN = /(\d{4}-\d{2}-\d{2}|\w+ \d{1,2},?\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/g;

/**
 * Best-effort deduplication of document mentions across query results.
 * Scans all result content for document names and dates, builds a version map.
 *
 * @param {Array<{id: number, label: string, content: string, error: string|null}>} results
 * @returns {{ map: Array<{name, latestDate, latestSource, olderVersions: Array}>, annotations: Map<number, string[]> }}
 */
function deduplicateDocuments(results) {
  // Step 1: Extract all document mentions with source and approximate date
  const mentions = []; // { name, source, date, sourceId }

  for (const r of results) {
    if (!r.content) continue;

    for (const pattern of DOC_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(r.content)) !== null) {
        const name = match[0].trim();
        if (name.length < 5) continue; // too short to be meaningful

        // Try to find a date near this mention (within 200 chars)
        const start = Math.max(0, match.index - 200);
        const end = Math.min(r.content.length, match.index + match[0].length + 200);
        const context = r.content.slice(start, end);
        const dates = context.match(DATE_PATTERN);
        const date = dates ? dates[dates.length - 1] : null;

        mentions.push({ name, source: r.label, sourceId: r.id, date });
      }
    }
  }

  if (mentions.length === 0) return { map: [], annotations: new Map() };

  // Step 2: Group by normalized document name (fuzzy match)
  const groups = new Map(); // normalized name → [mentions]

  for (const m of mentions) {
    const key = m.name
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/v\d+/g, "")
      .replace(/\.(?:docx|pptx|xlsx|pdf)$/i, "")
      .trim();

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  // Step 3: For each group, determine latest version
  const map = [];
  const annotations = new Map(); // sourceId → [annotation strings]

  for (const [, group] of groups) {
    if (group.length < 2) continue; // no duplicates to resolve

    // Unique sources
    const sources = [...new Set(group.map((g) => g.source))];
    if (sources.length < 2) continue; // same source, not cross-source dup

    // Sort by date (parse best-effort), most recent first
    const sorted = group.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    const latest = sorted[0];
    const older = sorted.slice(1).filter((s) => s.source !== latest.source);

    if (older.length === 0) continue;

    map.push({
      name: latest.name,
      latestDate: latest.date || "unknown",
      latestSource: latest.source,
      olderVersions: older.map((o) => `${o.source} (${o.date || "unknown"})`),
    });

    // Build annotations for older sources
    for (const o of older) {
      if (!annotations.has(o.sourceId)) annotations.set(o.sourceId, []);
      annotations.get(o.sourceId).push(
        `[SUPERSEDED] "${o.name}" — newer version in ${latest.source} (${latest.date || "unknown"})`
      );
    }
  }

  return { map, annotations };
}

// ───────────────────────────────────────────────────────────────────────────
// Assembly
// ───────────────────────────────────────────────────────────────────────────

const SECTION_MAP = {
  1: "Email History",
  2: "Meetings & Transcripts",
  3: "SharePoint SDR (CLSCMS)",
  4: "Teams Conversations",
};

/**
 * Assemble the final consolidated markdown context file.
 *
 * @param {string} customer
 * @param {Array<{id, label, content, error}>} results
 * @param {string} timeRange
 * @param {{ map, annotations }} dedup
 * @returns {string} Markdown content
 */
function assembleContextFile(customer, results, timeRange, dedup) {
  const now = new Date().toISOString().slice(0, 10);
  const trLabel = TIME_RANGE_LABELS[timeRange] || timeRange;
  const successCount = results.filter((r) => !r.error && r.content).length;

  const lines = [];
  lines.push(`# Customer Context: ${customer}`);
  lines.push("");
  lines.push(`> Generated on ${now} via WorkIQ M365 search`);
  lines.push(`> Time range: ${trLabel} | Queries: ${successCount}/${results.length} successful`);
  lines.push("");

  // Document Version Map (dedup)
  if (dedup.map.length > 0) {
    lines.push("## Document Version Map");
    lines.push("");
    lines.push("> Multiple versions of some documents exist across SharePoint and email.");
    lines.push("> Use ONLY the latest version listed below.");
    lines.push("");
    lines.push("| Document | Latest Date | Source | Older versions found in |");
    lines.push("|----------|------------|--------|------------------------|");
    for (const entry of dedup.map) {
      lines.push(
        `| ${escapeMd(entry.name)} | ${escapeMd(entry.latestDate)} | ${escapeMd(entry.latestSource)} | ${escapeMd(entry.olderVersions.join(", "))} |`
      );
    }
    lines.push("");
  }

  // Content sections
  const sorted = [...results].sort((a, b) => a.id - b.id);
  for (const r of sorted) {
    const heading = SECTION_MAP[r.id] || r.label;
    lines.push(`## ${heading}`);
    lines.push("");

    if (r.error) {
      lines.push(`> Query failed: ${r.error}`);
    } else if (!r.content) {
      lines.push("*No data found for this category.*");
    } else {
      // Add superseded annotations if any
      const anns = dedup.annotations.get(r.id);
      if (anns && anns.length > 0) {
        lines.push("> **Deduplication notes:**");
        for (const a of anns) lines.push(`> - ${a}`);
        lines.push("");
      }
      lines.push(r.content);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(`*Pulled from M365 via WorkIQ on ${now}. Re-run "Pull from M365" to refresh.*`);
  lines.push("");

  return lines.join("\n");
}

// ───────────────────────────────────────────────────────────────────────────
// SharePoint URL extraction
// ───────────────────────────────────────────────────────────────────────────

// Matches SharePoint/OneDrive document URLs in WorkIQ natural-language output.
// Covers standard URLs, sharing links (:w:/, :x:/, :p:/, :b:/), and -df variants.
const SP_URL_PATTERN = /https?:\/\/[\w.-]+\.sharepoint(?:-df)?\.com\/[^\s)>\]"']+/gi;

// File extensions we can download and potentially convert
const DOWNLOADABLE_EXTENSIONS = new Set([
  ".docx", ".xlsx", ".xls", ".pptx", ".pdf", ".csv", ".txt", ".md", ".json",
]);

/**
 * Extract unique SharePoint/OneDrive URLs from WorkIQ query results.
 * Filters to downloadable document types, deduplicates by URL.
 *
 * @param {Array<{id: number, label: string, content: string, error: string|null}>} results
 * @returns {Array<{url: string, source: string}>}
 */
function extractSharePointUrls(results) {
  const seen = new Set();
  const urls = [];

  for (const r of results) {
    if (!r.content) continue;

    SP_URL_PATTERN.lastIndex = 0;
    let match;
    while ((match = SP_URL_PATTERN.exec(r.content)) !== null) {
      let url = match[0];

      // Strip trailing punctuation that leaked from prose
      url = url.replace(/[.,;:!?)]+$/, "");

      if (seen.has(url)) continue;
      seen.add(url);

      // Check if URL points to a downloadable file type
      // SharePoint sharing links encode the extension in the path (:w: = docx, :x: = xlsx, :p: = pptx, :b: = pdf)
      const lower = url.toLowerCase();
      const hasFileExt = [...DOWNLOADABLE_EXTENSIONS].some((ext) => lower.includes(ext));
      const hasSharingCode = /\/:(?:[wxpb]):\//.test(lower);

      if (hasFileExt || hasSharingCode) {
        urls.push({ url, source: r.label });
      }
    }
  }

  return urls;
}

// ───────────────────────────────────────────────────────────────────────────
// CLSCMS account library direct search
// ───────────────────────────────────────────────────────────────────────────

const CLSCMS_SITE_PATH = "/teams/CLSCMS";
const CLSCMS_HOSTNAME = "microsoft.sharepoint.com";

/** Escape a value for use inside an OData single-quoted string literal. */
function escapeOData(str) {
  return str.replace(/'/g, "''");
}

/** Sanitize a remote filename — strip path separators and ".." segments. */
function sanitizeFilename(name) {
  return path.basename(name).replace(/\.\./g, "_");
}

/** Escape text for safe inclusion in a Markdown table cell. */
function escapeMd(str) {
  if (!str) return "";
  return String(str).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Search the CLSCMS account library directly via Graph API for files
 * matching the customer name or aliases. Returns driveItems ready for download.
 *
 * The CLSCMS site has a dedicated "Account" drive (document library) at
 * https://microsoft.sharepoint.com/teams/CLSCMS/account — customer SDRs
 * and agent specs live here, organized by customer folder.
 *
 * Folder structure: Account / CUSTOMER_NAME_guid / incident / AGENT_guid / files
 * After search, resolves parent folder paths and filters out false positives
 * (files that match the search term but live in a different customer's folder).
 *
 * Duplicate filenames (same name, different folders) get prefixed with the
 * opportunity folder name to disambiguate.
 *
 * @param {string} token  Graph API token for Microsoft tenant
 * @param {string} customer  Primary customer name
 * @param {string[]} [aliases]  Alternative names
 * @returns {Promise<Array<{id, name, driveId, size, mimeType}>>}
 */
async function searchCLSCMS(token, customer, aliases) {
  const { httpRequestWithRetry } = require("../../tools/lib/http");
  const headers = { Authorization: `Bearer ${token}` };
  const select = "$select=id,name,size,file,parentReference,lastModifiedDateTime";

  // Get all drives on CLSCMS site, find "Account" drive
  const siteRes = await httpRequestWithRetry("GET",
    `${GRAPH_BASE}/sites/${CLSCMS_HOSTNAME}:${CLSCMS_SITE_PATH}:/drives?$select=name,id`,
    headers, null, 1, 10000);
  if (siteRes.status !== 200) return [];

  const accountDrive = (siteRes.data.value || []).find((d) => d.name === "Account");
  if (!accountDrive) return [];

  const driveId = accountDrive.id;

  // Search for each name variant, collect unique raw results
  const names = [customer, ...(aliases || [])];
  const seen = new Set();
  const rawItems = [];

  for (const name of names) {
    if (!name || name.length < 2) continue;
    try {
      const res = await httpRequestWithRetry("GET",
        `${GRAPH_BASE}/drives/${driveId}/root/search(q='${escapeOData(name)}')?${select}&$top=20`,
        headers, null, 1, 15000);
      if (res.status === 200 && res.data.value) {
        for (const item of res.data.value) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          const ext = path.extname(item.name || "").toLowerCase();
          if (item.file && DOWNLOADABLE_EXTENSIONS.has(ext)) {
            rawItems.push({
              id: item.id,
              name: item.name,
              driveId: item.parentReference?.driveId || "",
              parentId: item.parentReference?.id || "",
              size: item.size || 0,
              mimeType: item.file?.mimeType || "",
            });
          }
        }
      }
    } catch {
      // Skip failed searches, continue with other names
    }
  }

  if (rawItems.length === 0) return [];

  // ── Resolve parent folder paths to filter false positives ──
  // Search results don't include parentReference.path, but a direct
  // GET on the parent folder does. Resolve unique parent IDs only.
  const parentPathCache = new Map();
  const uniqueParentIds = [...new Set(rawItems.map((i) => i.parentId).filter(Boolean))];

  await Promise.all(uniqueParentIds.map(async (pid) => {
    try {
      const res = await httpRequestWithRetry("GET",
        `${GRAPH_BASE}/drives/${driveId}/items/${pid}?$select=name,parentReference`,
        headers, null, 1, 10000);
      if (res.status === 200) {
        const folderPath = res.data.parentReference?.path || "";
        const folderName = res.data.name || "";
        parentPathCache.set(pid, { path: folderPath, name: folderName });
      }
    } catch { /* skip — file will be kept if name matches */ }
  }));

  // Build case-insensitive name patterns to match against folder paths
  const namePatterns = names
    .filter((n) => n && n.length >= 2)
    .map((n) => n.toLowerCase());

  // Filter: the CLSCMS Account library is organized by customer folder, so the
  // folder path is the authoritative signal. A file in TERRACON's folder tree
  // that happens to contain "Fidelity" in its name (e.g. "High Fidelity Mockups")
  // is a false positive. Only fall back to filename matching when we couldn't
  // resolve the folder path.
  const filtered = rawItems.filter((item) => {
    const parent = parentPathCache.get(item.parentId);
    if (parent) {
      // Folder path resolved — require customer name in ancestor path
      const fullPath = (parent.path + "/" + parent.name).toLowerCase();
      return namePatterns.some((p) => fullPath.includes(p));
    }
    // Couldn't resolve folder — fall back to filename match
    const lowerName = item.name.toLowerCase();
    return namePatterns.some((p) => lowerName.includes(p));
  });

  // ── Disambiguate duplicate filenames ──
  // Count occurrences of each filename
  const nameCounts = new Map();
  for (const item of filtered) {
    const key = item.name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }

  // Dedup identical files (same name + same size) — keep first occurrence
  const dedupKey = new Set();
  const items = [];
  for (const item of filtered) {
    const key = `${item.name.toLowerCase()}|${item.size}`;
    if (dedupKey.has(key)) continue;
    dedupKey.add(key);

    // For duplicate names with different sizes, prefix with parent folder name
    if (nameCounts.get(item.name.toLowerCase()) > 1) {
      const parent = parentPathCache.get(item.parentId);
      if (parent?.name) {
        // Extract readable part: "CAD - Fund Events and PM Change_GUID" → "CAD - Fund Events and PM Change"
        const folderLabel = parent.name.replace(/_[A-F0-9]{32}$/i, "").trim();
        const ext = path.extname(item.name);
        const base = path.basename(item.name, ext);
        item.name = `${base} (${folderLabel})${ext}`;
      }
    }

    items.push({
      id: item.id,
      name: item.name,
      driveId: item.driveId,
      size: item.size,
      mimeType: item.mimeType,
    });
  }

  return items;
}

// ───────────────────────────────────────────────────────────────────────────
// Graph API file resolution + download
// ───────────────────────────────────────────────────────────────────────────

/**
 * Encode a SharePoint URL for the Graph /shares endpoint.
 * Format: "u!" + base64url(url)
 */
function encodeShareUrl(url) {
  const base64 = Buffer.from(url, "utf-8").toString("base64");
  const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `u!${base64url}`;
}

// Known SharePoint hostname → tenant ID map (expand as needed)
const SP_TENANT_MAP = {
  "microsoft.sharepoint.com": "72f988bf-86f1-41af-91ab-2d7cd011db47",
  "microsoft.sharepoint-df.com": "72f988bf-86f1-41af-91ab-2d7cd011db47",
  "microsoftapc.sharepoint.com": "72f988bf-86f1-41af-91ab-2d7cd011db47",
  "microsofteur.sharepoint.com": "72f988bf-86f1-41af-91ab-2d7cd011db47",
  "microsoft-my.sharepoint.com": "72f988bf-86f1-41af-91ab-2d7cd011db47",
  "microsoft-my.sharepoint-df.com": "72f988bf-86f1-41af-91ab-2d7cd011db47",
};

/**
 * Parse a SharePoint URL into components for Graph API resolution.
 *
 * @param {string} url  SharePoint URL
 * @returns {{ hostname, sitePath, filePath, fileName, sourcedocId, isSharingLink }}
 */
function parseSharePointUrl(url) {
  const parsed = new URL(url);
  const hostname = parsed.hostname;
  const pathname = decodeURIComponent(parsed.pathname);

  // Sharing link: /:w:/, /:x:/, /:p:/, /:b:/
  const isSharingLink = /\/:(?:[wxpb]):\//.test(pathname);

  // Doc.aspx with sourcedoc GUID
  const sourcedocMatch = parsed.searchParams.get("sourcedoc");
  const sourcedocId = sourcedocMatch ? sourcedocMatch.replace(/[{}]/g, "") : null;

  // Extract filename from 'file' param or from path
  const fileParam = parsed.searchParams.get("file");
  const fileName = fileParam
    ? decodeURIComponent(fileParam)
    : path.basename(pathname.replace(/\?.*$/, ""));

  // Extract site path — /teams/X, /sites/X, or /personal/X_domain_com
  const siteMatch = pathname.match(/^(\/(?:teams|sites|personal)\/[^/]+)/i);
  const sitePath = siteMatch ? siteMatch[1] : null;

  // Extract file path within the drive (after Shared Documents or similar)
  const drivePathMatch = pathname.match(/\/(?:Shared Documents|Documents|SiteAssets|account)\/(.+?)(?:\?|$)/i);
  const filePath = drivePathMatch ? drivePathMatch[1] : null;

  return { hostname, sitePath, filePath, fileName, sourcedocId, isSharingLink };
}

/**
 * Resolve a SharePoint URL to a Graph driveItem using multiple strategies:
 * 1. Sharing link → /shares endpoint
 * 2. Direct file path → /sites/{siteId}/drive/root:/{filePath}
 * 3. Doc.aspx with filename → /sites/{siteId}/drive/root/search(q='{name}')
 *
 * @param {string} token  Graph API access token
 * @param {string} url    SharePoint document URL
 * @returns {Promise<{id: string, name: string, driveId: string, size: number, mimeType: string}|null>}
 */
async function resolveSharePointUrl(token, url) {
  const { httpRequestWithRetry } = require("../../tools/lib/http");
  const parsed = parseSharePointUrl(url);
  const headers = { Authorization: `Bearer ${token}` };
  const select = "$select=id,name,size,file,parentReference";

  const extractItem = (data) => ({
    id: data.id,
    name: data.name || "unknown",
    driveId: data.parentReference?.driveId || "",
    size: data.size || 0,
    mimeType: data.file?.mimeType || "",
  });

  try {
    // Strategy 1: Sharing links → /shares endpoint
    if (parsed.isSharingLink) {
      const encoded = encodeShareUrl(url);
      const res = await httpRequestWithRetry("GET",
        `${GRAPH_BASE}/shares/${encoded}/driveItem?${select}`,
        headers, null, 2, 15000);
      if (res.status === 200) return extractItem(res.data);
    }

    // Get the site ID (needed for strategies 2 and 3)
    let siteId = null;
    if (parsed.sitePath) {
      // Normalize: microsoft-my.sharepoint.com → microsoft-my.sharepoint.com (personal sites)
      const siteHostname = parsed.hostname.replace("-df", "");
      const siteRes = await httpRequestWithRetry("GET",
        `${GRAPH_BASE}/sites/${siteHostname}:${parsed.sitePath}:`,
        headers, null, 1, 10000);
      if (siteRes.status === 200) siteId = siteRes.data.id;
    }

    // Strategy 2: Direct file path → /sites/{siteId}/drive/root:/{filePath}
    if (siteId && parsed.filePath) {
      const encodedPath = parsed.filePath.split("/").map(encodeURIComponent).join("/");
      const res = await httpRequestWithRetry("GET",
        `${GRAPH_BASE}/sites/${siteId}/drive/root:/${encodedPath}:?${select}`,
        headers, null, 1, 10000);
      if (res.status === 200 && res.data.id) return extractItem(res.data);
    }

    // Strategy 3: Search by filename within site drive
    if (siteId && parsed.fileName && parsed.fileName.length > 3) {
      const searchName = path.basename(parsed.fileName, path.extname(parsed.fileName));
      const res = await httpRequestWithRetry("GET",
        `${GRAPH_BASE}/sites/${siteId}/drive/root/search(q='${escapeOData(searchName)}')?${select}&$top=5`,
        headers, null, 1, 15000);
      if (res.status === 200 && res.data.value?.length > 0) {
        // Prefer exact name match
        const exact = res.data.value.find((item) =>
          item.name?.toLowerCase() === parsed.fileName.toLowerCase()
        );
        return extractItem(exact || res.data.value[0]);
      }
    }

    // Strategy 4: Fallback — try shares endpoint even for non-sharing links
    if (!parsed.isSharingLink) {
      const encoded = encodeShareUrl(url);
      const res = await httpRequestWithRetry("GET",
        `${GRAPH_BASE}/shares/${encoded}/driveItem?${select}`,
        headers, null, 1, 10000);
      if (res.status === 200) return extractItem(res.data);
    }
  } catch {
    // All strategies exhausted
  }

  return null;
}

/**
 * Get a Graph token for a SharePoint hostname.
 * Maps known hostnames to tenant IDs. Only falls back to default tenant
 * for unknown hostnames (known tenants that fail = auth setup issue).
 *
 * @param {string} hostname  SharePoint hostname (e.g., "microsoft.sharepoint.com")
 * @returns {string|null} Access token or null if unavailable
 */
function getGraphTokenForHost(hostname) {
  const tenantId = SP_TENANT_MAP[hostname];

  if (tenantId) {
    // Known tenant — don't fall back to default (which is likely wrong)
    try {
      return getToken("https://graph.microsoft.com", tenantId);
    } catch {
      return null;
    }
  }

  // Unknown hostname — try default tenant (current az-login)
  try {
    return getToken("https://graph.microsoft.com");
  } catch {
    return null;
  }
}

/**
 * Download and convert SharePoint files found in WorkIQ results.
 * Also searches the CLSCMS account library directly for customer files.
 *
 * @param {Array<{url: string, source: string}>} urls  Extracted SharePoint URLs
 * @param {string} docsDir  Target docs directory
 * @param {string} customer  Customer name (for CLSCMS search)
 * @param {string[]} aliases  Customer aliases (for CLSCMS search)
 * @param {function} onProgress  SSE callback: (event) => void
 * @returns {Promise<Array<{name: string, converted: string|null, error: string|null}>>}
 */
async function downloadAndConvertFiles(urls, docsDir, customer, aliases, onProgress) {
  const { convertDocument } = require("./documents");

  // Get Microsoft tenant token (needed for CLSCMS and most SP URLs)
  const msToken = getGraphTokenForHost(CLSCMS_HOSTNAME);
  if (!msToken && urls.length === 0) {
    onProgress({
      type: "download-skipped",
      reason: `Graph API auth needed. Run: az login --tenant ${SP_TENANT_MAP[CLSCMS_HOSTNAME]}`,
    });
    return [];
  }

  // Phase 1: Search CLSCMS account library directly for customer files
  let clscmsItems = [];
  if (msToken && customer) {
    onProgress({ type: "download-progress", index: 0, total: 0, status: "resolving",
      name: "Searching CLSCMS account library..." });
    try {
      clscmsItems = await searchCLSCMS(msToken, customer, aliases);
    } catch {
      // CLSCMS search failed — continue with URL extraction
    }
  }

  // Build unified download list: CLSCMS items (pre-resolved) + URL items (need resolution)
  fs.mkdirSync(docsDir, { recursive: true });
  const existingFiles = new Set(fs.readdirSync(docsDir).map((f) => f.toLowerCase()));
  const totalItems = clscmsItems.length + urls.length;

  if (totalItems === 0) return [];

  onProgress({ type: "download-started", total: totalItems });

  const results = [];
  let index = 0;

  // Track Graph item IDs downloaded in CLSCMS phase so Phase 2 URL extraction
  // skips the same files (CLSCMS names include folder prefix, so name-based
  // dedup alone misses cross-phase duplicates).
  const downloadedItemIds = new Set();

  // Group URLs by hostname and get tokens per host
  const tokenCache = new Map();
  tokenCache.set(CLSCMS_HOSTNAME, msToken);
  function getTokenForUrl(url) {
    try {
      const hostname = new URL(url).hostname;
      if (tokenCache.has(hostname)) return tokenCache.get(hostname);
      const token = getGraphTokenForHost(hostname);
      tokenCache.set(hostname, token);
      return token;
    } catch {
      return null;
    }
  }

  // Phase 1a: Download CLSCMS items (already resolved — have driveId + itemId)
  for (const item of clscmsItems) {
    index++;
    const safeName = sanitizeFilename(item.name);
    const lowerName = safeName.toLowerCase();
    const ext = path.extname(lowerName);
    const baseName = path.basename(safeName, path.extname(safeName));
    const possibleConverted = ext === ".docx" ? `${baseName}.md`.toLowerCase()
      : (ext === ".xlsx" || ext === ".xls") ? `${baseName}.csv`.toLowerCase()
      : lowerName;

    if (existingFiles.has(lowerName) || existingFiles.has(possibleConverted)) {
      results.push({ name: safeName, converted: null, error: "Already exists in docs" });
      onProgress({ type: "download-progress", index, total: totalItems, name: safeName, status: "skipped", detail: "Already in docs" });
      continue;
    }

    if (item.size > 50 * 1024 * 1024) {
      results.push({ name: safeName, converted: null, error: `File too large: ${Math.round(item.size / 1024 / 1024)}MB` });
      onProgress({ type: "download-progress", index, total: totalItems, name: safeName, status: "skipped", detail: "Too large (>50MB)" });
      continue;
    }

    onProgress({ type: "download-progress", index, total: totalItems, name: safeName, status: "downloading" });

    try {
      const tempPath = path.join(docsDir, safeName);
      await downloadFile(msToken, item.id, tempPath, item.driveId);
      downloadedItemIds.add(item.id);
      let convertedName = null, convErr = null;
      try {
        const result = await convertDocument(tempPath, docsDir);
        convertedName = result.convertedName;
        convErr = result.error;
      } catch (e) { convErr = `Conversion failed: ${String(e).slice(0, 200)}`; }
      const finalName = convertedName || safeName;
      existingFiles.add(finalName.toLowerCase());
      results.push({ name: safeName, converted: convertedName, error: convErr });
      onProgress({ type: "download-progress", index, total: totalItems, name: safeName, converted: convertedName, status: "done" });
    } catch (err) {
      results.push({ name: safeName, converted: null, error: `Download failed: ${err.message}` });
      onProgress({ type: "download-progress", index, total: totalItems, name: safeName, status: "error", detail: "Download failed" });
    }
  }

  // Phase 2: Download files from WorkIQ-extracted URLs

  for (const { url, source } of urls) {
    index++;

    // Get token for this URL's host
    const token = getTokenForUrl(url);
    if (!token) {
      const hostname = new URL(url).hostname;
      results.push({ name: url, converted: null, error: `No auth for ${hostname}` });
      onProgress({ type: "download-progress", index, total: totalItems, url, status: "error", detail: `No auth for ${hostname}` });
      continue;
    }

    onProgress({ type: "download-progress", index, total: totalItems, url, status: "resolving" });

    // Resolve URL to driveItem
    const item = await resolveSharePointUrl(token, url);
    if (!item || !item.driveId) {
      results.push({ name: url, converted: null, error: "Could not resolve SharePoint URL" });
      onProgress({ type: "download-progress", index, total: totalItems, url, status: "error", detail: "Could not resolve URL" });
      continue;
    }

    // Skip if this exact item was already downloaded in CLSCMS phase
    // (CLSCMS names include folder prefix so filename dedup alone won't catch this)
    if (downloadedItemIds.has(item.id)) {
      onProgress({ type: "download-progress", index, total: totalItems, name: item.name, status: "skipped", detail: "Already downloaded from CLSCMS" });
      continue;
    }

    // Skip if already downloaded (from earlier URL or pre-existing file)
    const safeName2 = sanitizeFilename(item.name);
    const lowerName = safeName2.toLowerCase();
    const ext = path.extname(lowerName);
    const baseName = path.basename(safeName2, path.extname(safeName2));
    const possibleConverted = ext === ".docx" ? `${baseName}.md`.toLowerCase()
      : (ext === ".xlsx" || ext === ".xls") ? `${baseName}.csv`.toLowerCase()
      : lowerName;

    if (existingFiles.has(lowerName) || existingFiles.has(possibleConverted)) {
      results.push({ name: safeName2, converted: null, error: "Already exists in docs" });
      onProgress({ type: "download-progress", index, total: totalItems, name: safeName2, status: "skipped", detail: "Already in docs" });
      continue;
    }

    if (item.size > 50 * 1024 * 1024) {
      results.push({ name: safeName2, converted: null, error: `File too large: ${Math.round(item.size / 1024 / 1024)}MB` });
      onProgress({ type: "download-progress", index, total: totalItems, name: safeName2, status: "skipped", detail: "Too large (>50MB)" });
      continue;
    }

    // Download
    const tempPath = path.join(docsDir, safeName2);
    onProgress({ type: "download-progress", index, total: totalItems, name: safeName2, status: "downloading" });

    try {
      await downloadFile(token, item.id, tempPath, item.driveId);
    } catch (err) {
      results.push({ name: safeName2, converted: null, error: `Download failed: ${err.message}` });
      onProgress({ type: "download-progress", index, total: totalItems, name: safeName2, status: "error", detail: "Download failed" });
      continue;
    }

    downloadedItemIds.add(item.id);

    // Convert if needed
    let convertedName = null;
    let convErr = null;
    try {
      const result = await convertDocument(tempPath, docsDir);
      convertedName = result.convertedName;
      convErr = result.error;
    } catch (convError) {
      convErr = `Conversion failed: ${String(convError).slice(0, 200)}`;
    }
    existingFiles.add((convertedName || safeName2).toLowerCase());
    results.push({ name: safeName2, converted: convertedName, error: convErr });
    onProgress({ type: "download-progress", index, total: totalItems, name: safeName2, converted: convertedName, status: "done" });
  }

  const downloaded = results.filter((r) => !r.error || r.error === "Already exists in docs");
  onProgress({
    type: "download-done",
    total: totalItems,
    downloaded: downloaded.length,
    errors: results.filter((r) => r.error && r.error !== "Already exists in docs").length,
  });

  return results;
}

module.exports = {
  isWorkIQAvailable,
  checkWorkIQAuth,
  runWorkIQQuery,
  runWorkIQQueryWithRetry,
  runQueriesBatched,
  isAuthError,
  buildQueries,
  deduplicateDocuments,
  assembleContextFile,
  extractSharePointUrls,
  downloadAndConvertFiles,
  escapeMd,
};
