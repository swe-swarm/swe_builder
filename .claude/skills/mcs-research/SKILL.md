---
name: mcs-research
description: Full research pass — reads project documents, identifies agents, researches MCS components, designs architecture, enriches brief.json + generates evals. Uses Agent Teams for quality.
---

# MCS Research

Single-pass pipeline: read documents, identify agents, research components, design architecture, write instructions, generate eval sets. This skill absorbs the former mcs-analyze step — there is no separate extraction step.

## Input

```
/mcs-research {projectId}              # Project-level: all agents
/mcs-research {projectId} {agentId}    # Agent-level: scoped to one agent
```

**Project-level** (no agentId):
- First run: reads all docs, identifies agents, deep research, creates brief.json with evalSets + evals.csv
- Subsequent runs: smart-detects new/changed docs, routes to full or incremental

**Agent-level** (with agentId):
- After project research: smart-detects new/changed docs relevant to this agent, incremental enrichment
- Manually created agent (no prior research): full deep research scoped to this agent
- Brief edited (open questions answered): re-enriches with new context even without new docs

## Output Files (per agent)

- `Build-Guides/{projectId}/agents/{agentId}/brief.json` — Single source of truth (all fields populated including instructions + evalSets)
- `Build-Guides/{projectId}/agents/{agentId}/evals.csv` — Evaluation test cases (flat CSV generated from evalSets for MCS native eval compatibility)

**That's it. Two files.** No research report (future: on-demand export from dashboard). No working-paper files.

## Before Research — Load Frameworks

The session startup protocol already checks cache freshness and refreshes stale Tier 1 files. Do NOT re-check all 18 cache files here.

1. Read `knowledge/frameworks/component-selection.md` for the research protocol
2. Read `knowledge/frameworks/architecture-scoring.md` for scoring criteria

**Cache files are read on-demand** in Phase A (for informed questions) and Phase B (for component research). Only read the specific files needed, not all 18.

## Phase 0: Smart Research Routing (Unified)

**Goal:** Determine the optimal processing path for ANY invocation — project or agent level. Detects new/changed docs, brief edits, and manually created agents.

**This phase runs for ALL invocations.** No bypass, no skip.

### Step 0.1: Determine Scope

- `/mcs-research {projectId}` → `scope = "project"`
- `/mcs-research {projectId} {agentId}` → `scope = "agent"`

### Step 0.2: Check Preconditions (Manifest + Brief)

| Scope | Manifest? | Brief? | Result |
|-------|-----------|--------|--------|
| project | No | — | `processingPath = "full"` (first run) |
| project | Yes | — | Proceed to Step 0.3 (diff docs) |
| agent | — | No / empty stub | `processingPath = "full-agent"` (manually created, deep research scoped to this agent) |
| agent | — | Yes + enriched | Proceed to Step 0.3 (diff docs) |

Read `Build-Guides/{projectId}/doc-manifest.json` for manifest check.
Read `Build-Guides/{projectId}/agents/{agentId}/brief.json` for brief check (agent scope only).

"Empty stub" = brief.json exists but `instructions` is empty AND `capabilities` is empty (never been through research).

### Step 0.3: Diff Documents Against Manifest

1. List all files in `Build-Guides/{projectId}/docs/` matching supported extensions: `.md`, `.csv`, `.json`, `.txt`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.tiff`, `.webp`, `.docx`, `.pdf`
2. For each file, compute SHA-256 hash via PowerShell:
   ```powershell
   (Get-FileHash -Path "file" -Algorithm SHA256).Hash
   ```
3. Compare against `manifest.docsProcessed[]` entries by filename + sha256:
   - **`newDocs[]`** — files in docs/ not in manifest
   - **`changedDocs[]`** — files in manifest whose hash differs
   - **`deletedDocs[]`** — files in manifest not present in docs/
4. **Agent-scoped filtering:**
   - If `scope = "project"`: diff ALL docs (current behavior)
   - If `scope = "agent"`: diff docs where `matchedAgents` includes this agentId, PLUS any new docs (not yet in manifest)
   - If no manifest exists (agent scope, brief exists): treat ALL project docs as candidates, filter by relevance in Step 0.4
5. If changes exist → proceed to Step 0.4
6. If no changes → proceed to Step 0.5 (check brief modifications)

### Step 0.4: Document-to-Agent Mapping (when new/changed docs exist)

For each new/changed doc, determine which agent(s) it belongs to:

1. Read each doc content, score relevance against every agent's `brief.json`:
   - Systems mentioned → match `integrations[]`
   - Domain keywords → match `business.problemStatement`
   - Capabilities → match `capabilities[].name`
   - Agent name explicitly mentioned → direct match
2. **Auto-map** if relevance is clear (matches one agent strongly)
3. **Ask user** via AskUserQuestion if ambiguous (matches multiple equally, or matches none)
4. **Cross-cutting docs** (org policies, IT standards) → apply to all agents
5. **Agent-scoped invocation**: assume new docs are for this agent (user clicked Research on specific agent), but flag if doc seems irrelevant to this agent's domain

Output the mapping:
```
## Document → Agent Mapping
| Document | Agent(s) | Confidence |
|----------|----------|-----------|
| new-jira-reqs.md | incident-manager | High (mentions Jira, tickets) |
| company-policy.md | All agents | Cross-cutting |
```

Then proceed to Step 0.6 (drastic change detection).

### Step 0.5: Check for Brief Modifications (when no doc changes detected)

**For agent scope only** — if no doc changes were detected for this agent:
- Compare brief.json file modification time vs `manifest.lastResearchAt`
- If brief is newer → set `processingPath = "re-enrich"` (brief was edited, re-run Phase B→C→D)
- If brief is NOT newer → set `processingPath = "none"` (truly nothing to do)

**For project scope** — if no doc changes at all:
- Output: `No document changes since last research ({manifest.lastResearchAt}). Nothing new to process.`
- **Exit** the skill.

### Step 0.6: Drastic Change Detection (scope-aware)

Only run when processing new/changed docs (from Step 0.4).

Read new/changed docs and check 5 thresholds. **Any one** triggers a fallback to full research:

| Threshold | How to Detect | Scope |
|-----------|--------------|-------|
| New agent described | Content describes an agent not in `Build-Guides/{projectId}/agents/` | Project only |
| Architecture change | Content implies single ↔ multi-agent switch | Project only |
| >4 brief sections affected | Map content to brief sections; count > 4 | Both |
| Problem statement shift | Content fundamentally changes `business.problemStatement` | Both |
| Volume ratio >2x | Total bytes of new/changed docs > 2x total bytes of existing processed docs | Both |

At agent scope, skip "new agent described" and "architecture change" thresholds (those are project-level concerns).

### Step 0.7: Route and Report

| Condition | `processingPath` | Phases |
|-----------|-----------------|--------|
| First project run (no manifest) | `full` | A → B → C → D (all docs, deep research) |
| First agent run (empty brief) | `full-agent` | A → B → C → D (scoped to agent, reads all project docs for relevance) |
| No changes, brief not edited | `none` | Exit with message |
| Brief edited, no new docs | `re-enrich` | B → C → D (skip A, re-enrich with current brief context) |
| Changes exist, not drastic | `incremental` | A-inc → B-inc → C-inc → D-inc |
| Changes exist, drastic | `full` | Warning → A → B → C → D |

**Output to user before proceeding:**

```
## Research: {projectId} [{agentId if scoped}]
**Scope:** {Project / Agent: agentName}
**New docs:** {N} | **Changed:** {N} | **Deleted:** {N}
**Mode:** {Full / Full-Agent / Incremental / Re-enrich / Nothing new}
{If incremental: doc→agent mapping table}
```

Then proceed to Phase A with the determined `processingPath`.

## Phase A: Document Comprehension & Agent Identification

**Goal:** Read ALL project documents, build a unified understanding, identify every agent to build, and create brief.json stubs with informed open questions.

**This is NOT dumb extraction — it's deep comprehension.**

### Incremental Path (processingPath == "incremental")

When `processingPath == "incremental"`, Phase A operates on new/changed docs only, merging into the existing brief:

1. **Read ONLY `newDocs` + `changedDocs`** (not all docs). Also read each existing `brief.json` under `Build-Guides/{projectId}/agents/*/brief.json` for context.
2. **Agent-scoped filtering:** If `scope = "agent"`, only process docs mapped to this agent in Step 0.4. Write changes only to this agent's brief.
3. **Cross-reference** new content against existing brief fields. Look for: new systems, new capabilities, answers to existing open questions, contradictions with existing data.
4. **Check for new agents.** If new docs describe an agent not in `agents/`, the drastic threshold should have caught it in Phase 0 — escalate to `processingPath = "full"` if missed.
5. **Extract data only from new/changed docs.** Map to agents using the doc→agent mapping from Step 0.4.
6. **Apply merge rules:**
   - **Append-only:** `capabilities[]`, `boundaries.handle/decline/refuse`, `integrations[]`, `conversations.topics[]`, `knowledge[]`, `evalSets[].tests[]`
   - **Never overwrite:** `instructions`, answered `openQuestions[].answer`
   - **Resolve:** unanswered `openQuestions` if doc provides the answer
   - **Flag conflicts:** `business.problemStatement`, `architecture.type` → add to `_updateFlags`
7. **Show summary** of what was extracted and which agents were affected.
8. **Update manifest incrementally:** Add new entries, update hashes for changed docs, remove deleted docs, preserve unchanged entries. Set `processedAt` for each processed file. Update `matchedAgents` for new docs.

Then proceed to Phase B (incremental).

### Full-Agent Path (processingPath == "full-agent")

When `processingPath == "full-agent"` (manually created agent, empty brief):

1. **Read ALL project docs** in `Build-Guides/{projectId}/docs/`, but only extract/write data for this specific agent.
2. **Skip agent identification** — agent already exists (user created it manually).
3. **Score relevance** of each doc against this agent's name/description. Filter out clearly irrelevant docs.
4. **Extract per-agent data** — same as full path Step 4 below, but only for this one agent.
5. **Create manifest entries** with `matchedAgents` for this agent.
6. **Write brief.json stub** with all extracted data (same as full path Step 5).

Then proceed to Phase B (full path — this agent needs deep research).

### Full Path (processingPath == "full")

Existing behavior — process all documents as described below.

### Step 1: Read All Documents

Read every file in `Build-Guides/{projectId}/docs/`:
- `.md` files — read directly
- `.docx` files — convert via pandoc first: `pandoc "file.docx" -t gfm -o "file.md"` (if not on PATH, check `%LOCALAPPDATA%\Pandoc\pandoc.exe`)
- `.pdf` files — read via Read tool (PDF support)
- `.txt` files — read directly
- Images (`.png`, `.jpg`) — read via Read tool (multimodal)

If `customer-context.md` exists in the project folder, read it too — it provides M365 history.

### Step 2: Cross-Reference & Build Unified Picture

Don't read documents in isolation. Build a single mental model:
- Cross-reference systems mentioned across documents (same system, different names?)
- Cross-reference personas (same user group described differently?)
- Identify contradictions between documents (flag as open questions)
- Identify themes: what's consistent across all docs?
- Note what's explicit vs implied vs missing

### Step 3: Identify Agents

From the unified understanding, identify distinct agents. Look for:
- Explicit agent names or titles
- Distinct problem domains that suggest separate agents
- SDR sections: "Agent Name", "Solution Ideas", "Autonomous Agent" tables
- Separate use case descriptions or user prompt tables

**If documents describe ONE agent:** Create one agent entry.
**If documents describe MULTIPLE agents:** Create one entry per agent.
**If unclear:** Default to one agent, note uncertainty in openQuestions.

### Step 4: Extract Per-Agent Data & Generate Informed Open Questions

For each agent, extract what's in the documents AND cross-reference against `knowledge/cache/` to generate *informed* open questions.

| Field | Where to Look |
|-------|--------------|
| `agent.name` | Title, agent name field, heading |
| `business.problemStatement` | Problem statement, opportunity description, pain points |
| `business.challenges` | Business challenges, inefficiencies, pain points |
| `business.benefits` | Expected outcomes, ROI, efficiency gains |
| `agent.description` | Agent purpose, what it does, for whom |
| `capabilities[].name` | Solution ideas, capabilities list, "what it does" sections |
| `boundaries.handle` | Inferred from capabilities and scope description |
| `boundaries.decline` | Out-of-scope mentions, limitations |
| `boundaries.refuse` | Hard boundaries, compliance requirements |
| `integrations[]` | Data sources table, integrations mentioned, connectors listed |
| `knowledge[]` | Knowledge sources table, SharePoint sites, document references |
| `architecture.triggers` | Autonomous triggers table, scheduling mentions |
| `architecture.channels` | Deployment targets (Teams, M365 Copilot, website, etc.) |

**Informed open questions** — use cache knowledge to ask the RIGHT questions:
- Doc mentions a system → check `knowledge/cache/connectors.md` and `knowledge/cache/mcp-servers.md` → if no native connector, ask: "System X has no native MCS connector. Options: custom connector, Power Automate flow, or HTTP request action. Which applies?"
- Doc mentions triggers → check `knowledge/cache/triggers.md` → ask about specific trigger types, not vague "what triggers?"
- Doc mentions "proactive alerts" → ask: "Should alerts use a Recurrence trigger polling every N hours, or an event-driven trigger from Power Automate?"
- Doc mentions "write-back" → flag: "Write operations require connector actions. Has the customer approved write access to [system]?"

### Step 5: Create brief.json Stubs

For each agent, create:
```
Build-Guides/{projectId}/agents/{slug}/brief.json
```

Where `{slug}` is a kebab-case version of the agent name (e.g., "Incident Manager" → "incident-manager").

Follow the schema in `templates/brief.json`. Include only fields with extracted data + informed openQuestions.

**If agents already exist** under `Build-Guides/{projectId}/agents/`:
- Update their `brief.json` with new info from documents
- Do NOT duplicate existing agents
- Merge new data into existing fields

### Step 6: Confirm with User

Present what was found and get confirmation before proceeding to research:

```
## Documents Analyzed: {projectId}

**Documents read:** {count}
**Agents identified:** {count}

| Agent | Key Capabilities | Open Questions |
|-------|-----------------|----------------|
| {name} | {2-3 capabilities} | {count} |

{List top 3-5 open questions across all agents}

Proceeding to full MCS component research for all {count} agents...
```

Then continue directly to Phase B. **Do not stop and wait** — this is a single-pass skill. The user will provide feedback after the full research is complete.

### Step 6.5: Write Document Manifest

Write `doc-manifest.json` to `Build-Guides/{projectId}/` containing every document read during Phase A. This is the baseline for future incremental runs.

```json
{
  "projectId": "{projectId}",
  "lastResearchAt": null,
  "docsProcessed": [
    {
      "filename": "sdr-agent-1.md",
      "sha256": "a1b2c3...",
      "size": 4520,
      "processedAt": "2026-02-13T10:30:00Z",
      "targetAgent": null,
      "source": "research",
      "matchedAgents": ["incident-management", "confluence-knowledge"]
    }
  ]
}
```

For each file in `docs/`:
- Compute SHA-256 hash of file contents
- Set `targetAgent: null` (initial research reads everything for all agents)
- Set `matchedAgents` to all identified agent slugs
- Set `source: "research"`

This manifest enables incremental research to detect new/changed documents without re-running the full pipeline.

## Phase B: Component Research — Targeted

**Goal:** Research MCS components and recommend the best tools, knowledge sources, model, triggers, and channels for each agent.

**Key principle:** Don't research all 6 categories live for every agent. Stable categories use cache directly. Only dispatch live research for the agent's specific integration systems.

### Incremental Path (processingPath == "incremental")

When `processingPath == "incremental"`, Phase B is scoped to only what's new:

1. **Skip stable category resolution** unless Phase A-inc found new architecture-relevant data (new channels, triggers, knowledge types not already in the brief). If all new content maps to existing categories, skip directly to Step 3.
2. **Only research NEW external systems** from the new docs that aren't already in `integrations[]`. If a doc mentions "Jira" and the agent already has Jira in integrations, skip it.
3. **Check learnings** (same as full — quick read of relevant `knowledge/learnings/` files).
4. **Spawn Research Analyst only if new external systems were found** that need live MCP/connector lookup. If everything maps to existing integrations or Microsoft-native tools, skip RA entirely.

Then proceed to Phase C (incremental).

### Full Path (processingPath == "full" or "full-agent")

Existing behavior — research all categories as described below.

### Step 1: Resolve Stable Categories from Cache (Lead)

These categories are well-documented and change infrequently. Read the cache files directly — no live research needed unless the doc mentions something unusual:

| Category | Cache File | Lead Action |
|----------|-----------|-------------|
| **Channels** | `knowledge/cache/channels.md` | Read cache. Default Teams + Web Chat unless docs say otherwise. |
| **Triggers** | `knowledge/cache/triggers.md` | Read cache. Match trigger type to agent's activation needs from Phase A. |
| **Knowledge sources** | `knowledge/cache/knowledge-sources.md` | Read cache. Match to data types from Phase A (SharePoint, files, websites). |

Write these directly to `brief.json`:
- `architecture.channels` (each with `name` + `reason`)
- `architecture.triggers` (each with `type` + `description`)
- `knowledge[]` (each with `name`, `type`, `purpose`, `scope`, `phase`)

### Step 2: Identify What Needs Live Research

From Phase A extraction, list the agent's **specific external systems** that need MCP/connector lookup:

```
Example: Agent needs Jira, ServiceNow, Confluence
→ Research task: "Find MCS MCP servers or connectors for Jira, ServiceNow, Confluence"
```

**Skip live research if:**
- The agent only uses Microsoft-native tools (Outlook, SharePoint, Teams) — these are well-documented in cache
- The agent has no external system integrations (pure knowledge agent)
- All systems are already in `knowledge/cache/connectors.md` or `knowledge/cache/mcp-servers.md` with recent `last_verified` dates

### Step 3: Check Past Learnings (only relevant files)

Read learnings files only if they're relevant to this agent's systems and non-empty:

- `knowledge/learnings/connectors.md` — if the agent has external connectors
- `knowledge/learnings/integrations.md` — if the agent has complex integrations
- `knowledge/learnings/customer-patterns.md` — if there's a matching industry

**Also read `knowledge/learnings/index.json`** to check confirmed counts. Entries with higher `confirmed` values get stronger presentation weight.

**How to use learnings:**
- Present as an additional option alongside official recommendations
- Higher `Confirmed` count = higher weight, but user always decides

**If a cached category is confirmed by learnings** (e.g., same trigger approach worked in 3 builds), bump `confirmed` count in `index.json` (Tier 1 auto-capture — no user confirmation needed).

### Step 4: Live Research via Research Analyst (only if needed)

**If Step 2 identified systems needing live research**, spawn the **Research Analyst** teammate with **targeted tasks only**:

```
Research Analyst tasks (ONLY for systems not resolved from cache):
- "Find MCS MCP servers or connectors for [System A], [System B]"
- "What connector auth modes does [System C] support in MCS?"
```

The RA should:
- Check `knowledge/cache/connectors.md` + `knowledge/cache/mcp-servers.md` for baseline
- WebSearch for "[system] Copilot Studio connector" + current year
- MS Learn MCP for official docs
- Cross-reference and present options with pros/cons

**If Step 2 found nothing needing live research**, skip the RA entirely — proceed to Phase C.

### Component Selection Rules

- **MCP > individual connector actions**: When a connector offers an MCP server, ALWAYS prefer MCP
- **Present options**: For each need, recommend the best option but note alternatives
- **Flag preview features**: Note GA vs preview status for each recommendation

### Update brief.json

After research (live or cache-only), update:
- `integrations[]` — recommended tools with `type` (mcp/connector/flow/ai-tool), `purpose`, `dataProvided`, `authMethod`, `phase`
- `conversations.topics[]` — recommended conversation topics with `triggerType`, `topicType`, `implements[]`
- `knowledge[]` — recommended knowledge sources with `type`, `purpose`, `scope`, `phase`

## Phase C: Architecture Design + Instructions

**Goal:** Score architecture, write instructions, and update brief.json with build-ready data.

### Re-enrich Path (processingPath == "re-enrich")

When `processingPath == "re-enrich"` (brief was edited, no new docs — e.g., user answered open questions):

Phase A was skipped (no new docs to process). Go straight to:

1. **Re-score architecture** if answered questions affect the 6-factor scoring (e.g., answered "Which teams own this?" could change teamOwnership factor). If score changes, update `architecture.score` and `architecture.factors`.
2. **Generate `instructionsDelta`** noting what changed from answered questions. If `instructions` is empty (never written), write from scratch via Prompt Engineer (same as full mode). If instructions exist, generate delta and flag for review.
3. **QA reviews consistency** — do the answered questions create contradictions with existing brief fields? Are there new integration needs revealed by the answers?
4. **Update MVP fields** if applicable — answered questions may clarify what's now vs later.

Then proceed to Phase D (re-enrich — QA generates new eval tests only if answered questions affect eval coverage).

### Incremental Path (processingPath == "incremental")

When `processingPath == "incremental"`, Phase C preserves existing architecture and instructions:

1. **Re-score architecture only if** Phase A-inc added new capabilities or integrations that affect the 6-factor scoring. If the score changes, add to `_updateFlags` with the old and new score — do NOT automatically switch architecture type.
2. **Do NOT rewrite instructions.** Instead, generate an `instructionsDelta` describing what changed (new capabilities, new tools, new boundaries) and store in `notes.instructionsDelta`. Flag for the user: "Instructions may need updating — review delta in dashboard."
   - **Exception:** If the `instructions` field is currently empty (never written), write from scratch via Prompt Engineer (same as full mode).
3. **QA reviews incremental changes only** — consistency check of new fields against existing brief (do new integrations conflict with existing architecture? do new capabilities overlap with existing ones?). No full instruction review.
4. **Merge new fields only** — append to `mvp.now`/`mvp.later` where appropriate, don't overwrite existing MVP decisions.

Then proceed to Phase D (incremental).

### Full Path (processingPath == "full" or "full-agent")

Existing behavior — full architecture scoring + instructions as described below.

### Before Scoring: Consult Architecture + Instruction Learnings

Read `knowledge/learnings/architecture.md` and `knowledge/learnings/instructions.md` (if non-empty) before architecture scoring and instruction writing. Look for:
- Architecture patterns that matched similar agent profiles (single vs multi-agent precedents)
- Instruction patterns that improved quality (boundary language, tool reference patterns)
- Present relevant learnings to PE alongside the brief data

### Step 1: Architecture Decision (Lead)

Score single vs multi-agent using the 6-factor framework:

| Factor | Single Agent (0 pts) | Multi-Agent (1 pt) |
|--------|---------------------|-------------------|
| **Domain** | Same domain | Truly separate domains |
| **Data sources** | Shared data | Different systems per capability |
| **Team ownership** | Same team | Different teams own parts |
| **Reusability** | One-off agent | Specialists reusable elsewhere |
| **Instruction size** | Fits in 8000 chars | Would exceed 8000 chars |
| **Knowledge isolation** | Shared KB | Each needs own deep KB |

**Score: 0-2 → Single Agent | 3+ → Multi-Agent**

Update `brief.json architecture`:
- `architecture.type` — "Single Agent" or "Multi-Agent" (auto-computed from factors)
- `architecture.factors` — 6-factor boolean checklist (domainSeparation, dataIsolation, teamOwnership, reusability, instructionSize, knowledgeIsolation)
- `architecture.score` — count of true factors (0-6)
- `architecture.children` — child agents if multi-agent

### Step 2: Instructions — Prompt Engineer (single pass)

Spawn the **Prompt Engineer** teammate to write the agent instructions. Provide the PE with:
- The agent's complete `brief.json` (business, agent, capabilities, integrations, knowledge, conversations, boundaries populated from Phases A-B)
- `knowledge/cache/instructions-authoring.md` for MS-recommended patterns and anti-patterns

**PE must follow the three-part structure (Constraints + Response Format + Guidance) and anti-pattern rules:**
- **Three-part structure**: Constraints (what to do/not do) → Response Format (how to present) → Guidance (how to find answers)
- **State the audience** in the Role section (e.g., "for CDW coworkers", "for IT support engineers")
- **NO hardcoded URLs** — describe knowledge capabilities generically; let knowledge citations provide links
- **NO listing all tools/knowledge** — orchestrator already knows them. Only `/ToolName` for disambiguation
- **NO professional tone instructions** — professional is the default. Only specify tone for deviations
- **Include follow-up guidance** — "End every response with a relevant follow-up question or next step"
- **Include 2-3 examples** for complex behaviors (boundary enforcement, multi-step workflows)
- **Boundaries in instructions are guidance only** — hard stops require dedicated topics (which are in `conversations.topics`)
- **Topic descriptions drive routing** — instructions are lowest priority for routing. If a topic needs to be found, its description matters more than instructions mentioning it
- PE runs their own review checklist before returning (char count, anti-pattern check, reference validity, audience, follow-ups)

### Step 3: QA Review (single pass, no iteration)

Spawn the **QA Challenger** to review the PE's output in a **single pass**:
- Verify instructions use three-part structure (Constraints + Response Format + Guidance)
- Verify **no hardcoded URLs** and **no tool/knowledge listing**
- Verify instructions reference only tools that are in `integrations[]`
- Verify boundaries match `boundaries.handle/decline/refuse`
- Verify audience is stated in the Role section
- Verify follow-up question guidance is included
- Verify instruction length < 8000 chars
- Check for vague language, missing edge cases, nested lists

**QA produces a verdict:**
- **PASS** — instructions are ready as-is
- **PASS WITH FIXES** — instructions are good but have specific issues. QA outputs the exact fixes needed (e.g., "Line 4: change `/JiraConnector` to `/Jira`", "Remove reference to `/TopicX` — not configured")
- **FAIL** — fundamental problems requiring rewrite (rare — only if PE missed something major)

**No iteration loop.** If QA returns PASS WITH FIXES, the lead applies the specific fixes directly. If QA returns FAIL, the lead spawns PE again with QA's feedback for one more attempt, then accepts the result.

### Step 4: Write to brief.json

Write the build-ready data directly to `brief.json`:

- `instructions` — full system prompt text (QA-reviewed, up to 8000 chars)
- `mvp.now` — what to build this sprint
- `mvp.later` — what's deferred and why

Also enrich existing fields with research findings:
- `integrations[].status` — availability status per tool
- `integrations[].notes` — auth details, config notes
- `knowledge[].scope` — scoping/filtering details
- `knowledge[].status` — readiness status
- `conversations.topics[].triggerType` — how each topic is triggered
- `notes` — any additional context discovered during research

## Phase D: Eval Sets & Topic Classification

**Goal:** Generate eval sets (5 default tiers + custom), classify topic needs, and produce evaluation CSV.

### Incremental Path (processingPath == "incremental")

When `processingPath == "incremental"`, Phase D generates eval tests only for what's new:

1. **Generate tests only for NEW capabilities** added during Phase A-inc. Distribute into the appropriate eval sets.
2. **Append new tests** to existing `evalSets[].tests[]`. Never remove or modify existing test entries.
3. **QA reviews new tests only** — verify they don't duplicate existing test coverage.
4. **Regenerate `evals.csv`** from the updated evalSets (flat export for MCS native eval compatibility).

Then proceed to Final Output (incremental format).

### Full Path (processingPath == "full" or "full-agent")

Existing behavior — generate all eval sets and topics as described below.

### Before Eval Generation: Consult Topic + Eval Learnings

Read `knowledge/learnings/topics-triggers.md` and `knowledge/learnings/eval-testing.md` (if non-empty) before generating eval sets and classifying topics. Look for:
- Topic patterns that improved routing (trigger phrase strategies, "by agent" description patterns)
- Eval method insights (which test methods work best for which scenario types, threshold calibration)
- Provide relevant learnings to QA Challenger alongside the brief data

### The Generic-Instructions / Explicit-Topics Balance

Since instructions are now generic (no hardcoded URLs, no tool listing, no naming knowledge sources per MS best practices), **routing must come from elsewhere**. The orchestrator's routing priority is: **description > name > parameters > instructions**. This means:

- **Every capability** in `brief.json.capabilities[]` should map to either a well-described knowledge source OR a custom topic with a strong description
- **Capabilities requiring specific behavior** (multi-step workflows, structured data collection, hard boundaries) → MUST be custom topics, not left to generative orchestration
- **Capabilities handled by knowledge Q&A** → generative orchestration is fine, but the knowledge source description must be specific enough for routing
- **Topic descriptions are the #1 routing signal** — every custom topic's `description` field must clearly state when to use it AND when NOT to use it

### Step 1: Classify Topics + Generate Eval Sets — QA Challenger (single pass)

Spawn **QA Challenger** to classify topics AND populate all 5 default eval sets in one pass.

**Topic classification:** For each capability, QA determines:
- **Topic type**: `generative` (handled by orchestration + knowledge) or `custom` (needs dedicated topic YAML)
- **Trigger type**: `by-agent` (AI routes via description) or `phrases` (explicit triggers) or `event` (autonomous)

**Custom topic decision criteria** (if ANY are true → custom topic, not generative):
- Requires multi-step data collection (sequential questions)
- Requires specific response format the model can't reliably produce (e.g., structured summaries, forms)
- Is a hard boundary/decline/refuse scenario (instructions alone are unreliable — need manual response topic)
- Requires tool calls in a specific sequence
- Requires channel-specific behavior (adaptive cards, quick replies)
- Maps to a capability that the brief marks as requiring "structured" or "workflow" behavior

**Eval set generation:** QA populates 5 default eval sets from the brief:

| Set | What QA Generates | Source Material |
|-----|-------------------|----------------|
| **critical** (100% pass) | Boundary decline + refuse tests, identity/persona tests | `boundaries.decline[]`, `boundaries.refuse[]`, `agent.persona` |
| **functional** (70% pass) | Happy-path tests per MVP capability | `capabilities[]` where `phase == "mvp"` |
| **integration** (80% pass) | Tool/connector verification tests | `integrations[]` where `phase == "mvp"` |
| **conversational** (60% pass) | Multi-turn, context carry, topic switching | Cross-capability scenarios, follow-ups |
| **regression** (70% pass) | Cross-cutting end-to-end tests | Combined capabilities, edge cases |

**Each test includes:**
- `question` — realistic user message (including typos, informal language)
- `expected` — what the response should contain or convey
- `capability` — links to `capabilities[].name` (optional for cross-cutting tests)

**Target counts:** 15-25 total tests across all sets. Critical set must have at least 1 test per boundary refuse/decline.

**Methods are preset per set (defaults from schema):**
- Critical: `Keyword match (all)` + `Exact match`
- Functional: `Compare meaning (70)` + `Keyword match (any)`
- Integration: `Capability use` + `Keyword match (any)`
- Conversational: `General quality` + `Compare meaning (60)`
- Regression: `Compare meaning (70)` + `General quality`

Research may adjust methods per set based on agent specifics (e.g., raise Compare meaning threshold for precision-critical agents).

### Step 1.5: Topic Feasibility Review — Topic Engineer (single pass)

Spawn **Topic Engineer** to validate the proposed topic structure before the build. This catches structural issues early — reducing rework.

Provide TE with:
- `brief.json.conversations.topics[]` (topic list with types and triggers from QA)
- `brief.json.capabilities[]` (what each topic needs to do)
- `brief.json.integrations[]` (available tools)
- `knowledge/cache/adaptive-cards.md` + `knowledge/cache/conversation-design.md`

TE reviews each proposed topic and produces a **per-topic feasibility assessment:**

| Check | What TE Validates |
|-------|------------------|
| **Complexity** | Can this be a single topic, or needs splitting? (Rule of thumb: >8 nodes or >3 branch levels → split) |
| **Node types** | Are the required node types available? (e.g., HttpRequest for API calls, InvokeConnectorAction for connectors) |
| **Card feasibility** | If topic needs adaptive cards — will they work on target channels? Size < 28KB? No Action.Execute? |
| **Variable flow** | Do inputs chain to outputs correctly? Any circular dependencies? |
| **Trigger viability** | Is the trigger type appropriate? "By agent" description specific enough for AI routing? |
| **Description quality** | Is the topic description specific enough for routing? Does it say when to use AND when NOT to use? (Descriptions are routing priority #1 — more important than instructions) |

**What happens with TE's output:**
- **OK** topics → no change to brief
- **SPLIT** recommendations → update `conversations.topics[]` to reflect the split (add sub-topics, mark original as parent)
- **Caveats** → add to `conversations.topics[].notes` field
- QA does NOT re-review TE's output (this is a single-pass addition, not an iteration loop)

**When to skip TE:** If the agent has no custom topics (all generative), skip this step — there's nothing structural to validate.

### Step 2: Write evalSets to brief.json + Generate evals.csv (Lead)

Write the 5 eval sets to `brief.json.evalSets[]` and `brief.json.evalConfig`.

Also generate `Build-Guides/{projectId}/agents/{agentId}/evals.csv` from the eval sets (flat format for MCS native eval compatibility):

```csv
"question","expectedResponse","testMethodType","passingScore"
```

**Flattening rules (evalSets → CSV):**
- Each test becomes one CSV row
- `testMethodType` = first method from the test's set (e.g., functional → `CompareMeaning`)
- `passingScore` = that method's score threshold (e.g., `70`), or empty for binary methods

### Step 3: Update brief.json

Write to `brief.json`:
- `evalSets[]` — all 5 sets with their tests, methods, thresholds
- `evalConfig` — `{ targetPassRate: 70, maxIterationsPerCapability: 3, maxRegressionRounds: 2 }`
- `conversations.topics[]` — topic classifications from QA

## Final Output

After all phases complete for each agent:

1. **brief.json** — All fields populated (business, agent, capabilities, integrations, knowledge, conversations, boundaries, architecture, evalSets, evalConfig, mvpSummary, openQuestions, instructions)
2. **evals.csv** — Evaluation test cases in MCS-compatible flat CSV format (generated from evalSets)

### Report to User

#### Terminal Output — Incremental Mode

When `processingPath == "incremental"`, use this format:

```
## Incremental Research Complete: {projectId}

**Mode:** Incremental ({N} new/changed docs processed)
**Agents updated:** {count}

| Agent | +Capabilities | +Integrations | +Tests | Flags |
|-------|--------------|---------------|--------|-------|
| {name} | +{N} | +{M} | +{K} | {F} |

{If _updateFlags exist: "Review flagged items in dashboard. Instructions delta in notes."}

**Next:** Review changes in dashboard. If instructions need updating, edit in dashboard or re-run with agentId.
```

#### Terminal Output — Full Mode

```
## Research Complete: {projectId}

**Agents:** {count} | **Open Questions:** {count}

| Agent | Architecture | Tools | Evals |
|-------|-------------|-------|-------|
| {name} | {Single/Multi} | {N} | {N} |

Files: brief.json + evals.csv per agent

**Next:** Review brief in the dashboard. Resolve open questions. Then /mcs-build.
```

**No report file generated.** The dashboard renders brief.json directly. Customer-shareable reports will be an on-demand export feature (future).

## Post-Research Learnings Capture

After the terminal output, check if there are learnings worth capturing. This is lighter than the post-build capture — focus on **research-phase discoveries only**.

### What to Capture

- **New components found** that weren't in `knowledge/cache/` (already updated cache, but also log the discovery)
- **Cache corrections** — if a cache file had wrong or outdated information
- **Customer-specific patterns** — if the SDR reveals an industry pattern (e.g., "financial services customers always need X")
- **Architecture insights** — if the scoring led to a non-obvious recommendation

### Generate Summary (only if there are learnings)

```markdown
## Research Learnings: [Project] — [Date]

### New Discoveries
| Discovery | Updated In | Category |
|-----------|-----------|----------|
| [what was found] | [cache file updated] | [learnings topic] |

### Customer/Industry Patterns
| Pattern | Context | Category |
|---------|---------|----------|
| [pattern observed] | [customer/industry] | customer-patterns |
```

Present to user. If confirmed (Tier 2), write to `knowledge/learnings/{category}.md` and update `knowledge/learnings/index.json`.

If the research was routine and nothing surprising was found, skip the Tier 2 summary — but still run the Tier 1 auto-check:

**Tier 1 auto-capture (no user confirmation):**
- For each approach that matched a prior learning (same cache category resolved the same way), bump `confirmed` count and `lastConfirmed` date in `index.json`
- For cache corrections found during research, write the correction to the appropriate learnings file and add to `index.json`

**Tier 2 user-confirmed capture:**
- New discoveries not covered by existing entries
- Contradictions with existing learnings (flag both)
- Non-obvious architecture insights

**Comparison engine:** Before writing any new entry, run the 4-step comparison (see CLAUDE.md "Learnings Protocol" § B) to avoid duplicates and catch contradictions.

### Update Document Manifest

After all phases complete, update `doc-manifest.json` with the final `lastResearchAt` timestamp:

```python
manifest["lastResearchAt"] = datetime.now().isoformat()
```

This timestamp lets incremental research know when the last full research was performed.

---

## Important Rules

- **brief.json is THE source of truth** — the dashboard reads it, the build skill reads it, reports are generated from it
- **There is no separate agent-spec.md** — everything lives in brief.json including instructions and MVP scope
- **evals.csv is for MCS native eval compatibility** — flat export from brief.json evalSets. The Eval skill reads evalSets directly.
- **Only 2 permanent output files per agent**: `brief.json` and `evals.csv`. Nothing else.
- **No working-paper files**: Do NOT leave intermediate artifacts like instruction drafts, QA reviews, connector research notes, or scenario docs as separate files. All research findings go INTO brief.json fields (instructions, integrations[].notes, notes{}, etc.). If teammates generate working documents during collaboration, consolidate their content into brief.json and delete the working files before completing.
- **Targeted research, not exhaustive** — only spawn RA for systems that need live lookup. Stable categories (models, channels, triggers, knowledge) use cache.
- **Single-pass QA** — no PE↔QA iteration loop. PE self-checks, QA reviews once, lead applies fixes.
- **Topic Engineer validates feasibility in Phase D** but does NOT generate YAML. Full YAML authoring is reserved for `/mcs-build`. TE checks structural feasibility (complexity, node types, card limits, variable flow, triggers) and recommends splits where needed.
- **Never assume components** — always research, always present options
- **Update cache** — after live research, update relevant `knowledge/cache/` files
- **Iteration comes from the user** — present open questions, let the customer/user resolve them, then re-run with `{agentId}` to re-enrich
- **Don't stop between phases** — this is a single-pass skill. Run A→B→C→D continuously.
- **Phase 0 runs for ALL invocations** — project and agent level. No bypass, no skip.
- **Document-to-agent mapping is auto-detected.** Ask user only when ambiguous.
- **Brief edits trigger re-enrichment.** If brief was modified since last research (answered questions), re-enrich even without new docs.
- **`full-agent` for manually created agents.** Empty brief + agent scope = full research scoped to that agent.
- **Incremental by default** — when a manifest exists and docs changed but no drastic thresholds are triggered, prefer the incremental path. Don't re-process unchanged documents.
- **brief.json IS the context** — the existing brief contains all prior research. During incremental processing, read the brief for context instead of re-reading unchanged docs.
- **Merge rules are sacred** — during incremental processing, follow incremental merge rules exactly. Never overwrite `instructions` or answered `openQuestions`. Append-only for arrays and evalSets tests. Flag conflicts in `_updateFlags`.
- **Manifest consistency** — after ANY path (full, full-agent, incremental, or re-enrich), the manifest must reflect the current `docs/` state with accurate hashes and timestamps.

## Teammate Usage Summary

| Phase | Full | Full-Agent | Incremental | Re-enrich |
|-------|------|-----------|-------------|-----------|
| 0 | Lead | Lead | Lead | Lead |
| A | Lead (all docs, all agents) | Lead (all docs, one agent) | Lead (new docs only) | Skipped |
| B | Lead + **RA** (if needed) | Lead + **RA** (if needed) | Lead + **RA** (new systems only) | Lead only |
| C | Lead + **PE** + **QA** | Lead + **PE** + **QA** | Lead + **QA** (PE skipped unless instructions empty) | Lead + **QA** |
| D | Lead + **QA** + **TE** | Lead + **QA** + **TE** | Lead + **QA** (new caps) + **TE** (if new topics) | Lead + **QA** + **TE** (if answered questions affect topics) |

**Maximum teammates per full/full-agent run:** 4 (RA + PE + QA + TE). Often just 3 (PE + QA + TE) for Microsoft-native agents.
**Maximum teammates per incremental run:** 3 (RA + QA + TE). Often just 1-2 (QA, or QA + TE when new topics added).
**Maximum teammates per re-enrich run:** 2 (QA + TE). PE only if instructions are empty. TE only if answered questions affect topics.
