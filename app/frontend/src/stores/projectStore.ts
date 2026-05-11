/**
 * Store for the currently-viewed project's agents and documents.
 * Fetches from API. Agents and docs refresh when the project changes.
 */
import { create } from "zustand";
import type { Agent, Document } from "@/types";
import type { ApiProjectDetail, ApiAgentSummary, ApiDoc } from "@/types/api";
import {
  fetchProject,
  uploadDocument as apiUpload,
  pasteDocument as apiPaste,
  deleteDocument as apiDeleteDoc,
  deleteAgent as apiDeleteAgent,
} from "@/lib/api";

interface ProjectStore {
  projectId: string | null;
  projectName: string;
  agents: Agent[];
  documents: Document[];
  docContent: Record<string, string>;
  loading: boolean;
  error: string | null;
  /** Load a project's agents and docs from the API. */
  loadProject: (id: string) => Promise<void>;
  /** Re-fetch current project (for polling). */
  refresh: () => Promise<void>;
  /** Upload a file to the server. */
  uploadFile: (file: File) => Promise<void>;
  /** Save pasted text as a document. */
  pasteText: (title: string, text: string) => Promise<void>;
  /** Delete a document by filename. */
  removeDocument: (filename: string) => Promise<void>;
  /** Delete an agent. */
  removeAgent: (agentId: string) => Promise<void>;
}

function apiAgentToAgent(a: ApiAgentSummary): Agent {
  let status: Agent["status"] = "draft";
  if (a.has_build_report) status = "built";
  else if (a.build_ready) status = "ready";
  else if (a.has_instructions) status = "researched";

  return {
    id: a.id,
    name: a.name,
    description: a.description,
    status,
    readiness: a.readiness,
    sectionCompletion: {},
    evalPassRate: a.eval_pass_rate ?? null,
    architectureType: a.architecture_type || undefined,
    childAgentIds: a.architecture_children?.length ? a.architecture_children : undefined,
  };
}

function apiDocToDocument(d: ApiDoc): Document {
  const ext = d.filename.split(".").pop()?.toLowerCase() ?? "";
  let type: Document["type"] = "markdown";
  if (ext === "csv") type = "csv";
  else if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"].includes(ext)) type = "image";

  const sizeStr = d.size >= 1024 ? `${Math.round(d.size / 1024)} KB` : `${d.size} B`;

  return {
    id: d.key,
    name: d.filename,
    type,
    size: sizeStr,
    uploadedAt: "",
    content: "",
    contentHash: "",
    changeStatus: d.isModified ? "modified" : d.isNew ? "new" : "processed",
  };
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projectId: null,
  projectName: "",
  agents: [],
  documents: [],
  docContent: {},
  loading: false,
  error: null,

  loadProject: async (id: string) => {
    set({ loading: true, error: null, projectId: id });
    try {
      const data: ApiProjectDetail = await fetchProject(id);
      set({
        projectId: data.id,
        projectName: data.name,
        agents: data.agents.map(apiAgentToAgent),
        documents: data.docs.map(apiDocToDocument),
        docContent: data.doc_content,
        loading: false,
      });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  refresh: async () => {
    const id = get().projectId;
    if (!id) return;
    try {
      const data = await fetchProject(id);
      set({
        agents: data.agents.map(apiAgentToAgent),
        documents: data.docs.map(apiDocToDocument),
        docContent: data.doc_content,
      });
    } catch {
      // Silent refresh failure
    }
  },

  uploadFile: async (file: File) => {
    const id = get().projectId;
    if (!id) return;
    await apiUpload(id, file);
    await get().refresh();
  },

  pasteText: async (title: string, text: string) => {
    const id = get().projectId;
    if (!id) return;
    await apiPaste(id, title, text);
    await get().refresh();
  },

  removeDocument: async (filename: string) => {
    const id = get().projectId;
    if (!id) return;
    await apiDeleteDoc(id, filename);
    await get().refresh();
  },

  removeAgent: async (agentId: string) => {
    const id = get().projectId;
    if (!id) return;
    await apiDeleteAgent(id, agentId);
    await get().refresh();
  },
}));
