# SWE_BUILDER

Automate end-to-end agent builds — from data intake through architecture, build, evaluation, and automated fix loops. Powered by Copilot-SDK and Claude Code with a hybrid stack and AI teammate peer review.

amp=agent_manifest_protocol combining the simplicity of adaptive cards with mcp, full agents, solutions, etc. can follow known schemas and indexes so that reasoning is spent on solutioning instead of architecture. Adaptive by design

## Quick Start

### Option A: `start.cmd` (Windows — installs everything)

```powershell
git clone https://github.com/swe-swarm/swe_builder.git
cd swe_builder
.\start.cmd
```

Double-click `start.cmd` or run it from a terminal. On first run it installs Node.js, Python, Git, Claude Code, and all dependencies via winget — no admin needed. On subsequent runs it detects everything is present and launches instantly (~1 second). Every launch auto-updates from the repo, builds the frontend if needed, and opens your browser.

Use `.\start.cmd --full` to force a full dependency check and upgrade pass.

### Option B: `npm install` (cross-platform — requires Node.js + Python)

```bash
npm install -g swe_builder
swe_builder start
```

The install automatically sets up Python dependencies, builds the frontend, and configures environment variables. Requires Node.js 18+ and Python 3.10+ already installed.

### CLI Commands

```
swe_builder start       Start the dashboard server
swe_builder stop        Stop a running instance
swe_builder restart     Restart (stop + start)
swe_builder health      Check status (pid, port, HTTP)
swe_builder --version   Show version
swe_builder --help      Show help
```

Flag syntax (`--start`, `--stop`, etc.) also accepted.

## Prerequisites

**None** — `start.cmd` installs everything automatically via winget (Windows 11 built-in).

If you prefer to install manually:

| Requirement | Why |
|-------------|-----|
| **Node.js 18+** | Dashboard and terminal server |
| **Python 3.10+** | Backend API |
| **Claude Code** | AI agent that runs the builds (org-provided) |
| **PAC CLI** | Power Platform operations (Claude will auth for you) |
| **Azure CLI** | Bug/suggest work item creation (optional) |
| **.NET 10 Runtime** | ObjectModel CLI for YAML validation (optional — om-cli tools skip gracefully if missing) |
| **Microsoft Account** | Access to Copilot Studio |

## How It Works

### Dashboard

The dashboard provides project management with an embedded Claude Code terminal:

1. **Create project** — upload customer documents (SDR, requirements, etc.)
2. **Research** — Claude reads docs, identifies agents, researches MCS components, generates the full design
3. **Build** — Claude builds the agent in Copilot Studio using the hybrid stack
4. **Evaluate** — Claude runs automated tests against the published agent
5. **Fix** — if eval pass rate is below 70%, a "Fix Failures" button appears. Claude classifies root causes, fixes instructions/topics, and re-evaluates automatically
6. **Export Report** — download a customer-shareable summary from the design

Each button runs a Claude Code skill in the embedded terminal. You watch it work in real-time. Multiple terminal tabs let you work on several agents in parallel.

The workflow is iterative: Research → Build → Evaluate → Fix → re-Evaluate until the agent meets quality bar.

### CLI

You can also run skills directly in Claude Code:

```
/mcs-init ProjectName                    Create project, detect SDR files
/mcs-context CustomerName                Pull M365 history (emails, meetings, docs, Teams)
/mcs-research ProjectName                Read docs, identify agents, full enrichment
/mcs-research ProjectName agentId        Re-enrich a specific agent after feedback
/mcs-build ProjectName agentId           Build agent(s) in Copilot Studio
/mcs-eval ProjectName agentId            Run evals, write results
/mcs-fix ProjectName agentId             Fix eval failures and re-evaluate
/mcs-refresh                             Refresh knowledge cache
```

## What Happens on First Use

When you open the Claude Code terminal for the first time, Claude will:

1. Ask you to pick your **account** (which tenant)
2. Ask you to pick your **environment** (which Copilot Studio environment)
3. Set up **PAC CLI auth** for you (opens a browser sign-in — just click through)
4. Check the **knowledge cache** is fresh (auto-refreshes if stale)

After that, you're ready to build. Claude remembers your selection for the session.

## Hybrid Build Stack

Each build step uses the best tool, minimizing fragile browser automation:

| Priority | Tool | Handles |
|----------|------|---------|
| 1 | **PAC CLI** | Agent listing, publish, status, solution export/import |
| 2 | **Dataverse API** | Instructions, knowledge upload, security settings |
| 3 | **Code Editor YAML** | Topic authoring, adaptive cards, branching logic |
| 4 | **Direct Line API** | Evaluation testing (send messages, compare responses) |
| 5 | **Playwright** | Agent creation, model selection, tool/connector addition, OAuth (last resort) |

### YAML Validation Pipeline

Topic YAML goes through 4 validation layers before it reaches Copilot Studio:

| Layer | Tool | What It Catches |
|-------|------|----------------|
| Pre-generation | `tools/gen-constraints.py` | Missing required fields (prevents errors at generation time) |
| Structural | `tools/om-cli/om-cli.exe` | Unknown nodes, missing fields, invalid structure (357 types) |
| Semantic | `tools/semantic-gates.py` | PowerFx errors, cross-refs, variable flow, channel compat, connectors |
| Spec drift | `tools/drift-detect.py` | Missing/extra topics, trigger/variable mismatches vs brief |

## Agent Teams

Complex builds use 5 AI teammates that challenge each other's work before execution:

| Teammate | What They Do | Used In |
|----------|-------------|---------|
| **Research Analyst** | Discovers MCS capabilities, prevents false limitation claims | Research, Build (on-demand) |
| **Prompt Engineer** | Writes agent instructions, reviews system prompt quality | Research, Build (on-demand), Fix |
| **Topic Engineer** | Validates topic feasibility, generates YAML topics + adaptive cards | Research (feasibility), Build (YAML), Fix |
| **QA Challenger** | Reviews all outputs, challenges claims, classifies failures | Research, Build, Fix |
| **Repo Checker** | Validates repo integrity after changes | Development |

You interact with the lead only. The lead delegates to teammates, they debate and iterate, then the lead executes validated outputs in Copilot Studio.

## Knowledge System

The tool continuously learns and improves:

| Layer | What | How It Stays Current |
|-------|------|---------------------|
| **Cache** (18 files) | MCS capabilities — models, connectors, MCP servers, triggers, etc. | Auto-refreshed at session start + before builds |
| **Learnings** (8 files) | Experience from past builds — what worked, what didn't | Captured after each build/eval, user-confirmed |
| **Patterns** | YAML syntax, Playwright patterns, Dataverse API patterns | Stable reference (manually updated) |
| **Frameworks** | Component selection, architecture scoring, tool priority | Stable reference (manually updated) |

## Project Structure

```
start.cmd                   Double-click entry point (installs deps + launches)
setup.ps1                   Bootstrap script (winget/npm/pip, .NET 10 SDK)
start.js                    Launcher (npm start) — installs hooks, checks deps
bin/
  cli.js                    CLI entry point (swe_builder command)
  postinstall.js            Post-install setup (Python deps, frontend build, env vars)

.claude/
  settings.json             MCP servers, permissions, Agent Teams flag
  skills/                   9 skills (7 workflow + 2 utility)
  agents/                   5 AI teammate definitions

app/
  server.py                 FastAPI backend (serves SPA from dist/)
  terminal-server.js        Claude Code terminal (multi-tab, WebSocket)
  lib/                      Shared Python modules (readiness calc, project scanning)
  frontend/                 React + TypeScript SPA (Vite + shadcn/ui)

knowledge/
  learnings/                Experience from past builds (grows over time)
  cache/                    18 MCS capability cheat sheets (auto-refreshed)
  patterns/                 YAML, Playwright, Dataverse API patterns + 10 topic templates
  frameworks/               Decision frameworks

templates/                  brief.json (single source of truth schema)

tools/
  om-cli/                   ObjectModel CLI — YAML validation (357 types, .NET 10)
  gen-constraints.py        Pre-generation constraint extraction
  drift-detect.py           Brief-vs-YAML drift detection
  semantic-gates.py         5 semantic validation gates (PowerFx, cross-refs, variables, channels, connectors)
  powerfx-catalog.json      Official PowerFx function catalog (139 functions from MS Learn)
  update-om-cli.ps1         Auto-update om-cli from ObjectModel source repo
  direct-line-test.js       Direct Line API test runner
  dataverse-helper.ps1      PowerShell Dataverse Web API helper
  schema-lookup.py          Legacy schema query tool (fallback)
  git-hooks/                Pre-commit (file protection) + pre-push (om-cli auto-update)

Build-Guides/               Per-project work (gitignored)
```

## Networking & Security

Both servers bind to `127.0.0.1` (localhost only). No ports are exposed to the network — no firewall rules or port openings are needed. This is safe on corporate PCs and won't affect Teams, Outlook, VPN, or any other applications.

| Port | Service | Binding |
|------|---------|---------|
| 8000–8020 | Dashboard (FastAPI) | `127.0.0.1` — localhost only |
| 8001–8021 | Terminal (WebSocket) | `127.0.0.1` — localhost only |

Ports are auto-discovered in pairs (app, app+1). If 8000/8001 are busy, the next available pair is used. The actual port is shown in the terminal output and lockfile.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `start.cmd` fails | Make sure winget is available (built into Windows 11). Try `.\start.cmd --full` to force a re-check |
| `npm start` fails | Run `.\start.cmd` instead — it installs missing dependencies automatically |
| `swe_builder start` fails | Ensure Python 3.10+ is installed: `python --version`. Re-run `npm install -g swe_builder` |
| Port conflict | The launcher auto-discovers available ports (8000–8020). Run `swe_builder health` to see the actual port |
| Bug/Suggest buttons not working | Run `.\start.cmd --full` to install Azure CLI, or install manually and run `az login` |
| Dashboard won't load | Check terminal output for errors — both servers must be running |
| Firewall prompt on startup | Should not happen (localhost-only binding). If it does, you can safely deny it |
| PAC CLI not working | Ask Claude: "set up PAC CLI auth for me" |
| Wrong MCS environment | Claude silently verifies before every browser interaction — it will alert you only if the environment doesn't match |
| Terminal not connecting | Close the tab and click "+" to create a new terminal session |

## Feedback

Found a bug or have a suggestion? Click the **Bug** or **Suggest** buttons in the dashboard header. A dialog collects your description, auto-gathers context (project, agent, page), and routes to Claude in the terminal. You can also file issues directly in the [SWE_BUILDER GitHub repository](https://github.com/swe-swarm/swe_builder/issues).

## License

MIT

## AMP Framework

AMP is the manifest-driven generator framework for swe_builder Copilot SDK agents.
Docs live in `knowledge/amp/` because the root `docs/` folder is gitignored.
Start with [knowledge/amp/README.md](knowledge/amp/README.md), then read the manifest spec and generator guide.
Basic CLI flow:

```text
swe_builder amp init my-agent --language typescript
swe_builder amp validate
swe_builder amp build --out ./out
```
