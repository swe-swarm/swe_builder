# Build Method Learnings

Lessons learned about build execution — PAC CLI vs Playwright, Dataverse API patterns, Code Editor YAML, publish methods. Consulted during `/mcs-build`.

<!--
Entry format:
### [Title] {#id} — [Date]
**Context:** [Customer/project, what was being built]
**Tried:** [Initial approach]
**Result:** [What happened]
**Better approach:** [What worked or was recommended]
**Confirmed:** [N] build(s) | Last confirmed: [YYYY-MM-DD]
**Related cache:** [cache file(s) if applicable]
**Tags:** #tag1 #tag2
-->

### PAC CLI create requires undocumented template YAML {#bm-001} — 2026-02-18
**Context:** Evaluating agent creation methods for the hybrid build stack
**Tried:** `pac copilot create --templateFileName template.yaml` — requires a YAML template extracted from an existing agent via `pac copilot extract-template`
**Result:** Template format is not published by Microsoft, no official samples exist, and templates only capture ~30% of agent config (topics/instructions — not tools, knowledge, or model). Since Playwright is already required for tools + model selection, the template dependency adds friction with no benefit.
**Better approach:** Create agents via Playwright (MCS UI → Create → New agent → Skip to configure → set name/description → Create). PAC CLI `create` is a fallback for environments where browser is unavailable.
**Confirmed:** 1 build(s) | Last confirmed: 2026-02-18
**Related cache:** agent-lifecycle.md, api-capabilities.md
**Tags:** #pac-cli #playwright #agent-creation #template

### Dataverse POST for new botcomponents skips MCS orchestration {#bm-002} — 2026-02-20
**Context:** CDW Legal & HR Policy Advisor build — attempted to create topics and instructions via raw `POST /botcomponents`
**Tried:** PowerShell Web API `POST` to create botcomponent records (componenttype 9 for topics, 15 for instructions) with YAML/JSON content
**Result:** Records created in Dataverse (confirmed via FetchXML), but agent appears BLANK in MCS UI. MCS doesn't recognize the components because raw POST skips:
- NLU trigger phrase registration
- `bot_botcomponent` M:M relationship setup
- Dependency tracking and topic compilation
**Better approach:** For NEW topics: use Playwright Code Editor paste. For EXISTING instructions: PATCH the `data` field (see bm-005). For publish: PvaPublish bound action (see bm-004).
**Confirmed:** 1 build(s) | Last confirmed: 2026-02-20
**Related cache:** api-capabilities.md, dataverse-patterns.md
**Tags:** #dataverse #botcomponent #topic-creation #instructions #playwright #code-editor

### PAC CLI extract-template crashes on complex agents {#bm-003} — 2026-02-20
**Context:** CDW build — attempted `pac copilot extract-template --bot <CDW-Legal-bot>` to get a working template
**Tried:** `pac copilot extract-template` on the CDW Legal & HR Policy Advisor agent
**Result:** `System.ArgumentException` crash. Reproduced on multiple agents with custom topics or complex configurations.
**Better approach:** Use the simplest available agent in the environment as the template source. Or skip templates entirely — create agents via Playwright UI (preferred) and configure from there.
**Confirmed:** 1 build(s) | Last confirmed: 2026-02-20
**Related cache:** agent-lifecycle.md
**Tags:** #pac-cli #extract-template #crash #agent-creation

### PAC CLI publish (MSI) crashes — PvaPublish bound action is the reliable method {#bm-004} — 2026-02-20
**Context:** CDW + BY builds — attempted multiple publish methods
**Tried:** (1) `pac copilot publish` via MSI CLI v2.1.2, (2) MCP `copilot_publish` via dnx v2.2.1, (3) PvaPublish bound action via Web API, (4) Playwright Publish button
**Result:** MSI crashes with `System.ArgumentException`. MCP returns `Invalid response format`. PvaPublish bound action WORKS. Playwright works but is fragile.
**Better approach:** Use `PvaPublish` bound action via Dataverse Web API (`POST /bots(<id>)/Microsoft.Dynamics.CRM.PvaPublish`). Token via `az account get-access-token`. This is now the primary publish method — no PAC CLI dependency, no browser needed.
**Confirmed:** 2 build(s) | Last confirmed: 2026-02-20
**Related cache:** api-capabilities.md, dataverse-patterns.md
**Tags:** #publish #pva-publish #bound-action #dataverse #pac-cli #workaround

### Instructions use 'data' field (YAML), NOT 'content' field (JSON) {#bm-005} — 2026-02-20
**Context:** BY Digital Resource Matching Agent build — investigated why API-written instructions didn't appear in MCS UI
**Tried:** PATCH `botcomponent.content` field with `{"systemMessage":"..."}` (JSON format, componenttype 15)
**Result:** PATCH to `content` returned 400 Bad Request on published agents. Even when it succeeded on new agents, the MCS UI Instructions card showed empty. Investigation revealed TWO fields:
- `content` (JSON): Compiled runtime field. Read-only via API after first publish.
- `data` (YAML): Source of truth. Format: `kind: GptComponentMetadata\ndisplayName: ...\ninstructions: |-\n  ...`
The MCS UI reads/writes the `data` field. PvaPublish syncs `data` -> `content` for runtime.
**Better approach:** PATCH the `data` field with YAML format. Use `If-Match: *` header. Then call PvaPublish to sync to runtime. Full E2E tested: write -> publish -> verify (12/13 tests pass).
**Confirmed:** 1 build(s) | Last confirmed: 2026-02-20
**Related cache:** api-capabilities.md, dataverse-patterns.md
**Tags:** #instructions #dataverse #data-field #content-field #yaml #custom-gpt #botcomponent

### Az.Accounts not needed — az CLI provides reliable Dataverse tokens {#bm-006} — 2026-02-20
**Context:** BY build — `Connect-DataverseFromPac` crashed because Az.Accounts module not installed
**Tried:** `Get-AzAccessToken -ResourceUrl <org-url>` (requires Az.Accounts module)
**Result:** Module not installed, no reliable way to install it in the build environment without admin rights.
**Better approach:** `az account get-access-token --resource <org-url>` works everywhere Azure CLI is installed. Returns JSON with `.accessToken`. No module dependency. Now the primary token method in `dataverse-helper.ps1`.
**Confirmed:** 1 build(s) | Last confirmed: 2026-02-20
**Related cache:** dataverse-patterns.md
**Tags:** #token #az-cli #az-accounts #authentication #dataverse
