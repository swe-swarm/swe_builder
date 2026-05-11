<!-- CACHE METADATA
last_verified: 2026-02-19
sources: [MS Learn, PAC CLI docs, Dataverse MCP docs, direct testing]
confidence: high
refresh_trigger: on_error
-->
# API Capabilities by Layer — Quick Reference

## Layer Overview

| Layer | Tool | Best For | Cost |
|-------|------|----------|------|
| 1 | Dataverse MCP Server | Record CRUD, schema discovery | Copilot Credits |
| 2 | PAC CLI (MSI + MCP) | Solution ALM, publish, env management | Free |
| 3 | PowerShell Web API | Bound actions, complex queries, unattended | Free |
| 4 | Playwright | UI-only operations | Free |

## Layer 1: Dataverse MCP Server (v0.2.310025)

Tools: `read_query` (20-row limit), `create_record`, `update_record`, `delete_record`, `list_tables`, `describe_table`, `search`, `fetch`

**Limitations**: 20-row limit, no bound actions, interactive auth only, PPAC admin must enable.

## Layer 2: PAC CLI

**MSI** (Bash): `pac copilot list/create/publish/status/extract-template`, `pac solution export/import`
> **Note:** `pac copilot create` requires an undocumented template YAML (topics/instructions only, ~30% of config). Prefer MCS UI creation via Playwright for full-featured agents.
**MCP** (dnx, 52 tools): `copilot_publish`, `env_fetch` (FetchXML, no row limit), `solution_*`, `auth_*`

**Not in PAC CLI MCP**: copilot list/create/status/extract-template — use Bash.

## Layer 3: PowerShell Web API

`Get-Bots`, `Get-BotByName`, `Get-BotComponents`, `Update-BotInstructions`, `Update-BotSecurity`, `Add-BotKnowledgeFile`, `Publish-Bot`, `Get-DirectLineToken`, `Remove-Bot`

**Use when**: bound actions, >20 rows, unattended/CI/CD, file upload.

## Layer 4: Playwright (UI Only)

| Operation | Why Playwright |
|-----------|---------------|
| Model selection | Not in API |
| Add tools/connectors | Tool attachment requires MCS sync |
| Add MCP servers | MCP server attachment via UI only |
| Create OAuth connections | Interactive auth flow |
| Connect child agents | MCS orchestration setup |
| Gen AI settings | Internal MCS setting |
| "Allow other agents to connect" | Not in public API |
| Native eval upload/run | MCS eval service |

## CRITICAL: What Raw Dataverse POST CANNOT Do

**Creating new `botcomponent` records via `POST /botcomponents` is UNSUPPORTED for MCS agents.**

Raw POST creates the Dataverse record but skips MCS internal orchestration:
- No NLU trigger phrase registration (topics won't route)
- No `bot_botcomponent` M:M relationship (agent won't see components)
- No dependency tracking or topic compilation
- Agent appears BLANK in MCS UI despite data existing in Dataverse

| Operation | POST Works? | PATCH Works? | Correct Method |
|-----------|------------|-------------|----------------|
| New topic (type 9) | **NO** — record created but invisible to MCS | N/A | Playwright → Code Editor → paste YAML |
| New instructions (type 15) | **NO** — same problem | N/A | Playwright → Instructions panel |
| Update EXISTING instructions (type 15) | N/A | **YES** — component already registered | Dataverse PATCH + PvaPublish |
| Update EXISTING topic content (type 9) | N/A | **RISKY** — MS warns against direct edits | Playwright → Code Editor preferred |
| New knowledge source (type 16) | **NO** | N/A | Playwright → Knowledge tab |

### Other Bound Actions

| Action | Status | Use |
|--------|--------|-----|
| `PvaPublish` | Supported | Compile and publish registered components |
| `PvaDeleteBot` | Supported | Delete an agent |
| `PvaGetDirectLineEndpoint` | Supported | Get Direct Line token endpoint |
| `PvaCreateBotComponents` | **Internal use only** — do NOT call | MS-internal, undocumented behavior |

### Column Distinction: `data` vs `content`

The `botcomponent` table has both `data` and `content` columns. Instructions (type 15) use `content` for the JSON payload. Topics (type 9) use `content` for YAML. The `data` column exists but its usage varies by component type — always check via `describe_table` first.

---

## Upcoming API Capabilities

| Feature | Timeline | Impact |
|---------|----------|--------|
| Custom MCP servers | Public preview Mar 2026, GA Apr 2026 | Programmatic MCP server creation via MCP Management Server (already in preview) |

## Refresh Notes

When a Playwright-only operation starts failing, check if an API was added. APIs expand over time.
