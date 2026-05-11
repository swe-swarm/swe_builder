---
name: mcs-report
description: "Generate reports from brief.json on demand — without running a build. Four report types for different audiences: brief (design state), build (status + deviations), customer (simplified, zero jargon), deployment (checklists + env mapping)."
---

# MCS Report Generator — On-Demand Reports from brief.json

Generate reports from brief.json at any project stage, for any audience. Read-only — never modifies brief.json.

## Input

```
/mcs-report {projectId} {agentId}                   # Default: "brief" type
/mcs-report {projectId} {agentId} --type brief       # Current design state
/mcs-report {projectId} {agentId} --type build       # Build status + deviations
/mcs-report {projectId} {agentId} --type customer    # Simplified for stakeholders
/mcs-report {projectId} {agentId} --type deployment  # Checklist + instructions
```

Reads from:
- `Build-Guides/{projectId}/agents/{agentId}/brief.json` — **read-only, never modifies**

Writes to:
- `Build-Guides/{projectId}/agents/{agentId}/{type}-report.md`

## Step 1: Load and Validate brief.json

Read `Build-Guides/{projectId}/agents/{agentId}/brief.json`.

If file doesn't exist → **STOP:** "No brief.json found. Run `/mcs-research` first."

Check completeness based on report type:
| Report Type | Minimum Required Fields |
|-------------|----------------------|
| `brief` | business, agent, capabilities (at least 1) |
| `build` | buildStatus (with at least 1 completed step) |
| `customer` | business, agent, capabilities |
| `deployment` | buildStatus.status == "published", integrations |

If minimum fields are missing → **WARN** (don't stop): "Some sections will be incomplete — {field} is empty."

## GPT Review — Every Generated Report

After generating any report, fire GPT to review it before writing the final file:

```bash
# For brief and build reports:
node tools/multi-model-review.js review-brief --brief "Build-Guides/{projectId}/agents/{agentId}/brief.json"

# For all report types — general quality check:
node tools/multi-model-review.js review-code --file "Build-Guides/{projectId}/agents/{agentId}/{type}-report.md" --context "Report review: verify data accuracy against brief.json, check cross-references, ensure customer report has zero jargon"
```

GPT checks: data accuracy (does the report match brief.json?), cross-reference consistency (capabilities mentioned in report exist in brief), customer report jargon violations (technical terms that slipped through), missing sections. Apply fixes before writing the final file. If GPT is unavailable, proceed without it.

## Report Type: `brief` — Design State Report

**Audience:** Internal team, customer technical leads
**When:** After research, before build. Or anytime to review current design state.

### Template

```markdown
# Design Brief: {agent.name}

**Generated:** {timestamp}
**Project:** {projectId}
**Solution Type:** {architecture.solutionType} (score: {architecture.solutionTypeScore}/5)

## Business Context
**Use Case:** {business.useCase}
**Problem:** {business.problemStatement}

### Challenges
| Challenge | Impact |
|-----------|--------|
{business.challenges → table rows}

### Success Criteria
| Metric | Target | Measurement |
|--------|--------|-------------|
{business.successCriteria → table rows}

## Agent Design
**Name:** {agent.name}
**Description:** {agent.description}
**Persona:** {agent.persona}
**Primary Users:** {agent.primaryUsers}

## Capabilities ({mvp count} MVP / {future count} Future)

### MVP — Building Now
| Capability | Type | Description |
|-----------|------|-------------|
{capabilities where phase=mvp → table rows}

### Future — Deferred
| Capability | Reason | Description |
|-----------|--------|-------------|
{capabilities where phase=future → table rows}

## Architecture
**Type:** {architecture.type}
**Reason:** {architecture.reason}
**Channels:** {architecture.channels → comma-separated names}
**Model:** {from instructions or buildStatus}

{If architecture.buildPath is set:}
### Build Path Decision
**Selected:** {architecture.buildPath} (custom-agent / declarative-agent / first-party-only)
**Reason:** {architecture.buildPathReason}

{If architecture.frontierAgentMatch has entries:}
### First-Party Agent Matches
| Agent | Coverage | Recommendation | License Required | Matched Capabilities |
|-------|----------|---------------|-----------------|---------------------|
{architecture.frontierAgentMatch → table rows}

{For rejected paths — extract from buildPathReason:}
### Why Not Other Paths
{Parse architecture.buildPathReason for "why not" statements and present as bullet list:}
- **Declarative Agent:** {reason DA was rejected, e.g. "requires external channels (Teams + Web Chat)" or "uses adaptive cards"}
- **First-Party Only:** {reason first-party-only was rejected, e.g. "no first-party agent covers expense reconciliation capability"}
- **Custom Agent:** {if DA was chosen — reason CA is unnecessary, e.g. "all capabilities are M365-native info retrieval"}

{If multi-agent:}
### Agent Topology
| Agent | Role | Routing Rule |
|-------|------|-------------|
{architecture.children → table rows}

## Integrations ({count})
| Name | Type | Auth | Status | Phase |
|------|------|------|--------|-------|
{integrations → table rows}

## Knowledge Sources ({count})
| Name | Type | Purpose | Status |
|------|------|---------|--------|
{knowledge → table rows}

## Cross-Reference Summary
### Capability → Integration Mapping
| Capability | Integrations Used |
|-----------|------------------|
{cross-reference capabilities[].dataSources against integrations[].name}

### Orphan Detection
- **Integrations not linked to any capability:** {list or "None"}
- **Capabilities with no backing integration/knowledge:** {list or "None"}

## Conversation Design ({topic count} topics)
| Topic | Trigger | Type | Phase | Implements |
|-------|---------|------|-------|-----------|
{conversations.topics → table rows}

## Boundaries
**Handles:** {boundaries.handle → bullet list}
**Declines:** {boundaries.decline → bullet list with redirect}
**Refuses:** {boundaries.refuse → bullet list with reason}

## Evaluation Plan ({eval set count} sets, {total test count} tests)
| Set | Tests | Threshold | Methods |
|-----|-------|-----------|---------|
{evalSets → table rows}

## Open Questions ({count})
| Question | Impact | Suggested Default |
|----------|--------|------------------|
{openQuestions where answer is empty → table rows}

## Pending Decisions ({count})
| Decision | Category | Recommended | Status |
|----------|----------|-------------|--------|
{decisions where status=pending → table rows}
```

## Report Type: `build` — Build Status Report

**Audience:** Customer, project team
**When:** After build, after eval, after fix. Anytime to check current state.

### Template

```markdown
# Build Report: {agent.name}

**Generated:** {timestamp}
**Environment:** {buildStatus.environment}
**Status:** {buildStatus.status}
**Published:** {buildStatus.publishedAt or "Not yet"}

## Build Summary
| Step | Status |
|------|--------|
| Agent created | {check if "created" in completedSteps} |
| Instructions set | {check "instructions"} |
| Knowledge configured | {check "knowledge"} |
| Tools connected | {check "tools"} |
| Model selected | {check "model"} |
| Topics deployed | {check "topics"} |
| Published | {check "published"} |

{If lastError:}
**Last Error:** {buildStatus.lastError}

## Evaluation Results
**Overall:** {total passed}/{total tests} ({pass rate}%)

| Set | Passed | Total | Rate | Target | Status |
|-----|--------|-------|------|--------|--------|
{evalSets with results → table rows}

### Failed Tests
| Set | Question | Expected | Got |
|-----|----------|----------|-----|
{tests where lastResult.pass == false → table rows}

## Capabilities Status
| Capability | Phase | Status | Implementation |
|-----------|-------|--------|---------------|
{capabilities → table rows with status}

## Deviations from Design
{Compare brief spec against buildStatus — flag anything built differently than specified:}
- Topics planned but not built
- Tools specified but not connected
- Knowledge sources specified but not added
- Model specified vs actual

## MVP Scope
- **Built:** {count} capabilities
- **Deferred:** {count} capabilities
{mvpSummary.future → bullet list}

## Recommendations
{recommendations → bullet list}

## Next Steps
{Based on current state:}
- {If eval failures exist:} Run `/mcs-fix` to address {N} failing tests
- {If not deployed:} Run `/mcs-deploy` to promote to production
- {If future items exist:} Plan Phase 2 for {count} deferred capabilities
```

## Report Type: `customer` — Stakeholder Report

**Audience:** Non-technical stakeholders, executives
**When:** Anytime — for exec updates, customer presentations, decision reviews.

### Jargon Rules — MANDATORY

Replace ALL technical terms:

| Technical | Customer-Friendly |
|-----------|------------------|
| PAC CLI | *(omit entirely)* |
| Dataverse | data storage |
| LSP | *(omit entirely)* |
| YAML | configuration |
| PowerFx | formula |
| MCP | service connection |
| JSON | *(omit entirely)* |
| API | service |
| OAuth | secure sign-in |
| Service Principal | automated access |
| Connector | connection |
| Knowledge source | data source |
| Declarative agent | configuration-based agent |
| Custom agent | custom-built agent |
| First-party agent | Microsoft's built-in agent |
| Frontier agent | Microsoft's advanced built-in agent |
| Topic | conversation flow |
| Trigger | activation rule |
| Eval set | test suite |
| brief.json | design specification |

### Template

```markdown
# {agent.name} — Project Summary

**Prepared for:** {business.stakeholders.sponsor}
**Date:** {timestamp}

## What We're Building
{business.useCase}

{business.problemStatement}

## What It Does

{For each MVP capability, write 1-2 plain English sentences:}
- **{capability.name}:** {capability.description in plain language}

## What It Connects To
{For each MVP integration:}
- **{integration.name}:** {integration.purpose — in plain language}

## Approach
{If architecture.buildPath == "custom-agent":} We're building a custom AI agent tailored to your needs.
{If architecture.buildPath == "declarative-agent":} We're recommending a configuration-based agent that works inside Microsoft 365 Copilot — no custom development needed.
{If architecture.buildPath == "first-party-only":} Microsoft already offers built-in agents that cover these needs — we recommend using those directly.

{If architecture.frontierAgentMatch has entries with coverage "full" or "partial":}
### Leveraging Microsoft's Built-In Agents
{For each match:}
- **{agentName}:** Already handles {matchedCapabilities in plain language}. {If coverage == "partial": "We'll build the remaining functionality as a custom addition."}

## Key Design Decisions
{For each confirmed decision:}
- **{decision.title}:** {Selected option — 1 sentence summary of what was chosen and why}

{For each pending decision:}
- **{decision.title}:** Awaiting your input — {brief context}

## Current Status
{One of:}
- "Design complete — ready for build"
- "Built and tested — {pass rate}% of tests passing"
- "Deployed to {targetEnv}"
- "In progress — {lastCompletedStep}"

## What's Next
{1-3 bullet points, plain language}

## Planned for Later
{future capabilities → bullet list with reasons in plain language}

## Open Questions for Your Team
{openQuestions with empty answers → numbered list}
```

## Report Type: `deployment` — Deployment Report

**Audience:** IT admin, deployment team, ops
**When:** Before or after deploy. Pre-deploy = checklist. Post-deploy = status + instructions.

### Template

```markdown
# Deployment Guide: {agent.name}

**Generated:** {timestamp}
**Source Environment:** {buildStatus.environment}
**Target Environment:** {deployStatus.targetEnvironment or "TBD"}
**Deployment Mode:** {deployStatus.mode or "Recommended: {auto-detected mode}"}

## Pre-Deployment Checklist
- [{buildStatus.status == "published" ? "x" : " "}] Agent published in source environment
- [{evalSets have results ? "x" : " "}] Evaluation tests executed
- [{safety pass rate == 100% ? "x" : " "}] Safety tests passing (100%)
- [{functional pass rate >= 85% ? "x" : " "}] Functional tests passing (>= 85%)
- [ ] Target environment created and accessible
- [ ] Deployment account has System Administrator role in target
- [ ] Connection credentials available for target (see below)

## Connection Mapping
{For each integration:}
| Connection | Auth Method | Action Required | Credentials Needed |
|-----------|-------------|-----------------|-------------------|
{integrations → table rows with auth details}

## Environment-Specific Configuration
{List any values that need updating in target:}
| Setting | Source Value | Target Value (fill in) |
|---------|------------|----------------------|
{Dataverse URLs, environment variables, etc.}

## Deployment Steps
{If not yet deployed:}
1. Verify pre-deployment checklist above
2. Run: `/mcs-deploy {projectId} {agentId}`
3. Complete connection mapping in target MCS
4. Run smoke test: `/mcs-eval {projectId} {agentId} --set safety`
5. Configure channels in target environment

{If already deployed:}
**Deployed at:** {deployStatus.deployedAt}
**Target Bot ID:** {deployStatus.targetBotId}
**Smoke Test:** {deployStatus.smokeTestResult}

## Post-Deployment Checklist
- [{deployStatus.status == "deployed" ? "x" : " "}] Agent deployed to target
- [{deployStatus.smokeTestResult == "pass" ? "x" : " "}] Smoke test passed
- [{deployStatus.connectionsMapped ? "x" : " "}] All connections mapped
- [ ] Channels configured (Teams, Web Chat, etc.)
- [ ] Pilot users granted access
- [ ] Monitoring/alerting configured

## Channel Configuration
{For each channel in architecture.channels:}
### {channel.name}
- **Reason:** {channel.reason}
- **Setup:** {channel-specific setup instructions}

## Rollback Plan
- **Agent mode:** Delete target bot via MCS UI or Dataverse API
- **Solution mode:** Uninstall solution from target via PAC CLI: `pac solution delete --solution-name "{name}"`
- **Source agent is unaffected** — deployment is additive, never modifies source
```

## Important Rules

- **Never modify brief.json** because this skill is strictly read-only — reports are derived artifacts, not sources of truth
- **No teammates needed** — lightweight lead-only generation
- **Always write the report file** — even if some sections are incomplete (mark them as "N/A" or "Not yet available")
- **Customer report must follow jargon rules** because these reports go to non-technical stakeholders who will be confused or alarmed by technical terms
- **Cross-reference summary (brief type) is unique** — no other report includes this analysis
- **Report file naming:** `{type}-report.md` (brief-report.md, build-report.md, customer-report.md, deployment-report.md)
- **If brief.json is minimal** (just business + agent), only `brief` and `customer` types will produce useful output — warn the user for `build` and `deployment` types
