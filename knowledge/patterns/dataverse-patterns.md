# Dataverse API Patterns for MCS Agent Management

Reusable patterns for managing Copilot Studio agents via the **3-layer Dataverse automation stack**:

| Layer | Tool | Best For | Cost |
|-------|------|----------|------|
| 1 | **Dataverse MCP Server** | Record CRUD, schema discovery — native MCP tools | Copilot Credits |
| 2 | **PAC CLI MCP Server** | Solution ALM, publish, env management — native MCP tools | Free |
| 3 | **PowerShell + Web API** | Bound actions, complex queries, fallback CRUD | Free |

**Decision flow:** Dataverse MCP → PAC CLI MCP → PowerShell Web API → Playwright (last resort)

---

## Prerequisites

- **PAC CLI authenticated**: `pac auth list` shows active profile
- **Azure CLI**: `az account get-access-token --resource https://<org>.crm.dynamics.com` (primary token method; Az.Accounts module is NOT installed — do not use `Get-AzAccessToken`)
- **Dataverse MCP Server**: `dotnet tool install --global Microsoft.PowerPlatform.Dataverse.MCP` (for Layer 1)
- **PAC CLI MCP Server**: Configured in `.claude/settings.json` via `dnx` (for Layer 2)

---

## Layer 1: Dataverse MCP Server (Native Tools)

When the Dataverse MCP Server is connected, Claude Code can call these directly:

| MCP Tool | Maps To | Use For |
|----------|---------|---------|
| `read_query` | SELECT SQL | Query bots, botcomponents, any table (20-row limit) |
| `create_record` | POST entity | Create knowledge sources, test cases |
| `update_record` | PATCH entity | Update instructions, security settings |
| `delete_record` | DELETE entity | Remove components |
| `list_tables` | Metadata | Discover available tables |
| `describe_table` | Schema | Inspect column definitions |
| `search` | Dataverse Search | Find records by keyword |
| `fetch` | GET by ID | Retrieve full record |

### Example Queries (via `read_query`)

```sql
-- List all agents
SELECT botid, name, schemaname, statecode, publishedon FROM bot ORDER BY name

-- Find agent by name
SELECT botid, name, schemaname FROM bot WHERE name = 'Builder PM RoB Manager'

-- Get instructions component
SELECT botcomponentid, name, content FROM botcomponent
WHERE _parentbotid_value = '<bot-guid>' AND componenttype = 15

-- Get knowledge sources
SELECT botcomponentid, name, content FROM botcomponent
WHERE _parentbotid_value = '<bot-guid>' AND componenttype = 16

-- Get all components for an agent
SELECT botcomponentid, name, componenttype FROM botcomponent
WHERE _parentbotid_value = '<bot-guid>'
```

### Example Updates (via `update_record`)

```
Table: botcomponent
ID: <component-guid>
Fields: { "content": "<updated YAML/JSON>" }
```

### Limitations
- **20-row limit** on `read_query` results
- **No bound actions** (PvaPublish, PvaDeleteBot, PvaGetDirectLineEndpoint)
- **Interactive auth only** (MSAL browser popup on first use)
- **Requires PPAC admin** to enable MCP for the environment

---

## Layer 2: PAC CLI MCP Server (Native Tools)

52 tools available. Most relevant for MCS automation:

| MCP Tool | Use For |
|----------|---------|
| `copilot_publish` | Publish an agent |
| `solution_list` | List solutions in environment |
| `solution_export` | Export solution zip |
| `solution_import` | Import solution zip |
| `solution_check` | Run Power Apps Checker |
| `env_list` | List all environments |
| `env_select` | Switch active environment |
| `env_fetch` | Run FetchXML query (read-only, no row limit) |
| `auth_list` | List auth profiles |
| `auth_select` | Switch active profile |
| `auth_who` | Show current profile info |
| `admin_list` | List all tenant environments |

### FetchXML via `env_fetch` (no row limit)

```xml
<fetch>
  <entity name="bot">
    <attribute name="botid" />
    <attribute name="name" />
    <attribute name="schemaname" />
    <attribute name="statecode" />
    <filter>
      <condition attribute="name" operator="eq" value="Builder PM RoB Manager" />
    </filter>
  </entity>
</fetch>
```

### Not Available via PAC CLI MCP
- `copilot list` / `copilot create` / `copilot status` / `copilot extract-template` — use Bash `pac copilot` directly
- Record CRUD — use Dataverse MCP or PowerShell

---

## Layer 3: PowerShell + Web API (Fallback / Bound Actions)

**Helper script:** `tools/dataverse-helper.ps1`

### Quick Start

```powershell
# Load helper
. .\tools\dataverse-helper.ps1

# Connect (interactive — uses az CLI for token, no module deps)
$ctx = Connect-Dataverse -OrgUrl "https://org.crm.dynamics.com"

# Connect (service principal — unattended/CI)
$ctx = Connect-Dataverse -OrgUrl "https://org.crm.dynamics.com" `
    -ClientId "<app-id>" -ClientSecret "<secret>" -TenantId "<tenant-id>"

# Connect using active PAC auth profile's environment
$ctx = Connect-DataverseFromPac
```

**Token priority:** Service Principal > Azure CLI (`az account get-access-token`) > Az.Accounts (fallback).
Az.Accounts is NOT required. Azure CLI is the recommended interactive method.

### Operations

```powershell
# List all agents
$bots = Get-Bots -Ctx $ctx

# Find agent by name
$bot = Get-BotByName -Ctx $ctx -Name "Builder PM RoB Manager"

# Get components by type
$instructions = Get-BotComponents -Ctx $ctx -BotId $botId -ComponentType 15
$knowledge = Get-BotComponents -Ctx $ctx -BotId $botId -ComponentType 16
$topics = Get-BotComponents -Ctx $ctx -BotId $botId -ComponentType 9

# Update instructions
Update-BotInstructions -Ctx $ctx -BotId $botId -Instructions "New instructions text"

# Update security
Update-BotSecurity -Ctx $ctx -BotId $botId -AccessControl 0 -AuthMode 2 -AuthTrigger 0

# Upload knowledge file
Add-BotKnowledgeFile -Ctx $ctx -BotId $botId -FilePath "C:\path\to\doc.pdf"

# Publish (bound action)
Publish-Bot -Ctx $ctx -BotId $botId

# Get Direct Line token (bound action)
$dl = Get-DirectLineToken -Ctx $ctx -BotId $botId

# Delete agent (bound action)
Remove-Bot -Ctx $ctx -BotId $botId
```

### When to Use PowerShell Over MCP

| Scenario | Why PowerShell |
|----------|---------------|
| Bound actions (PvaPublish, PvaDeleteBot, PvaGetDirectLineEndpoint) | Not available in either MCP server |
| Queries returning > 20 rows | Dataverse MCP has 20-row limit |
| Unattended / CI/CD | Service principal auth (MCP servers need interactive) |
| Complex multi-step operations | Script orchestration with error handling |
| File upload (knowledge) | Binary content handling |

---

## Key Entity Reference

### bot entity
| Field | Type | Purpose |
|-------|------|---------|
| `botid` | GUID | Primary key |
| `name` | string | Display name |
| `schemaname` | string | Unique schema name |
| `statecode` | int | 0=Active, 1=Inactive |
| `accesscontrolpolicy` | int | Access control mode |
| `authenticationmode` | int | Auth configuration |
| `publishedon` | datetime | Last publish time |
| `language` | int | LCID (1033=English) |

### botcomponent entity
| Field | Type | Purpose |
|-------|------|---------|
| `botcomponentid` | GUID | Primary key |
| `name` | string | Component name |
| `componenttype` | int | Type code (see below) |
| `data` | string | **Source YAML** (writable, what MCS UI reads/writes) |
| `content` | string | **Compiled JSON** (read-only after publish, runtime use) |
| `_parentbotid_value` | GUID | Parent agent |
| `schemaname` | string | Unique schema name |
| `description` | string | Component description |

**CRITICAL: Instructions have TWO fields. Use `data` (YAML), not `content` (JSON).**
- `data`: YAML format `kind: GptComponentMetadata\ndisplayName: ...\ninstructions: |-\n  ...` -- PATCH works, MCS UI reflects changes
- `content`: JSON `{"systemMessage":"..."}` -- compiled/read-only, synced by PvaPublish
- After PATCHing `data`, call `PvaPublish` to sync to `content` for runtime

### Component Type Codes
| Code | Type |
|------|------|
| 0 | Topic |
| 5 | Trigger |
| 9 | Topic (V2) |
| 14 | Bot File Attachment |
| 15 | Custom GPT (instructions) |
| 16 | Knowledge Source |
| 17 | External Trigger |
| 18 | Copilot Settings |
| 19 | Test Case |

---

## What CANNOT Be Done via API (Requires Playwright)

### UI-Only Operations (No API Exists)

| Operation | Why |
|-----------|-----|
| Model selection | Field not exposed in API |
| Add tools/connectors | Tool attachment requires MCS internal sync |
| Create OAuth connections | Interactive auth flow required |
| Connect child agents | Agent connection requires MCS orchestration setup |
| Generative AI settings | Internal MCS setting, not in Dataverse schema |
| "Allow other agents to connect" | Security toggle not in public API |
| Native eval upload/run | MCS evaluation service, no API |

### CRITICAL: Creating New Components via Raw POST Is Broken

**Raw `POST /botcomponents` creates Dataverse records but MCS never sees them.** The agent appears blank in the UI despite data existing in the table. This is because MCS requires internal orchestration (NLU registration, M:M relationships, compilation) that only happens through the MCS UI or MCS-internal APIs.

| What You Want | Wrong Way (Looks Like It Works) | Right Way |
|---------------|--------------------------------|-----------|
| New topic | `POST /botcomponents` with componenttype=9 | Playwright: Topics → Add → Code Editor → paste YAML → Save |
| New instructions | `POST /botcomponents` with componenttype=15 | Playwright: Overview → Instructions panel → paste text |
| New knowledge source | `POST /botcomponents` with componenttype=16 | Playwright: Knowledge tab → Add → configure source |
| Update EXISTING instructions | `PATCH content` field (400 error) | **`PATCH data` field (YAML) + `PvaPublish` -- WORKS** (E2E tested 2026-02-20) |
| Publish | — | `PvaPublish` bound action or `pac copilot publish` (MCP version) |

**Why this is dangerous:** The POST returns 201 Created with a valid GUID. FetchXML queries confirm the record exists. Everything looks successful. But the agent in MCS shows nothing — no topics, no instructions. The failure is completely silent.

### Safe Dataverse Operations (Verified Working)

| Operation | Method | Notes |
|-----------|--------|-------|
| Query agents | `read_query` / `env_fetch` (FetchXML) | Both work; env_fetch has no row limit |
| Query components | `read_query` / `env_fetch` | Filter by `_parentbotid_value` and `componenttype` |
| Update existing instructions | `PATCH /botcomponents(<id>)` | Component must already exist (created via UI) |
| Publish agent | `PvaPublish` bound action | Or MCP `copilot_publish` |
| Delete agent | `PvaDeleteBot` bound action | Or PowerShell `Remove-Bot` |
| Get Direct Line token | `PvaGetDirectLineEndpoint` | For eval testing |

### Common Pitfalls

1. **`_parentbotid_value` vs `parentbotid@odata.bind`**: For queries, use `_parentbotid_value`. For POST/PATCH with navigation properties, use `"parentbotid@odata.bind": "/bots(<guid>)"`. Direct update of `_parentbotid_value` returns: "CRM does not support direct update of Entity Reference properties."

2. **`schemaname` is required**: POST without `schemaname` returns: "Attribute 'schemaname' cannot be NULL." Generate a unique schema name (e.g., `cr_componentname_<random>`).

3. **OData `$filter` in Bash**: The `$` sign conflicts with Bash variable expansion. Use PowerShell for OData queries, or carefully escape: `\$filter` (but this can cause "Query option '\\' specified more than once" errors). Safest: use FetchXML via `env_fetch` instead of OData `$filter`.
