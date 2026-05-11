/**
 * Global store for the list of all projects.
 * Fetches from /api/projects instead of mock data.
 */
import { create } from "zustand";
import type { Project } from "@/types";
import type { ApiProject } from "@/types/api";
import { fetchProjects, createProject as apiCreate, deleteProject as apiDelete } from "@/lib/api";

interface ProjectsStore {
  projects: Project[];
  loading: boolean;
  error: string | null;
  /** Fetch projects from server. */
  load: () => Promise<void>;
  /** Create a new project via API. Returns the new project ID. */
  createProject: (name: string) => Promise<string>;
  /** Delete a project via API. */
  deleteProject: (id: string) => Promise<void>;
}

function apiToProject(p: ApiProject): Project {
  const maxReadiness = p.agents.length
    ? Math.max(...p.agents.map((a) => a.readiness))
    : 0;

  // Derive status from stage
  let status: Project["status"] = "draft";
  if (p.stage === "eval" || p.stage === "deployed") status = "ready";
  else if (p.stage === "build") status = "building";
  else if (p.stage === "research" || p.stage === "context") status = "in-progress";

  return {
    id: p.id,
    name: p.name,
    description: "",
    status,
    agentCount: p.agents.length,
    docCount: p.doc_count,
    updatedAt: p.created_at,
    readiness: maxReadiness,
  };
}

export const useProjectsStore = create<ProjectsStore>((set) => ({
  projects: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const raw = await fetchProjects();
      set({ projects: raw.map(apiToProject), loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },
  createProject: async (name: string) => {
    const result = await apiCreate(name);
    // Reload to get full project data
    const raw = await fetchProjects();
    set({ projects: raw.map(apiToProject) });
    return result.id;
  },
  deleteProject: async (id: string) => {
    await apiDelete(id);
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
  },
}));
