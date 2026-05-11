/**
 * Brief store — loads brief via API + transform, tracks dirty state,
 * saves via transform + PUT. Includes debounced auto-save and polling.
 */
import { create } from "zustand";
import type { BriefData, BuildStatus, EvalResults } from "@/types";
import type { ApiBrief } from "@/types/api";
import { fetchAgent, saveAgentBrief } from "@/lib/api";
import { briefFromApi, briefToApi } from "@/lib/briefTransforms";
import { sectionCompletion } from "@/lib/readiness";

/** Compute overall eval pass rate from evalSets UI data. */
function computeEvalPassRate(data: BriefData | null): string | null {
  if (!data) return null;
  const sets = data["eval-sets"]?.sets ?? [];
  let tested = 0;
  let passed = 0;
  for (const s of sets) {
    for (const t of s.tests ?? []) {
      if (t.lastResult != null) {
        tested++;
        if (t.lastResult.pass) passed++;
      }
    }
  }
  if (tested === 0) return null;
  return `${Math.round((passed / tested) * 100)}%`;
}

interface BriefStore {
  projectId: string | null;
  agentId: string | null;
  agentName: string;
  /** Transformed UI data. */
  data: BriefData | null;
  /** Raw brief from server (for merge-on-save). */
  rawBrief: ApiBrief | null;
  /** Build status from raw brief. */
  buildStatus: BuildStatus | null;
  /** @deprecated Use evalPassRate instead. Kept for legacy briefs. */
  evalResults: EvalResults | null;
  /** Overall eval pass rate string (e.g. "85%") computed from evalSets. */
  evalPassRate: string | null;
  /** Per-section completion map. */
  completion: Record<string, boolean>;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** Server timestamp for polling (brief.updated_at). */
  serverUpdatedAt: string | null;
  /** File mtime for polling (detects external edits by Claude/manual). */
  serverFileMtime: string | null;
  /** Load an agent's brief from server. */
  load: (projectId: string, agentId: string) => Promise<void>;
  /** Update a section's data in the store. Marks dirty. */
  updateSection: (sectionId: string, sectionData: any) => void;
  /** Save current state to server. */
  save: () => Promise<void>;
  /** Poll for server changes (returns true if refreshed). */
  poll: () => Promise<boolean>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useBriefStore = create<BriefStore>((set, get) => ({
  projectId: null,
  agentId: null,
  agentName: "",
  data: null,
  rawBrief: null,
  buildStatus: null,
  evalResults: null,
  evalPassRate: null,
  completion: {},
  dirty: false,
  loading: false,
  saving: false,
  error: null,
  serverUpdatedAt: null,
  serverFileMtime: null,

  load: async (projectId: string, agentId: string) => {
    set({ loading: true, error: null, projectId, agentId, dirty: false });
    try {
      const result = await fetchAgent(projectId, agentId);
      const raw = result.brief ?? ({} as ApiBrief);
      const data = briefFromApi(raw);
      set({
        agentName: result.name,
        data,
        rawBrief: raw,
        buildStatus: raw.buildStatus ?? null,
        evalResults: raw.evalResults ?? null,
        evalPassRate: computeEvalPassRate(data) ?? raw.evalResults?.summary?.passRate ?? null,
        completion: sectionCompletion(data),
        serverUpdatedAt: raw.updated_at ?? null,
        serverFileMtime: result._file_mtime ?? null,
        loading: false,
      });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  updateSection: (sectionId: string, sectionData: any) => {
    const { data } = get();
    if (!data) return;
    const updated = { ...data, [sectionId]: sectionData } as BriefData;
    set({
      data: updated,
      completion: sectionCompletion(updated),
      dirty: true,
    });
    // Debounced auto-save: 2s after last edit
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      get().save();
    }, 2000);
  },

  save: async () => {
    // Cancel any pending debounced auto-save to prevent stale overwrites
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const { projectId, agentId, data, rawBrief, dirty, saving } = get();
    if (!projectId || !agentId || !data || !rawBrief || saving) return;
    if (!dirty) return;
    set({ saving: true });
    try {
      const merged = briefToApi(data, rawBrief);
      await saveAgentBrief(projectId, agentId, merged as unknown as Record<string, unknown>);
      set({ rawBrief: merged, dirty: false, saving: false, serverUpdatedAt: new Date().toISOString() });
    } catch (e: any) {
      set({ saving: false, error: e.message });
    }
  },

  poll: async () => {
    const { projectId, agentId, dirty } = get();
    if (!projectId || !agentId || dirty) return false;
    try {
      const result = await fetchAgent(projectId, agentId);
      const raw = result.brief ?? ({} as ApiBrief);
      const serverTs = raw.updated_at ?? null;
      const fileMtime = result._file_mtime ?? null;
      // Refresh if either the JSON updated_at OR the file mtime changed
      // This catches both dashboard saves (updated_at) and external edits (mtime)
      const tsChanged = serverTs && serverTs !== get().serverUpdatedAt;
      const mtimeChanged = fileMtime && fileMtime !== get().serverFileMtime;
      if (tsChanged || mtimeChanged) {
        const data = briefFromApi(raw);
        set({
          data,
          rawBrief: raw,
          buildStatus: raw.buildStatus ?? null,
          evalResults: raw.evalResults ?? null,
          evalPassRate: computeEvalPassRate(data) ?? raw.evalResults?.summary?.passRate ?? null,
          completion: sectionCompletion(data),
          serverUpdatedAt: serverTs,
          serverFileMtime: fileMtime,
        });
        return true;
      }
    } catch {
      // Silent poll failure
    }
    return false;
  },
}));
