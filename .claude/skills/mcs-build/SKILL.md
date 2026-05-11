---
name: mcs-build
description: "Build agent(s) in Copilot Studio using the hybrid build stack with eval-driven iteration. Bootstrap → critical gate → per-capability iteration → regression. Reads brief.json for architecture mode (single/multi-agent)."
---

# MCS Agent Builder — Unified Hybrid Build Stack

Build agents in Microsoft Copilot Studio using the optimized hybrid approach: PAC CLI for lifecycle, Dataverse API for configuration, Code Editor YAML for topics, and Playwright only where no API exists.

This skill handles all build modes:
- **Single Agent** — standalone build
- **Multi-Agent** — builds specialists first, then orchestrator with child connections

## BUILD DISCIPLINE — VERIFY-THEN-MARK (MANDATORY)

**These rules override all other behavior. Never skip them.**

1. **Atomic tasks**: Every build step is a SEPARATE task. "Generate file" and "upload file" and "run eval" are THREE tasks, not one.
2. **Verify after every action**: After each change, snapshot or read-back to confirm it worked.
3. **Never mark a task complete until verified**: If you can't verify, say "I did X but couldn't verify Y".
4. **File generation ≠ deployment**: Writing a local file is NOT the same as uploading it to MCS.
5. **Environment check**: Before PAC CLI ops, verify the agent's environment matches PAC CLI's active profile.
6. **End-of-build reconciliation**: After ALL changes, walk the brief's component list and snapshot-verify each item.

## Input

```
/mcs-build {projectId} {agentId}
```

Reads from:
- `Build-Guides/{projectId}/agents/{agentId}/brief.json` — THE single source of truth (architecture, tools, instructions, model, topics, everything)

Writes to:
- `Build-Guides/{projectId}/agents/{agentId}/brief.json` — updates `buildStatus` field
- `Build-Guides/{projectId}/agents/{agentId}/build-report.md` — customer-shareable summary

## Smart Build Account & Environment Gate

Every build targets a specific tenant and environment. This gate reads persisted context first and only asks the user when no prior build context exists.

### Flow

1. **Read brief.json** → check `buildStatus.account`, `buildStatus.environment`, `buildStatus.accountId`
2. **If all three exist** (previous build ran):
   - Look up account in `tools/session-config.json` by `accountId` to get `pacProfileIndex`
   - Set PAC CLI profile: `pac auth select --index {pacProfileIndex}`
   - Output a one-line confirmation and proceed:
     ```
     Resuming build on {account} / {environment} (PAC CLI profile {index}).
     ```
   - **No question asked.** If the user wants to change target, they can say so.
3. **If missing** (first build for this agent):
   a. Read `tools/session-config.json`
   b. Check `sessionDefaults.lastAccount` and `sessionDefaults.lastEnvironment`
   c. **If sessionDefaults has values** → pre-fill and confirm with ONE yes/no question:
      - `AskUserQuestion`: "Build on {lastAccount} / {lastEnvironment}?" — options: "Yes (Recommended)" / "Choose different account"
      - If "Yes" → use sessionDefaults, skip picker
      - If "Choose different" → full picker (step d)
   d. **If sessionDefaults empty** (truly first time) → use `AskUserQuestion`:
      - Q1: "Which account should we build under?" — options from session-config accounts
      - Q2: "Which environment?" — options from the selected account's environments
   e. Set PAC CLI profile: `pac auth select --index {pacProfileIndex}`
   f. **Persist the selection** to BOTH locations:
      - `brief.json.buildStatus` → set `account`, `environment`, `accountId`
      - `session-config.json.sessionDefaults` → set `lastAccount`, `lastEnvironment`, `lastUpdated`
   g. Output one-line confirmation:
     ```
     Build target: {account} / {environment} (PAC CLI profile {index}).
     ```

### Rules

- If the user says "switch to [account/env]" at any point, re-run the picker and update both persistence locations
- If an account has no environments listed, ask the user to provide the environment name manually
- Silent browser verification (later in the build) compares the browser's account/env against this gate's selection

---

## MVP Phase Filtering

**Only build items tagged `phase: "mvp"`. Skip items tagged `phase: "future"`.**

At the start of the build, scan the brief and compute the build scope:

1. **`capabilities[]`** — filter to `phase: "mvp"` only. Future capabilities are noted but not built.
2. **`integrations[]`** — only configure tools/connectors where `phase: "mvp"`. Future integrations are skipped in Step 3.
3. **`knowledge[]`** — only upload knowledge sources where `phase: "mvp"`. Future sources are skipped in Step 2.
4. **`conversations.topics[]`** — only author topics where `phase: "mvp"`. Future topics are skipped in Step 4.

Output a scope summary before proceeding:
```
## Build Scope (MVP filter)
- Capabilities: {N} MVP, {M} deferred
- Integrations: {N} MVP, {M} deferred
- Knowledge: {N} MVP, {M} deferred
- Topics: {N} MVP, {M} deferred
```

If ALL items of a type are `future` (e.g., zero MVP knowledge sources), skip that entire build step and note it.

**Deferred items** are listed in the build report (Section 9: "What Changed from Plan") so the customer knows what's coming next.

---

## Before Building — Knowledge Cache + Learnings Check

1. Read `knowledge/cache/api-capabilities.md` — check `last_verified` date
2. If stale (> 7 days), refresh: WebSearch + MS Learn for "Copilot Studio API"
3. Check if any Playwright-only operations now have API alternatives
4. Read `knowledge/patterns/dataverse-patterns.md` for API call patterns
5. Read `knowledge/learnings/build-methods.md` — check for agent creation precedents, known build gotchas
6. Update cache files if new findings

## Route: Determine Build Mode

Read `brief.json` → `architecture.type`:

| Value | Build Path |
|-------|-----------|
| `Single Agent` | → **Standalone Build** (below) |
| `Multi-Agent` | → **Multi-Agent Build** (below) |
| `Connected Agent` | → **Standalone Build** + external connection notes |

---

## On-Demand Teammates During Build

In addition to Topic Engineer (YAML authoring, Step 4) and QA Challenger (review, Step 4), two teammates are available on-demand when issues arise during build. They are NOT spawned at build start — only when specific conditions trigger them. This keeps simple builds fast while making complex builds resilient.

### Research Analyst — When Tool Configuration Fails

**Trigger conditions (Step 2 or Step 3):**
- Connector/MCP server not found by expected name in MCS UI
- Auth mode in MCS differs from what brief.json specifies
- Tool behavior doesn't match documentation (unexpected parameters, missing actions)
- Any error during Playwright tool configuration that the lead can't resolve in 1 attempt

**What RA does:**
- WebSearch for "[connector name] Copilot Studio" + current year
- MS Learn MCP for official connector docs
- Check if connector was renamed, deprecated, or moved to preview
- Report back: correct name, auth requirements, alternative approaches

**After RA reports:**
- Lead applies the fix (correct connector name, different auth mode, etc.)
- Update `brief.json.integrations[].notes` with the finding
- Update `knowledge/cache/connectors.md` if the discovery is broadly useful
- RA is dismissed (not kept alive for the whole build)

### Prompt Engineer — When Instructions Need Adjustment

**Trigger conditions (Step 2, after tools are configured):**
- Tool names in MCS differ from brief.json (e.g., brief says "Jira" but MCS connector is "Atlassian Jira Cloud (Preview)")
- A planned tool couldn't be added (not available, auth failed) → instructions reference non-existent tool
- Connector actions have different parameter names than expected → instructions reference wrong action names
- Instructions exceed 8000 chars after adding tool-specific guidance

**What PE does:**
- Read current instructions from brief.json
- Read actual tool configuration (names, action names) from the build session
- Produce revised instructions with corrected tool references
- Self-verify: char count < 8000, all referenced tools exist, boundaries intact

**After PE reports:**
- QA Challenger does a quick consistency check (existing QA teammate, already active in Step 4)
- Lead applies revised instructions via Dataverse API
- Update `brief.json.instructions` with the revised version
- PE is dismissed (not kept alive for the whole build)

---

## Standalone Build (Single Agent)

### Step 0: Resume Detection & Environment Verification

**Resume check (runs before anything else):**

1. Read `brief.json.buildStatus.completedSteps` (array)
2. If the array has entries, this is a resumed build. Log which steps will be skipped:
   ```
   Resuming build — completed steps: [created, instructions, knowledge]
   Skipping to: tools configuration (Step 3)
   ```
3. Use this mapping to decide what to skip:
   - `"created"` in list → skip Step 1 (find-or-create agent)
   - `"instructions"` in list → skip instruction paste in Step 2
   - `"knowledge"` in list → skip knowledge upload in Step 2
   - `"tools"` in list → skip tool configuration in Step 3
   - `"model"` in list → skip model selection in Step 3
   - `"topics"` in list → skip Step 4 (topic authoring)
   - **Always re-run Step 5 (publish)** — it's cheap and ensures latest state is published

**Environment verification:**

1. Check brief.json for environment info
2. Run `pac auth list` to see PAC CLI target
3. If environments don't match: plan browser-based operations
4. Log verified environment

### Step 1: Find or Create Agent

**Check for existing agent before creating.** This prevents duplicate agents on build resume or session restart.

#### 1a. Check brief.json for existing agent ID

Read `brief.json.buildStatus.mcsAgentId`:

- **If set** → verify it still exists:
  ```powershell
  pac copilot list
  ```
  - If agent ID or name found in output → skip creation, log: "Resuming work on existing agent {name} ({id})"
  - If NOT found (agent was deleted?) → clear `mcsAgentId` from buildStatus, proceed to 1b

#### 1b. Check PAC CLI for matching agent name

If no `mcsAgentId`, search for an agent with the same `displayName` from brief.json:
```powershell
pac copilot list
```
- If a matching name is found → store its ID in `brief.json.buildStatus.mcsAgentId`, skip creation
- If NOT found → proceed to 1c

#### 1c. Create new agent (Playwright — silent browser verification required)

PAC CLI `create` requires an undocumented template YAML that only captures ~30% of config (topics/instructions — not tools, knowledge, or model). Since Playwright is already required for tools + model, using it for creation eliminates the template dependency.

1. **Run silent browser verification** (see CLAUDE.md "MCS Browser Preflight — Silent Verification")
2. Navigate to MCS home → **Create** → **New agent** → **Skip to configure**
3. Set **Name** and **Description** from brief.json
4. Set icon if specified in brief.json
5. Click **Create**

After creation, capture bot ID:
```powershell
pac copilot list
```

**Fallback:** If browser is unavailable, use `pac copilot create --displayName "Name" --schemaName "cr_name" --solution "DefaultSolution" --templateFileName template.yaml` (requires extracting a template from an existing agent first).

#### 1d. Persist immediately

Write `mcsAgentId` to `brief.json.buildStatus` right after creation or detection — do NOT defer to Step 6. Also add `"created"` to `completedSteps`.

**VERIFY:** Agent exists in `pac copilot list` output and `brief.json.buildStatus.mcsAgentId` is set.

### Step 2: Configure Instructions & Knowledge (Dataverse API — no browser)

**Skip check:** If `"instructions"` is in `completedSteps`, skip the instructions sub-step. If `"knowledge"` is in `completedSteps`, skip the knowledge sub-step. If both are completed, skip this entire step.

**Instructions:** Update via Dataverse API (see `knowledge/patterns/dataverse-patterns.md` § 3).
**Fallback:** Playwright → Edit Instructions → paste → Save
**Checkpoint:** After verified, add `"instructions"` to `brief.json.buildStatus.completedSteps` and set `lastCompletedStep` to `"instructions"`.

**Knowledge:** Upload via Dataverse API (see `knowledge/patterns/dataverse-patterns.md` § 4).
**Phase filter:** Only upload `knowledge[]` entries where `phase == "mvp"`. Log skipped future sources.
**Fallback:** Playwright → Knowledge tab → Add knowledge
**Checkpoint:** After verified, add `"knowledge"` to `brief.json.buildStatus.completedSteps` and set `lastCompletedStep` to `"knowledge"`.

**Initial Publish:**
```powershell
pac copilot publish --bot <bot-id>
```

**VERIFY:** Snapshot Overview → instructions text matches spec, knowledge sources listed.

**On-demand PE trigger:** After Step 3 configures tools, if tool names in MCS differ from brief.json, spawn Prompt Engineer to adjust instructions (see "On-Demand Teammates" section above). Re-apply instructions via Dataverse API after PE revises them.

### Before Step 3: Consult Connector & Integration Learnings

Read `knowledge/learnings/connectors.md` and `knowledge/learnings/integrations.md` (if non-empty) before configuring tools. Look for:
- Connector name mismatches (brief says "Jira" but MCS calls it "Atlassian Jira Cloud (Preview)")
- Auth mode gotchas (e.g., OAuth requires admin consent first)
- Known workarounds for specific connectors

### Step 3: Configure Tools & Model (Playwright — browser required)

**Skip check:** If `"tools"` is in `completedSteps`, skip tool configuration. If `"model"` is in `completedSteps`, skip model selection. If both are completed, skip this entire step.

**Silent browser verification FIRST (MANDATORY) — unless entire step is skipped.**

1. `browser_navigate` to `https://copilotstudio.microsoft.com`
2. `browser_snapshot` — wait for load
3. Compare snapshot account/environment against the build gate selection from earlier in this build
4. **If match** → log `Browser verified: {account} / {environment}` and proceed
5. **If mismatch** → alert user: `Browser shows {X} but build targets {Y}. Switch?` — WAIT for user

Then configure:
- **Model**: Always select the latest available model. In the MCS model combobox, pick the newest option (typically the top preview model). Do not read architecture.model from brief.json.
  **Checkpoint:** After model verified, add `"model"` to `completedSteps`, set `lastCompletedStep` to `"model"`.
- **Phase filter:** Only configure `integrations[]` entries where `phase == "mvp"`. Log skipped future integrations.
- **MCP servers**: Tools → Add tool → Model Context Protocol → search → add
- **Connectors**: Tools → Add tool → search connector → select action → create connection
- **Computer Use**: Tools → Add tool → Computer use → configure
- **Security**: Settings → "Allow other agents to connect" (if specialist)
  **Checkpoint:** After all MVP tools verified, add `"tools"` to `completedSteps`, set `lastCompletedStep` to `"tools"`.

**On-demand RA trigger:** If a connector/MCP server is not found by expected name, or auth mode differs from spec, spawn Research Analyst to investigate (see "On-Demand Teammates" section above). Apply RA's findings before continuing.

**VERIFY:** Snapshot Tools tab → all tools listed. Snapshot Overview → model correct.

**Error handling:** If a step fails, write the error to `brief.json.buildStatus.lastError` before stopping. On the next resume, `lastError` tells the lead what went wrong.

### Before Step 4: Consult Topic & Trigger Learnings

Read `knowledge/learnings/topics-triggers.md` (if non-empty) before authoring topics. Look for:
- YAML patterns that improved routing (trigger phrase strategies)
- Adaptive card gotchas (channel-specific rendering limits)
- Node type availability issues discovered in prior builds

### Step 4: Author Topics (Code Editor YAML — minimal browser)

**Skip check:** If `"topics"` is in `completedSteps`, skip this entire step.

Use **Topic Engineer** teammate to generate validated YAML.

**Phase filter:** Only author `conversations.topics[]` entries where `phase == "mvp"`. Log skipped future topics.

For each MVP topic in the spec:
1. Topic Engineer queries constraints: `python tools/gen-constraints.py <NodeTypes>` → gets required fields
2. Topic Engineer generates YAML using constraints + `knowledge/patterns/topic-patterns/`
3. Structural validation: `tools/om-cli/om-cli.exe validate -f <file.yaml>` → must pass
4. Semantic validation: `python tools/semantic-gates.py <file.yaml> --brief <brief.json>` → must pass (or warnings acknowledged)
5. QA Challenger reviews validated YAML
6. In MCS: Topics → "Add a topic" → "From blank"
7. Click "..." → "Open code editor"
8. Paste generated YAML → Save

**Checkpoint:** After all topics verified, add `"topics"` to `completedSteps`, set `lastCompletedStep` to `"topics"`.

### Step 4.5: Eval-Driven Iteration Loop (NEW — runs after initial setup)

**This is the core of the eval-driven build.** After the agent is configured (Steps 1-4), run eval sets iteratively to verify the build works.

#### Phase 1: Initial Publish + Critical Gate

1. **Publish** (PAC CLI):
   ```powershell
   pac copilot publish --bot <bot-id>
   ```
2. **Run critical eval set** via Direct Line API (same method as `/mcs-eval` Tier 1/2):
   - Read `brief.json.evalSets[]`, find set where `name == "critical"`
   - Run all tests in the critical set
   - Write results to each test's `lastResult`

3. **Evaluate critical gate:**
   - If ALL critical tests pass → proceed to Phase 2
   - If ANY critical test fails:
     - Classify failure (instruction gap or boundary violation)
     - Fix instructions via Dataverse API (PE if needed)
     - Re-publish, re-run critical set
     - **Max 3 attempts.** If still failing after 3 → **HARD STOP**: "Critical gate failed after 3 attempts. Safety/boundary issues must be resolved manually."
     - Update `capabilities[].status` accordingly

#### Phase 2: Per-Capability Iteration

For each MVP capability (in priority order from `capabilities[]` where `phase == "mvp"`):

1. **Gather this capability's tests** from across eval sets:
   - Functional set: tests where `capability == this.name`
   - Integration set: tests where `capability == this.name`
   - Conversational set: tests where `capability == this.name`

2. **Run capability's tests** (filtered from the sets above)

3. **Evaluate results:**
   - If all tests pass → mark `capability.status = "passing"`, move to next capability
   - If tests fail:
     - Classify failures (instruction gap, routing, tool issue, knowledge gap)
     - Apply targeted fix (PE for instructions, TE for topics — same as `/mcs-fix` Step 3)
     - Re-publish, re-run capability's tests
     - **Max 3 iterations per capability.** If still failing → mark `capability.status = "failing"`, move on
   - Update `capabilities[].status` = `"building"` while iterating

4. **Always run critical set** between capabilities as a regression check (should still pass)

#### Phase 3: Regression & Finalize

1. **Final publish** (PAC CLI)
2. **Run regression eval set** (full suite, cross-capability)
3. **Run critical set again** (regression check)
4. **Compute overall pass rates** per set
5. If regression < threshold → targeted fix on worst areas (**max 2 rounds**)
6. Update all `capabilities[].status` based on final results

**Iteration limits (from `evalConfig`):**
- Critical gate: max 3 attempts, then HARD STOP
- Per-capability: max `evalConfig.maxIterationsPerCapability` (default 3)
- Regression: max `evalConfig.maxRegressionRounds` (default 2)
- Overall target: `evalConfig.targetPassRate` (default 70%)

**When to skip iteration loop:**
- If `brief.json.evalSets` is empty or has no tests → skip to Step 5 (publish only, no iteration)
- If `--skip-eval` flag provided → skip to Step 5

### Step 5: Publish (PAC CLI — no browser)

**Always runs** — even on resume. Publishing is cheap and ensures the latest state is live.

```powershell
pac copilot publish --bot <bot-id>
pac copilot status --bot-id <bot-id>
```

**If environments don't match:** Publish via browser Publish button.

**Checkpoint:** After verified, add `"published"` to `completedSteps`, set `lastCompletedStep` to `"published"`. Clear `lastError`.

**VERIFY:** Snapshot Overview → "Published [today]" visible.

### Step 5.5: QA Build Validation Gate (Agent Teams)

**After publish and reconciliation snapshot collection, spawn QA Challenger for formal validation.**

The lead collects snapshot data during reconciliation (overview, tools tab, knowledge, topics, triggers — this already happens). Instead of the lead both collecting AND judging, now:
- **Lead collects** snapshots (existing behavior)
- **QA Challenger analyzes** the data (this step)
- **Lead reports** QA's findings and acts on the verdict

#### Pre-QA: Automated Drift Detection

Before spawning QA, run automated drift detection on all built topics:
```bash
python tools/drift-detect.py Build-Guides/{projectId}/agents/{agentId}/brief.json --validate
```
This catches missing/extra topics, trigger mismatches, and variable drift automatically. Include the drift report in QA's input data.

#### QA Challenger Receives

1. The full `brief.json` (spec — what SHOULD be configured)
2. The reconciliation snapshot summaries (what IS configured — collected by the lead)
3. The drift detection report (from `drift-detect.py` above)
4. The list of deferred `phase: "future"` items (so QA doesn't flag them as missing)

#### Check 1: Brief-vs-Actual Comparison

Walk each MVP-scoped section and compare spec to actual:

| Brief Section | What QA Checks |
|---------------|---------------|
| `agent.name` / `agent.description` | Match overview heading |
| `instructions` | Text matches (or char-count delta if large) |
| `integrations[]` (MVP) | Each tool name appears in Tools tab snapshot |
| `knowledge[]` (MVP) | Each source appears in Knowledge section |
| `conversations.topics[]` (MVP) | Each topic name appears in Topics list |
| `architecture.triggers[]` | Trigger types configured |
| `boundaries.refuse[]` | Hard boundaries present in instructions text |

#### Check 2: Cross-Reference Validation

These catch issues that simple reconciliation misses:

| Cross-Reference | What Could Be Wrong |
|----------------|-------------------|
| Instructions → Tools | Instructions mention a tool name that wasn't configured |
| Instructions → Topics | Instructions reference a `/TopicName` that doesn't exist |
| Topics → Variables | Topic YAML uses a variable that's never prompted for |
| Topics → Integrations | Topic calls a connector action that wasn't added |
| Adaptive Cards → Channels | Card uses features unsupported on target channel |
| (Multi-agent) Routing rules → Children | Instructions route to a child agent that isn't connected |

#### Check 3: Deviation Impact Assessment

For each deviation found during the build (Section 9 material), QA assesses:
- **Severity**: Critical (blocks core use case) / High (degrades quality) / Medium (cosmetic or edge case)
- **Can ship?**: Yes / Yes with caveat / No — blocks deployment
- **Suggested fix**: What to do about it (manual step, config change, defer to next iteration)

#### QA Output

QA writes results to `Build-Guides/{projectId}/agents/{agentId}/qa-validation.md`:

```markdown
# QA Build Validation: [Agent Name]

## Brief-vs-Actual: {N}/{M} items match
| Item | Brief Says | Agent Has | Status |
|------|-----------|-----------|--------|
| ... | ... | ... | Match / Mismatch / Missing |

## Cross-References: {N} issues found
| Issue | Severity | Detail |
|-------|----------|--------|
| ... | Critical/High/Medium | ... |

## Deviations: {N} with impact assessment
| Deviation | Severity | Can Ship? | Suggested Fix |
|-----------|----------|-----------|---------------|
| ... | ... | ... | ... |

## QA Verdict: PASS / PASS WITH CAVEATS / FAIL
[1-2 sentence summary]
```

#### How the Lead Uses the Verdict

1. **PASS** → proceed to build report
2. **PASS WITH CAVEATS** → log caveats in build report Section 9, proceed
3. **FAIL** → stop, report critical issues to user, do NOT write `"published"` to buildStatus

#### Terminal Output Update

The reconciliation line changes from:
```
Reconciliation: N/N MVP items verified
```
to:
```
QA Validation: PASS (N/N items match, 0 cross-ref issues)
```
or:
```
QA Validation: PASS WITH CAVEATS (N/N items match, 2 cross-ref issues — see qa-validation.md)
```

### Step 6: Finalize brief.json buildStatus

Write the complete buildStatus. Most fields were already written incrementally during checkpoints — this step ensures the final state is clean:

```json
{
  "buildStatus": {
    "status": "published",
    "lastBuild": "2026-02-18T...",
    "mcsAgentId": "<bot-id>",
    "environment": "<env-name>",
    "account": "<account-label>",
    "accountId": "<session-config-account-id>",
    "publishedAt": "2026-02-18T...",
    "completedSteps": ["created", "instructions", "knowledge", "tools", "model", "topics", "critical-gate", "capability-iteration", "regression", "published"],
    "lastCompletedStep": "published",
    "lastError": null
  }
}
```

---

## Multi-Agent Build

### Build Order

**Specialists first, then orchestrator:**

1. For each specialist agent defined in the spec:
   a. Create agent via Playwright (silent browser verification required)
   b. Set instructions (Dataverse API) — specialist-focused, with scope limits
   c. Add knowledge (Dataverse API)
   d. Add tools/model (Playwright) — reuse session from creation
   e. Enable "Allow other agents to connect" (Playwright → Settings → Security)
   f. Author topics (Code Editor YAML)
   g. Publish (PAC CLI)
   h. **VERIFY:** All items above confirmed

2. Build orchestrator:
   a. Create orchestrator via Playwright (silent browser verification required)
   b. Set instructions with routing rules (Dataverse API):
      ```
      ## Connected Specialists
      /[SpecialistName] - [when to use]

      ## Routing Rules
      - [Intent] → /[Specialist]
      ```
   c. Select model (Playwright)
   d. Connect child agents (Playwright → Agents tab → Add agent → search → add)
   e. Add orchestrator-level tools/knowledge if needed
   f. Author topics if needed (Code Editor YAML)
   g. Publish (PAC CLI)
   h. **VERIFY:** All specialists connected, routing rules in instructions

### Multi-Agent Verification

After building all agents:
- Each specialist: published, sharing enabled
- Orchestrator: published, all children connected
- Routing test: send test queries to verify correct specialist is invoked

---

## End-of-Build Reconciliation — Data Collection (MANDATORY)

After ALL changes, walk the brief's **MVP-scoped** component list and snapshot each item. This data feeds the QA Build Validation Gate (Step 5.5).

| Check | How to verify |
|-------|--------------|
| Agent exists with correct name | Overview heading |
| Latest model selected | Model combobox |
| Instructions match spec | Instructions text read-back |
| MVP knowledge sources configured | Knowledge section |
| MVP tools/integrations configured | Tools tab |
| MVP triggers match spec | Triggers section |
| Agent is published | "Published [today]" |
| (Multi-agent) All specialists connected | Agents tab |
| (Multi-agent) Sharing enabled on specialists | Settings snapshot |

Collect a deferred items list:
```
Deferred to future phase: {N} capabilities, {M} integrations, {K} knowledge sources, {J} topics
```

**Then spawn QA Challenger (Step 5.5)** with the snapshot data, brief.json, and deferred items list. The QA verdict replaces the old "Reconciliation: N/N" terminal output.

## Output: Build Summary Report

After reconciliation, generate **two outputs**:

1. **Terminal output** — concise build status for the user (shown inline)
2. **Build report file** — shareable document for customer review

### Terminal Output (inline)

```
## Build Complete: [Agent Name]

**Status:** Published | **Environment:** [env] | **Account:** [account]
**QA Validation:** PASS ({N}/{N} items match, {M} cross-ref issues — see qa-validation.md)
**Eval Sets:** critical {X}% | functional {X}% | integration {X}% | conversational {X}% | regression {X}%
**Capabilities:** {N} passing, {M} failing, {K} not tested
**Deferred:** {J} future items (see build report Section 9)

Report saved: Build-Guides/{projectId}/agents/{agentId}/build-report.md

**Next:** Review the build report, share with customer for approval. Run /mcs-eval for standalone re-runs.
```

### Build Report File

Write to `Build-Guides/{projectId}/agents/{agentId}/build-report.md`.

This is a **customer-shareable deliverable**. Write it in clear, professional language. No internal jargon (no "Playwright", "PAC CLI", "Dataverse API" — those are build methods, not customer concerns).

```markdown
# Build Summary: [Agent Name]

**Date:** [today]
**Environment:** [environment name]
**Status:** Published

---

## 1. Agent Overview

**Name:** [agent name]
**Purpose:** [1-2 sentence problem statement from spec]
**Target Users:** [who will use this agent]
**Channels:** [where it's deployed — Teams, web, etc.]

---

## 2. Architecture

**Type:** [Single Agent | Multi-Agent with N specialists]
**Model:** [model name] ([GA | Preview])
**Rationale:** [Why this architecture and model were chosen — 2-3 sentences]

[If multi-agent, list specialists:]
| Agent | Role | Status |
|-------|------|--------|
| [Orchestrator name] | Routes to specialists | Published |
| [Specialist 1] | [domain] | Published |
| [Specialist 2] | [domain] | Published |

---

## 3. Capabilities

### What This Agent Does
[Bullet list of key capabilities from the spec]

### What This Agent Declines
[Bullet list of out-of-scope items it redirects gracefully]

### Hard Boundaries
[Bullet list of things the agent will never do]

---

## 4. Tools & Integrations

| Tool / System | Purpose | Connection Type | Status |
|---------------|---------|----------------|--------|
| [e.g., Outlook Calendar] | Read/manage calendar events | MCP Server | Connected |
| [e.g., ServiceNow] | Query incidents and tickets | Custom Connector | Connected |
| [e.g., SharePoint] | Access project documents | MCP Server | Connected |

---

## 5. Knowledge Sources

| Source | Type | What It Covers |
|--------|------|---------------|
| [e.g., SharePoint site] | SharePoint | Project documentation |
| [e.g., Confluence space] | Graph Connector | Knowledge base articles |

---

## 6. Topics & Triggers

### Conversation Topics
| Topic | What It Handles |
|-------|----------------|
| [topic name] | [description] |

### Triggers
| Trigger | Type | When It Fires |
|---------|------|--------------|
| [e.g., Daily prioritization] | Recurrence | Every weekday at 8 AM |
| [e.g., User message] | Conversational | When user sends a message |

---

## 7. Key Behaviors (Instruction Summary)

[3-5 bullet summary of the agent's core behavioral rules — NOT the full 8000-char instructions, but the essence of how it behaves. Written so a customer can verify "yes, this is what we want."]

- [e.g., Always prioritizes by urgency, then due date, then assignment]
- [e.g., Outputs structured tables for worklists, narrative for leadership summaries]
- [e.g., Never makes up ticket IDs — only returns real data from source systems]

---

## 8. Open Questions

[Items that still need customer input. These block further optimization.]

| # | Question | Impact | Status |
|---|---------|--------|--------|
| 1 | [question] | [what it affects] | Open |
| 2 | [question] | [what it affects] | Open |

---

## 9. What Changed from Plan

[If anything was different from the original spec, note it here. If nothing changed, write "Built as specified."]

| Area | Originally Planned | Actually Built | Reason |
|------|-------------------|----------------|--------|
| [e.g., Jira connector] | Custom connector | Power Automate flow | On-prem auth incompatible |

---

## 10. Evaluation Status

[If eval-driven iteration ran during build:]
**Overall:** {X}/{Y} passed ({Z}%)

| Eval Set | Passed | Total | Rate | Target | Status |
|----------|--------|-------|------|--------|--------|
| Critical | X | Y | Z% | 100% | PASS/FAIL |
| Functional | X | Y | Z% | 70% | PASS/FAIL |
| Integration | X | Y | Z% | 80% | PASS/FAIL |
| Conversational | X | Y | Z% | 60% | PASS/FAIL |
| Regression | X | Y | Z% | 70% | PASS/FAIL |

**Per-Capability Status:**
| Capability | Status | Tests Passing |
|------------|--------|--------------|
| [name] | Passing/Failing | X/Y |

[If evals haven't run (--skip-eval used):]
**Status:** Pending — run `/mcs-eval` after customer review

---

## 11. Next Steps

1. **Review this report** — confirm capabilities, boundaries, and tool connections are correct
2. **Answer open questions** (Section 8) — these are needed for optimization
3. **Run evaluation tests** — automated tests will verify agent behavior
4. **Pilot deployment** — deploy to pilot users for real-world feedback
5. **Iterate** — incorporate feedback, re-run research if needed

---

*Generated by MCS Agent Builder — [date]*
```

### Rules for the Report

- **Customer-readable language** — no build toolchain details, no API references
- **Decisions explained** — every architecture/tool choice includes a "why"
- **Open questions prominent** — this is how the customer knows what input is needed
- **Spec-vs-actual transparent** — if anything changed during build, it's documented
- **Concise** — aim for 2-3 pages, not 10. Tables over paragraphs.
- **Save as file** — always write to `build-report.md` so it can be shared

---

## Post-Build Learnings Capture (MANDATORY — Two-Tier)

**After reconciliation and the build report, run the two-tier learnings capture.** This is how the system gets smarter over time.

### Tier 1: Auto-Capture (no user confirmation)

Run automatically after every build. Scan for:

1. **Zero-deviation builds:** If nothing deviated from the spec (build-report Section 9 is "Built as specified"), auto-bump `confirmed` count for every learnings entry whose tags overlap with this build's components (e.g., an agent using Playwright for creation confirms `bm-001`).
2. **Cache corrections:** If any cache file was updated during the build (Step 3 refreshed api-capabilities), log the correction.
3. **Confirmed approaches:** For each build step that used a known pattern from learnings, bump the entry's `confirmed` and `lastConfirmed` in `index.json`.

### Tier 2: User-Confirmed Capture (when deviations exist)

Run when the build had deviations, errors, or discoveries:

- Did something deviate from the spec? (Already captured in build-report.md Section 9)
- Did an error force a workaround? You researched the fix — that's a learning.
- Did you discover a new component or better method? That's a learning.
- Did the user override a recommendation? That's a learning.

**Before writing, run the comparison engine** (see CLAUDE.md "Learnings Protocol" § B):
1. Check `index.json` for entries with overlapping tags
2. Same scenario → BUMP (becomes Tier 1); new scenario → present to user; contradiction → FLAG both

Output a short learnings block:

```
## Learnings from this build

1. [Natural language description — e.g., "GPT-5.2 Reasoning ignores soft DECLINE boundaries. DO NOT language required."]
   **Tags:** #instructions #boundaries #gpt-5
   **File:** instructions.md
   **Action:** ADD (new entry) / BUMP bm-001 (same pattern confirmed)

Anything else to add? These will be saved to our knowledge base for future builds.
```

### Write Confirmed Learnings

After user confirms (or adds more):
- Write each learning to the appropriate `knowledge/learnings/{topic}.md` file using the entry format with `{#id}` anchors
- Update `knowledge/learnings/index.json` — add new entries or bump existing ones
- If an existing entry covers the same pattern, bump its `Confirmed` count and `lastConfirmed` instead of duplicating

### Rules

- **Don't force Tier 2** — if the build was clean and routine, Tier 1 runs silently. Say "No new learnings. Approach confirmed (N entries bumped)." and move on
- **Tier 2 requires user confirmation** — always ask before writing NEW entries to learnings files
- **Tier 1 is silent** — bump operations happen without user interaction
- **Concise entries** — one insight per entry, not paragraphs
- **Always update index.json** — both tiers must keep the index in sync
