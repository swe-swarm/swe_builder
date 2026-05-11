# Phase A: Document Comprehension & Agent Identification

**Goal:** Read all project documents, build a unified understanding, identify every agent to build, and create brief.json stubs with informed open questions.

This is deep comprehension, not surface extraction.

## Incremental Path (processingPath == "incremental")

When `processingPath == "incremental"`, Phase A operates on new/changed docs only, merging into the existing brief:

1. **Read only `newDocs` + `changedDocs`** (not all docs). Also read each existing `brief.json` under `Build-Guides/{projectId}/agents/*/brief.json` for context.
2. **Agent-scoped filtering:** If `scope = "agent"`, only process docs mapped to this agent in Step 0.4. Write changes only to this agent's brief.
3. **Cross-reference** new content against existing brief fields. Look for: new systems, new capabilities, answers to existing open questions, contradictions with existing data.
4. **Check for new agents.** If new docs describe an agent not in `agents/`, the drastic threshold should have caught it in Phase 0 -- escalate to `processingPath = "full"` if missed.
5. **Extract data only from new/changed docs.** Map to agents using the doc->agent mapping from Step 0.4.
6. **Apply merge rules:**
   - **Append-only:** `capabilities[]`, `boundaries.handle/decline/refuse`, `integrations[]`, `conversations.topics[]`, `knowledge[]`, `evalSets[].tests[]`
   - **Never overwrite:** `instructions`, answered `openQuestions[].answer`
   - **Resolve:** unanswered `openQuestions` if doc provides the answer
   - **Flag conflicts:** `business.problemStatement`, `architecture.type` -> add to `_updateFlags`
7. **Show summary** of what was extracted and which agents were affected.
8. **Update manifest incrementally:** Add new entries, update hashes for changed docs, remove deleted docs, preserve unchanged entries. Set `processedAt` for each processed file. Update `matchedAgents` for new docs.

Then proceed to Phase B (incremental).

## Full-Agent Path (processingPath == "full-agent")

When `processingPath == "full-agent"` (manually created agent, empty brief):

1. **Read all project docs** in `Build-Guides/{projectId}/docs/`, but only extract/write data for this specific agent.
2. **Skip agent identification** -- agent already exists (user created it manually).
3. **Score relevance** of each doc against this agent's name/description. Filter out clearly irrelevant docs.
4. **Extract per-agent data** -- same as full path Step 4 below, but only for this one agent.
5. **Create manifest entries** with `matchedAgents` for this agent.
6. **Write brief.json stub** with all extracted data (same as full path Step 5).

Then proceed to Phase B (full path -- this agent needs deep research).

## Full Path (processingPath == "full")

Existing behavior -- process all documents as described below.

### Step 1: Read All Documents

Read every file in `Build-Guides/{projectId}/docs/`:
- `.md` files -- read directly
- `.docx` files -- convert via pandoc first: `pandoc "file.docx" -t gfm -o "file.md"` (if not on PATH, check `%LOCALAPPDATA%\Pandoc\pandoc.exe`)
- `.pdf` files -- read via Read tool (PDF support)
- `.txt` files -- read directly
- Images (`.png`, `.jpg`) -- read via Read tool (multimodal)

If `customer-context.md` exists in the project folder, read it too -- it provides M365 history.

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

**If documents describe one agent:** Create one agent entry.
**If documents describe multiple agents:** Create one entry per agent.
**If unclear:** Default to one agent, note uncertainty in openQuestions.

### Step 3.5: Solution Type Assessment

**Goal:** Determine whether each agent candidate actually needs to be an MCS agent, or if a simpler solution (Power Automate flow, SharePoint view, etc.) is more appropriate.

This step runs for each agent candidate identified in Step 3. It uses the 5-factor framework from `knowledge/frameworks/solution-type-scoring.md`.

Skip this step if `solutionTypeOverride: true` exists in the agent's existing brief (user clicked "Build as Agent Anyway" in the dashboard).

#### Assessment Process

For each agent candidate:

1. **Classify capabilities:** Read the capability descriptions from the SDR/docs. For each, assign a lightweight `implementationType` estimate:
   - `prompt` -- behavior encoded in instructions only
   - `topic` -- requires custom conversation flow
   - `knowledge` -- requires knowledge source Q&A
   - `tool` -- requires a tool/connector with deterministic I/O
   - `flow` -- requires a Power Automate flow (event-driven pipeline)

2. **Score the 5 factors:**
   - **Conversational Need:** Do users need dialogue, or just data moved/displayed?
   - **Interaction Pattern:** Is the dominant pattern reactive (AI judgment) or procedural (deterministic pipeline)?
   - **Capability Distribution:** Are 50%+ capabilities conversational types (prompt/topic/knowledge)?
   - **User Value of NL:** Do users gain clear value from natural language over structured UI?
   - **MCS Feasibility:** Does this fit within MCS technical constraints?

3. **Write assessment to brief stub:**
   - `architecture.solutionType` -- `"agent"`, `"flow"`, `"hybrid"`, or `"not-recommended"`
   - `architecture.solutionTypeScore` -- 0-5
   - `architecture.solutionTypeFactors` -- per-factor value + reasoning
   - `architecture.solutionTypeReason` -- 2-4 sentence explanation
   - `architecture.alternativeRecommendation` -- if not agent, what to build instead

4. **Route based on score:**

| Score | solutionType | Research Path |
|-------|-------------|---------------|
| **4-5** | `agent` | Continue normally -- Steps 4-6 then Phases B+C |
| **3** | Borderline | Continue with agent research. Create `solution-type` decision with `agent`, `hybrid`, and `flow` options. Pre-apply `hybrid`. |
| **1-2** | `flow` | Write simplified brief: populate `business.*`, `agent.name/description`, `capabilities[]`, `recommendations[]`, `architecture.alternativeRecommendation`. Skip Phases B+C (no instructions, eval sets, or architecture scoring). |
| **0** | `not-recommended` | Write minimal brief with alternative. Skip all deep research. |

#### Simplified Brief (flow / not-recommended)

When `solutionType` is `flow` or `not-recommended`, the brief is intentionally minimal:
- `business.*` -- fully populated (problem statement, challenges, benefits)
- `agent.name`, `agent.description` -- set for identification
- `capabilities[]` -- all identified, with `implementationType` classifications
- `architecture.solutionType*` -- all assessment fields populated
- `architecture.alternativeRecommendation` -- detailed recommendation for what to build instead
- `recommendations[]` -- MCS best practices replaced with alternative-specific guidance
- `openQuestions[]` -- any remaining unknowns

**Not populated:** `instructions`, `evalSets`, `architecture.type/factors/score` (arch scoring), `conversations.topics[]` (no topic YAML), `integrations[]` (minimal -- list systems but no MCS connector research)

#### Output Modification for Non-Agent Types

When presenting the Phase A summary (Step 6):
- **Agent types:** Normal output -- "Proceeding to full MCS component research..."
- **Flow/not-recommended:** Modified output:
  ```
  ## Solution Type Assessment: {agentName}
  **Score:** {N}/5 -> {solutionType}
  **Recommendation:** {alternativeRecommendation summary}

  Simplified brief written. Full MCS research skipped -- this use case is better served by {alternative}.
  ```

### Step 4: Extract Per-Agent Data & Generate Informed Open Questions

For each agent, extract what's in the documents and cross-reference against `knowledge/cache/` to generate *informed* open questions.

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

**Informed open questions** -- use cache knowledge to ask the right questions:
- Doc mentions a system -> check `knowledge/cache/connectors.md` and `knowledge/cache/mcp-servers.md` -> if no native connector, ask: "System X has no native MCS connector. Options: custom connector, Power Automate flow, or HTTP request action. Which applies?"
- Doc mentions triggers -> check `knowledge/cache/triggers.md` -> ask about specific trigger types, not vague "what triggers?"
- Doc mentions "proactive alerts" -> ask: "Should alerts use a Recurrence trigger polling every N hours, or an event-driven trigger from Power Automate?"
- Doc mentions "write-back" -> flag: "Write operations require connector actions. Has the customer approved write access to [system]?"

### Step 5: Create brief.json Stubs

For each agent, create:
```
Build-Guides/{projectId}/agents/{slug}/brief.json
```

Where `{slug}` is a kebab-case version of the agent name (e.g., "Incident Manager" -> "incident-manager").

Follow the schema in `templates/brief.json`. Include only fields with extracted data + informed openQuestions.

**If agents already exist** under `Build-Guides/{projectId}/agents/`:
- Update their `brief.json` with new info from documents
- Do not duplicate existing agents
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

For agents assessed as `flow` or `not-recommended` in Step 3.5, do not proceed to Phase B for those agents. Their simplified briefs are already written. Only proceed to Phase B for agents with `solutionType == "agent"` or `"hybrid"`.

Then continue directly to Phase B. Do not stop and wait -- this is a single-pass skill. The user will provide feedback after the full research is complete.

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
