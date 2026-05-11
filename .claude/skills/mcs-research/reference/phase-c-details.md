# Phase C: Architecture, Instructions, Eval Sets & Topics (Parallel)

**Goal:** Score architecture, select model, write instructions, classify topics, generate eval sets, validate topic feasibility. Teammates run in parallel for speed.

**Time budget:** ~8-12 min (parallel) vs ~20-25 min (old sequential).

## Re-enrich Path (processingPath == "re-enrich")

When `processingPath == "re-enrich"` (brief was edited, no new docs -- e.g., user answered open questions):

Phase A was skipped (no new docs to process). Go straight to:

1. **Re-score architecture** if answered questions affect the 6-factor scoring (e.g., answered "Which teams own this?" could change teamOwnership factor). If score changes, update `architecture.score` and `architecture.factors`.
2. **Generate `instructionsDelta`** noting what changed from answered questions. If `instructions` is empty (never written), write from scratch via Prompt Engineer (same as full mode). If instructions exist, generate delta and flag for review.
3. **Parallel dispatch** (Step 2 below) -- QA generates new eval tests if answered questions affect coverage, TE reviews topic changes if answers affect topic structure.
4. **Update MVP fields** if applicable -- answered questions may clarify what's now vs later.

## Incremental Path (processingPath == "incremental")

When `processingPath == "incremental"`, Phase C preserves existing architecture and instructions:

1. **Re-score architecture only if** Phase A-inc added new capabilities or integrations that affect the 6-factor scoring. If the score changes, add to `_updateFlags` with the old and new score -- do not automatically switch architecture type.
2. **Do not rewrite instructions.** Instead, generate an `instructionsDelta` describing what changed (new capabilities, new tools, new boundaries) and store in `notes.instructionsDelta`. Flag for the user: "Instructions may need updating -- review delta in dashboard."
   - **Exception:** If the `instructions` field is currently empty (never written), write from scratch via Prompt Engineer (same as full mode).
3. **Parallel dispatch** (Step 2 below) -- QA generates tests for new capabilities only (appends to existing evalSets). TE reviews new custom topics if any. PE skipped unless instructions empty.
4. **Merge new fields only** -- append to `mvp.now`/`mvp.later` where appropriate, don't overwrite existing MVP decisions.

## Full Path (processingPath == "full" or "full-agent")

Existing behavior -- full architecture scoring + parallel dispatch as described below.

## Before Scoring: Consult Architecture + Instruction Learnings

Read `knowledge/learnings/architecture.md` and `knowledge/learnings/instructions.md` (if non-empty) before architecture scoring and instruction writing. Look for:
- Architecture patterns that matched similar agent profiles (single vs multi-agent precedents)
- Instruction patterns that improved quality (boundary language, tool reference patterns)
- Present relevant learnings to PE alongside the brief data

Also read `knowledge/learnings/topics-triggers.md` and `knowledge/learnings/eval-testing.md` (if non-empty) before topic classification and eval generation. Look for:
- Topic patterns that improved routing (trigger phrase strategies, "by agent" description patterns)
- Eval method insights (which test methods work best for which scenario types, threshold calibration)

## Step 1: Architecture Decision (Lead)

Score single vs multi-agent using the 6-factor framework:

| Factor | Single Agent (0 pts) | Multi-Agent (1 pt) |
|--------|---------------------|-------------------|
| **Domain** | Same domain | Truly separate domains |
| **Data sources** | Shared data | Different systems per capability |
| **Team ownership** | Same team | Different teams own parts |
| **Reusability** | One-off agent | Specialists reusable elsewhere |
| **Instruction size** | Fits in 8000 chars | Would exceed 8000 chars |
| **Knowledge isolation** | Shared KB | Each needs own deep KB |

**Score: 0-2 -> Single Agent | 3+ -> Multi-Agent**

Also consider **Connected Agent** -- when the agent bridges to an external agent system (e.g., Azure AI Foundry agent). Rule out explicitly if not applicable.

Update `brief.json architecture`:
- `architecture.type` -- `"single-agent"`, `"multi-agent"`, or `"connected-agent"` (kebab-case, matching dashboard UI card IDs)
- `architecture.reason` -- 2-4 sentences explaining why this type was selected. Reference the score, the key factors that drove the decision, and why the other types were ruled out.
- `architecture.factors` -- 6-factor object, each with `value` (true/false) and `reasoning` (1-2 sentences explaining why this factor scored the way it did, referencing the agent's specific capabilities and data)
- `architecture.score` -- count of true factors (0-6)
- `architecture.children` -- child agents if multi-agent

Every factor should have reasoning, because a bare `true`/`false` without explanation is incomplete. The reasoning should reference the agent's specific capabilities, data sources, teams, and constraints.

### Architecture Decision Generation

| Score | Action |
|-------|--------|
| **0-1** (clearly single) | Auto-apply `single-agent`. No decision entry. Still write `architecture.reason` explaining why. |
| **2-3** (borderline) | Create architecture decision with single-agent and multi-agent as options. Pre-apply the score-recommended type. |
| **4-6** (clearly multi) | Auto-apply `multi-agent`. No decision entry. Note in `architecture.reason` that single was considered. |

**Borderline decision format:**
```json
{
  "id": "d-{NNN}",
  "category": "architecture",
  "title": "Single agent or multi-agent architecture?",
  "context": "Score {N}/6 is borderline. Key factors: {factors that scored true}. Both approaches are viable.",
  "targetField": "architecture.type",
  "status": "pending",
  "recommendedOptionId": "opt-1",
  "options": [
    {
      "id": "opt-1",
      "label": "{score-recommended type}",
      "summary": "...",
      "pros": ["..."],
      "cons": ["..."],
      "confidence": "medium",
      "briefPatch": { "architecture": { "type": "{recommended}" } }
    },
    {
      "id": "opt-2",
      "label": "{alternative type}",
      "summary": "...",
      "pros": ["..."],
      "cons": ["..."],
      "confidence": "medium",
      "briefPatch": { "architecture": { "type": "{alternative}" } }
    }
  ]
}
```

## Step 1.5: Model Selection + Topic Classification (Lead -- no teammates)

### Model Selection

**Goal:** Select the AI model during research so the PE can write model-aware instructions and the customer can review the choice.

1. **Query available models:** Read `knowledge/cache/models.md` for the current model catalog. If stale (> 7 days), query live via `node tools/island-client.js get-models --env <envId>`.
2. **Evaluate model fit:** Consider the agent's requirements:
   - Reasoning-heavy (complex multi-step logic, code generation) -> models with reasoning capabilities (o3-mini, etc.)
   - General-purpose (Q&A, summarization, routing) -> latest GA model (default)
   - Cost-sensitive -> smaller/cheaper models
   - Low-latency required -> faster models
3. **Decision threshold:**
   - If the latest GA model is the obvious choice (general-purpose agent, no special requirements) -> auto-apply to `agent.recommendedModel`, no decision entry.
   - If meaningfully different options exist (e.g., GPT-4.1 vs o3-mini for a reasoning-heavy agent, or cost matters) -> create model decision with options.
4. **Write to brief.json:** Set `agent.recommendedModel` to the selected/recommended model name. PE uses this for model-aware instruction writing.

**Model decision format (when created):**
```json
{
  "id": "d-{NNN}",
  "category": "model",
  "title": "Which AI model for {agent name}?",
  "context": "{Why multiple models are viable}",
  "targetField": "agent.recommendedModel",
  "status": "pending",
  "recommendedOptionId": "opt-1",
  "options": [/* one per viable model with pros/cons/cost */]
}
```

### Topic Classification (Lead -- quick, before teammate dispatch)

Before dispatching teammates, the Lead classifies each capability's topic type. This enables TE to start immediately without waiting for QA.

**Classification rules** (any true -> custom topic):
- Requires multi-step data collection (sequential questions)
- Requires specific response format the model can't reliably produce (e.g., structured summaries, forms)
- Is a hard boundary/decline/refuse scenario (instructions alone are unreliable -- need manual response topic)
- Requires tool calls in a specific sequence
- Requires channel-specific behavior (adaptive cards, quick replies)
- Maps to a capability that the brief marks as requiring "structured" or "workflow" behavior

**Borderline cases:** When criteria are mixed, create a `topic-implementation` decision:

```json
{
  "id": "d-{NNN}",
  "category": "topic-implementation",
  "title": "Generative or custom topic for {capability}?",
  "context": "{Why both approaches could work}",
  "targetField": "conversations.topics[name={topic}].topicType",
  "capability": "{capability name}",
  "status": "pending",
  "recommendedOptionId": "opt-1",
  "options": [
    {
      "id": "opt-1",
      "label": "Custom topic",
      "summary": "Dedicated YAML topic with explicit flow control",
      "pros": ["Deterministic behavior", "Explicit error handling", "Structured data collection"],
      "cons": ["Higher build effort", "Maintenance overhead", "Less flexible to prompt changes"],
      "effort": "Medium-High",
      "confidence": "high",
      "briefPatch": { "conversations": { "topics": [{ "name": "{topic}", "topicType": "custom" }] } }
    },
    {
      "id": "opt-2",
      "label": "Generative orchestration",
      "summary": "Handled by AI orchestrator with instructions + knowledge",
      "pros": ["Zero build effort", "Flexible", "Easy to iterate"],
      "cons": ["Less predictable", "May not reliably follow multi-step flows", "Harder to enforce exact formatting"],
      "effort": "Low",
      "confidence": "medium",
      "briefPatch": { "conversations": { "topics": [{ "name": "{topic}", "topicType": "generative" }] } }
    }
  ]
}
```

Write classifications to `conversations.topics[].topicType` before dispatching teammates.

### Auto-Include: Greeting System Topic

After classifying custom topics, always add a **Conversation Start (Greeting)** system topic when the agent has 2+ distinct capabilities and the channel supports adaptive cards (Teams, Web Chat). This is a standard pattern (per learning #bm-024):

- **topicType:** `"system"` (override of default Conversation Start)
- **triggerType:** `"system"`
- **Design:** Welcome text + adaptive card with `Action.Submit` buttons for key capabilities
- **Button data must match `conversationStarters` text** for consistent cross-channel UX
- **Channel behavior (per learning #tt-002):** On M365 Copilot, this topic fires passively after user initiates — the welcome page shows `conversationStarters` instead. So configure both: adaptive card in the Greeting topic (for Teams/Web Chat) AND `conversationStarters` at the agent level (for M365 Copilot).
- **Card version:** 1.5 for cross-channel safety
- Use `knowledge/patterns/topic-patterns/welcome-card.yaml` as the YAML template

**Skip** the Greeting topic only if: (1) agent is purely generative with no distinct capabilities, or (2) agent has only 1 capability, or (3) all channels are text-only (no adaptive card support).

### implementationType Hybrid Rule

When classifying `implementationType` for capabilities, apply the topic+flow hybrid rule (per learning #ar-003): if a capability has a topic entry in `conversations.topics` that calls a flow internally (e.g., InvokeFlowTaskAction for email send), classify as `"topic"` not `"flow"`. Use `"flow"` only for headless Power Automate capabilities with no conversational UI.

## The Generic-Instructions / Explicit-Topics Balance

Since instructions are now generic (no hardcoded URLs, no tool listing, no naming knowledge sources per MS best practices), routing comes from elsewhere. The orchestrator's routing priority is: **description > name > parameters > instructions**. This means:

- Every capability in `brief.json.capabilities[]` should map to either a well-described knowledge source or a custom topic with a strong description
- Capabilities requiring specific behavior (multi-step workflows, structured data collection, hard boundaries) -> use custom topics, not generative orchestration alone
- Capabilities handled by knowledge Q&A -> generative orchestration is fine, but the knowledge source description needs to be specific enough for routing
- Topic descriptions are the #1 routing signal -- every custom topic's `description` field should clearly state when to use it and when not to use it

## Step 2: Parallel Teammate Dispatch

Spawn all teammates simultaneously. They do not depend on each other's output.

### Prompt Engineer -- write agent instructions

- Input: full brief.json (Phases A+B complete), `knowledge/cache/instructions-authoring.md`, model selection from Step 1.5
- Output: instruction text (up to 8,000 chars, self-verified per PE checklist)
- Runs independently -- does not need QA or TE output

PE follows the universal instruction template and model-aware rules:
- 7 universal style rules: (1) Functional role in first line, no superlatives. (2) WHY on every constraint in parentheses. (3) Tiered length with floor + ceiling per question type. (4) Plain emphasis -- bold or "Never X", no aggressive caps. (5) No personality padding. (6) 2-3 varied examples -- happy path + boundary + complex. (7) Flat lists only.
- Three-part structure: Constraints (what to do/not do) -> Response Format (how to present) -> Guidance (how to find answers)
- State the audience in the Role section (e.g., "for CDW coworkers", "for IT support engineers")
- No hardcoded URLs -- describe knowledge capabilities generically; let knowledge citations provide links
- No listing all tools/knowledge -- orchestrator already knows them. Only `/ToolName` for disambiguation
- Include follow-up guidance -- "End every response with a relevant follow-up question or next step"
- Include 2-3 examples for complex behaviors (boundary enforcement, multi-step workflows)
- Address all capabilities where `phase == "mvp"` -- every MVP capability should have corresponding instruction coverage
- Do not write dedicated sections for capabilities where `phase == "future"` unless `implementationType` is `"prompt"` (re-tag as MVP since it's zero-cost prompt guidance)
- Model-specific scan: If `recommendedModel` is set, PE runs the model-specific checks from the Model Family Tuning Guide
- PE runs their own review checklist before returning (char count, anti-pattern check, reference validity, audience, follow-ups, model awareness checks)

### QA Challenger -- generate eval sets (3 default + custom)

- Input: full brief.json (capabilities, boundaries, integrations, **pre-existing evalSets from preview stubs**), eval-scenarios library, topic-triggers + eval-testing learnings
- Output: 3 eval sets (boundaries/quality/edge-cases) with 40-55 tests, coverage report
- Does not review instructions (Lead handles that inline in Step 3)
- Does not classify topics (Lead already did in Step 1.5)

#### Pre-Existing Eval Stubs (from Fast Preview)

When `evalSets` already contain tests from the fast preview, QA must respect the customer's confirmed golden sets:

| Test Source | Action During Deep Research |
|---|---|
| `"user-edited"` | **Immutable.** Never modify. Customer explicitly edited this test. |
| `"user-added"` | **Immutable.** Customer added this test manually. |
| `"preview-stub"` (unmodified) | **Enrichable.** May upgrade `expected` with research-specific detail. Set `source: "research-enriched"`. |
| (new test) | **Append.** Set `source: "research-generated"`. |

**Merge rules:**
- Dedup by intent: >70% keyword overlap between a new test and an existing test = same test. Keep existing, discard new.
- Cap at 40-55 total tests (including stubs).
- Never delete customer tests (`user-edited`, `user-added`).
- When no stubs exist (legacy briefs or first run without `--fast`), generate all tests from scratch (backward compatible — current behavior).

**Eval set generation -- scenario-driven:** QA reads `knowledge/frameworks/eval-scenarios/index.json` and uses the Scenario-Driven Eval Generation protocol (defined in qa-challenger.md).

| Set | What QA Generates | Source Material | Target Count |
|-----|-------------------|----------------|-------------|
| **boundaries** (100% pass) | Boundary decline/refuse + PII protection + prompt injection + scope boundary + adversarial + disclaimers + compliance language | `boundaries.*`, `agent.persona`, CAP-SB + CAP-CV scenarios | 8-12 |
| **quality** (85% pass) | Per-capability happy paths + grounding accuracy + routing + tool invoke + parameter extraction + error handling + disambiguation | `capabilities[]` (mvp), `knowledge.*`, `integrations[]` (mvp), BP-* + CAP-* scenarios | 15-25 |
| **edge-cases** (80% pass) | Edge cases + graceful failure + tone/empathy + cross-capability + end-to-end + regression | Cross-capability, CAP-TQ + CAP-GF + CAP-RT scenarios | 10-18 |

Total target: 40-55 tests across all sets. Safety set should have at least 1 test per boundary refuse/decline, plus PII, prompt injection, and any domain-specific compliance tests.

Each test MUST use the EvalTest schema from `templates/brief.json` (lines 239-253):
```json
{ "question": "...", "expected": "...", "capability": "...", "methods": [...], "scenarioId": "...", "scenarioCategory": null, "coverageTag": null, "turns": null, "expectedTools": null, "toolThreshold": null, "lastResult": null }
```
**Field names are strict:** `question` (NOT `input`), `expected` (NOT `expectedOutput`), `methods` (array, NOT `method` object), `scenarioId` (NOT `scenario`), `lastResult: null` (REQUIRED). Wrong field names cause the dashboard to display empty strings.

Methods are preset per set (defaults from schema), with per-test overrides where scenarios recommend different methods:
- Boundaries: `General quality` + `Keyword match (all)`
- Quality: `General quality` + `Compare meaning (70)` + `Keyword match (any)`
- Edge-cases: `General quality` + `Compare meaning (60)`

After eval generation, QA reports coverage distribution (core-business/variations/architecture/edge-cases percentages) and flags gaps against the scenario library's recommended categories.

### Flow Designer -- write flow specification (only if solutionType is "flow" or "hybrid")

- Input: brief.json (capabilities where `implementationType == "flow"`), integrations, architecture
- Output: `flow-spec.md` with triggers, actions, connectors, data flow, flow-manager.js commands
- Skip if `architecture.solutionType` is "agent" or not set

### Topic Engineer -- topic feasibility validation (only if custom topics exist)

- Input: brief.json topics (classified by Lead in Step 1.5), capabilities, integrations, `knowledge/cache/adaptive-cards.md` + `knowledge/cache/conversation-design.md`
- Output: per-topic feasibility assessment (OK / SPLIT / caveats)
- Skip if no custom topics (all generative)

TE reviews each proposed custom topic and produces a per-topic feasibility assessment:

| Check | What TE Validates |
|-------|------------------|
| **Complexity** | Can this be a single topic, or needs splitting? (Rule of thumb: >8 nodes or >3 branch levels -> split) |
| **Node types** | Are the required node types available? (e.g., HttpRequest for API calls, InvokeConnectorAction for connectors) |
| **Card feasibility** | If topic needs adaptive cards -- will they work on target channels? Size < 28KB? No Action.Execute? |
| **Variable flow** | Do inputs chain to outputs correctly? Any circular dependencies? |
| **Trigger viability** | Is the trigger type appropriate? "By agent" description specific enough for AI routing? |
| **Description quality** | Is the topic description specific enough for routing? Does it say when to use and when not to use? (Descriptions are routing priority #1) |

## Step 3: Lead Reconciliation

After all teammates return (or as each finishes):

**3a. Apply PE instructions + inline review:**
- Write instructions to brief.json
- Lead does inline instruction review (no separate QA spawn):
  1. Three-part structure present? (Constraints + Response Format + Guidance)
  2. No hardcoded URLs?
  3. No tool/knowledge listing?
  4. References match `integrations[]`?
  5. Boundaries match `boundaries.*`?
  6. Audience stated in Role section?
  7. Follow-up guidance included?
  8. Length < 8,000 chars?
  9. Capability-instruction alignment: Every MVP capability addressed? No future capability dedicated sections (unless `implementationType == "prompt"`)?
- If issues found: fix inline (minor) or re-spawn PE with specific fixes (rare)

**3b. Apply QA eval sets:**
- Write evalSets[] to brief.json
- Write evalConfig -- `{ targetPassRate: 70, maxIterationsPerCapability: 3, maxRegressionRounds: 2 }`
- Review coverage report -- flag gaps

**3c. Apply TE recommendations:**
- **OK** topics -> no change to brief
- **SPLIT** recommendations -> update `conversations.topics[]` to reflect the split (add sub-topics, mark original as parent)
- **Caveats** -> add to `conversations.topics[].notes` field

**3d. Generate per-set CSVs:**

Generate per-set CSVs in `Build-Guides/{projectId}/agents/{agentId}/` for MCS native eval compatibility:

```
evals-boundaries.csv
evals-quality.csv
evals-edge-cases.csv
```

CSV format (MCS test set import):
```csv
Question,Expected response,Testing method
```

Generation rules:
- One CSV per eval set (each uploads as a separate MCS test set)
- `Testing method` = first method from the test's resolved methods (display name: "Compare meaning", "Keyword match", etc.)
- Max 100 questions per CSV (MCS limit). If a set has > 100 tests, split into multiple CSVs.
- `Tool use` cannot be specified in CSV -- add via MCS UI after import

**3e. Write to brief.json:**

Write all build-ready data:
- `instructions` -- full system prompt text (up to 8000 chars)
- `evalSets[]` -- all 3 sets with their tests, methods, thresholds
- `evalConfig` -- target pass rates and iteration limits
- `conversations.topics[]` -- topic classifications and feasibility notes
- `mvp.now` -- what to build this sprint
- `mvp.later` -- what's deferred and why
- `integrations[].status` -- availability status per tool
- `integrations[].notes` -- auth details, config notes
- `knowledge[].scope` -- scoping/filtering details
- `knowledge[].status` -- readiness status
- `notes` -- any additional context discovered during research

## Step 3.5: GPT Parallel Review

After teammate reconciliation and before final output, fire GPT-5.4 reviews in parallel:

```bash
node tools/multi-model-review.js review-brief --brief <path-to-brief.json>
node tools/multi-model-review.js review-instructions --brief <path-to-brief.json>
# If solution type is hybrid/flow:
node tools/multi-model-review.js review-flow --file <path-to-flow-spec.md> --brief <path-to-brief.json>
# Component review (catches Microsoft-native alternatives, preview risks):
node tools/multi-model-review.js review-components --brief <path-to-brief.json>
```

What GPT reviews:
- `review-brief` -- completeness, MVP phase alignment, blocking open questions, integration gaps
- `review-instructions` -- anti-patterns, boundary coverage, capability-instruction alignment, ambiguity
- `review-components` -- Microsoft-first priority violations, MCP opportunities, preview risks, redundant tools
- `review-flow` (hybrid/flow only) -- trigger correctness, action ordering, error handling, execution limits

Merge protocol:
- Union of findings -- if either model flags something, investigate
- Stricter wins on conflicts
- Flag divergence when opinions differ significantly
- If GPT fails (exit code 3), proceed without it

**Truncation artifacts:** GPT receives a condensed brief payload. Dismiss findings about "missing" instructions, eval tests, or boundaries shown as `[object Object]` -- these are serialization artifacts, not real gaps.

Apply fixes for actionable items (instruction ambiguity, phase misalignment, missing boundary paths) before writing final output. Note fixes in the terminal summary.
