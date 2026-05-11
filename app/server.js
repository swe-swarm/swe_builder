#!/usr/bin/env node
/**
 * MCS Agent Builder — Express.js Server
 *
 * Port of server.py — single process serving:
 *   - REST API for project/agent/document CRUD
 *   - Pre-built React SPA (app/dist/)
 *   - WebSocket terminal (node-pty) on /ws path
 *
 * No Python dependency. No separate terminal sidecar.
 *
 * Usage: node app/server.js
 *   env PORT=8000 (default)
 *   env BUILD_GUIDES=/path/to/projects (default: ~/swe_builder)
 */

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { attachTerminal } = require("./lib/terminal");
const { migrateBrief } = require("./lib/brief-migrate");
const { convertDocument, extractContent, NEEDS_CONVERSION } = require("./lib/documents");
const { isWorkIQAvailable, checkWorkIQAuth, runQueriesBatched, buildQueries, deduplicateDocuments, assembleContextFile, extractSharePointUrls, downloadAndConvertFiles, escapeMd } = require("./lib/workiq");
const {
  ensureDirs,
  listProjects,
  getProject,
  getDocStatus,
  humanizeName,
} = require("./lib/projects");

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SCRIPT_DIR = __dirname;
const BASE_DIR = path.resolve(SCRIPT_DIR, "..");
const DIST_DIR = path.join(SCRIPT_DIR, "dist");

// Build-Guides location: env var > config file > ~/swe_builder
function resolveBuildGuides() {
  if (process.env.BUILD_GUIDES) return process.env.BUILD_GUIDES;

  const configFile = path.join(os.homedir(), ".swe_builder", "config.json");
  if (fs.existsSync(configFile)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      if (cfg.buildGuidesPath) return cfg.buildGuidesPath;
    } catch { /* ignore */ }
  }

  // Default: ~/swe_builder — but also check if running from repo with Build-Guides/
  const repoBG = path.join(BASE_DIR, "Build-Guides");
  if (fs.existsSync(repoBG)) return repoBG;

  return path.join(os.homedir(), "swe_builder");
}

const BUILD_GUIDES = resolveBuildGuides();

// ---------------------------------------------------------------------------
// Express app setup
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT, 10) || 8000;

const app = express();
const server = http.createServer(app);

// CORS: restricted to localhost origins
app.use(
  cors({
    origin: [
      `http://localhost:${PORT}`,
      `http://127.0.0.1:${PORT}`,
      "http://localhost:8080", // Vite dev server
    ],
  })
);

app.use(express.json({ limit: "10mb" }));

// File upload via multer — disk storage, 50MB limit
const upload = multer({
  dest: path.join(os.tmpdir(), "mcs-uploads"),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// WebSocket terminal — same port, /ws path
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: "/ws" });
attachTerminal(wss, BASE_DIR);

// ---------------------------------------------------------------------------
// Helpers — path safety
// ---------------------------------------------------------------------------

/** Sanitize a route parameter to prevent path traversal */
function safeSlug(param) {
  return param.replace(/[^\w-]/g, "");
}

/** Verify resolved path is within the expected base directory */
function assertWithin(base, target) {
  const resolvedBase = path.resolve(base) + path.sep;
  return path.resolve(target).startsWith(resolvedBase);
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", terminal: wss.clients.size > 0 });
});
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", terminal: wss.clients.size > 0 });
});

// Config — terminal WS is now same port
app.get("/api/config", (req, res) => {
  res.json({ terminalWsUrl: `ws://localhost:${PORT}/ws` });
});

// --- Projects ---

app.get("/api/projects", (req, res) => {
  const projects = listProjects(BUILD_GUIDES);
  res.json({
    generated_at: new Date().toISOString(),
    project_count: projects.length,
    projects,
  });
});

app.get("/api/projects/:projectId", (req, res) => {
  const project = getProject(BUILD_GUIDES, req.params.projectId);
  if (!project) return res.status(404).json({ detail: `Project '${req.params.projectId}' not found` });
  res.json(project);
});

app.post("/api/projects", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ detail: "Project name required" });

  const folderName = name.replace(/ /g, "-").replace(/[^\w-]/g, "");
  if (!folderName) return res.status(400).json({ detail: "Invalid project name" });

  const folder = path.join(BUILD_GUIDES, folderName);
  if (fs.existsSync(folder)) {
    return res.json({
      id: folderName,
      name: humanizeName(folderName),
      path: `Build-Guides/${folderName}`,
      existed: true,
    });
  }

  fs.mkdirSync(path.join(folder, "docs"), { recursive: true });

  res.json({
    id: folderName,
    name: humanizeName(folderName),
    path: `Build-Guides/${folderName}`,
    existed: false,
  });
});

app.delete("/api/projects/:projectId", (req, res) => {
  const projectId = safeSlug(req.params.projectId);
  const folder = path.join(BUILD_GUIDES, projectId);
  if (!assertWithin(BUILD_GUIDES, folder) || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return res.status(404).json({ detail: `Project '${projectId}' not found` });
  }
  fs.rmSync(folder, { recursive: true, force: true });
  res.json({ deleted: true, project_id: projectId });
});

// --- Agents ---

app.get("/api/projects/:projectId/agents/:agentId", (req, res) => {
  const agentDir = path.join(BUILD_GUIDES, req.params.projectId, "agents", req.params.agentId);
  if (!fs.existsSync(agentDir) || !fs.statSync(agentDir).isDirectory()) {
    return res.status(404).json({ detail: `Agent '${req.params.agentId}' not found` });
  }

  const briefFile = path.join(agentDir, "brief.json");
  let brief = null;
  if (fs.existsSync(briefFile)) {
    try {
      const raw = fs.readFileSync(briefFile, "utf-8").replace(/^\uFEFF/, "");
      brief = JSON.parse(raw);
      // Auto-migrate v1 → v2 on read
      if (brief && brief.step1 && !brief.agent) {
        brief = migrateBrief(brief);
        fs.writeFileSync(briefFile, JSON.stringify(brief, null, 2), "utf-8");
      }
    } catch { /* ignore */ }
  }

  let name;
  if (brief && (brief.agent || {}).name) {
    name = brief.agent.name;
  } else if (brief && (brief.step1 || {}).agentName) {
    name = brief.step1.agentName;
  } else {
    name = humanizeName(req.params.agentId);
  }

  let fileMtime = null;
  if (fs.existsSync(briefFile)) {
    fileMtime = new Date(fs.statSync(briefFile).mtimeMs).toISOString();
  }

  res.json({
    id: req.params.agentId,
    name,
    brief,
    _file_mtime: fileMtime,
    has_instructions: brief ? !!brief.instructions : false,
    has_evals: fs.existsSync(path.join(agentDir, "evals.csv")),
    has_build_report: fs.existsSync(path.join(agentDir, "build-report.md")),
  });
});

app.put("/api/projects/:projectId/agents/:agentId/state", (req, res) => {
  const folder = path.join(BUILD_GUIDES, req.params.projectId);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return res.status(404).json({ detail: `Project '${req.params.projectId}' not found` });
  }

  const agentDir = path.join(folder, "agents", req.params.agentId);
  fs.mkdirSync(agentDir, { recursive: true });

  const stateFile = path.join(agentDir, "brief.json");
  let existing = {};
  if (fs.existsSync(stateFile)) {
    try {
      const raw = fs.readFileSync(stateFile, "utf-8").replace(/^\uFEFF/, "");
      existing = JSON.parse(raw);
    } catch { /* ignore */ }
  }

  Object.assign(existing, req.body);
  existing.updated_at = new Date().toISOString();

  fs.writeFileSync(stateFile, JSON.stringify(existing, null, 2), "utf-8");
  res.json({ saved: true });
});

app.post("/api/projects/:projectId/agents/:agentId/scaffold-children", (req, res) => {
  const folder = path.join(BUILD_GUIDES, req.params.projectId);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return res.status(404).json({ detail: `Project '${req.params.projectId}' not found` });
  }

  const agentDir = path.join(folder, "agents", req.params.agentId);
  const briefFile = path.join(agentDir, "brief.json");
  if (!fs.existsSync(briefFile)) {
    return res.status(404).json({ detail: `Agent '${req.params.agentId}' has no brief.json` });
  }

  let brief;
  try {
    const raw = fs.readFileSync(briefFile, "utf-8").replace(/^\uFEFF/, "");
    brief = JSON.parse(raw);
  } catch (e) {
    return res.status(500).json({ detail: `Failed to read brief: ${e.message}` });
  }

  const children = ((brief.architecture || {}).children || []);
  if (!children.length) {
    return res.json({ created: [], message: "No children defined in architecture" });
  }

  const created = [];
  const agentsDir = path.join(folder, "agents");
  fs.mkdirSync(agentsDir, { recursive: true });

  for (const child of children) {
    if (child.agentFolderId) continue;

    const childName = (child.name || "").trim();
    if (!childName) continue;

    let folderName = childName.toLowerCase().replace(/ /g, "-").replace(/[^\w-]/g, "");
    if (!folderName) folderName = `agent-${created.length + 1}`;

    const baseName = folderName;
    let counter = 1;
    while (fs.existsSync(path.join(agentsDir, folderName))) {
      folderName = `${baseName}-${counter}`;
      counter++;
    }

    const childDir = path.join(agentsDir, folderName);
    fs.mkdirSync(childDir, { recursive: true });

    const childBrief = {
      _schema: "2.0",
      agent: {
        name: childName,
        description: child.role || "",
        persona: "",
        responseFormat: "",
        primaryUsers: "",
        secondaryUsers: "",
      },
      business: {
        useCase: child.role || "",
        problemStatement: "",
        challenges: [],
        benefits: [],
        successCriteria: [],
        stakeholders: { sponsor: "", owner: "", users: "" },
      },
      architecture: {
        type: "single-agent",
        reason: `Specialist agent — child of ${(brief.agent || {}).name || req.params.agentId}`,
      },
      updated_at: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(childDir, "brief.json"),
      JSON.stringify(childBrief, null, 2),
      "utf-8"
    );

    child.agentFolderId = folderName;
    created.push(folderName);
  }

  // Save parent brief with updated agentFolderIds
  brief.updated_at = new Date().toISOString();
  fs.writeFileSync(briefFile, JSON.stringify(brief, null, 2), "utf-8");

  res.json({ created, message: `Created ${created.length} agent folder(s)` });
});

app.delete("/api/projects/:projectId/agents/:agentId", (req, res) => {
  const projectId = safeSlug(req.params.projectId);
  const agentId = safeSlug(req.params.agentId);
  const agentDir = path.join(BUILD_GUIDES, projectId, "agents", agentId);
  if (!assertWithin(BUILD_GUIDES, agentDir) || !fs.existsSync(agentDir) || !fs.statSync(agentDir).isDirectory()) {
    return res.status(404).json({ detail: `Agent '${agentId}' not found` });
  }
  fs.rmSync(agentDir, { recursive: true, force: true });
  res.json({ deleted: true, agent_id: agentId });
});

// --- Documents ---

app.post("/api/projects/:projectId/upload", upload.single("file"), async (req, res) => {
  const folder = path.join(BUILD_GUIDES, req.params.projectId);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return res.status(404).json({ detail: `Project '${req.params.projectId}' not found` });
  }

  if (!req.file) return res.status(400).json({ detail: "No file uploaded" });

  ensureDirs(folder);
  const docsDir = path.join(folder, "docs");

  const originalName = req.file.originalname || "upload";
  const ext = path.extname(originalName).toLowerCase();
  const safeBase = path.basename(originalName, path.extname(originalName))
    .toLowerCase()
    .replace(/[^\w-]/g, "_");
  const rawName = `${safeBase}${ext}`;
  const rawPath = path.join(docsDir, rawName);

  // Move uploaded temp file to docs/
  fs.renameSync(req.file.path, rawPath);

  let finalName = rawName;
  let conversionError = null;

  if (NEEDS_CONVERSION.has(ext)) {
    const result = await convertDocument(rawPath, docsDir);
    if (result.error && !result.convertedName) {
      // Encrypted file — delete and return error
      if (result.error.includes("encrypted")) {
        try { fs.unlinkSync(rawPath); } catch { /* ignore */ }
        return res.status(422).json({ detail: result.error });
      }
      conversionError = result.error;
    }
    if (result.convertedName) {
      finalName = result.convertedName;
    }
  }

  const briefOutdated = fs.existsSync(path.join(folder, "doc-manifest.json"));
  const stat = fs.existsSync(path.join(docsDir, finalName))
    ? fs.statSync(path.join(docsDir, finalName))
    : null;

  res.json({
    uploaded: true,
    filename: finalName,
    conversionError,
    size: stat ? stat.size : req.file.size,
    path: `Build-Guides/${req.params.projectId}/docs/${finalName}`,
    briefOutdated,
  });
});

app.post("/api/projects/:projectId/paste", (req, res) => {
  const folder = path.join(BUILD_GUIDES, req.params.projectId);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return res.status(404).json({ detail: `Project '${req.params.projectId}' not found` });
  }

  ensureDirs(folder);
  const text = (req.body.text || "").trim();
  const title = (req.body.title || "").trim() || "pasted-context";

  if (!text) return res.status(400).json({ detail: "No text provided" });

  const safeBase = title.toLowerCase().replace(/ /g, "-").replace(/[^\w-]/g, "_");
  const docsDir = path.join(folder, "docs");

  let mdName = `${safeBase}.md`;
  let mdPath = path.join(docsDir, mdName);
  let counter = 1;
  while (fs.existsSync(mdPath)) {
    mdName = `${safeBase}-${counter}.md`;
    mdPath = path.join(docsDir, mdName);
    counter++;
  }

  const heading = title.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  fs.writeFileSync(mdPath, `# ${heading}\n\n${text}`, "utf-8");

  res.json({
    saved: true,
    filename: mdName,
    size: text.length,
    path: `Build-Guides/${req.params.projectId}/docs/${mdName}`,
  });
});

app.get("/api/projects/:projectId/doc-status", (req, res) => {
  const result = getDocStatus(BUILD_GUIDES, req.params.projectId);
  if (!result) {
    return res.status(404).json({ detail: `Project '${req.params.projectId}' not found` });
  }
  res.json(result);
});

app.get("/api/projects/:projectId/docs/:filename/raw", (req, res) => {
  const folder = path.join(BUILD_GUIDES, req.params.projectId);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return res.status(404).json({ detail: `Project '${req.params.projectId}' not found` });
  }

  const safe = req.params.filename.replace(/[^\w\-.]/g, "_");
  let target = path.join(folder, "docs", safe);
  if (!fs.existsSync(target)) target = path.join(folder, safe);
  if (!fs.existsSync(target)) {
    return res.status(404).json({ detail: `File '${safe}' not found` });
  }

  // Path traversal defense
  if (!path.resolve(target).startsWith(path.resolve(folder))) {
    return res.status(400).json({ detail: "Invalid file path" });
  }

  res.sendFile(path.resolve(target));
});

app.delete("/api/projects/:projectId/docs/:filename", (req, res) => {
  const folder = path.join(BUILD_GUIDES, req.params.projectId);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return res.status(404).json({ detail: `Project '${req.params.projectId}' not found` });
  }

  const filename = req.params.filename;
  const docsDir = path.join(folder, "docs");
  const target = path.join(docsDir, filename);

  // Path traversal check
  if (!path.resolve(target).startsWith(path.resolve(docsDir))) {
    return res.status(400).json({ detail: "Invalid file path" });
  }

  if (!fs.existsSync(target)) {
    return res.status(404).json({ detail: `File '${filename}' not found in docs/` });
  }

  fs.unlinkSync(target);
  res.json({ deleted: true, filename });
});

app.get("/api/projects/:projectId/docs/:filename/content", async (req, res) => {
  const folder = path.join(BUILD_GUIDES, req.params.projectId);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return res.status(404).json({ detail: `Project '${req.params.projectId}' not found` });
  }

  const filename = req.params.filename;
  const docsDir = path.join(folder, "docs");
  const target = path.join(docsDir, filename);

  // Path traversal check
  if (!path.resolve(target).startsWith(path.resolve(docsDir))) {
    return res.status(400).json({ detail: "Invalid file path" });
  }

  if (!fs.existsSync(target)) {
    return res.status(404).json({ detail: `File '${filename}' not found` });
  }

  const result = await extractContent(target);
  res.json({ filename, content: result.content, error: result.error || undefined });
});

// ---------------------------------------------------------------------------
// Pull from M365 via WorkIQ (SSE)
// ---------------------------------------------------------------------------

app.post("/api/projects/:projectId/pull-m365", async (req, res) => {
  const folder = path.join(BUILD_GUIDES, req.params.projectId);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return res.status(404).json({ detail: `Project '${req.params.projectId}' not found` });
  }

  const customer = (req.body.customer || "").trim();
  const timeRange = req.body.timeRange || "90d";
  const aliases = (req.body.aliases || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!customer) return res.status(400).json({ detail: "Customer name required" });

  const available = await isWorkIQAvailable();
  if (!available) {
    return res.status(503).json({
      detail: "WorkIQ CLI not available. Install WorkIQ and run 'workiq ask -q \"test\"' to authenticate.",
    });
  }

  // Pre-flight auth check — verify session is active before starting SSE
  const authCheck = await checkWorkIQAuth();
  if (!authCheck.ok) {
    return res.status(503).json({
      detail: "WorkIQ session expired. Run 'workiq ask -q \"test\"' in a terminal to re-authenticate, then try again.",
    });
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let clientDisconnected = false;
  req.on("close", () => { clientDisconnected = true; });

  const sendSSE = (data) => {
    if (clientDisconnected) return;
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  try {
    const queries = buildQueries(customer, timeRange, aliases);
    sendSSE({ type: "started", total: queries.length, customer });

    // AbortController lets us kill in-flight child processes when auth fails
    const abortController = new AbortController();

    // Run queries in batches of 2 to avoid the Windows WAM broker bug (#71)
    // that crashes after 3+ simultaneous MSAL auth calls in console apps.
    const { results, authAborted } = await runQueriesBatched(queries, {
      batchSize: 2,
      signal: abortController.signal,
      onProgress: (queryId, label, status, completed, total) => {
        sendSSE({ type: "progress", queryId, label, status, completed, total });
      },
    });

    // If auth failed mid-pull, abort remaining queries and end SSE
    if (authAborted) {
      abortController.abort();
      sendSSE({
        type: "error",
        detail: "WorkIQ session expired during pull. Run 'workiq ask -q \"test\"' in a terminal to re-authenticate, then try again.",
      });
      res.end();
      return;
    }
    if (clientDisconnected) {
      res.end();
      return;
    }

    // Minimum success threshold — require at least 3/4 queries to produce content.
    // A mostly-empty context file with 3 "Query failed" sections isn't useful.
    const successCount = results.filter((r) => !r.error && r.content).length;
    const minRequired = Math.max(1, queries.length - 1); // at least N-1 must succeed
    if (successCount < minRequired) {
      const failedLabels = results.filter((r) => r.error).map((r) => `${r.label}: ${r.error}`);
      sendSSE({
        type: "error",
        detail: `Only ${successCount}/${queries.length} queries succeeded (minimum ${minRequired} required). Failed: ${failedLabels.join("; ")}`,
      });
      res.end();
      return;
    }

    // Dedup pass + assemble file
    const dedup = deduplicateDocuments(results);
    ensureDirs(folder);
    const docsDir = path.join(folder, "docs");
    const safeCustomer = customer.toLowerCase().replace(/[^\w-]/g, "_");
    const filename = `workiq-context-${safeCustomer}.md`;
    const filePath = path.join(docsDir, filename);
    const content = assembleContextFile(customer, results, timeRange, dedup);

    try {
      fs.writeFileSync(filePath, content, "utf-8");
      const stat = fs.statSync(filePath);
      sendSSE({
        type: "done",
        filename,
        size: stat.size,
        successCount: results.filter((r) => !r.error && r.content).length,
        totalQueries: queries.length,
      });
    } catch (e) {
      sendSSE({ type: "error", detail: `Failed to save context file: ${e.message}` });
    }

    // Phase 2: Download actual files — CLSCMS library search + SharePoint URLs from results
    if (!clientDisconnected) {
      const spUrls = extractSharePointUrls(results);
      try {
        const downloadResults = await downloadAndConvertFiles(spUrls, docsDir, customer, aliases, sendSSE);

        // Append download summary to context file
        const downloaded = downloadResults.filter((r) => !r.error || r.error === "Already exists in docs");
        if (downloaded.length > 0) {
          const appendLines = [
            "",
            "## Downloaded Documents",
            "",
            `> ${downloaded.length} file(s) downloaded and saved to docs/`,
            "",
            "| File | Status |",
            "|------|--------|",
          ];
          for (const d of downloadResults) {
            const status = d.error
              ? (d.error === "Already exists in docs" ? "Skipped (exists)" : `Error: ${d.error}`)
              : (d.converted ? `Converted to ${d.converted}` : "Saved");
            appendLines.push(`| ${escapeMd(d.name)} | ${escapeMd(status)} |`);
          }
          appendLines.push("");
          fs.appendFileSync(filePath, appendLines.join("\n"), "utf-8");
        }
      } catch (e) {
        sendSSE({ type: "download-skipped", reason: `File download failed: ${e.message}` });
      }
    }
  } catch (e) {
    sendSSE({ type: "error", detail: `Unexpected error: ${e.message}` });
  }

  res.end();
});

// ---------------------------------------------------------------------------
// Static file serving — SPA with catch-all
// ---------------------------------------------------------------------------

if (fs.existsSync(path.join(DIST_DIR, "assets"))) {
  app.use("/assets", express.static(path.join(DIST_DIR, "assets")));
}

// SPA catch-all — must be last (Express v5 requires named param, not bare *)
app.get("/{*splat}", (req, res) => {
  // Skip API routes that weren't matched
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ detail: "Not found" });
  }

  // Try serving a static file from dist/
  const staticFile = path.join(DIST_DIR, req.path);
  if (
    fs.existsSync(staticFile) &&
    fs.statSync(staticFile).isFile() &&
    path.resolve(staticFile).startsWith(path.resolve(DIST_DIR))
  ) {
    return res.sendFile(staticFile);
  }

  // Fall back to index.html for client-side routing
  const index = path.join(DIST_DIR, "index.html");
  if (fs.existsSync(index)) {
    return res.sendFile(index);
  }

  res.status(200).send(
    "<h2>Frontend not built</h2>" +
    "<p>Run <code>npm run frontend:build</code> from the repo root, then refresh.</p>"
  );
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

app.use((err, req, res, next) => {
  // Multer file size error
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ detail: "File too large (max 50 MB)" });
  }
  console.error("[server]", err.message || err);
  res.status(500).json({ detail: err.message || "Internal server error" });
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (require.main === module) {
  // Ensure Build-Guides directory exists
  if (!fs.existsSync(BUILD_GUIDES)) {
    fs.mkdirSync(BUILD_GUIDES, { recursive: true });
    console.log(`  Created project directory: ${BUILD_GUIDES}`);
  }

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`MCS Agent Builder — http://localhost:${PORT}`);
    console.log(`  Base dir: ${BASE_DIR}`);
    console.log(`  Projects: ${BUILD_GUIDES}`);
    console.log(`  Terminal: ws://localhost:${PORT}/ws`);
  });
}

// Export for start.js to spawn
module.exports = { app, server, PORT, BUILD_GUIDES, BASE_DIR };
