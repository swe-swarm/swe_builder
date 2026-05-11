---
name: mcs-refresh
description: Refresh one or all knowledge cache files with live research from MS Learn, WebSearch, and MCS UI snapshots. Use to keep inventories current.
---

# MCS Knowledge Cache Refresh

Refresh knowledge cache files in `knowledge/cache/` with targeted live research. These 18 files form a **specialized MCS knowledge layer** — distilled cheat sheets with decision tables, gotchas, and current-state inventories that Claude's base training doesn't have.

## Usage

- `/mcs-refresh` — refresh all stale cache files (> 7 days old)
- `/mcs-refresh triggers` — refresh just `knowledge/cache/triggers.md`
- `/mcs-refresh models connectors` — refresh specific files
- `/mcs-refresh all` — force refresh everything regardless of age

## All 18 Cache Files

### Tier 1: Build-Critical (refresh before every `/mcs-research`)

These directly drive component selection and architecture decisions. Staleness here = wrong recommendations.

| File | What It Contains | Search Queries |
|------|-----------------|----------------|
| `triggers.md` | Topic trigger types, YAML kinds, event triggers | "Copilot Studio topic trigger types", "Copilot Studio triggers YAML" |
| `models.md` | Available LLM models, GA vs Preview status | "Copilot Studio available models", "Copilot Studio AI models" |
| `mcp-servers.md` | Built-in MCP server catalog | "Copilot Studio MCP servers", "Copilot Studio Model Context Protocol" |
| `connectors.md` | Key Power Platform connectors for agents | "Power Platform connectors Copilot Studio", "new connectors" |
| `knowledge-sources.md` | Knowledge source types + limits | "Copilot Studio knowledge sources types", "knowledge source limits" |
| `channels.md` | Deployment channels + capabilities | "Copilot Studio deployment channels", "Copilot Studio channels" |

### Tier 2: Build-Phase (refresh before `/mcs-build`)

These drive the actual build execution. Staleness here = build errors or suboptimal patterns.

| File | What It Contains | Search Queries |
|------|-----------------|----------------|
| `api-capabilities.md` | What each API layer can do (PAC CLI, Dataverse, Playwright) | "Copilot Studio API Dataverse", "PAC CLI copilot commands" |
| `instructions-authoring.md` | Instruction writing patterns, limits, Custom Prompt | "Copilot Studio instructions authoring", "Custom Prompt actions" |
| `generative-orchestration.md` | How gen orchestration routes topics | "Copilot Studio generative orchestration", "topic routing" |
| `adaptive-cards.md` | Adaptive card syntax, channel limits, PowerFx in cards | "Copilot Studio adaptive cards", "adaptive card channel support" |
| `ai-tools-computer-use.md` | AI tools, computer use, prompt actions | "Copilot Studio AI tools", "computer use agent" |
| `power-automate-integration.md` | Flow integration patterns, cloud vs desktop | "Copilot Studio Power Automate", "cloud flow integration" |

### Tier 3: Reference (refresh weekly or on-demand)

These are stable reference material that changes less frequently.

| File | What It Contains | Search Queries |
|------|-----------------|----------------|
| `eval-methods.md` | Test method types, scoring rules | "Copilot Studio evaluation test methods", "agent testing" |
| `security-auth.md` | Auth patterns, DLP, security settings | "Copilot Studio security authentication", "DLP policies" |
| `agent-lifecycle.md` | Create, publish, version, delete lifecycle | "Copilot Studio agent lifecycle", "publish versioning" |
| `limits-licensing.md` | Message limits, licensing, throttling | "Copilot Studio limits licensing", "rate limits quotas" |
| `powerfx-variables.md` | PowerFx in topics, variable types | "Copilot Studio PowerFx variables", "topic variables" |
| `conversation-design.md` | UX patterns, conversation flows | "Copilot Studio conversation design", "best practices" |

## Freshness Rules

| Age | Action |
|-----|--------|
| < 7 days | Skip (unless forced with `all`) |
| 7-30 days | Refresh |
| > 30 days | Refresh (high priority — flag to user) |

## Process (Per Cache File)

### Step 1: Read Current Cache

Read the cache file. Extract the `last_verified` date from the metadata header.

### Step 2: Check Freshness

Calculate days since `last_verified`:
- If < 7 days AND not forced → skip, report "Still fresh"
- Otherwise → proceed to research

### Step 3: Targeted Research

For each stale file, run **two research queries** (minimum):

1. **MS Learn MCP** — `microsoft_docs_search(query="{search query from table above}")` → official docs, most reliable source
2. **WebSearch** — `"{search query} {current year}"` → catches announcements, blog posts, preview features not yet in docs

If either query surfaces a high-value page (detailed reference, release notes, "what's new"):
3. **MS Learn fetch** — `microsoft_docs_fetch(url="{page URL}")` → get full content

**What to look for:**
- New items added (new models, new MCP servers, new triggers, etc.)
- Items deprecated or removed
- Status changes (Preview → GA, GA → Deprecated)
- Changed limits or behavior
- New patterns or best practices

### Step 4: Compare and Update

For each file:
1. Compare research findings against current cache content
2. **Add** new items discovered
3. **Update** items that changed (status, limits, behavior)
4. **Mark deprecated** items confirmed removed (don't delete — mark with ~~strikethrough~~ or "Deprecated" status)
5. Update metadata header: `last_verified: {today's date}`
6. Update `sources` list with what was checked
7. Adjust `confidence` if findings are ambiguous

### Step 5: Report

```
## Knowledge Cache Refresh Report

| File | Previous | Updated | Changes |
|------|----------|---------|---------|
| triggers.md | Feb 03 | Feb 12 | Added OnPlanComplete trigger |
| models.md | Feb 10 | — | Still fresh (skipped) |
| mcp-servers.md | Jan 15 | Feb 12 | 2 new MCP servers found |
| ... | ... | ... | ... |

**Refreshed:** N / 18 files
**Skipped (fresh):** M files
**Notable changes:**
- {change 1}
- {change 2}
```

## Session-Start Mode

When called during session startup (auto-refresh), use a **lightweight pass**:

1. Read all 18 files, check dates
2. Only refresh files > 7 days old
3. For Tier 1 files: always refresh if stale (these affect research quality)
4. For Tier 2-3 files: flag as stale but skip unless user is about to build
5. Report what was refreshed and what's flagged

This keeps session start under 3-5 minutes while ensuring build-critical knowledge is current.

## Important Rules

- **Always update `last_verified`** even if no changes found — it means "verified as still current"
- **Don't delete content** unless confirmed removed/deprecated — add new, mark old as deprecated
- **Note confidence level** — if only one source mentions something, set confidence to "medium"
- **Preserve the metadata header format** exactly — other tools parse it
- **Parallel where possible** — run MS Learn + WebSearch queries for multiple files in parallel to speed up refresh
- **If MCS UI snapshot would help** (e.g., checking current model list), mention it to user but don't require browser
