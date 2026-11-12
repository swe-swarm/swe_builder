export interface Workspace {
  id: string;
  name: string;
  root: string;
  created: number;
}
export interface Provider {
  id: string;
  name: string;
  available: boolean;
  detail: string;
}
export interface StudioFile {
  path: string;
  content: string;
  digest: string;
}
export interface Run {
  id: string;
  workspace_id: string;
  action: "inspect" | "test" | "agent";
  provider: string;
  prompt: string;
  script: string;
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "interrupted";
  created: number;
  finished: number | null;
  exit_code: number | null;
  output?: string;
  outputTruncated?: boolean;
}
export interface WorkspaceDetail extends Workspace {
  files: { path: string; size: number }[];
  truncated: boolean;
  scripts: string[];
  runs: Run[];
  git: {
    available: boolean;
    branch: string | null;
    status: string;
    diff: string;
    truncated: boolean;
  };
}
export interface Bootstrap {
  token: string;
  suggestedRoot: string;
  providers: Provider[];
  workspaces: Workspace[];
}
let token = "";

async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/studio${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Studio-Token": token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : `Request failed (${response.status}).`,
    );
  if (!data)
    throw new Error(
      "Studio API is unavailable. Start the Python dashboard server.",
    );
  return data as T;
}

export const studioApi = {
  bootstrap: async () => {
    const data = await request<Bootstrap>("/bootstrap");
    token = data.token;
    return data;
  },
  register: (root: string, name = "") =>
    request<Workspace>("/workspaces", "POST", { root, name }),
  workspace: (id: string) => request<WorkspaceDetail>(`/workspaces/${id}`),
  file: (id: string, path: string) =>
    request<StudioFile>(
      `/workspaces/${id}/file?path=${encodeURIComponent(path)}`,
    ),
  save: (id: string, file: StudioFile) =>
    request<StudioFile>(`/workspaces/${id}/file`, "PUT", file),
  runs: (id: string) => request<Run[]>(`/workspaces/${id}/runs`),
  submit: (
    id: string,
    input: {
      action: Run["action"];
      provider?: string;
      prompt?: string;
      script?: string;
    },
  ) => request<Run>(`/workspaces/${id}/runs`, "POST", input),
  run: (id: string) => request<Run>(`/runs/${id}`),
  cancel: (id: string) => request<Run>(`/runs/${id}/cancel`, "POST"),
};
