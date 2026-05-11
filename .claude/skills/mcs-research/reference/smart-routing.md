# Phase 0: Smart Research Routing (Unified)

**Goal:** Determine the optimal processing path for any invocation — project or agent level. Detects new/changed docs, brief edits, and manually created agents.

This phase runs for all invocations because accurate routing prevents wasted work (re-reading unchanged docs) and missed updates (brief edits without new docs).

## Step 0.1: Determine Scope

- `/mcs-research {projectId}` -> `scope = "project"`
- `/mcs-research {projectId} {agentId}` -> `scope = "agent"`

## Step 0.2: Check Preconditions (Manifest + Brief)

| Scope | Manifest? | Brief? | Result |
|-------|-----------|--------|--------|
| project | No | -- | `processingPath = "full"` (first run) |
| project | Yes | -- | Proceed to Step 0.3 (diff docs) |
| agent | -- | No / empty stub | `processingPath = "full-agent"` (manually created, deep research scoped to this agent) |
| agent | -- | Yes + enriched | Proceed to Step 0.3 (diff docs) |

Read `Build-Guides/{projectId}/doc-manifest.json` for manifest check.
Read `Build-Guides/{projectId}/agents/{agentId}/brief.json` for brief check (agent scope only).

"Empty stub" = brief.json exists but `instructions` is empty AND `capabilities` is empty (never been through research).

## Step 0.3: Diff Documents Against Manifest

1. List all files in `Build-Guides/{projectId}/docs/` matching supported extensions: `.md`, `.csv`, `.json`, `.txt`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.tiff`, `.webp`, `.docx`, `.pdf`
2. For each file, compute SHA-256 hash via PowerShell:
   ```powershell
   (Get-FileHash -Path "file" -Algorithm SHA256).Hash
   ```
3. Compare against `manifest.docsProcessed[]` entries by filename + sha256:
   - **`newDocs[]`** -- files in docs/ not in manifest
   - **`changedDocs[]`** -- files in manifest whose hash differs
   - **`deletedDocs[]`** -- files in manifest not present in docs/
4. **Agent-scoped filtering:**
   - If `scope = "project"`: diff all docs (current behavior)
   - If `scope = "agent"`: diff docs where `matchedAgents` includes this agentId, plus any new docs (not yet in manifest)
   - If no manifest exists (agent scope, brief exists): treat all project docs as candidates, filter by relevance in Step 0.4
5. If changes exist -> proceed to Step 0.4
6. If no changes -> proceed to Step 0.5 (check brief modifications)

## Step 0.4: Document-to-Agent Mapping (when new/changed docs exist)

For each new/changed doc, determine which agent(s) it belongs to:

1. Read each doc content, score relevance against every agent's `brief.json`:
   - Systems mentioned -> match `integrations[]`
   - Domain keywords -> match `business.problemStatement`
   - Capabilities -> match `capabilities[].name`
   - Agent name explicitly mentioned -> direct match
2. **Auto-map** if relevance is clear (matches one agent strongly)
3. **Ask user** via AskUserQuestion if ambiguous (matches multiple equally, or matches none)
4. **Cross-cutting docs** (org policies, IT standards) -> apply to all agents
5. **Agent-scoped invocation**: assume new docs are for this agent (user clicked Research on specific agent), but flag if doc seems irrelevant to this agent's domain

Output the mapping:
```
## Document -> Agent Mapping
| Document | Agent(s) | Confidence |
|----------|----------|-----------|
| new-jira-reqs.md | incident-manager | High (mentions Jira, tickets) |
| company-policy.md | All agents | Cross-cutting |
```

Then proceed to Step 0.6 (drastic change detection).

## Step 0.5: Check for Brief Modifications (when no doc changes detected)

**For agent scope only** -- if no doc changes were detected for this agent:
- Compare brief.json file modification time vs `manifest.lastResearchAt`
- If brief is newer -> set `processingPath = "re-enrich"` (brief was edited, re-run Phase B->C)
- If brief is not newer -> set `processingPath = "none"` (truly nothing to do)

**For project scope** -- if no doc changes at all:
- Output: `No document changes since last research ({manifest.lastResearchAt}). Nothing new to process.`
- **Exit** the skill.

## Step 0.6: Drastic Change Detection (scope-aware)

Only run when processing new/changed docs (from Step 0.4).

Read new/changed docs and check 5 thresholds. Any one triggers a fallback to full research:

| Threshold | How to Detect | Scope |
|-----------|--------------|-------|
| New agent described | Content describes an agent not in `Build-Guides/{projectId}/agents/` | Project only |
| Architecture change | Content implies single <-> multi-agent switch | Project only |
| >4 brief sections affected | Map content to brief sections; count > 4 | Both |
| Problem statement shift | Content fundamentally changes `business.problemStatement` | Both |
| Volume ratio >2x | Total bytes of new/changed docs > 2x total bytes of existing processed docs | Both |

At agent scope, skip "new agent described" and "architecture change" thresholds because those are project-level concerns.

## Step 0.7: Route and Report

| Condition | `processingPath` | Phases |
|-----------|-----------------|--------|
| First project run (no manifest) | `full` | A -> B -> C (all docs, deep research) |
| First agent run (empty brief) | `full-agent` | A -> B -> C (scoped to agent, reads all project docs for relevance) |
| No changes, brief not edited | `none` | Exit with message |
| Brief edited, no new docs | `re-enrich` | B -> C (skip A, re-enrich with current brief context) |
| Changes exist, not drastic | `incremental` | A-inc -> B-inc -> C-inc |
| Changes exist, drastic | `full` | Warning -> A -> B -> C |

**Output to user before proceeding:**

```
## Research: {projectId} [{agentId if scoped}]
**Scope:** {Project / Agent: agentName}
**New docs:** {N} | **Changed:** {N} | **Deleted:** {N}
**Mode:** {Full / Full-Agent / Incremental / Re-enrich / Nothing new}
{If incremental: doc->agent mapping table}
```

Then proceed to Phase A with the determined `processingPath`.
