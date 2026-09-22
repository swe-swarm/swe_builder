import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Studio from "./Studio";
import { studioApi } from "@/lib/studioApi";

vi.mock("@/lib/studioApi", () => ({
  studioApi: {
    bootstrap: vi.fn(),
    workspace: vi.fn(),
    file: vi.fn(),
    save: vi.fn(),
    register: vi.fn(),
    runs: vi.fn(),
    run: vi.fn(),
    submit: vi.fn(),
    cancel: vi.fn(),
  },
}));

const workspace = {
  id: "w1",
  root: "/tmp/project",
  name: "Project",
  created: 1,
  files: [{ path: "main.ts", size: 12 }],
  scripts: ["test"],
  runs: [],
  truncated: false,
  git: {
    available: true,
    branch: "main",
    status: "",
    diff: "",
    truncated: false,
  },
};
const file = { path: "main.ts", content: "original", digest: "a".repeat(64) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(studioApi.bootstrap).mockResolvedValue({
    token: "token",
    suggestedRoot: workspace.root,
    workspaces: [workspace],
    providers: [
      {
        id: "nemo",
        name: "NemoSwarm",
        available: false,
        detail: "Not installed",
      },
    ],
  });
  vi.mocked(studioApi.workspace).mockResolvedValue(workspace);
  vi.mocked(studioApi.runs).mockResolvedValue([]);
  vi.mocked(studioApi.file).mockResolvedValue(file);
});
afterEach(cleanup);

describe("Studio workflows", () => {
  it("keeps unavailable runtimes disabled and does not start an agent on load", async () => {
    render(
      <MemoryRouter>
        <Studio />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "main.ts" });
    fireEvent.change(screen.getByLabelText("WHAT ARE WE BUILDING?"), {
      target: { value: "Review" },
    });
    expect(screen.getByRole("button", { name: /Start task/ })).toBeDisabled();
    expect(studioApi.submit).not.toHaveBeenCalled();
  });

  it("retains the draft when the file changed on disk", async () => {
    vi.mocked(studioApi.save).mockRejectedValue(
      new Error(
        "The file changed on disk. Reload it before saving your edits.",
      ),
    );
    render(
      <MemoryRouter>
        <Studio />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "main.ts" }));
    const editor = await screen.findByLabelText("Edit main.ts");
    fireEvent.change(editor, { target: { value: "my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "file changed on disk",
    );
    expect(editor).toHaveValue("my draft");
    expect(studioApi.save).toHaveBeenCalledWith("w1", {
      ...file,
      content: "my draft",
    });
  });

  it("does not overwrite typing that happens during an in-flight save", async () => {
    let resolve!: (value: typeof file) => void;
    vi.mocked(studioApi.save).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(
      <MemoryRouter>
        <Studio />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "main.ts" }));
    const editor = await screen.findByLabelText("Edit main.ts");
    fireEvent.change(editor, { target: { value: "saved version" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.change(editor, { target: { value: "newer typing" } });
    resolve({ ...file, content: "saved version", digest: "b".repeat(64) });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
    expect(editor).toHaveValue("newer typing");
  });

  it("displays a real inspection receipt", async () => {
    vi.mocked(studioApi.submit).mockResolvedValue({
      id: "r1",
      workspace_id: "w1",
      action: "inspect",
      provider: "",
      prompt: "",
      script: "",
      status: "succeeded",
      created: 1,
      finished: 2,
      exit_code: 0,
      output: "Inspection complete.",
    });
    render(
      <MemoryRouter>
        <Studio />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "main.ts" });
    fireEvent.click(screen.getByRole("button", { name: "Inspect workspace" }));
    expect(await screen.findByText("Inspection complete.")).toBeInTheDocument();
    expect(screen.getByText("exit 0")).toBeInTheDocument();
  });
});
