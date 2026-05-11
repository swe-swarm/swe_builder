/**
 * Shared readiness calculation and project-scanning utilities.
 *
 * Port of app/lib/readiness_calc.py — single source of truth for
 * readiness calculation, stage detection, and project scanning.
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_FILE_MAP = {
  sdr_raw: "sdr-raw.md",
  customer_context: "customer-context.md",
};

const AGENT_FILE_MAP = {
  brief: "brief.json",
  evals_csv: "evals.csv",
  evals_results: "evals-results.json",
  build_report: "build-report.md",
};

const SKIP_FOLDERS = new Set(["topics", ".git", "__pycache__", "node_modules"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanizeName(folderName) {
  const overrides = {
    CDW: "CDW",
    "RoB-Manager": "RoB Manager",
    DailyBriefing: "Daily Briefing",
  };
  if (overrides[folderName]) return overrides[folderName];
  // Insert space before uppercase letters preceded by lowercase
  let name = folderName.replace(/([a-z])([A-Z])/g, "$1 $2");
  name = name.replace(/[-_]/g, " ");
  // Title case
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

function isV2(brief) {
  return brief._schema === "2.0" || "agent" in brief;
}

// ---------------------------------------------------------------------------
// Readiness calculation
// ---------------------------------------------------------------------------

function countEvalTests(brief) {
  return (brief.evalSets || []).reduce(
    (sum, s) => sum + (s.tests || []).length,
    0
  );
}

function hasEvalResults(brief) {
  for (const s of brief.evalSets || []) {
    for (const t of s.tests || []) {
      if (t.lastResult) return true;
    }
  }
  // Legacy fallback
  const er = brief.evalResults || {};
  const summary = er.summary || {};
  return (summary.total || 0) > 0;
}

function calcReadiness(brief) {
  if (!brief) return 0;

  const openQs = brief.openQuestions || [];
  const unanswered = openQs.filter((q) => q.question && !q.answer);
  const buildStatus = brief.buildStatus || {};

  if (isV2(brief)) {
    const biz = brief.business || {};
    const arch = brief.architecture || {};
    const solutionType = arch.solutionType || "agent";
    const isNonAgent = solutionType === "flow" || solutionType === "not-recommended";

    // Non-agent types use a reduced check set (5 checks)
    if (isNonAgent) {
      const decisions = brief.decisions || [];
      const blockingPending = decisions.filter(
        (d) =>
          d.status === "pending" &&
          (d.category === "architecture" || d.category === "infrastructure")
      );
      const checks = [
        !!(biz.problemStatement || biz.useCase),
        !!arch.solutionType,
        (brief.capabilities || []).length > 0,
        !!arch.alternativeRecommendation,
        blockingPending.length === 0,
      ];
      return Math.round(
        (checks.filter(Boolean).length / checks.length) * 100
      );
    }

    const integ = brief.integrations || [];
    const know = brief.knowledge || [];
    const convos = brief.conversations || {};
    const bounds = brief.boundaries || {};
    const decisions = brief.decisions || [];
    const blockingPending = decisions.filter(
      (d) =>
        d.status === "pending" &&
        (d.category === "architecture" || d.category === "infrastructure")
    );

    const checks = [
      !!(biz.problemStatement || biz.useCase),
      !!arch.type,
      !!brief.instructions,
      integ.filter((i) => i.name).length + (convos.topics || []).length > 0,
      know.filter((k) => k.name).length > 0,
      countEvalTests(brief) >= 5,
      !!(bounds.handle || bounds.decline || bounds.refuse),
      (arch.channels || []).filter((c) =>
        typeof c === "object" ? c.name : c
      ).length > 0,
      unanswered.length === 0,
      buildStatus.status === "published",
      hasEvalResults(brief),
      blockingPending.length === 0,
    ];
    return Math.round(
      (checks.filter(Boolean).length / checks.length) * 100
    );
  }

  // v1 fallback
  const s1 = brief.step1 || {};
  const s2 = brief.step2 || {};
  const s3 = brief.step3 || {};
  const s4 = brief.step4 || {};
  const v1Evals = brief.evals || [];

  const checks = [
    !!s1.problem,
    !!s4.architectureRecommendation,
    (s3.systems || []).filter((s) => s.name).length > 0,
    (s3.knowledge || []).filter((k) => k.name).length > 0,
    (s2.scenarios || []).filter((s) => s.userSays).length >= 3,
    v1Evals.length > 0,
    !!(s2.handle || s2.decline || s2.refuse),
    (s4.channels || []).length > 0,
    unanswered.length === 0,
    !!brief.instructions,
  ];
  return Math.round(
    (checks.filter(Boolean).length / checks.length) * 100
  );
}

function isBuildReady(brief) {
  if (!brief) return false;

  if (!isV2(brief)) {
    return calcReadiness(brief) === 100;
  }

  const biz = brief.business || {};
  const arch = brief.architecture || {};
  const solutionType = arch.solutionType || "agent";
  if (solutionType === "flow" || solutionType === "not-recommended") {
    return false;
  }

  const integ = brief.integrations || [];
  const know = brief.knowledge || [];
  const convos = brief.conversations || {};
  const bounds = brief.boundaries || {};
  const openQs = brief.openQuestions || [];
  const unanswered = openQs.filter((q) => q.question && !q.answer);
  const decisions = brief.decisions || [];
  const blockingPending = decisions.filter(
    (d) =>
      d.status === "pending" &&
      (d.category === "architecture" || d.category === "infrastructure")
  );

  return [
    biz.problemStatement || biz.useCase,
    arch.type,
    brief.instructions,
    integ.filter((i) => i.name).length + (convos.topics || []).length > 0,
    know.filter((k) => k.name).length > 0,
    countEvalTests(brief) >= 5,
    bounds.handle || bounds.decline || bounds.refuse,
    (arch.channels || []).filter((c) =>
      typeof c === "object" ? c.name : c
    ).length > 0,
    unanswered.length === 0,
    blockingPending.length === 0,
  ].every(Boolean);
}

// ---------------------------------------------------------------------------
// Stage determination
// ---------------------------------------------------------------------------

function determineStage(agents) {
  if (!agents || agents.length === 0) return "discovery";

  let bestStage = "discovery";
  const stageOrder = [
    "discovery",
    "context",
    "preview",
    "research",
    "build",
    "eval",
    "deployed",
  ];

  for (const agent of agents) {
    const brief = agent._brief;
    if (!brief) continue;

    let agentStage;

    const hasResults = hasEvalResults(brief);
    if (hasResults) {
      agentStage = "eval";
    } else if (
      (brief.buildStatus || {}).status === "published" ||
      (brief.buildStatus || {}).status === "in_progress"
    ) {
      agentStage = "build";
    } else if (isV2(brief)) {
      const wf = brief.workflow || {};
      const wfPhase = wf.phase || "";
      if (wfPhase === "ready_to_build" || wf.decisionsConfirmed) {
        agentStage = "research";
      } else if (
        (wfPhase === "decisions" || wfPhase === "research") &&
        wf.previewConfirmed
      ) {
        agentStage = "research";
      } else if (wfPhase === "preview" && wf.previewGeneratedAt) {
        agentStage = "preview";
      } else {
        const arch = brief.architecture || {};
        if (brief.instructions && arch.type) {
          agentStage = "research";
        } else if (
          (brief.business || {}).problemStatement ||
          (brief.agent || {}).name
        ) {
          agentStage = "context";
        } else {
          agentStage = "discovery";
        }
      }
    } else {
      // v1 fallback
      if (
        brief.instructions &&
        (brief.step4 || {}).architectureRecommendation
      ) {
        agentStage = "research";
      } else if ((brief.step1 || {}).problem) {
        agentStage = "context";
      } else {
        agentStage = "discovery";
      }
    }

    if (stageOrder.indexOf(agentStage) > stageOrder.indexOf(bestStage)) {
      bestStage = agentStage;
    }
  }

  return bestStage;
}

// ---------------------------------------------------------------------------
// CSV row counting
// ---------------------------------------------------------------------------

function countCsvRows(filepath) {
  try {
    const content = fs.readFileSync(filepath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    return Math.max(0, lines.length - 1); // subtract header
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Agent scanning (detailed — used by scan_project / skills)
// ---------------------------------------------------------------------------

function scanAgents(projectFolder) {
  const agentsDir = path.join(projectFolder, "agents");
  const agents = [];

  if (!fs.existsSync(agentsDir)) return agents;

  const entries = fs.readdirSync(agentsDir).sort();
  for (const name of entries) {
    const agentDir = path.join(agentsDir, name);
    if (!fs.statSync(agentDir).isDirectory() || name.startsWith(".")) continue;

    let brief = null;
    const briefFile = path.join(agentDir, "brief.json");
    if (fs.existsSync(briefFile)) {
      try {
        const raw = fs.readFileSync(briefFile, "utf-8").replace(/^\uFEFF/, "");
        brief = JSON.parse(raw);
      } catch {
        // ignore parse errors
      }
    }

    const readiness = brief ? calcReadiness(brief) : 0;

    const agentFiles = {};
    for (const [key, filename] of Object.entries(AGENT_FILE_MAP)) {
      agentFiles[key] = fs.existsSync(path.join(agentDir, filename));
    }

    const evalCount = agentFiles.evals_csv
      ? countCsvRows(path.join(agentDir, "evals.csv"))
      : 0;

    let agentName, description, architecture, architectureScore, tools, knowledge;

    if (brief && isV2(brief)) {
      const agentSec = brief.agent || {};
      const biz = brief.business || {};
      const arch = brief.architecture || {};
      const integ = brief.integrations || [];
      const know = brief.knowledge || [];

      agentName = agentSec.name || humanizeName(name);
      description = ((biz.problemStatement || biz.useCase) || "").slice(0, 300);
      architecture = arch.type || "tbd";
      architectureScore = arch.score || "TBD";
      tools = integ.filter((i) => i.name).map((i) => i.name).slice(0, 10);
      knowledge = know.filter((k) => k.name).map((k) => k.name).slice(0, 10);
    } else if (brief) {
      const s1 = brief.step1 || {};
      const s3 = brief.step3 || {};
      const s4 = brief.step4 || {};

      agentName = s1.agentName || humanizeName(name);
      description = (s1.problem || "").slice(0, 300);
      architecture = s4.architectureRecommendation || "tbd";
      architectureScore = s4.architectureScore || "TBD";
      tools = (s3.systems || []).filter((s) => s.name).map((s) => s.name).slice(0, 10);
      knowledge = (s3.knowledge || []).filter((k) => k.name).map((k) => k.name).slice(0, 10);
    } else {
      agentName = humanizeName(name);
      description = "";
      architecture = "tbd";
      architectureScore = "TBD";
      tools = [];
      knowledge = [];
    }

    agents.push({
      id: name,
      name: agentName,
      description,
      architecture,
      architecture_score: architectureScore,
      tools,
      knowledge,
      has_brief: brief !== null,
      has_instructions: brief ? !!brief.instructions : false,
      has_evals: !!agentFiles.evals_csv,
      has_build_report: !!agentFiles.build_report,
      readiness,
      eval_count: evalCount,
      open_questions: brief
        ? (brief.openQuestions || []).filter((q) => q.question && !q.answer).length
        : 0,
      _brief: brief, // internal — stripped before output
    });
  }

  return agents;
}

// ---------------------------------------------------------------------------
// Project scanner
// ---------------------------------------------------------------------------

function scanProject(folder, baseDir) {
  if (!baseDir) baseDir = path.resolve(folder, "..", "..");

  const folderName = path.basename(folder);
  const project = {
    id: folderName,
    name: humanizeName(folderName),
    path: path.relative(baseDir, folder).replace(/\\/g, "/"),
    files: {},
    agents: [],
    stats: {},
  };

  for (const [key, filename] of Object.entries(PROJECT_FILE_MAP)) {
    project.files[key] = fs.existsSync(path.join(folder, filename));
  }

  const agents = scanAgents(folder);
  project.stage = determineStage(agents);

  for (const agent of agents) {
    delete agent._brief;
  }

  project.agents = agents;

  if (project.agents.length === 0) {
    const docsDir = path.join(folder, "docs");
    project.agents = [
      {
        id: folderName,
        name: project.name,
        description: "",
        architecture: "tbd",
        architecture_score: "TBD",
        tools: [],
        knowledge: [],
        has_brief: false,
        has_instructions: false,
        has_evals: false,
        has_build_report: false,
        readiness: 0,
        eval_count: 0,
        open_questions: 0,
      },
    ];
  }

  project.stats.total_agents = project.agents.length;
  project.stats.eval_count = project.agents.reduce(
    (sum, a) => sum + (a.eval_count || 0),
    0
  );

  return project;
}

module.exports = {
  PROJECT_FILE_MAP,
  AGENT_FILE_MAP,
  SKIP_FOLDERS,
  humanizeName,
  isV2,
  countEvalTests,
  hasEvalResults,
  calcReadiness,
  isBuildReady,
  determineStage,
  countCsvRows,
  scanAgents,
  scanProject,
};
