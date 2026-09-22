# SWE Studio

SWE Studio is an initial local coding workspace at `/studio`, built inside
[swe-swarm/swe_builder](https://github.com/swe-swarm/swe_builder). It extends the
existing React/Vite frontend and Python/FastAPI service. The Copilot Studio
builder remains at `/`.

## Run locally

Use Node.js 18+ and Python 3.10+. From the repository root:

```bash
python -m venv .venv
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install fastapi uvicorn python-multipart
npm --prefix app/frontend ci
npm --prefix app/frontend run build
npm run studio
```

Open **http://127.0.0.1:8000/studio**. This command starts the existing Python
server without the legacy terminal sidecars or automatic dependency installation.
For frontend development, keep the server running and use
`npm --prefix app/frontend run dev`; visit `http://localhost:8080/studio`.
Run one server worker. Do not expose this local development service to a network.

## What works

- Register an existing project folder; browse, filter, and edit UTF-8 files.
- Save atomically with a digest check that rejects edits based on stale content.
- Review the repository's current branch, working-tree status, staged patch, and
  unstaged patch. Open the repository root for Git review.
- Inspect a repository without a model call, or run a selected existing
  `test`, `check`, `lint`, or `typecheck` npm script, including namespaced variants.
- Submit a task to an installed Claude Code, GitHub Copilot, or NemoSwarm CLI.
- Read live output, cancel a process group, revisit history, and download a JSON
  receipt with status and exit code. Mobile layouts include a toggleable explorer.

## Agent runtimes

Install and authenticate the desired CLI independently. Discovery checks for an
executable; it does not verify credentials or call a model. Tasks use the local
account's provider configuration and repository instructions. Provider calls may
incur that provider's normal usage charges.

| Runtime                                             | Invocation                                             |
| --------------------------------------------------- | ------------------------------------------------------ |
| GitHub Copilot                                      | `copilot --prompt <task>`                              |
| Claude Code                                         | `claude --print --permission-mode default -- <task>`   |
| [NemoSwarm](https://github.com/swe-swarm/nemoswarm) | `nemo --prompt <task> --output-format text --no-color` |

Executable overrides: `SWE_STUDIO_COPILOT_BIN`, `SWE_STUDIO_CLAUDE_BIN`, and
`SWE_STUDIO_NEMO_BIN`. Use absolute executable paths. On Windows, `.cmd` and `.bat`
wrappers are not launched. Nemo can instead use `SWE_STUDIO_NEMO_ENTRY` pointing
to the absolute path of its installed `bin/nemo.js`, invoked with Node.js.

Studio does not grant bypass/YOLO/allow-all permissions. It runs these CLIs with
closed stdin; interactive authentication or permission decisions must be handled
in the provider's native terminal. A task needing such interaction may fail.
The CLI adapters have command-construction tests; authenticated model execution
must be validated with your own provider setup.

## Execution and storage

One active task is allowed per workspace. Tasks run in the selected folder with
the local user's access; this is **not a sandbox**. Only open trusted projects:
package scripts and configured agent tools can execute arbitrary project code.
Task output is capped at 2 MiB and execution at 15 minutes. Neither cancellation
nor a failed task rolls back changes. Review Git changes and relevant checks.
`succeeded` means exit code zero, not verified correctness of generated code.

Workspace registrations, receipts, and logs are stored in `.swe-studio/`
(gitignored). Override with `SWE_STUDIO_STATE`. Prompts and logs can contain
project content; they are local plaintext. Startup marks unfinished receipts
`interrupted` and never automatically retries them. A hard server crash can leave
a child process running: inspect it before starting replacement work.

Studio APIs require loopback host/origin checks and a per-process mutation token.
They are for a single local user, not a hosted multi-tenant deployment. File routes
exclude symlinks, path traversal, generated directories, and common secret-file
names. These filters are convenience protections, not a secret scanner or a
boundary for agent subprocesses. Git diffs may include sensitive tracked content.

The explorer shows at most 1,500 files and descends 12 levels; hidden files and
generated directories are omitted. Editing is limited to existing UTF-8 files up
to 1 MiB. Git patches are truncated at 1 MiB. The task console returns the most
recent 150,000 characters; the capped full log stays on disk. History shows the
latest 100 receipts per workspace. No file creation, Git commit/push, approval
queue, autonomous swarm scheduling, or isolated worktree management is included.

## Checks

With the virtual environment activated:

```bash
python -m pip install -r app/tests/requirements.txt
npm run test:studio
npm --prefix app/frontend test
npm --prefix app/frontend run typecheck:studio
npm --prefix app/frontend run build
```

Tests cover file access, stale saves, Git patches, receipt persistence, process
failures, output limits, cancellation, HTTP origin/token enforcement, and UI
draft preservation. They do not use paid APIs. The repository-wide TypeScript
check currently has unrelated legacy brief/PDF type errors; `typecheck:studio`
checks this new surface and its imported UI primitives independently.

## Framework scope

The actual foundation is swe_builder's React/FastAPI application. NemoSwarm is
an optional executable adapter, not a bundled runtime. AMP manifests, Aether's
Rust runtime, and dayour/a2swe are not wired into this first version. Their durable
jobs, evidence contracts, and runtime isolation are potential follow-on work.
