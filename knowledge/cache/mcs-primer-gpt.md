<!-- CACHE METADATA
last_verified: 2026-03-23
sources: [CLAUDE.md, knowledge/cache/*.md (synthesized), MS Learn whats-new, 2025 Wave 2 change history, 2026 Wave 1 Release Plan, MS Learn architecture/whats-new, MS Learn M365 extensibility known-issues, WebSearch Mar 2026]
confidence: high
refresh_trigger: manual
-->
# Microsoft Copilot Studio (MCS) — Domain Primer

## What Is MCS?

Microsoft Copilot Studio is a low-code platform for building AI agents (chatbots) that integrate with Microsoft 365, Power Platform, and external systems. Agents are deployed to channels (Teams, Web, Slack, etc.) and can be published to production environments.

## Core Concepts

**Generative Orchestration**: An LLM-driven planner interprets user intent, selects tools/topics/knowledge sources, executes multi-step plans, and synthesizes responses. This is the default and required mode for all modern agents.

**Topics**: Conversation flows authored in YAML. Each has a trigger (phrases, events, or "by agent" for generative routing) and nodes (messages, questions, conditions, actions). Topics are the building blocks of agent behavior.

**Triggers**: How topics activate. Types: phrases (NLU match), "by agent" (generative orchestration routes to it), on conversation start, on error, before/after generative response. Phrase triggers use NLU matching, not exact match.

**Tools**: External capabilities the agent can call — MCP servers (Microsoft 365, SharePoint, etc.), Power Automate flows, connectors, HTTP actions. Referenced in instructions as `/ToolName`.

**Knowledge Sources**: Documents, URLs, SharePoint sites, or Dataverse tables the agent searches for grounded answers. Configured separately from instructions.

**Instructions**: Natural language guidance (max 8,000 chars) that tells the agent HOW to behave — persona, boundaries, tool usage patterns, response formatting. Instructions influence response generation and disambiguation more than routing. Tool/topic DESCRIPTIONS matter most for routing.

## Key Constraints

- Agent instructions: 8,000 character limit
- Routing priority: Description > Name > Parameters > Instructions
- 3 eval sets: boundaries (100% pass), quality (85%), edge-cases (80%)
- `/Tool` and `/Topic` syntax references tools/topics in instructions
- Generative orchestration is REQUIRED for MCP tools, knowledge grounding, and AI routing
- Topics can't call MCP servers directly — only generative orchestration can
- Adaptive cards in Teams: max 28KB, version 1.5, no Action.Execute

## brief.json Structure

The `brief.json` file is the single source of truth for an agent build:
- `agentName`, `purpose`, `persona` — identity
- `capabilities[]` — what the agent does (customer-facing features)
- `integrations[]` — tools and connectors configured
- `knowledge[]` — knowledge sources for grounding
- `conversations.topics[]` — topic definitions with triggers and nodes
- `boundaries` — what the agent should NOT do (handle/decline/refuse)
- `instructions` — the agent's system prompt text
- `evalSets[]` — test suites (safety, functional, resilience) with per-test results
- `decisions[]` — structured choice points with ranked options
- `architecture` — single-agent or multi-agent design
- `model` — which LLM powers the agent (GPT-4.1 default, GPT-5 Preview, Claude Sonnet/Opus, etc.)

## Instruction Writing Rules (7 Universal)

1. **Role in first line** — functional, no superlatives. "You are PolicyBot, a benefits assistant for HR employees."
2. **WHY on every constraint** — reason in parentheses. "Do not provide medical advice (employees must consult HR Benefits for liability reasons)."
3. **Tiered length (floor + ceiling)** — per question type. "Simple lookups: 2-4 sentences. Explanations: 3-5 bullets."
4. **Bold emphasis only** — no aggressive caps ("CRITICAL:", "YOU MUST"). Use **bold** or "Never X".
5. **No personality padding** — "world-class expert" wastes chars. Functional role only.
6. **2-3 varied examples** — happy path + boundary + complex.
7. **Flat lists only** — no nesting. All models lose accuracy with nested structures.

**Structure:** Three-part — Constraints + Response Format + Guidance (with examples). Max 8,000 chars.
**Anti-patterns:** No hardcoded URLs, no tool/knowledge listing, no naming specific files, no "be concise" without floors.
**Routing priority:** Description > Name > Parameters > Instructions. Instructions are LEAST important for routing.

## Topic YAML Structure

- **Root:** `kind: AdaptiveDialog` → `beginDialog` → trigger `kind` + `actions[]`
- **Every node** needs a unique `id`. Variables: `Topic.varName`, new: `init:Topic.varName`
- **Bindings:** Input = `=expression` (with `=`). Output = destination name (no `=`).
- **"By agent" trigger:** `OnRecognizedIntent` with `displayName` + `description` (no `triggerQueries`). Description is the #1 routing signal.
- **Entities:** Every `Question` needs an `entity` (e.g., `StringPrebuiltEntity`, `EmailPrebuiltEntity`).
- **Cards:** Adaptive card version `1.5`, no `Action.Execute`, max 28KB for Teams. Use `SendMessage` + `AdaptiveCardTemplate`.
- **Key node types:** SendActivity, Question, ConditionGroup, SetVariable, BeginDialog, HttpRequest, SearchAndSummarizeContent, EndDialog.

## Eval Generation Rules (3-Set Model)

| Set | Threshold | Default Methods | Target Count |
|-----|-----------|----------------|-------------|
| boundaries | 100% | Keyword match (all) | 8-12 |
| quality | 85% | Compare meaning (70) + Keyword match (any) | 15-25 |
| edge-cases | 80% | General quality + Compare meaning (60) | 10-18 |

**Rules:** Two methods per test (one specific + one general). Include negative tests. Tag with `scenarioId`, `scenarioCategory`, `coverageTag`. Coverage: core-business 30-40%, variations 20-30%, architecture 20-30%, edge-cases 10-20%. Total: 40-55 tests.

## Eval Methods (8 Total)

| Method | Type | Status | What It Does |
|--------|------|--------|-------------|
| General quality | Scored 0-100% | GA | Relevance + Groundedness + Completeness + Abstention |
| Compare meaning | Scored 0-100 | GA | Semantic similarity (same meaning, different words OK) |
| Keyword match | All/Any mode | GA | Checks for specific words/phrases |
| Text similarity | Scored 0-100 | GA | Token-level text closeness (cosine similarity) |
| Exact match | Binary | GA | Must match exactly |
| Tool use | Binary | GA | Checks if specific tools/topics were used |
| Custom | Label-based | Preview | Maker-defined criteria with custom labels |
| Plan validation | Scored 0-100 | N/A (our custom) | Verifies tool invocations via Direct Line activity stream |

## Model Availability (Mar 2026)

| Model | Status | Notes |
|-------|--------|-------|
| GPT-4.1 | **GA (Default)** | Default for new agents since Oct 2025, replaced GPT-4o |
| GPT-4.1 mini | Preview | Experimental response model for generative answers |
| GPT-5 Chat | **GA** | GA for EU and US regions since Nov 2025 |
| GPT-5 Reasoning | Preview | Advanced reasoning with chain-of-thought |
| Claude Sonnet 4 / 4.5 | GA | Multi-model option, available in most geos since Jan 2026 |
| Claude Opus 4.1 / 4.5 / 4.6 | GA | For orchestration and prompt builder |
| GPT-4o | **Retired** | Retired Oct 2025 for generative orchestration (except GCC) |
| GPT-4o mini | GA (legacy) | Still available for lightweight use cases |

**Model selection**: Dropdown in agent settings for orchestration model. Prompt builder has separate model selection (Claude + OpenAI). Admin can disable Anthropic models at tenant level.

## Key Platform Updates (Q1 2026)

- **Work IQ MCP tools** (Preview Mar 2026): 6 tools (Mail, Calendar, Teams, Copilot, User, Word) connecting agents to M365 work context
- **Custom MCP servers** (Preview Mar 2026, GA Apr 2026): Connect any agent to external data
- **MCP in agent workflows** (Preview Apr 2026, GA Oct 2026): Use MCP tools in agent flows
- **Computer Use agents** (Preview, GA May 2026): Automate web and desktop apps with vision+reasoning. Claude Sonnet 4.5 (beta) added for computer use (Feb 2026)
- **Code interpreter** (GA Aug 2025): Python code generation from natural language, supports Excel/CSV/PDF analysis
- **Code interpreter on SharePoint** (Preview Mar 2026, GA May 2026): Analyze SP-sourced data directly in conversations
- **SharePoint Lists as knowledge** (Preview Apr 2026, GA May 2026): Real-time connection to list data
- **File groups** (GA Aug 2025): Organize uploaded files as single knowledge source with variable-based instructions. GA May 2026 for file groups with instructions.
- **VS Code extension** (GA Jan 2026): Build, edit, manage agents in VS Code
- **General Quality Grader in Test Pane** (GA Mar 2026): Auto-evaluate during testing
- **Advanced Approvals** (GA Mar 2026): Multi-stage + AI-powered approval stages in agent flows
- **Reassign agent owner via API** (GA Mar 2026): Power Platform API for agent ownership transfer
- **Batch testing for prompts** (Preview): Systematic prompt validation with test datasets
- **Prompt builder enhancements** (Feb 2026): Content moderation sensitivity per prompt, Claude Opus 4.6/Sonnet 4.5 model support, inline editing of prompt instructions
- **Evaluate test sets with multiple graders** (Preview Feb 2026): Run multiple evaluation methods per test set
- **Triggers with end-user credentials** (Preview Mar 2026, GA May 2026): Autonomous triggers using end-user identity
- **Use your own model** (Preview Mar 2026): Bring your own model for generative responses
- **Enforce safe sharing** (Preview Apr 2026, GA Jun 2026): Detect credential oversharing
- **Unified error/warning/governance view** (Preview Apr 2026, GA Jun 2026): Single pane for all notifications
- **OpenAPI v3 connectors** (Preview Feb 2026, GA May 2026): Build Power Platform connectors with OpenAPI v3 specs
- **Enhanced connectors with Connector SDK + PowerFx** (Preview May 2025, GA May 2026)

## Architecture Guidance (Feb 2026 Update)

New articles in the Architecting agent solutions guidance center:
- **Common evaluation approaches** — patterns for measuring agent quality
- **Multi-agent patterns** — orchestrator/subagent patterns, workflow-oriented patterns
- Reference architecture for agents in model-driven apps (Jan 2026)
- Reference architecture for extracting/analyzing conversation transcripts (Dec 2025)

## Removed/Deprioritized Features (Build-Relevant)

Features removed from the 2025 Wave 2 release plan (will NOT be delivered):
- **SSO for non-Entra ID connections** — deprioritized Feb 27, 2026
- **Test and debug agent actions in Copilot Studio** — deprioritized Feb 12, 2026
- **Lead Manager and Customer Brief templates** — deprioritized Oct 13, 2025
