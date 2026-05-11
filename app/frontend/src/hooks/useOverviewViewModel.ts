import { useMemo } from "react";
import type { BriefData, ItemSource } from "@/types";

export interface ViewItem {
  text: string;
  source?: ItemSource;
  editPath: { section: string; index: number; field?: string };
}

/** Boundary item with sub-type for unified display. */
export interface BoundaryItem extends ViewItem {
  boundaryType: "handle" | "decline" | "refuse";
  /** Redirect target for declines. */
  redirect?: string;
  /** Reason for refuses. */
  reason?: string;
}

export interface OverviewViewModel {
  agentName: string;
  whatItDoes: string;
  problemStatement: string;

  /** "Who it's for" — target user groups */
  audience: string[];

  /** "What it can do" — capabilities */
  capabilities: ViewItem[];

  /** "Scope and boundaries" — unified handles + declines + refuses */
  boundaries: BoundaryItem[];

  /** "How it should respond" — persona + response format */
  persona: string;
  responseFormat: string;

  /** "Knowledge sources" — data the agent relies on */
  knowledgeSources: string[];

  /** "Things to confirm" — open questions */
  openQuestions: ViewItem[];
}

/**
 * Helper: map an array to ViewItems while preserving original indices.
 * Items that don't pass the predicate are skipped but indices stay correct.
 */
function toViewItems<T>(
  items: T[],
  predicate: (item: T) => boolean,
  mapper: (item: T, originalIndex: number) => ViewItem,
): ViewItem[] {
  const result: ViewItem[] = [];
  for (let i = 0; i < items.length; i++) {
    if (predicate(items[i])) {
      result.push(mapper(items[i], i));
    }
  }
  return result;
}

/**
 * Pure projection: maps brief.json fields to a customer-friendly view model.
 * Each ViewItem carries an `editPath` with the ORIGINAL array index so edits
 * write back to the correct brief.json field (no duplication, no index shift).
 */
export function useOverviewViewModel(data: BriefData | null): OverviewViewModel | null {
  return useMemo(() => {
    if (!data) return null;

    const ov = data.overview;
    const caps = data.capabilities?.items ?? [];
    const bounds = data["scope-boundaries"];
    const questions = data["open-questions"]?.items ?? [];
    const knowledge = data["knowledge-sources"]?.items ?? [];

    // --- Capabilities ---
    const capabilities = toViewItems(
      caps,
      (c) => !!c.name,
      (c, i) => ({
        text: c.name,
        source: c.source ?? "from-docs",
        editPath: { section: "capabilities", index: i, field: "name" },
      }),
    );

    // --- Unified Boundaries ---
    const boundaryItems: BoundaryItem[] = [];

    // Handles (things it answers confidently)
    const handles = bounds?.handles ?? [];
    for (let i = 0; i < handles.length; i++) {
      if (!handles[i]) continue;
      boundaryItems.push({
        text: handles[i],
        editPath: { section: "scope-boundaries", index: i, field: "handles" },
        boundaryType: "handle",
      });
    }

    // Declines (polite redirects)
    const declines = bounds?.politelyDeclines ?? [];
    for (let i = 0; i < declines.length; i++) {
      if (!declines[i].topic) continue;
      boundaryItems.push({
        text: declines[i].topic,
        source: declines[i].source ?? "from-docs",
        editPath: { section: "scope-boundaries", index: i, field: "politelyDeclines" },
        boundaryType: "decline",
        redirect: declines[i].redirect,
      });
    }

    // Refuses (hard stops)
    const refuses = bounds?.hardRefuses ?? [];
    for (let i = 0; i < refuses.length; i++) {
      if (!refuses[i].topic) continue;
      boundaryItems.push({
        text: refuses[i].topic,
        source: refuses[i].source ?? "from-docs",
        editPath: { section: "scope-boundaries", index: i, field: "hardRefuses" },
        boundaryType: "refuse",
        reason: refuses[i].reason,
      });
    }

    // --- Open Questions ---
    const openQuestions = toViewItems(
      questions,
      (q) => !!q.question && q.status !== "resolved",
      (q, i) => ({
        text: q.question,
        source: q.source ?? "inferred",
        editPath: { section: "open-questions", index: i },
      }),
    );

    // --- Knowledge Sources ---
    const knowledgeSources: string[] = knowledge
      .filter((k) => k.name)
      .map((k) => k.name);

    return {
      agentName: ov.name ?? "",
      whatItDoes: ov.description ?? "",
      problemStatement: ov.problemStatement ?? "",
      audience: ov.targetUsers?.filter(Boolean) ?? [],
      capabilities,
      boundaries: boundaryItems,
      persona: ov.persona ?? "",
      responseFormat: ov.responseFormat ?? "",
      knowledgeSources,
      openQuestions,
    };
  }, [data]);
}
