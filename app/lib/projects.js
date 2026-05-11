/**
 * Project and agent CRUD helpers.
 *
 * Extracts the scanning/listing/document helpers from server.py
 * into a reusable module consumed by server.js routes.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  humanizeName,
  calcReadiness,
  isBuildReady,
  determineStage,
  hasEvalResults,
  isV2,
  SKIP_FOLDERS,
} = require("./readiness");
const { migrateBrief } = require("./brief-migrate");

// File types shown in the dashboard document list
const DOC_EXTENSIONS = new Set([
  ".md", ".csv", ".json", ".txt",
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp",
  ".pdf",
  ".docx", ".pptx", ".xlsx", ".xls",
]);

// Binary Office formats that need text extraction
const NEEDS_CONVERSION = new Set([".docx", ".pptx", ".xlsx", ".xls"]);

// Formats Claude Code reads natively
const NATIVE_READABLE = new Set([
  ".md", ".csv", ".json", ".txt",
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp",
  ".pdf", ".ipynb",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDirs(folder) {
  const docsDir = path.join(folder, "docs");
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
}

function fileSha256(fp) {
  const hash = crypto.createHash("sha256");
  const content = fs.readFileSync(fp);
  hash.update(content);
  return hash.digest("hex");
}

function loadManifest(folder) {
  const manifestPath = path.join(folder, "doc-manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const raw = fs.readFileSync(manifestPath, "utf-8").replace(/^\uFEFF/, "");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Document scanning
// ---------------------------------------------------------------------------

function scanDocs(folder) {
  const docsDir = path.join(folder, "docs");
  const docs = [];

  const manifest = loadManifest(folder);
  const manifestEntries = {};
  if (manifest) {
    for (const entry of manifest.docsProcessed || []) {
      manifestEntries[entry.filename] = entry;
    }
  }

  if (fs.existsSync(docsDir)) {
    const files = fs.readdirSync(docsDir).sort();
    for (const name of files) {
      const fp = path.join(docsDir, name);
      if (!fs.statSync(fp).isFile()) continue;
      const ext = path.extname(name).toLowerCase();
      if (!DOC_EXTENSIONS.has(ext)) continue;

      const stat = fs.statSync(fp);
      let isNew = true;
      let isModified = false;

      if (manifest !== null) {
        const known = manifestEntries[name];
        if (known) {
          isNew = false;
          const knownSize = known.size;
          const knownMtime = known.mtime;
          if (knownSize != null && knownMtime != null) {
            isModified =
              stat.size !== knownSize ||
              Math.abs(stat.mtimeMs / 1000 - knownMtime) > 1.0;
          } else if (known.sha256) {
            isModified = false; // Old manifest — can't compare cheaply
          }
        }
      }

      docs.push({
        filename: name,
        size: stat.size,
        isNew,
        isModified,
      });
    }
  }

  return docs;
}

// ---------------------------------------------------------------------------
// Agent scanning (server-level — includes readiness, eval rates, etc.)
// ---------------------------------------------------------------------------

function scanAgents(folder) {
  const agentsDir = path.join(folder, "agents");
  const agents = [];

  if (!fs.existsSync(agentsDir)) return agents;

  const entries = fs.readdirSync(agentsDir).sort();
  for (const name of entries) {
    const agentDir = path.join(agentsDir, name);
    if (!fs.statSync(agentDir).isDirectory() || name.startsWith(".")) continue;

    const briefFile = path.join(agentDir, "brief.json");
    let brief = null;
    if (fs.existsSync(briefFile)) {
      try {
        const raw = fs.readFileSync(briefFile, "utf-8").replace(/^\uFEFF/, "");
        brief = JSON.parse(raw);
      } catch {
        // ignore
      }
    }

    // Extract name/description supporting both v1 and v2
    let agentName, agentDesc;
    if (brief && brief.step1 && !brief.agent) {
      agentName = (brief.step1 || {}).agentName || humanizeName(name);
      agentDesc = ((brief.step1 || {}).problem || "").slice(0, 150);
    } else if (brief) {
      agentName = (brief.agent || {}).name || humanizeName(name);
      agentDesc = (
        (brief.agent || {}).description ||
        (brief.business || {}).useCase ||
        ""
      ).slice(0, 150);
    } else {
      agentName = humanizeName(name);
      agentDesc = "";
    }

    // Eval pass rate
    let evalPassRate = null;
    if (brief) {
      let totalTested = 0;
      let totalPassed = 0;
      for (const es of brief.evalSets || []) {
        for (const t of es.tests || []) {
          const lr = t.lastResult;
          if (lr) {
            totalTested++;
            if (lr.pass) totalPassed++;
          }
        }
      }
      if (totalTested > 0) {
        evalPassRate = Math.round((totalPassed / totalTested) * 100);
      } else {
        // Legacy fallback
        const er = brief.evalResults || {};
        if (typeof er === "object") {
          const summary = er.summary || {};
          if ((summary.total || 0) > 0) {
            const pr = summary.passRate;
            if (typeof pr === "string" && pr.endsWith("%")) {
              const num = parseFloat(pr);
              if (!isNaN(num)) evalPassRate = num;
            }
            if (evalPassRate === null) {
              const total = summary.total || 0;
              const passed = summary.passed || 0;
              if (total > 0) evalPassRate = Math.round((passed / total) * 100);
            }
          }
        }
      }
    }

    // Architecture metadata
    let archType = "";
    let archChildren = [];
    if (brief) {
      const arch = brief.architecture || {};
      if (typeof arch === "object") {
        archType = arch.type || "";
        for (const child of arch.children || []) {
          const fid = child.agentFolderId || "";
          if (fid) archChildren.push(fid);
        }
      }
    }

    // Workflow phase
    let workflowPhase = null;
    if (brief) {
      const wf = brief.workflow || {};
      if (typeof wf === "object" && wf.phase) {
        workflowPhase = wf.phase;
      }
    }

    agents.push({
      id: name,
      name: agentName,
      description: agentDesc,
      has_brief: brief !== null,
      has_instructions: brief ? !!brief.instructions : false,
      has_evals: fs.existsSync(path.join(agentDir, "evals.csv")),
      has_build_report: fs.existsSync(path.join(agentDir, "build-report.md")),
      readiness: brief ? calcReadiness(brief) : 0,
      build_ready: brief ? isBuildReady(brief) : false,
      eval_pass_rate: evalPassRate,
      folder: path.relative(folder, agentDir).replace(/\\/g, "/"),
      architecture_type: archType,
      architecture_children: archChildren,
      workflow_phase: workflowPhase,
      _brief: brief,
    });
  }

  return agents;
}

// ---------------------------------------------------------------------------
// Project listing
// ---------------------------------------------------------------------------

function listProjects(buildGuidesDir) {
  const projects = [];
  if (!fs.existsSync(buildGuidesDir)) return projects;

  const entries = fs.readdirSync(buildGuidesDir).sort();
  for (const name of entries) {
    const itemPath = path.join(buildGuidesDir, name);
    if (!fs.statSync(itemPath).isDirectory()) continue;
    if (SKIP_FOLDERS.has(name) || name.startsWith(".")) continue;

    const hasContent =
      fs.existsSync(path.join(itemPath, "docs")) ||
      fs.existsSync(path.join(itemPath, "agents")) ||
      fs.readdirSync(itemPath).some((f) => f.endsWith(".md")) ||
      fs.existsSync(path.join(itemPath, "session-state.json"));

    if (!hasContent) continue;

    const stat = fs.statSync(itemPath);
    const agents = scanAgents(itemPath);
    const stage = determineStage(agents);

    // Strip _brief before sending to client
    for (const a of agents) delete a._brief;

    // Lightweight doc count
    const docsDir = path.join(itemPath, "docs");
    let docCount = 0;
    if (fs.existsSync(docsDir)) {
      for (const f of fs.readdirSync(docsDir)) {
        const fp = path.join(docsDir, f);
        if (fs.statSync(fp).isFile() && DOC_EXTENSIONS.has(path.extname(f).toLowerCase())) {
          docCount++;
        }
      }
    }

    const createdAt = new Date(stat.birthtimeMs || stat.ctimeMs);
    projects.push({
      id: name,
      name: humanizeName(name),
      path: `Build-Guides/${name}`,
      agents,
      doc_count: docCount,
      stage,
      created_at: createdAt.toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      }),
    });
  }

  return projects;
}

// ---------------------------------------------------------------------------
// Single project detail
// ---------------------------------------------------------------------------

function getProject(buildGuidesDir, projectId) {
  const folder = path.join(buildGuidesDir, projectId);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return null;
  }

  ensureDirs(folder);

  const docs = scanDocs(folder);
  const agents = scanAgents(folder);
  const stage = determineStage(agents);

  for (const a of agents) delete a._brief;

  return {
    id: path.basename(folder),
    name: humanizeName(path.basename(folder)),
    path: `Build-Guides/${path.basename(folder)}`,
    agents,
    docs,
    doc_content: {},
    stage,
  };
}

// ---------------------------------------------------------------------------
// Doc status (manifest comparison)
// ---------------------------------------------------------------------------

function getDocStatus(buildGuidesDir, projectId) {
  const folder = path.join(buildGuidesDir, projectId);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return null;
  }

  const manifest = loadManifest(folder);
  if (!manifest) {
    return {
      hasManifest: false,
      lastResearchAt: null,
      newDocs: [],
      changedDocs: [],
      deletedDocs: [],
      needsUpdate: false,
    };
  }

  const manifestEntries = {};
  for (const entry of manifest.docsProcessed || []) {
    manifestEntries[entry.filename] = entry;
  }

  const docsDir = path.join(folder, "docs");
  const newDocs = [];
  const changedDocs = [];
  const currentFilenames = new Set();

  if (fs.existsSync(docsDir)) {
    const files = fs.readdirSync(docsDir).sort();
    for (const name of files) {
      const fp = path.join(docsDir, name);
      if (!fs.statSync(fp).isFile()) continue;
      if (!DOC_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;

      currentFilenames.add(name);
      const entry = manifestEntries[name];
      if (!entry) {
        newDocs.push(name);
      } else {
        const currentHash = fileSha256(fp);
        if (currentHash !== (entry.sha256 || "").toLowerCase()) {
          changedDocs.push(name);
        }
      }
    }
  }

  const deletedDocs = Object.keys(manifestEntries).filter(
    (name) => !currentFilenames.has(name)
  );

  return {
    hasManifest: true,
    lastResearchAt: manifest.lastResearchAt || null,
    newDocs,
    changedDocs,
    deletedDocs,
    needsUpdate: newDocs.length > 0 || changedDocs.length > 0,
  };
}

module.exports = {
  DOC_EXTENSIONS,
  NEEDS_CONVERSION,
  NATIVE_READABLE,
  ensureDirs,
  fileSha256,
  loadManifest,
  scanDocs,
  scanAgents,
  listProjects,
  getProject,
  getDocStatus,
  migrateBrief,
  humanizeName,
  calcReadiness,
  isBuildReady,
};
