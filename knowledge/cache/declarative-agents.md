<!-- CACHE METADATA
last_verified: 2026-03-23
sources: [MS Learn (overview-declarative-agent, declarative-agent-architecture, declarative-agent-manifest-1.6, declarative-agent-tool-comparison, agents-overview, declarative-agent-connected-agent, copilot-studio-experience, agent-builder, declarative-agent-ui-widgets, build-mcp-plugins, plugin-manifest-2.4, copilot-release-notes), Microsoft 365 Blog (2025-05-19, 2026-03-09), M365 Dev Blog (build-declarative-agents-with-mcp), M365 Copilot Release Notes (Jan 2026, Feb 2026), Tech Community (whats-new-feb-2026), voitanos.io (atk-v6.6.0-review), WorkIQ internal context (CAPE Day 2026-03-11)]
confidence: high
refresh_trigger: before_research
-->
# Declarative Agents (DA) — Cheat Sheet

> **Purpose:** When `/mcs-research` determines a use case fits a Declarative Agent, output a recommendation with this guide instead of building in Copilot Studio. Our automated build pipeline stays focused on Custom Agents (CA).

## What Is a Declarative Agent?

A DA is a customized version of Microsoft 365 Copilot configured through a JSON manifest — no custom code, no hosting. It runs on Copilot's own orchestrator, foundation models, and security/compliance infrastructure.

**Three configuration levers:**
1. **Instructions** — Natural language directions shaping behavior (up to 8,000 chars)
2. **Knowledge** — Scoped data sources (SharePoint, OneDrive, Copilot connectors, Dataverse, Teams messages, email, people, meetings)
3. **Actions** — API plugins, MCP servers, or Power Platform connectors for external system interaction

## DA vs CA — When to Recommend DA

### Recommend DA when ALL of these are true:
- Use case is primarily **information retrieval, Q&A, or API calls** (simple or MCP-powered)
- Users are **M365 Copilot licensed** within the org
- Only needs to run in **M365 apps** (Copilot Chat, Teams, Word, Excel, PowerPoint, Outlook)
- **No complex multi-step workflows** or conditional branching needed
- **No proactive/scheduled triggers** needed (user-initiated only)
- ~~No custom topics, adaptive cards, or branded UX needed~~ **UPDATED:** DAs now support Adaptive Cards (via API plugins) and interactive UI widgets (via MCP + OpenAI Apps SDK). Still no custom topic authoring.
- Response times **under 45 seconds** are acceptable

### Hard disqualifiers — if ANY are true, recommend CA instead:

| # | Disqualifier | Why DA Can't Do This |
|---|-------------|---------------------|
| 1 | External channels (web chat, Slack, WhatsApp, Direct Line, mobile app) | DA only runs in M365 apps |
| 2 | Custom YAML topics with branching logic | DA has no topic authoring — sequential processing only |
| 3 | ~~Adaptive card responses~~ **UPDATED:** DA now supports Adaptive Cards via API plugin response semantics and interactive UI widgets via MCP + OpenAI Apps SDK | Adaptive Cards supported for API plugin actions. Interactive UI widgets (inline + fullscreen) supported via MCP server actions. Native text responses still default. |
| 4 | ~~MCP tools (preview)~~ **UPDATED:** MCP support is GA in ATK v6.6.0 (March 2026) | MCP integration is now generally available. Use for production builds. |
| 5 | Multi-agent orchestration (child/connected CA agents) | DA-to-DA text delegation only (via `worker_agents` in schema v1.6), no CA orchestration |
| 6 | Autonomous / scheduled / event-driven triggers | DA is user-initiated only |
| 7 | Custom model selection | DA uses M365 Copilot's model (currently GPT-5.1 with auto architecture), developer has no control |
| 8 | External or non-licensed users | DA requires M365 Copilot license per user |

**Also recommend CA when:** Power Automate flow integration needed, precise topic routing control needed, multi-step conditional workflows needed, custom response formatting needed.

## DA Technical Limits

| Limit | Value | Impact |
|-------|-------|--------|
| Grounding records | 50 items | Affects contextual data available per query |
| Plugin response | 25 items | Constrains external API response sizes |
| Token limit | 4,096 | Includes all context + response data |
| Timeout | 45 seconds | Includes network latency + processing |
| Instructions | 8,000 chars | Same as CA |
| Description | 1,000 chars | Agent description in manifest |
| Name | 100 chars | Agent name in manifest |
| Conversation starters | Max 6 | Hints shown to user at start |
| Actions (plugins) | 1-10 | API plugins per agent |
| Web search sites | Max 4 | Sites scoped for web grounding (max 2 path segments, no query params) |
| Teams message URLs | Max 5 | Teams channels/chats scoped for search |
| Meeting items | Max 5 | Specific meetings scoped via items_by_id |
| Group mailboxes | Max 25 | M365 Groups/shared mailboxes for Email capability |
| Embedded knowledge files | Max 10, 1MB each | Local files in app package (not yet enabled) |
| Worker agents | Unlimited (schema) | Connected DAs for delegation (Preview) |
| Processing model | Sequential (with GPT-5.1 "auto") | Auto-selects fast vs reasoning model per prompt. "Think deeper" mode has higher latency. No iterative reasoning loops or chained multi-step operations ([source](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/declarative-agent-architecture#declarative-agent-data-flow)) |

**Rule of thumb:** Optimize for ~66% of technical limits to account for overhead.

## DA Manifest Capabilities

Schema v1.6 is the latest documented version (supersedes v1.5). Major additions: `worker_agents`, `user_overrides`, `EmbeddedKnowledge`, `sensitivity_label`, enhanced `Meetings` (items_by_id), enhanced `People` (include_related_content), enhanced `Email` (group_mailboxes, folders).

| Capability | What It Enables | New in v1.6? |
|------------|----------------|-------------|
| `WebSearch` | Web grounding, optionally scoped to 4 sites | No |
| `OneDriveAndSharePoint` | Document grounding from SharePoint sites/libraries. Now supports scanned PDFs and image-based documents (March 2026). | Enhanced |
| `GraphConnectors` | Copilot connectors (formerly Graph connectors) for external data. Enhanced filtering: `items_by_external_id`, `items_by_path`, `items_by_container_name`, `items_by_container_url`, `additional_search_terms` (KQL) | Enhanced |
| `GraphicArt` | Image generation | No |
| `CodeInterpreter` | Python code generation and execution | No |
| `Dataverse` | CRM/business data from Dataverse tables (with `host_name`, `skill`, `tables` scoping) | No |
| `TeamsMessages` | Teams chat/channel/meeting/1:1/group chat search (max 5 URLs) | No |
| `Email` | Mailbox search. New: `group_mailboxes` (up to 25 group/shared mailboxes), `folders` (scope by folder) | Enhanced |
| `People` | Organizational people search. New: `include_related_content` (includes related docs, emails, Teams messages between user and referenced people) | Enhanced |
| `Meetings` | Meeting transcript search. New: `items_by_id` (scope to specific meetings, max 5, with `is_series` flag) | Enhanced |
| `ScenarioModels` | Task-specific models | No |
| `EmbeddedKnowledge` | Local files bundled in the app package (max 10 files, max 1MB each). Supported: .doc/.docx, .ppt/.pptx, .xls/.xlsx, .txt, .pdf. **Note: Not yet enabled as of March 2026** | **New** |

### Additional v1.6 Manifest Properties

| Property | What It Enables |
|----------|----------------|
| `worker_agents` | DA-to-DA connected agents (Preview). Array of declarative agents this agent can delegate to, identified by title ID. |
| `user_overrides` | Let users toggle capabilities on/off at runtime. Uses JSONPath to identify capabilities. Only `remove` action supported. |
| `sensitivity_label` | Microsoft Purview sensitivity label for embedded files (not yet enabled). |
| `behavior_overrides.suggestions.disabled` | Disable follow-up suggestions |
| `behavior_overrides.special_instructions.discourage_model_knowledge` | Prevent model from using its own knowledge (grounding-only mode) |
| `disclaimer` | Custom disclaimer text at conversation start (max 500 chars) |

## DA Connected Agents (Schema v1.6 — Preview)

DAs can delegate to other DAs via `worker_agents` in the manifest. Researcher agent now supports connected agents: admins can add DAs to Researcher's sources, and Researcher will call them for domain-specific expertise (Jan 2026 release). Users can also connect DAs to their own custom DAs.

**Constraints:**
- DA-to-DA only (cannot connect to CA or custom engine agents)
- Text-only communication (no files, images, or adaptive cards)
- Each connected agent must be installed by the user
- Adaptive cards from connected agents are processed as data but not displayed
- `worker_agents` entries use the title ID of the target app (found via Agents Toolkit publish or developer mode card metadata)

## Build Tools for DA

| Tool | Audience | How | Notes |
|------|----------|-----|-------|
| **Agent Builder** (in M365 Copilot) | Business users, no-code | copilot.microsoft.com → Create agent | Now powered by GPT-5.1 (Feb 2026). Can generate Office docs (Jan 2026 via Copilot Studio lite). |
| **Copilot Studio** (DA mode) | Makers, low-code | Agents → M365 Copilot → Add | Extends Agent Builder DAs with knowledge types, tools, evals (2026 Wave 1 focus) |
| **M365 Agents Toolkit (ATK)** (VS Code) | Developers, pro-code | VS Code extension v6.6.0+, generates manifest JSON | MCP GA, embedded knowledge, GCC-M support (March 2026). 61 legacy templates removed. |
| **TypeSpec** (`@microsoft/typespec-m365-copilot`) | Developers | Type-safe manifest authoring with compile-time validation | Schema v1.6 support |
| **SharePoint** | Site owners, no-code | Create agent scoped to a SharePoint site | Now supports scanned PDFs and image-based docs (March 2026) |

**Conversion paths:**
- DA → Copilot Studio: "Copy to Copilot Studio" button (preserves instructions + knowledge)
- DA → Custom Engine Agent: Via M365 Agents Toolkit conversion
- Copilot Studio CA → M365 Copilot: Publish to M365 Copilot channel (appears as agent but runs on CS orchestrator)

## DA Architecture — Two Separate Orchestrators

```
M365 Copilot Orchestrator          Copilot Studio Orchestrator
(hosts Declarative Agents)         (hosts Custom Agents)
├── GPT-5.1 auto architecture     ├── Multi-model selection (GPT-4o/5/o1/o3)
├── Sequential + auto reasoning   ├── Multi-step planning
├── Single grounding + tool call   ├── Iterative reasoning loops
├── No proactive messaging         ├── Triggers + autonomous
├── DA-to-DA connected agents      ├── Multi-framework connected agents
├── MCP server actions (GA)        ├── MCP server actions (GA)
├── Adaptive Cards (via plugins)   ├── Adaptive Cards (native)
├── Interactive UI widgets         ├── Adaptive Cards + custom UX
└── Microsoft-managed              └── Power Platform-managed
```

These are **separate planes** — no unified orchestration layer today. Bridge patterns:
- **DA calling CA:** DA uses an API plugin that calls a CA's REST endpoint. **Note:** Requires explicit auth design (OAuth/API key), least-privilege access, and validation of data crossing between M365 Copilot and Copilot Studio environments.
- **CA in M365 Copilot:** CA published to M365 Copilot channel appears alongside DAs in Agent Store (runs on CS orchestrator, not M365 Copilot orchestrator). Now also available in Outlook (Feb/March 2026).
- **Azure AI Foundry → M365 Copilot:** One-click publish from Foundry to Agent Store (Jan 2026). No code required.
- **Microsoft Foundry → M365 Copilot:** Bring Foundry agents into M365 Copilot and Teams via proxy app built with Agents Toolkit (Jan 2026).
- **Neither can directly call the other** as a sub-agent

## License Requirements

| Feature | License |
|---------|---------|
| Use existing DAs | M365 Copilot ($30/user/month) |
| Build DAs via Agent Builder | M365 Copilot |
| Build DAs via Copilot Studio | M365 Copilot + Copilot Studio license |
| Build DAs via Agents Toolkit | M365 Copilot (developer builds, no extra license) |
| Prebuilt chat agents (coaches) | M365 Copilot Chat (free) or M365 Copilot |

## Key Repos & Resources

| Resource | URL | Purpose |
|----------|-----|---------|
| DA Architecture docs | [MS Learn](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/declarative-agent-architecture) | Limits, data flow, use case alignment |
| DA Overview | [MS Learn](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/overview-declarative-agent) | What DAs are, scenarios, benefits |
| DA Tool Comparison | [MS Learn](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/declarative-agent-tool-comparison) | Agent Builder vs Toolkit vs Copilot Studio |
| Agent Builder vs Copilot Studio | [MS Learn](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/copilot-studio-experience) | When to use which |
| DA Manifest Schema v1.6 | [MS Learn](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/declarative-agent-manifest-1.6) | JSON manifest reference (latest) |
| DA Manifest Schema v1.5 | [MS Learn](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/declarative-agent-manifest-1.5) | JSON manifest reference (previous) |
| Connected Agents | [MS Learn](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/declarative-agent-connected-agent) | DA-to-DA delegation |
| UI Widgets for DAs | [MS Learn](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/declarative-agent-ui-widgets) | Interactive UI via MCP + OpenAI Apps SDK |
| Build MCP Plugins | [MS Learn](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/build-mcp-plugins) | MCP server integration for DAs |
| Adaptive Cards in API Plugins | [MS Learn (Training)](https://learn.microsoft.com/en-us/training/modules/copilot-declarative-agent-action-api-plugin-adaptive-cards-vsc/) | Rich responses via Adaptive Cards |
| Adaptive Card Dialog Box (Preview) | [MS Learn](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/adaptive-card-dialog-box) | Dialog boxes in DA Adaptive Cards |
| Plugin Manifest Schema 2.4 | [MS Learn](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/plugin-manifest-2.4) | API plugin with response semantics |
| Agents Overview (DA vs CEA) | [MS Learn](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/agents-overview) | Decision guide |
| Agent Host Platform Choice | [MS Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/architecture/host-platform) | DA vs CA hosting architecture |
| Build DA with MCP (Dev Blog) | [M365 Dev Blog](https://devblogs.microsoft.com/microsoft365dev/build-declarative-agents-for-microsoft-365-copilot-with-mcp/) | MCP integration walkthrough |
| MCP Interactive UI Samples | [GitHub](https://github.com/microsoft/mcp-interactiveUI-samples) | Sample MCP server plugins with UI widgets |
| pnp/copilot-pro-dev-samples | [GitHub](https://github.com/pnp/copilot-pro-dev-samples) | Community DA samples |
| M365 Agents Toolkit | [GitHub](https://github.com/OfficeDev/microsoft-365-agents-toolkit) | VS Code extension for DA manifests (v6.6.0+) |
| microsoft/AgentSchema | [GitHub](https://github.com/microsoft/AgentSchema) | Unified YAML spec (MCS + Foundry) |
| Copilot Camp | [GitHub](https://microsoft.github.io/copilot-camp/) | Hands-on labs for DA + CEA |
| Agent Academy | [GitHub](https://microsoft.github.io/agent-academy/) | Hands-on missions including DA deployment |

## Convergence Signals (Internal)

From CAPE Day (2026-03-11), WorkIQ research, and March 2026 announcements:
- DAs are gaining capabilities from CAs (topics, evals, testing) — convergence, not deprecation
- Microsoft's intended model: **DA for simple → CA for complex** (progressive enhancement)
- Actions for DAs via Copilot Studio is an active investment area (ADO #4765717)
- DA model progression: GPT-5 (Jan 2026) → GPT-5.1 with "auto" architecture (Feb 2026) — auto-selects fast vs reasoning model per prompt. **Previous note about GPT-5.2 by late March was internal estimate; actual shipped version is GPT-5.1 auto.**
- Agent 365 (GA May 1, 2026, $15/user/month) will provide unified governance across both DA and CA. Includes Entra Agent ID (agent identities, discovery, authorization).
- M365 E7: The Frontier Suite (GA May 1, 2026, $99/user/month) bundles E5 + Copilot + Agent 365
- Azure AI Foundry agents can now publish to M365 Copilot Agent Store with one-click (Jan 2026)
- DA now supports Adaptive Cards (via API plugin response semantics) and interactive UI widgets (via MCP + OpenAI Apps SDK) — this removes the #3 hard disqualifier for many use cases
- MCP support in DAs is GA (ATK v6.6.0, March 2026) — this removes the #4 hard disqualifier
- DAs now available in Outlook (agents built with Copilot Studio and Foundry accessible in Outlook, Feb/March 2026)
- Scanned PDFs / image-based documents from SharePoint now supported as DA knowledge (March 2026 rollout)

---

## Customer Recommendation Template

When research determines DA is the right path, include this in the build report:

```markdown
## Recommendation: Declarative Agent

Based on the capability analysis, this use case is best served by a **Declarative Agent**
rather than a custom Copilot Studio build.

### Why Declarative Agent
- [Specific reasons from scoring: e.g., "All capabilities are information retrieval
  from SharePoint, no complex workflows needed"]
- [License confirmation: "Customer has M365 Copilot licenses"]
- [Channel fit: "Users work exclusively in Teams and M365 Copilot"]

### Why NOT Custom Agent
- [Explicit rejection reasons: e.g., "No multi-step workflows, no external channels,
  no adaptive cards needed — CA would be over-engineered"]

### Recommended Build Tool
- [Agent Builder / Copilot Studio DA mode / Agents Toolkit — based on customer's
  technical capability]

### Getting Started
1. Go to [copilot.microsoft.com](https://copilot.microsoft.com) → Create agent (Agent Builder)
   OR open Copilot Studio → Agents → Microsoft 365 Copilot → Add
2. Set agent name: [from brief.json agent.name]
3. Add instructions: [from brief.json instructions or generated instructions]
4. Add knowledge sources: [from brief.json knowledge[]]
5. Add actions if needed: [from brief.json integrations[] where type = connector/api-plugin]
6. Test in M365 Copilot Chat
7. Publish to organizational catalog

### First-Party Agents to Leverage
[From frontierAgentMatch[] — list any first-party agents that cover capabilities]

### Prerequisites to Confirm
- [ ] Customer has M365 Copilot licenses ($30/user/month)
- [ ] [If Office agents recommended] Anthropic subprocessor enabled by admin
- [ ] [If Frontier agents recommended] Frontier program enrollment active
- [ ] Required SharePoint sites / data sources accessible

> If any prerequisite is unconfirmed, note: "DA recommendation is conditional on
> [prerequisite]. Verify before proceeding."

### What We Provide
- Agent instructions (generated from brief)
- Knowledge source configuration guide
- Eval test questions (for manual verification in M365 Copilot)
- Boundary/scope documentation
```
