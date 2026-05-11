/**
 * API client — fetch wrapper for all server.py endpoints.
 *
 * In dev mode, Vite proxies /api → localhost:8000.
 * In production, same origin serves both API and static files.
 */
import type {
  ApiProject,
  ApiProjectDetail,
  ApiAgentDetail,
  ApiUploadResult,
  ApiPasteResult,
  ApiDocStatus,
} from "@/types/api";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Config (runtime ports) ───────────────────────────────────────

let _terminalWsUrl: string | null = null;
let _copilotTerminalWsUrl: string | null = null;

export async function getTerminalWsUrl(): Promise<string> {
  if (_terminalWsUrl) return _terminalWsUrl;
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const data = await res.json();
      _terminalWsUrl = data.terminalWsUrl;
      _copilotTerminalWsUrl = data.copilotTerminalWsUrl;
      return _terminalWsUrl!;
    }
  } catch { /* fallback */ }
  // Derive from current page: terminal = same host, port + 1
  const port = parseInt(window.location.port || "8000", 10);
  _terminalWsUrl = `ws://localhost:${port + 1}/ws`;
  return _terminalWsUrl;
}

export async function getCopilotTerminalWsUrl(): Promise<string> {
  if (_copilotTerminalWsUrl) return _copilotTerminalWsUrl;
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const data = await res.json();
      _terminalWsUrl = data.terminalWsUrl;
      _copilotTerminalWsUrl = data.copilotTerminalWsUrl;
      return _copilotTerminalWsUrl!;
    }
  } catch { /* fallback */ }
  const port = parseInt(window.location.port || "8000", 10);
  _copilotTerminalWsUrl = `ws://localhost:${port + 2}/ws`;
  return _copilotTerminalWsUrl;
}

// ─── Projects ─────────────────────────────────────────────────────

export async function fetchProjects(): Promise<ApiProject[]> {
  const data = await request<{ projects: ApiProject[] }>("/projects");
  return data.projects;
}

export async function fetchProject(id: string): Promise<ApiProjectDetail> {
  return request<ApiProjectDetail>(`/projects/${id}`);
}

export async function createProject(name: string): Promise<{ id: string; name: string }> {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function deleteProject(
  projectId: string
): Promise<{ deleted: boolean }> {
  return request(`/projects/${projectId}`, {
    method: "DELETE",
  });
}

// ─── Agents ───────────────────────────────────────────────────────

export async function fetchAgent(projectId: string, agentId: string): Promise<ApiAgentDetail> {
  return request<ApiAgentDetail>(`/projects/${projectId}/agents/${agentId}`);
}

export async function saveAgentBrief(
  projectId: string,
  agentId: string,
  brief: Record<string, unknown>
): Promise<{ saved: boolean }> {
  return request(`/projects/${projectId}/agents/${agentId}/state`, {
    method: "PUT",
    body: JSON.stringify(brief),
  });
}

export async function deleteAgent(
  projectId: string,
  agentId: string
): Promise<{ deleted: boolean }> {
  return request(`/projects/${projectId}/agents/${agentId}`, {
    method: "DELETE",
  });
}

export async function scaffoldChildren(
  projectId: string,
  agentId: string
): Promise<{ created: string[]; message: string }> {
  return request(`/projects/${projectId}/agents/${agentId}/scaffold-children`, {
    method: "POST",
  });
}

// ─── Documents ────────────────────────────────────────────────────

export async function uploadDocument(
  projectId: string,
  file: File
): Promise<ApiUploadResult> {
  const form = new FormData();
  form.append("file", file);
  return request(`/projects/${projectId}/upload`, {
    method: "POST",
    body: form,
  });
}

export async function pasteDocument(
  projectId: string,
  title: string,
  text: string
): Promise<ApiPasteResult> {
  return request(`/projects/${projectId}/paste`, {
    method: "POST",
    body: JSON.stringify({ title, text }),
  });
}

export async function deleteDocument(
  projectId: string,
  filename: string
): Promise<{ deleted: boolean }> {
  return request(`/projects/${projectId}/docs/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
}

export async function fetchDocStatus(projectId: string): Promise<ApiDocStatus> {
  return request<ApiDocStatus>(`/projects/${projectId}/doc-status`);
}
