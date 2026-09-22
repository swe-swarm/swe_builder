import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  Circle,
  Code2,
  FileCode2,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  History,
  Loader2,
  PanelLeft,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Terminal,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  studioApi,
  type Bootstrap,
  type Run,
  type StudioFile,
  type WorkspaceDetail,
} from "@/lib/studioApi";
import "./studio.css";

const active = (run: Run) =>
  run.status === "queued" || run.status === "running";
const runLabel = (run: Run) =>
  run.action === "inspect"
    ? "Inspect workspace"
    : run.action === "test"
      ? `npm run ${run.script}`
      : run.prompt;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

export default function Studio() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [file, setFile] = useState<StudioFile | null>(null);
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<"code" | "changes" | "runs">("code");
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [query, setQuery] = useState("");
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("");
  const [script, setScript] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [folder, setFolder] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 560);
  const generation = useRef(0);
  const fileRequest = useRef(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  const lineNumbers = useRef<HTMLPreElement>(null);
  const dirty = file !== null && draft !== file.content;
  const running = runs.find(active);
  const selectedId = selectedRun?.id;
  const hasProvider =
    bootstrap?.providers.some((p) => p.id === provider && p.available) ?? false;

  const loadBootstrap = useCallback(async () => {
    try {
      const data = await studioApi.bootstrap();
      setBootstrap(data);
      setFolder(data.suggestedRoot);
      setProvider(
        (current) =>
          current || data.providers.find((p) => p.available)?.id || "",
      );
      setWorkspaceId((current) => current || data.workspaces[0]?.id || "");
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);
  useEffect(() => {
    const previous = document.title;
    document.title = "SWE Studio · Darbot Labs";
    return () => {
      document.title = previous;
    };
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!workspaceId) return;
    const version = generation.current;
    try {
      const data = await studioApi.workspace(workspaceId);
      if (version !== generation.current) return;
      setWorkspace(data);
      setRuns(data.runs);
      setScript((current) =>
        data.scripts.includes(current) ? current : data.scripts[0] || "",
      );
    } catch (e) {
      if (version === generation.current) setError(errorMessage(e));
    }
  }, [workspaceId]);

  useEffect(() => {
    generation.current += 1;
    fileRequest.current += 1;
    setWorkspace(null);
    setFile(null);
    setDraft("");
    setRuns([]);
    setSelectedRun(null);
    setQuery("");
    setLoading(Boolean(workspaceId));
    void refreshWorkspace().finally(() => setLoading(false));
  }, [workspaceId, refreshWorkspace]);

  // Poll receipts, not the file editor. External agent edits remain reviewable as conflicts.
  useEffect(() => {
    if (!workspaceId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const list = await studioApi.runs(workspaceId);
        if (disposed) return;
        setRuns(list);
        if (selectedId) {
          const latest = await studioApi.run(selectedId);
          if (!disposed) setSelectedRun(latest);
        }
      } catch (e) {
        if (!disposed) setError(errorMessage(e));
      }
      if (!disposed) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 500);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [workspaceId, selectedId]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const mayDiscard = () =>
    !dirty || window.confirm("Discard unsaved file edits?");
  const openFile = async (path: string) => {
    if (!workspaceId || saving || !mayDiscard()) return;
    const request = ++fileRequest.current;
    const version = generation.current;
    try {
      const data = await studioApi.file(workspaceId, path);
      if (request !== fileRequest.current || version !== generation.current)
        return;
      setFile(data);
      setDraft(data.content);
      setView("code");
      setNotice("");
      setError("");
      if (window.innerWidth <= 560) setSidebarOpen(false);
    } catch (e) {
      if (request === fileRequest.current) setError(errorMessage(e));
    }
  };

  const save = async () => {
    if (!file || !dirty || saving || !workspaceId) return;
    setSaving(true);
    setError("");
    const version = generation.current;
    const request = fileRequest.current;
    const submittedDraft = draft;
    try {
      const saved = await studioApi.save(workspaceId, {
        ...file,
        content: draft,
      });
      if (version !== generation.current || request !== fileRequest.current)
        return;
      setFile(saved);
      setDraft((current) =>
        current === submittedDraft ? saved.content : current,
      );
      setNotice("Saved to disk");
      void refreshWorkspace();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const register = async (path = folder) => {
    if (!mayDiscard() || opening) return;
    setOpening(true);
    setError("");
    try {
      const item = await studioApi.register(path);
      const next = await studioApi.bootstrap();
      setBootstrap(next);
      setWorkspaceId(item.id);
      setDialogOpen(false);
      setView("code");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOpening(false);
    }
  };

  const submit = async (action: Run["action"]) => {
    if (!workspaceId || submitting || running) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    const version = generation.current;
    try {
      const run = await studioApi.submit(workspaceId, {
        action,
        provider,
        prompt,
        script,
      });
      if (version !== generation.current) return;
      setRuns((current) => [run, ...current]);
      setSelectedRun(run);
      setView("runs");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };
  const selectRun = async (id: string) => {
    const version = generation.current;
    try {
      const run = await studioApi.run(id);
      if (version === generation.current) {
        setSelectedRun(run);
        setView("runs");
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const cancel = async () => {
    if (!running) return;
    try {
      const run = await studioApi.cancel(running.id);
      setSelectedRun(run);
      await refreshWorkspace();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const downloadRun = () => {
    if (!selectedRun) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(selectedRun, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `swe-studio-${selectedRun.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const files =
    workspace?.files.filter((f) =>
      f.path.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const changeCount =
    workspace?.git.status.trim().split("\n").filter(Boolean).length || 0;

  return (
    <div className="studio">
      <header className="studio-header">
        <Link
          to="/studio"
          className="studio-brand"
          aria-label="SWE Studio home"
        >
          <span className="studio-mark">
            s<span>/</span>
          </span>
          <span>
            SWE <strong>STUDIO</strong>
            <small>by Darbot Labs</small>
          </span>
        </Link>
        <div className="studio-breadcrumb">
          <span>Workspace</span>
          <ChevronRight size={13} />
          <strong>{workspace?.name || "Get started"}</strong>
          {workspace?.git.branch && (
            <span className="studio-branch">
              <GitBranch size={12} />
              {workspace.git.branch}
            </span>
          )}
        </div>
        <button
          className="studio-button studio-open"
          onClick={() => setDialogOpen(true)}
        >
          <FolderOpen size={14} /> Open folder
        </button>
        <span className="studio-local">
          <span /> LOCAL
        </span>
      </header>

      <div className="studio-layout">
        <nav className="studio-rail" aria-label="Studio views">
          <button
            title="Explorer"
            aria-label="Explorer"
            aria-pressed={view === "code"}
            className={view === "code" ? "active" : ""}
            onClick={() => {
              setView("code");
              setSidebarOpen(true);
            }}
          >
            <Code2 size={21} />
          </button>
          <button
            title="Git changes"
            aria-label="Git changes"
            aria-pressed={view === "changes"}
            className={view === "changes" ? "active" : ""}
            onClick={() => {
              setView("changes");
              void refreshWorkspace();
            }}
          >
            <GitCompareArrows size={20} />
          </button>
          <button
            title="Task history"
            aria-label="Task history"
            aria-pressed={view === "runs"}
            className={view === "runs" ? "active" : ""}
            onClick={() => setView("runs")}
          >
            <History size={20} />
          </button>
          <div className="studio-rail-bottom">
            <Link
              to="/"
              title="Copilot Studio builder"
              aria-label="Copilot Studio builder"
              onClick={(e) => {
                if (!mayDiscard()) e.preventDefault();
              }}
            >
              <Bot size={21} />
            </Link>
            <a
              href="https://github.com/swe-swarm/swe_builder"
              target="_blank"
              rel="noreferrer"
              title="Source repository"
              aria-label="Source repository"
            >
              <GitBranch size={19} />
            </a>
          </div>
        </nav>

        {sidebarOpen && (
          <aside className="studio-explorer">
            <div className="studio-section-label">
              EXPLORER
              <button
                aria-label="Hide explorer"
                onClick={() => setSidebarOpen(false)}
              >
                <PanelLeft size={15} />
              </button>
            </div>
            <label className="studio-sr-only" htmlFor="studio-workspace">
              Workspace
            </label>
            <select
              id="studio-workspace"
              className="studio-workspace-select"
              value={workspaceId}
              onChange={(e) => {
                if (mayDiscard()) setWorkspaceId(e.target.value);
              }}
            >
              <option value="" disabled>
                Choose a workspace
              </option>
              {bootstrap?.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <label className="studio-search">
              <Search size={14} />
              <input
                aria-label="Filter files"
                placeholder="Find a file…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>⌕</kbd>
            </label>
            <div className="studio-folder-title">
              <FolderOpen size={14} />
              <span>{workspace?.name || "No folder open"}</span>
              <span>{workspace?.files.length ?? 0}</span>
              <button
                aria-label="Refresh workspace"
                onClick={() => void refreshWorkspace()}
              >
                <RefreshCw size={12} />
              </button>
            </div>
            <div className="studio-files">
              {loading ? (
                <p className="studio-empty-small">Reading workspace…</p>
              ) : files.length ? (
                files.map((f) => (
                  <button
                    key={f.path}
                    title={f.path}
                    className={file?.path === f.path ? "selected" : ""}
                    onClick={() => void openFile(f.path)}
                  >
                    <FileCode2 size={13} />
                    <span>
                      {f.path.includes("/") && (
                        <small>
                          {f.path.slice(0, f.path.lastIndexOf("/") + 1)}
                        </small>
                      )}
                      {f.path.split("/").pop()}
                    </span>
                  </button>
                ))
              ) : (
                <p className="studio-empty-small">
                  {query
                    ? "No matching files."
                    : "Open a local project to explore its files."}
                </p>
              )}
            </div>
            <div className="studio-explorer-foot">
              <ShieldCheck size={14} />
              <span>
                {workspace?.truncated
                  ? "First 1,500 files shown"
                  : "Editing local project files"}
              </span>
            </div>
          </aside>
        )}

        <main className="studio-main">
          <div className="studio-tabs">
            {!sidebarOpen && (
              <button
                aria-label="Show explorer"
                onClick={() => setSidebarOpen(true)}
              >
                <PanelLeft size={15} />
              </button>
            )}
            {(["code", "changes", "runs"] as const).map((tab) => (
              <button
                key={tab}
                className={view === tab ? "selected" : ""}
                onClick={() => {
                  setView(tab);
                  if (tab === "changes") void refreshWorkspace();
                }}
              >
                {tab === "code" ? (
                  <Code2 size={14} />
                ) : tab === "changes" ? (
                  <GitCompareArrows size={14} />
                ) : (
                  <Terminal size={14} />
                )}{" "}
                {tab === "code"
                  ? "Editor"
                  : tab === "changes"
                    ? "Changes"
                    : "Task console"}
                {tab === "changes" && changeCount > 0 && (
                  <span className="studio-count">{changeCount}</span>
                )}
              </button>
            ))}
          </div>
          {error && (
            <div className="studio-error" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={14} />
              </button>
            </div>
          )}
          {!workspace ? (
            <div className="studio-welcome">
              <div className="studio-eyebrow">
                <span /> YOUR NEXT BUILD STARTS HERE
              </div>
              <h1>
                A workspace for
                <br />
                you <span>and your agents.</span>
              </h1>
              <p>
                Open your repository. Give an agent a focused task.
                <br />
                Keep the code, checks, and changes in view.
              </p>
              <div className="studio-welcome-actions">
                <button
                  className="studio-button primary"
                  onClick={() => setDialogOpen(true)}
                >
                  <FolderOpen size={16} /> Open a local folder{" "}
                  <ArrowRight size={15} />
                </button>
                {bootstrap && (
                  <button
                    className="studio-button"
                    disabled={opening}
                    onClick={() => void register(bootstrap.suggestedRoot)}
                  >
                    Explore swe_builder
                  </button>
                )}
              </div>
              <div className="studio-flow">
                <div>
                  <span>01</span>
                  <strong>Connect</strong>
                  <small>Your files and Git history</small>
                </div>
                <div>
                  <span>02</span>
                  <strong>Build</strong>
                  <small>Your installed agent runtimes</small>
                </div>
                <div>
                  <span>03</span>
                  <strong>Review</strong>
                  <small>Real diffs and check results</small>
                </div>
              </div>
              {!bootstrap && (
                <button
                  className="studio-button"
                  onClick={() => void loadBootstrap()}
                >
                  <RefreshCw size={14} /> Reconnect to server
                </button>
              )}
              <div className="studio-powered">
                BUILT ON <strong>SWE SWARM</strong>
                <span>/</span> LOCAL WORKSPACE · OPEN SOURCE
              </div>
            </div>
          ) : view === "code" ? (
            file ? (
              <>
                <div className="studio-editor-toolbar">
                  <span>
                    <FileCode2 size={14} />
                    {file.path}
                    {dirty && <i title="Unsaved changes" />}
                  </span>
                  <div>
                    {notice && (
                      <small role="status">
                        <Check size={12} />
                        {notice}
                      </small>
                    )}
                    <button
                      className="studio-button"
                      disabled={saving}
                      onClick={() => void openFile(file.path)}
                    >
                      <RefreshCw size={13} /> Reload
                    </button>
                    <button
                      className="studio-button primary"
                      disabled={!dirty || saving}
                      onClick={() => void save()}
                    >
                      {saving ? (
                        <Loader2 size={13} className="studio-spin" />
                      ) : (
                        <Check size={13} />
                      )}{" "}
                      Save
                    </button>
                  </div>
                </div>
                <div className="studio-code">
                  <pre
                    ref={lineNumbers}
                    aria-hidden="true"
                    className="studio-line-numbers"
                  >
                    {draft
                      .split("\n")
                      .map((_, i) => i + 1)
                      .join("\n")}
                  </pre>
                  <textarea
                    ref={editor}
                    aria-label={`Edit ${file.path}`}
                    spellCheck={false}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setNotice("");
                    }}
                    onScroll={() => {
                      if (lineNumbers.current && editor.current)
                        lineNumbers.current.scrollTop =
                          editor.current.scrollTop;
                    }}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                        e.preventDefault();
                        void save();
                      }
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="studio-editor-empty">
                <Code2 size={42} />
                <h2>{workspace.name}</h2>
                <p>Select a file from the explorer to start editing.</p>
                <button
                  className="studio-button"
                  disabled={!!running || submitting}
                  onClick={() => void submit("inspect")}
                >
                  <Search size={14} /> Inspect workspace
                </button>
                <small>{workspace.root}</small>
              </div>
            )
          ) : view === "changes" ? (
            <>
              <div className="studio-editor-toolbar">
                <span>
                  <GitBranch size={14} />
                  {workspace.git.branch || "Git overview"}
                </span>
                <button
                  className="studio-button"
                  onClick={() => void refreshWorkspace()}
                >
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>
              <div className="studio-diff">
                <h3>WORKING TREE</h3>
                <pre>{workspace.git.status || "No uncommitted changes."}</pre>
                <h3>PATCH</h3>
                {workspace.git.truncated && (
                  <p>
                    Diff truncated at 1 MiB. Review the complete patch with Git.
                  </p>
                )}
                <pre>
                  {workspace.git.diff
                    ? workspace.git.diff.split("\n").map((line, i) => (
                        <span
                          key={i}
                          className={
                            line.startsWith("+")
                              ? "added"
                              : line.startsWith("-")
                                ? "removed"
                                : line.startsWith("@@")
                                  ? "hunk"
                                  : ""
                          }
                        >
                          {line}
                          {"\n"}
                        </span>
                      ))
                    : "No tracked-file patch. New files appear in the working-tree list above."}
                </pre>
              </div>
            </>
          ) : (
            <div className="studio-console">
              <div className="studio-editor-toolbar">
                <span>
                  <Terminal size={14} />
                  {selectedRun ? runLabel(selectedRun) : "Task output"}
                </span>
                <div>
                  {selectedRun && (
                    <button className="studio-button" onClick={downloadRun}>
                      <ArrowDownToLine size={13} /> Receipt
                    </button>
                  )}
                  {running && (
                    <button
                      className="studio-button danger"
                      onClick={() => void cancel()}
                    >
                      <Square size={12} /> Stop
                    </button>
                  )}
                </div>
              </div>
              {selectedRun ? (
                <>
                  <div className="studio-run-meta">
                    <span className={`studio-status ${selectedRun.status}`}>
                      {selectedRun.status}
                    </span>
                    <span>
                      {new Date(
                        selectedRun.created * 1000,
                      ).toLocaleTimeString()}
                    </span>
                    {selectedRun.exit_code !== null && (
                      <span>exit {selectedRun.exit_code}</span>
                    )}
                    <span>{selectedRun.provider || "local"}</span>
                  </div>
                  <pre className="studio-output">
                    {selectedRun.outputTruncated &&
                      "[Earlier output omitted; complete log remains on disk]\n"}
                    {selectedRun.output ||
                      (active(selectedRun)
                        ? "Waiting for process output…"
                        : "No output was recorded.")}
                  </pre>
                  <p className="studio-console-note">
                    Status reflects process exit. Review the patch and checks
                    before accepting agent work.
                  </p>
                </>
              ) : (
                <div className="studio-editor-empty">
                  <Terminal size={36} />
                  <h2>Every task leaves a trail.</h2>
                  <p>
                    Run an inspection, a package check, or an agent task.
                    <br />
                    Output and receipts are kept across restarts.
                  </p>
                  <button
                    className="studio-button"
                    disabled={submitting || !!running}
                    onClick={() => void submit("inspect")}
                  >
                    Run first inspection <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
          )}
        </main>

        <aside className="studio-agent-panel">
          <div className="studio-agent-heading">
            <span className="studio-agent-glyph">
              <Bot size={20} />
            </span>
            <div>
              <h2>Build together</h2>
              <p>One focused task at a time.</p>
            </div>
            <span className="studio-version">01</span>
          </div>
          <div className="studio-composer">
            <label htmlFor="studio-prompt">WHAT ARE WE BUILDING?</label>
            <textarea
              id="studio-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe a change, investigate a bug, or ask for a code review…"
            />
            <div className="studio-prompt-presets">
              {["Review", "Implement", "Explain"].map((label) => (
                <button
                  key={label}
                  onClick={() =>
                    setPrompt(
                      label === "Review"
                        ? "Review this repository for a concrete correctness issue. Explain the evidence and propose a focused fix."
                        : label === "Implement"
                          ? "Implement the following change and run the relevant checks: "
                          : "Explain the architecture of this repository with references to the key source files.",
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="studio-sr-only" htmlFor="studio-provider">
              Agent runtime
            </label>
            <select
              id="studio-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="">Choose an installed runtime</option>
              {bootstrap?.providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.name}
                  {p.available ? "" : " · not installed"}
                </option>
              ))}
            </select>
            <button
              className="studio-button primary studio-dispatch"
              disabled={
                !workspace ||
                !hasProvider ||
                !prompt.trim() ||
                submitting ||
                !!running
              }
              onClick={() => void submit("agent")}
            >
              {submitting ? (
                <Loader2 size={14} className="studio-spin" />
              ) : (
                <ArrowRight size={15} />
              )}{" "}
              Start task <span>↵</span>
            </button>
            <p className="studio-permission-note">
              Uses your installed CLI, account, and permissions. Sign in through
              the CLI first. Provider permission prompts require its native
              terminal.
            </p>
          </div>
          <div className="studio-checks">
            <div className="studio-section-label">WORKSPACE CHECKS</div>
            <button
              className="studio-check-row"
              disabled={!workspace || !!running || submitting}
              onClick={() => void submit("inspect")}
            >
              <Search size={15} />
              <span>
                Inspect repository
                <small>Files, branch, and available checks</small>
              </span>
              <Play size={12} />
            </button>
            <div className="studio-script-row">
              <label className="studio-sr-only" htmlFor="studio-script">
                Package check
              </label>
              <select
                id="studio-script"
                value={script}
                onChange={(e) => setScript(e.target.value)}
              >
                <option value="">No check selected</option>
                {workspace?.scripts.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                aria-label="Run selected package check"
                disabled={!script || !!running || submitting}
                onClick={() => void submit("test")}
              >
                <Play size={14} />
              </button>
            </div>
            <small className="studio-check-hint">
              Runs the selected package script on this host.
            </small>
          </div>
          <div className="studio-history">
            <div className="studio-section-label">
              RECENT TASKS<span>{runs.length}</span>
            </div>
            {runs.length ? (
              runs.slice(0, 12).map((run) => (
                <button
                  className={`studio-history-item ${selectedId === run.id ? "selected" : ""}`}
                  key={run.id}
                  onClick={() => void selectRun(run.id)}
                >
                  <Circle size={8} className={`studio-dot ${run.status}`} />
                  <span>
                    {runLabel(run)}
                    <small>
                      {run.action === "agent" ? run.provider : "Workspace"} ·{" "}
                      {new Date(run.created * 1000).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </span>
                  <span className={`studio-status ${run.status}`}>
                    {run.status}
                  </span>
                </button>
              ))
            ) : (
              <p className="studio-empty-small">
                Your task history will appear here.
              </p>
            )}
          </div>
          <div className="studio-runtimes">
            <div className="studio-section-label">
              RUNTIMES
              <button
                aria-label="Refresh runtime availability"
                onClick={() => void loadBootstrap()}
              >
                <RefreshCw size={12} />
              </button>
            </div>
            {bootstrap?.providers.map((p) => (
              <div key={p.id} title={p.detail}>
                <span
                  className={`studio-runtime-dot ${p.available ? "online" : ""}`}
                />
                <span>{p.name}</span>
                <small>{p.available ? "Installed" : "Not installed"}</small>
              </div>
            ))}
          </div>
        </aside>
      </div>
      <footer className="studio-footer">
        <span>
          <span className="studio-runtime-dot online" /> SWE SWARM{" "}
          <ChevronRight size={11} /> SWE STUDIO
        </span>
        <span>
          {workspace?.git.branch && (
            <>
              <GitBranch size={12} />
              {workspace.git.branch}
              <i />
            </>
          )}
          {dirty ? "Unsaved changes" : "Ready"}
          <i /> UTF-8 <i />{" "}
          {file ? `${draft.split("\n").length} lines` : "Local workspace"}
        </span>
      </footer>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="studio-dialog">
          <DialogHeader>
            <DialogTitle>Open a workspace</DialogTitle>
            <DialogDescription>
              Choose an existing project folder on the machine running SWE
              Studio.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="studio-folder">Absolute folder path</label>
          <input
            id="studio-folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void register();
            }}
            placeholder="C:\\code\\my-project or /home/me/code/my-project"
          />
          <p>
            Studio opens the existing files in place. Agent tasks and package
            checks run with your local account’s access.
          </p>
          {error && (
            <p role="alert" className="studio-dialog-error">
              {error}
            </p>
          )}
          <button
            className="studio-button primary"
            disabled={opening || !folder.trim()}
            onClick={() => void register()}
          >
            {opening ? (
              <Loader2 size={15} className="studio-spin" />
            ) : (
              <FolderOpen size={15} />
            )}{" "}
            Open workspace
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
