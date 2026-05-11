/**
 * Client-side readiness calculator — mirrors server.py _calc_readiness().
 *
 * 11 checks, each worth equal weight. Returns 0–100.
 * Eval sets replace the old scenarios + evals checks.
 */
import type { BriefData } from "@/types";

/** Count total tests across all eval sets. */
function totalEvalTests(data: BriefData): number {
  return (data["eval-sets"]?.sets ?? []).reduce(
    (sum, s) => sum + (s.tests?.length ?? 0), 0
  );
}

/** Check if any eval test has a lastResult. */
function hasAnyEvalResult(data: BriefData): boolean {
  return (data["eval-sets"]?.sets ?? []).some((s) =>
    s.tests?.some((t) => t.lastResult != null)
  );
}

export function calcReadiness(data: BriefData): number {
  const bc = data["business-context"];
  const arch = data["architecture"];
  const tools = data["tools"]?.items ?? [];
  const knowledge = data["knowledge-sources"]?.items ?? [];
  const topics = data["conversation-topics"]?.items ?? [];
  const bounds = data["scope-boundaries"];
  const questions = data["open-questions"]?.items ?? [];
  const unanswered = questions.filter((q) => q.question && q.status !== "resolved");

  const checks = [
    Boolean(bc.problemStatement),                                         // 1. Business context
    Boolean(arch.pattern),                                                // 2. Architecture
    Boolean(data.instructions?.systemPrompt),                             // 3. Instructions
    tools.filter((t) => t.name).length + topics.filter((t) => t.name).length > 0,  // 4. Components
    knowledge.filter((k) => k.name).length > 0,                           // 5. Knowledge
    totalEvalTests(data) >= 5,                                            // 6. Eval tests defined (5+)
    Boolean(bounds.handles.length || bounds.politelyDeclines.length || bounds.hardRefuses.length), // 7. Boundaries
    Boolean(arch.channels?.length || arch.triggers?.length),               // 8. Channels/Triggers
    unanswered.length === 0,                                              // 9. Questions resolved
    false,                                                                // 10. Build published (set externally)
    false,                                                                // 11. Eval results exist (set externally)
  ];

  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

/**
 * Enhanced readiness that includes build + eval status from raw brief.
 */
export function calcReadinessWithStatus(
  data: BriefData,
  buildPublished: boolean,
  hasEvalResults: boolean
): number {
  const bc = data["business-context"];
  const arch = data["architecture"];
  const tools = data["tools"]?.items ?? [];
  const knowledge = data["knowledge-sources"]?.items ?? [];
  const topics = data["conversation-topics"]?.items ?? [];
  const bounds = data["scope-boundaries"];
  const questions = data["open-questions"]?.items ?? [];
  const unanswered = questions.filter((q) => q.question && q.status !== "resolved");

  const checks = [
    Boolean(bc.problemStatement),
    Boolean(arch.pattern),
    Boolean(data.instructions?.systemPrompt),
    tools.filter((t) => t.name).length + topics.filter((t) => t.name).length > 0,
    knowledge.filter((k) => k.name).length > 0,
    totalEvalTests(data) >= 5,
    Boolean(bounds.handles.length || bounds.politelyDeclines.length || bounds.hardRefuses.length),
    Boolean(arch.triggers?.length),
    unanswered.length === 0,
    buildPublished,
    hasEvalResults || hasAnyEvalResult(data),
  ];

  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

/**
 * Per-section completion check for the sidebar.
 */
export function sectionCompletion(data: BriefData): Record<string, boolean> {
  const bc = data["business-context"];
  const ai = data["agent-identity"];
  const arch = data["architecture"];
  const tools = data["tools"]?.items ?? [];
  const knowledge = data["knowledge-sources"]?.items ?? [];
  const topics = data["conversation-topics"]?.items ?? [];
  const bounds = data["scope-boundaries"];
  const questions = data["open-questions"]?.items ?? [];

  return {
    "business-context": Boolean(bc.problemStatement),
    "agent-identity": Boolean(ai.name && ai.description),
    architecture: Boolean(arch.pattern),
    instructions: Boolean(data.instructions?.systemPrompt),
    capabilities: data["capabilities"]?.items?.some((c) => c.name) ?? false,
    tools: tools.some((t) => t.name),
    "knowledge-sources": knowledge.some((k) => k.name),
    "conversation-topics": topics.some((t) => t.name),
    "scope-boundaries": Boolean(
      bounds.handles.length || bounds.politelyDeclines.length || bounds.hardRefuses.length
    ),
    "eval-sets": totalEvalTests(data) >= 5,
    "open-questions": questions.filter((q) => q.question && q.status !== "resolved").length === 0,
  };
}
