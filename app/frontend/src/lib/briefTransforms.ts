/**
 * Bidirectional transform between raw brief.json (API) and React BriefData (UI).
 *
 * briefFromApi(raw)  → converts API brief into UI shapes
 * briefToApi(ui, raw) → merges UI edits back into raw brief for save
 *
 * The raw brief is always preserved in full — UI only shows a subset of fields.
 * Save always merges UI changes into the full raw brief so fields the UI
 * doesn't display are never lost.
 */
import type { ApiBrief } from "@/types/api";
import type { BriefData, EvalSet, EvalConfig } from "@/types";

/**
 * Convert raw brief.json → UI BriefData shape.
 */
export function briefFromApi(raw: ApiBrief): BriefData {
  const biz = raw.business ?? {};
  const agent = raw.agent ?? {};
  const arch = raw.architecture ?? {};
  const bounds = raw.boundaries ?? {};

  return {
    "business-context": {
      problemStatement: biz.problemStatement ?? biz.useCase ?? "",
      challenges: (biz.challenges ?? []).map((c) =>
        typeof c === "string" ? c : c.challenge ?? ""
      ),
      benefits: (biz.benefits ?? []).map((b) =>
        typeof b === "string" ? b : b.benefit ?? ""
      ),
      successCriteria: (biz.successCriteria ?? []).map((s) => ({
        metric: s.metric ?? "",
        target: s.target ?? "",
        current: (s as any).current ?? s.measurement ?? "",
      })),
      stakeholders: stakeholdersFromApi(biz.stakeholders),
    },
    "agent-identity": {
      name: agent.name ?? "",
      description: agent.description ?? "",
      persona: agent.persona ?? "",
      targetUsers: [
        agent.primaryUsers ?? "",
        agent.secondaryUsers ?? "",
      ].filter(Boolean),
    },
    instructions: {
      systemPrompt: raw.instructions ?? "",
    },
    capabilities: {
      items: (raw.capabilities ?? []).map((c) => ({
        name: c.name ?? "",
        description: c.description ?? "",
        tag: (c.phase ?? "mvp").toUpperCase() === "MVP" ? "MVP" : "Future",
        enabled: (c.phase ?? "mvp").toLowerCase() === "mvp",
        status: (c.status as any) ?? "not_started",
      })),
    },
    tools: {
      items: (raw.integrations ?? []).map((i) => ({
        name: i.name ?? "",
        type: i.type ?? "",
        auth: i.authMethod ?? "",
        notes: i.notes ?? "",
      })),
    },
    "knowledge-sources": {
      items: (raw.knowledge ?? []).map((k) => ({
        name: k.name ?? "",
        purpose: k.purpose ?? "",
        location: k.scope ?? "",
        phase: (k.phase ?? "mvp").toUpperCase() === "MVP" ? "MVP" : "Future",
        status: k.status ?? "available",
      })),
    },
    "conversation-topics": {
      items: (raw.conversations?.topics ?? []).map((t) => ({
        name: t.name ?? "",
        type: (t.topicType ?? "generative") as "generative" | "custom",
        phase: (t.phase ?? "mvp").toUpperCase() === "MVP" ? "MVP" : "Future",
        description: t.description ?? "",
        flowDescription: "",
      })),
    },
    "scope-boundaries": {
      handles: bounds.handle ?? [],
      politelyDeclines: (bounds.decline ?? []).map((d) =>
        typeof d === "string" ? d : d.topic ?? ""
      ),
      hardRefuses: (bounds.refuse ?? []).map((r) =>
        typeof r === "string" ? r : r.topic ?? ""
      ),
    },
    architecture: {
      pattern: arch.type ?? "",
      patternReasoning: arch.reason ?? "",
      triggers: (arch.triggers ?? []).map((t) => ({
        type: t.type ?? "",
        description: t.description ?? "",
      })),
      channels: (arch.channels ?? []).map((ch) => ({
        name: typeof ch === "string" ? ch : ch.name ?? "",
        reason: typeof ch === "string" ? "" : ch.reason ?? "",
      })),
      childAgents: (arch.children ?? []).map((c) => ({
        name: c.name ?? "",
        role: c.role ?? "",
        routingRule: c.routingRule ?? "",
        model: c.model ?? "",
        agentFolderId: c.agentFolderId ?? "",
      })),
      scoring: factorsToScoring(arch.factors, arch.score),
    },
    "eval-sets": evalSetsFromApi(raw),
    "open-questions": {
      items: (raw.openQuestions ?? []).map((q) => ({
        question: q.question ?? "",
        assignee: "",
        priority: "Medium",
        status: q.answer ? "resolved" : "open",
        resolution: q.answer ?? undefined,
      })),
    },
  };
}

/**
 * Merge UI BriefData edits back into the full raw brief for save.
 * Preserves all fields the UI doesn't show.
 */
export function briefToApi(ui: BriefData, raw: ApiBrief): ApiBrief {
  const result = structuredClone(raw);
  const bc = ui["business-context"];
  const ai = ui["agent-identity"];
  const arch = ui["architecture"];

  // Business
  result.business = {
    ...result.business,
    problemStatement: bc.problemStatement,
    useCase: result.business?.useCase ?? bc.problemStatement,
    challenges: bc.challenges.map((c) => ({ challenge: c, impact: "medium" })),
    benefits: bc.benefits.map((b) => ({ benefit: b, type: "experience" })),
    successCriteria: bc.successCriteria.map((s) => ({
      metric: s.metric,
      target: s.target,
      measurement: s.current,
    })),
    stakeholders: stakeholdersToApi(bc.stakeholders, result.business?.stakeholders),
  };

  // Agent
  result.agent = {
    ...result.agent,
    name: ai.name,
    description: ai.description,
    persona: ai.persona,
    primaryUsers: ai.targetUsers[0] ?? "",
    secondaryUsers: ai.targetUsers[1] ?? "",
  };

  // Instructions
  result.instructions = ui.instructions.systemPrompt;

  // Capabilities — merge back, preserving extra fields
  result.capabilities = ui.capabilities.items.map((c) => {
    const existing = (raw.capabilities ?? []).find((e) => e.name === c.name);
    return {
      ...existing,
      name: c.name,
      description: c.description,
      phase: c.enabled ? "mvp" : "future",
      status: c.status ?? "not_started",
    };
  });

  // Integrations — merge back, preserving extra fields
  result.integrations = ui.tools.items.map((t) => {
    const existing = (raw.integrations ?? []).find((e) => e.name === t.name);
    return {
      ...existing,
      name: t.name,
      type: t.type,
      authMethod: t.auth,
      notes: t.notes,
    };
  });

  // Knowledge — merge back
  result.knowledge = ui["knowledge-sources"].items.map((k) => {
    const existing = (raw.knowledge ?? []).find((e) => e.name === k.name);
    return {
      ...existing,
      name: k.name,
      purpose: k.purpose,
      scope: k.location,
      phase: k.phase.toLowerCase() === "mvp" ? "mvp" : "future",
      status: k.status,
    };
  });

  // Conversations — merge back, preserving extra fields
  result.conversations = {
    ...result.conversations,
    topics: ui["conversation-topics"].items.map((t) => {
      const existing = (raw.conversations?.topics ?? []).find((e) => e.name === t.name);
      return {
        ...existing,
        name: t.name,
        topicType: t.type,
        phase: t.phase.toLowerCase() === "mvp" ? "mvp" : "future",
        description: t.description,
      };
    }),
  };

  // Boundaries
  result.boundaries = {
    ...result.boundaries,
    handle: ui["scope-boundaries"].handles,
    decline: ui["scope-boundaries"].politelyDeclines.map((topic) => {
      const existing = (raw.boundaries?.decline ?? []).find(
        (d) => (typeof d === "string" ? d : d.topic) === topic
      );
      return typeof existing === "object" ? { ...existing, topic } : { topic, redirect: "" };
    }),
    refuse: ui["scope-boundaries"].hardRefuses.map((topic) => {
      const existing = (raw.boundaries?.refuse ?? []).find(
        (r) => (typeof r === "string" ? r : r.topic) === topic
      );
      return typeof existing === "object" ? { ...existing, topic } : { topic, reason: "" };
    }),
  };

  // Architecture
  result.architecture = {
    ...result.architecture,
    type: arch.pattern,
    reason: arch.patternReasoning,
    triggers: arch.triggers,
    channels: arch.channels.map((ch) => ({ name: ch.name, reason: ch.reason })),
    children: arch.childAgents.map((c) => {
      const existing = (raw.architecture?.children ?? []).find((e) => e.name === c.name);
      return {
        ...existing,
        name: c.name,
        role: c.role,
        routingRule: c.routingRule,
        model: c.model,
        agentFolderId: c.agentFolderId,
      };
    }),
    factors: scoringToFactors(arch.scoring),
    score: arch.scoring.reduce((sum, s) => sum + s.score, 0),
  };

  // Eval Sets
  result.evalSets = evalSetsToApi(ui["eval-sets"]);
  result.evalConfig = ui["eval-sets"].config;
  // Remove legacy fields if migrated
  delete result.scenarios;
  delete result.evals;
  delete result.evalResults;

  // Open questions
  result.openQuestions = ui["open-questions"].items.map((q) => {
    const existing = (raw.openQuestions ?? []).find((e) => e.question === q.question);
    return {
      ...existing,
      question: q.question,
      answer: q.resolution ?? existing?.answer ?? "",
    };
  });

  return result;
}

// ─── Eval Set Helpers ─────────────────────────────────────────────

const DEFAULT_EVAL_CONFIG: EvalConfig = {
  targetPassRate: 70,
  maxIterationsPerCapability: 3,
  maxRegressionRounds: 2,
};

const DEFAULT_EVAL_SETS: EvalSet[] = [
  {
    name: "critical",
    description: "Safety, boundaries, identity — non-negotiable",
    methods: [
      { type: "Keyword match", mode: "all" },
      { type: "Exact match" },
    ],
    passThreshold: 100,
    runWhen: "every-iteration",
    tests: [],
  },
  {
    name: "functional",
    description: "Core capability happy paths — does each feature work?",
    methods: [
      { type: "Compare meaning", score: 70 },
      { type: "Keyword match", mode: "any" },
    ],
    passThreshold: 70,
    runWhen: "per-capability",
    tests: [],
  },
  {
    name: "integration",
    description: "Connectors return real data, tools actually invoked",
    methods: [
      { type: "Capability use" },
      { type: "Keyword match", mode: "any" },
    ],
    passThreshold: 80,
    runWhen: "after-tools",
    tests: [],
  },
  {
    name: "conversational",
    description: "Multi-turn, context carry, routing, topic switching",
    methods: [
      { type: "General quality" },
      { type: "Compare meaning", score: 60 },
    ],
    passThreshold: 60,
    runWhen: "after-functional",
    tests: [],
  },
  {
    name: "regression",
    description: "Full suite, cross-capability, end-to-end",
    methods: [
      { type: "Compare meaning", score: 70 },
      { type: "General quality" },
    ],
    passThreshold: 70,
    runWhen: "final",
    tests: [],
  },
];

/**
 * Convert raw evalSets (or migrate legacy scenarios/evals) → UI EvalSet shape.
 */
function evalSetsFromApi(raw: ApiBrief): { sets: EvalSet[]; config: EvalConfig } {
  const config: EvalConfig = {
    targetPassRate: raw.evalConfig?.targetPassRate ?? DEFAULT_EVAL_CONFIG.targetPassRate,
    maxIterationsPerCapability: raw.evalConfig?.maxIterationsPerCapability ?? DEFAULT_EVAL_CONFIG.maxIterationsPerCapability,
    maxRegressionRounds: raw.evalConfig?.maxRegressionRounds ?? DEFAULT_EVAL_CONFIG.maxRegressionRounds,
  };

  // New schema: evalSets already present
  if (raw.evalSets?.length) {
    return {
      sets: raw.evalSets.map((s) => ({
        name: s.name ?? "custom",
        description: s.description ?? "",
        methods: (s.methods ?? []).map((m) => ({
          type: m.type as any,
          ...(m.score != null ? { score: m.score } : {}),
          ...(m.mode ? { mode: m.mode as any } : {}),
        })),
        passThreshold: s.passThreshold ?? 70,
        runWhen: (s.runWhen as any) ?? "custom",
        tests: (s.tests ?? []).map((t) => ({
          question: t.question ?? "",
          expected: t.expected ?? "",
          capability: t.capability ?? undefined,
          lastResult: t.lastResult ?? null,
        })),
      })),
      config,
    };
  }

  // Legacy migration: convert scenarios[] + evals[] → eval sets
  const sets: EvalSet[] = DEFAULT_EVAL_SETS.map((s) => ({ ...s, tests: [...s.tests] }));

  // Migrate evals[] into appropriate sets
  for (const e of raw.evals ?? []) {
    const test = {
      question: e.question ?? "",
      expected: e.expected ?? "",
      capability: e.capability ?? undefined,
      lastResult: null as any,
    };

    // Migrate old evalResults into lastResult if available
    const oldResult = raw.evalResults?.results?.find((r) => r.question === e.question);
    if (oldResult) {
      test.lastResult = {
        pass: oldResult.pass,
        actual: oldResult.actual,
        score: oldResult.score,
        timestamp: raw.evalResults?.lastRun,
      };
    }

    const cat = e.category ?? "happy-path";
    if (cat === "boundary-decline" || cat === "boundary-refuse") {
      sets.find((s) => s.name === "critical")!.tests.push(test);
    } else if (cat === "multi-turn") {
      sets.find((s) => s.name === "conversational")!.tests.push(test);
    } else {
      sets.find((s) => s.name === "functional")!.tests.push(test);
    }
  }

  // Migrate scenarios[] that don't overlap with evals
  for (const s of raw.scenarios ?? []) {
    const alreadyExists = sets.some((set) =>
      set.tests.some((t) => t.question === s.userSays)
    );
    if (alreadyExists || !s.userSays) continue;

    const test = {
      question: s.userSays ?? "",
      expected: s.agentDoes ?? "",
      capability: s.capabilities?.[0] ?? undefined,
      lastResult: null as any,
    };

    const cat = s.category ?? "happy-path";
    if (cat === "boundary-decline" || cat === "boundary-refuse") {
      sets.find((s) => s.name === "critical")!.tests.push(test);
    } else if (cat === "multi-turn") {
      sets.find((s) => s.name === "conversational")!.tests.push(test);
    } else if (cat === "edge-case" || cat === "error-recovery") {
      sets.find((s) => s.name === "regression")!.tests.push(test);
    } else {
      sets.find((s) => s.name === "functional")!.tests.push(test);
    }
  }

  return { sets, config };
}

/**
 * Convert UI EvalSet shape → raw evalSets for API save.
 */
function evalSetsToApi(ui: { sets: EvalSet[]; config: EvalConfig }) {
  return ui.sets.map((s) => ({
    name: s.name,
    description: s.description,
    methods: s.methods.map((m) => ({
      type: m.type,
      ...(m.score != null ? { score: m.score } : {}),
      ...(m.mode ? { mode: m.mode } : {}),
    })),
    passThreshold: s.passThreshold,
    runWhen: s.runWhen,
    tests: s.tests.map((t) => ({
      question: t.question,
      expected: t.expected ?? "",
      ...(t.capability ? { capability: t.capability } : {}),
      lastResult: t.lastResult,
    })),
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────

function stakeholdersFromApi(
  raw?: { sponsor?: string; owner?: string; users?: string }
): Array<{ name: string; role: string; type: string }> {
  if (!raw) return [];
  const result: Array<{ name: string; role: string; type: string }> = [];
  if (raw.sponsor) result.push({ name: raw.sponsor, role: "Executive Sponsor", type: "Sponsor" });
  if (raw.owner) result.push({ name: raw.owner, role: "Agent Owner", type: "Owner" });
  if (raw.users) result.push({ name: raw.users, role: "Primary Users", type: "User" });
  return result;
}

function stakeholdersToApi(
  ui: Array<{ name: string; role: string; type: string }>,
  existing?: { sponsor?: string; owner?: string; users?: string }
): { sponsor: string; owner: string; users: string } {
  const sponsor = ui.find((s) => s.type === "Sponsor")?.name ?? existing?.sponsor ?? "";
  const owner = ui.find((s) => s.type === "Owner")?.name ?? existing?.owner ?? "";
  const users = ui.find((s) => s.type === "User")?.name ?? existing?.users ?? "";
  return { sponsor, owner, users };
}

const FACTOR_NAMES = [
  "domainSeparation",
  "dataIsolation",
  "teamOwnership",
  "reusability",
  "instructionSize",
  "knowledgeIsolation",
] as const;

const FACTOR_LABELS: Record<string, string> = {
  domainSeparation: "Domain Separation",
  dataIsolation: "Data Isolation",
  teamOwnership: "Team Ownership",
  reusability: "Reusability",
  instructionSize: "Instruction Size",
  knowledgeIsolation: "Knowledge Isolation",
};

function factorsToScoring(
  factors?: Record<string, boolean>,
  totalScore?: number
): Array<{ factor: string; score: number; notes: string }> {
  if (!factors) return [];
  return FACTOR_NAMES.map((key) => ({
    factor: FACTOR_LABELS[key] ?? key,
    score: factors[key] ? 1 : 0,
    notes: factors[key] ? "Applies" : "",
  }));
}

function scoringToFactors(
  scoring: Array<{ factor: string; score: number; notes: string }>
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  // Reverse lookup: label → key
  const labelToKey: Record<string, string> = {};
  for (const [key, label] of Object.entries(FACTOR_LABELS)) {
    labelToKey[label] = key;
  }
  for (const s of scoring) {
    const key = labelToKey[s.factor] ?? s.factor;
    result[key] = s.score > 0;
  }
  return result;
}
