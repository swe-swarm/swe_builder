# Phase B: Component Research -- Targeted

**Goal:** Research MCS components and recommend the best tools, knowledge sources, model, triggers, and channels for each agent.

Don't research all 6 categories live for every agent. Stable categories use cache directly. Only dispatch live research for the agent's specific integration systems.

## Step 0.5: Check Solution Library for Similar Builds

Before starting component research, check the team solution library for prior builds that match this agent's profile. Similar solutions provide real-world implementation evidence.

1. Read `knowledge/solutions/index.json`
2. For each agent being researched, search by tag overlap:
   - Industry tags (from `tags.industry`) vs agent's business domain
   - Capability tags (from `tags.capabilities`) vs agent's `capabilities[].name`
   - Tool tags (from `tags.tools`) vs agent's `integrations[].name`
   - Architecture type (from `tags.architectureType`) vs agent's expected pattern
3. **If similar solutions found (2+ tag overlap):**
   - Read cache files from `knowledge/solutions/cache/{solutionId}.json` for deeper context
   - Present: "Found {N} similar solutions in team library: {names}. Their approaches: {summary of tools, architecture, patterns used}"
   - Use as additional data points in subsequent research steps -- not as defaults, but as evidence ("Solution X used Dataverse connector for this, Solution Y used Power Automate flow")
   - Note connection references and environment variables from similar solutions -- they hint at proven integration paths
4. **If no matches:** proceed normally -- "No similar solutions in team library."

This step is fast (local file reads only, no API calls) and runs for all processing paths (full, full-agent, incremental, re-enrich).

## Step 0: MCP Server Discovery (Conditional)

**Goal:** Discover available MCP servers and recommend relevant ones -- but only when needed.

This step is not unconditional. Check these conditions first:

| Condition | Action | Time Saved |
|-----------|--------|-----------|
| All integrations are M365-native (Priority 1-4) | Skip entirely -- cache has everything needed | ~5 min |
| Cache `mcp-servers.md` refreshed < 24h and no new capabilities from Phase A | Skip fetch (Steps 1-5), run matching only (Steps 6-7) from cached data | ~3 min |
| Agent has Priority 5-6 integrations or cache > 7 days or first full research | Run full scan (Steps 1-7) | 0 (required) |

When skipped entirely, report it: "Microsoft-native agent -- MCP catalog scan skipped (all integrations Priority 1-4)."

**When running full scan:**

1. **Read catalog URLs** from `knowledge/cache/mcp-servers.md` metadata header (`catalog_url` and `agent365_url`)
2. **Fetch both catalog pages** via MS Learn MCP (`microsoft_docs_fetch`):
   - MCS built-in catalog: `catalog_url`
   - Agent 365 tooling servers overview: `agent365_url`
3. **Extract server names** from both pages (look for server names in tables, headings, and lists)
4. **Diff against cache** -- compare extracted servers against entries in `knowledge/cache/mcp-servers.md`:
   - **New servers** = in catalog but not in cache
   - **Removed servers** = in cache but no longer in catalog (may be deprecated)
5. **If new servers found:**
   - Research each via `microsoft_docs_fetch` (follow links from catalog page) or `microsoft_docs_search` for details
   - Update `knowledge/cache/mcp-servers.md` with new entries (name, description, status, category)
   - Update `last_verified` date in cache metadata
6. **Match all available MCP servers against agent capabilities from Phase A:**
   - For each capability's `dataSources` and `integrations[]`, check: is there an MCP server that covers this data domain?
   - For each MCP server in the catalog, check: does this agent's use case overlap with the server's capabilities?
   - Consider the agent's channels, knowledge needs, and workflow patterns -- not just explicit data source mentions
7. **Present discovery summary to user:**

```
## MCP Server Discovery: {agentName}

**Catalog:** {N} servers in MCS catalog, {M} in Agent 365 catalog
**Cache:** {K} servers cached | {new count} new since last scan

**Available MCPs relevant to this agent:**
| MCP Server | Why Relevant | Currently In Brief? |
|------------|-------------|-------------------|
| {server} | {matches capability X / data source Y} | Yes / No |

**Recommended additions:** {list of MCPs not in brief but relevant}
**No match:** {list of catalog MCPs not relevant to this agent}
```

8. If relevant MCPs are missing from the brief's integrations, add them as recommendations (don't auto-add -- present for user decision). Flag with `source: "catalog-scan"` so the user knows this came from proactive discovery, not document extraction.

## Incremental Path (processingPath == "incremental")

When `processingPath == "incremental"`, Phase B is scoped to only what's new:

1. Skip stable category resolution unless Phase A-inc found new architecture-relevant data (new channels, triggers, knowledge types not already in the brief). If all new content maps to existing categories, skip directly to Step 2.5.
2. Only research new external systems from the new docs that aren't already in `integrations[]`. If a doc mentions "Jira" and the agent already has Jira in integrations, skip it.
3. Run Step 2.5 (Solution Pattern Reality Check) for all MVP capabilities -- patterns may have been added since initial research, and existing integrations may match newly documented anti-patterns.
4. Check learnings (same as full -- quick read of relevant `knowledge/learnings/` files).
5. Spawn Research Analyst only if new external systems were found that need live MCP/connector lookup. If everything maps to existing integrations or Microsoft-native tools, skip RA entirely.

Then proceed to Phase C (incremental).

## Full Path (processingPath == "full" or "full-agent")

Existing behavior -- research all categories as described below.

### Step 1: Resolve Stable Categories from Cache (Lead)

These categories are well-documented and change infrequently. Read the cache files directly -- no live research needed unless the doc mentions something unusual:

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

**Microsoft-native fast path:** Before identifying external systems, classify every integration:
- **M365-native (Priority 1-4):** SharePoint, Outlook, Teams, OneDrive, Planner, Excel, Dataverse, Dynamics 365, Power Automate, Azure services -> resolve from cache, no live research
- **External (Priority 5-6):** Everything else -> needs cache check + potential live research

If all integrations are M365-native -> skip Steps 3-4 entirely (no learnings check for connectors, no RA spawn). Proceed directly to Step 2.5 because the reality check catches naive implementations regardless of stack.

When M365-native fast path does not apply, list the agent's specific external systems that need MCP/connector lookup:

```
Example: Agent needs Jira, ServiceNow, Confluence
-> Research task: "Find MCS MCP servers or connectors for Jira, ServiceNow, Confluence"
```

Skip live research if:
- The agent only uses Microsoft-native tools (Priority 1-4) -- resolved from cache via fast path above
- The agent has no external system integrations (pure knowledge agent)
- All systems are already in `knowledge/cache/connectors.md` or `knowledge/cache/mcp-servers.md` with recent `last_verified` dates

### Step 2.5: Implementation Reality Check (Lead)

**Goal:** Challenge every MVP capability's implementation approach -- both against known anti-patterns and from first principles. Don't trust the SDR doc's proposed solution just because the customer wrote it. The customer describes their problem well; their proposed *technical approach* may be naive.

This matters because recommending something that doesn't work destroys credibility. If we tell a customer "use HTTP Request + AI Prompt to extract articles" and it returns garbage HTML in their first test, they lose trust in everything else we recommended. A brief that says "this needs an Azure Function" is honest and buildable. A brief that says "HTTP connector handles this" is a lie that wastes everyone's time.

**Two-part check: Pattern Matching + First-Principles Feasibility.**

#### Part A: Solution Pattern Matching

1. Read `knowledge/patterns/solution-patterns.md` for the full pattern catalog
2. For each MVP capability in the brief:
   a. Trace data flow: What is the input? What processing happens? What is the output?
   b. Check "When to match" conditions for each solution pattern (sp-001 through sp-010+)
   c. If a pattern matches: Recommend the proven alternative. Update `integrations[]` if the proven pattern requires a different tool (e.g., Power Automate flow instead of HTTP connector). Add a note to `conversations.topics[].notes` explaining why the naive approach was replaced.
   d. If no pattern matches but the capability involves 3+ transformation steps: Flag for manual review -- it may need a new pattern or a Power Automate flow.

#### Part B: First-Principles Feasibility Challenge

For every MVP integration in `integrations[]`, ask these 5 questions:

| Question | What You're Checking | Red Flag |
|----------|---------------------|----------|
| **1. What does this tool actually return?** | Read the tool/connector/MCP docs. Don't assume from the name. | "HTTP Request" doesn't return clean text. "Word MCP" can't do templates. |
| **2. Does this solve the customer's problem or just move it?** | Compare the integration's actual output against what the capability needs. | Tool returns raw data that still needs the same cleanup the customer already struggles with. |
| **3. What happens at realistic scale?** | Check limits, timeouts, token budgets, payload sizes. | 6-8 articles x 100KB HTML = 600-800KB through AI prompts with 5K char limits. |
| **4. What fails silently?** | JS-rendered pages returning empty HTML, soft paywalls, rate limits, bot detection. | Tool "works" in testing but fails on real-world URLs. |
| **5. Does this need something that doesn't exist yet?** | Custom deployment (Azure Function), customer infrastructure. Licensing is assumed max — do not flag licensing as a blocker. | Brief assumes a tool is "available" but it needs provisioning or deployment first. |

For each integration that fails any question, mark it as `needsRework` and add to the reality check summary with:
- Which question(s) it failed
- What the actual behavior is (with source -- docs link, community post, etc.)
- What should replace it

#### Output

Present the combined reality check:

```
## Implementation Reality Check: {agentName}

### Pattern Matches
| Capability | Pattern | Naive -> Proven | Impact |
|-----------|---------|----------------|--------|
| {name} | sp-001 | HTTP Request -> Readability service | New Azure Function needed |
| {name} | (none) | -- | OK as designed |

### Feasibility Challenges
| Integration | Failed Question | Issue | Recommendation |
|------------|----------------|-------|----------------|
| {name} | #1 (actual output) | Returns raw HTML, not clean text | Replace with extraction service |
| {name} | #5 (doesn't exist yet) | Requires provisioning or deployment | Verify availability or use standard connector |
| {name} | -- | Passes all checks | OK |
```

Flag integrations that need rework for Step 4 (RA research) or user discussion. If a feasibility failure changes the integration approach significantly (e.g., adds an Azure Function dependency), flag it as requiring customer discussion. Do not flag licensing as a blocker — assume max licensing.

#### Part C: Decision Generation from Pattern Matches

When Step 2.5 finds a pattern match with 2+ viable implementation tiers, create a structured decision instead of auto-selecting one approach:

1. **Check tier viability:** For each matched pattern, filter implementation tiers against known customer constraints (from brief.json, open questions, or Phase A extraction). Remove tiers the customer clearly can't use (e.g., "Azure Function" when customer has no Azure subscription and answered "no" to Azure access).
2. **Decision threshold:** If 2+ tiers survive filtering -> create a `decisions[]` entry. If only 1 tier survives -> auto-apply that tier to brief fields, no decision entry needed.
3. **Map tiers to options:** Each surviving tier becomes an option in the decision. Use the pattern's tier data to populate `label`, `summary`, `pros`, `cons`, `requirements`, `cost`, `effort`. Set `confidence` based on the tier's track record (`confirmed` builds from the pattern).
4. **Set recommended:** Default recommendation = highest-ranked surviving tier (Tier 1 unless disqualified). Set `recommendedOptionId` to that option's ID.
5. **Pre-apply recommended:** Write the recommended option's `briefPatch` to the actual brief fields (integrations[], conversations.topics[].notes, etc.). This gives the brief a buildable default even if the user never reviews decisions.
6. **Set source:** `"solution-pattern:{patternId}:tier-{N}"` for each option.

**Decision entry format:**
```json
{
  "id": "d-{NNN}",
  "category": "integration",
  "title": "How should we {capability description}?",
  "context": "The naive approach ({naive}) fails because {reason}. Multiple proven alternatives exist.",
  "targetField": "integrations[name={integration}]",
  "capability": "{capability name from brief}",
  "status": "pending",
  "selectedOptionId": null,
  "recommendedOptionId": "opt-1",
  "resolvedAt": null,
  "resolvedBy": null,
  "options": [/* one per viable tier */]
}
```

When to skip decision generation:
- Pattern has only 1 viable tier after constraint filtering -> auto-apply
- Pattern match is clear-cut with no meaningful tradeoffs between tiers -> auto-apply top tier
- The capability is `phase: "future"` -> skip entirely (no need to decide on deferred items)

This step runs against all MVP capabilities regardless of processing path (full, full-agent, incremental, re-enrich) because solution patterns may be added to the catalog after initial research, and existing integrations may match newly documented anti-patterns. First-principles checks catch issues that no pattern catalog covers.

### Step 3: Check Past Learnings (only relevant files)

Read learnings files only if they're relevant to this agent's systems and non-empty:

- `knowledge/learnings/connectors.md` -- if the agent has external connectors
- `knowledge/learnings/integrations.md` -- if the agent has complex integrations
- `knowledge/learnings/customer-patterns.md` -- if there's a matching industry

Also read `knowledge/patterns/solution-patterns.md` for implementation patterns that may apply to this agent's integrations, and `knowledge/learnings/index.json` to check confirmed counts. Entries with higher `confirmed` values get stronger presentation weight.

How to use learnings:
- Present as an additional option alongside official recommendations
- Higher `Confirmed` count = higher weight, but user decides

If a cached category is confirmed by learnings (e.g., same trigger approach worked in 3 builds), bump `confirmed` count in `index.json` (Tier 1 auto-capture -- no user confirmation needed).

### Step 4: Live Research via Research Analyst (when needed)

Spawn the Research Analyst when any of these are true:

| Trigger | RA Task |
|---------|---------|
| Step 2 found external systems not in cache | "Find MCS MCP servers or connectors for [System A], [System B]" |
| Step 2.5 flagged an integration as `needsRework` | "Research alternatives for [integration] -- current approach fails because [reason]. Find what actually works." |
| Step 2.5 found a capability with no viable integration | "How can MCS implement [capability]? The obvious approach ([X]) doesn't work because [Y]." |

The RA should:
- Check `knowledge/cache/connectors.md` + `knowledge/cache/mcp-servers.md` for baseline
- WebSearch for the capability + "Copilot Studio" + current year (catch preview/new features)
- MS Learn MCP for official docs on tool/connector actual behavior
- Fetch actual API/tool documentation to verify what a tool returns (don't trust names)
- Cross-reference and present ranked options with pros/cons, cost, reliability, and deployment requirements
- Challenge the doc's proposed approach -- if the SDR says "use HTTP to scrape," the RA should independently evaluate whether that works, not just find HTTP connector docs

Skip RA entirely when:
- All integrations are M365-native (Priority 1-4) and Step 2.5 passed all integrations
- All systems are in `connectors.md` or `mcp-servers.md` cache with `last_verified` < 7 days
- processingPath == "re-enrich" (brief edits only, no new integrations)

When skipped, report it: "Microsoft-native agent -- external connector research skipped."

### Step 4.5: Decision Generation from RA Results

When the Research Analyst returns results with 2+ viable approaches for a system integration:

1. **Rank options** by: native MCS support > certified connector > custom connector > Power Automate flow > HTTP request
2. **Decision threshold:** If 2+ approaches are genuinely viable (not just "possible" -- they need to actually work for the customer's use case) -> create a `decisions[]` entry. If 1 clear winner exists -> auto-apply, no decision entry.
3. **Map RA findings to options:** Each viable approach becomes an option with `label`, `summary`, `pros`, `cons`, `requirements`, `cost`, `effort`, `confidence` (based on RA's source quality -- official docs = high, community blog = medium, untested = low).
4. **Set source:** `"research-analyst"` for RA-discovered options, `"cache:connectors"` or `"cache:mcp-servers"` for cache-sourced options.
5. **Pre-apply recommended:** Write the top-ranked option's `briefPatch` to brief fields as the buildable default.

What counts as "genuinely viable":
- Tool/connector exists and is GA or public preview
- Auth method is compatible with the customer's environment
- Tool actually returns the data the capability needs (verified by RA, not assumed from name)
- Customer can reasonably set it up (assume max licensing — do not disqualify based on license tier)

What does not count:
- Theoretical approaches no one has tried ("you could build a custom MCP server...")
- Tools that exist but don't solve the actual problem (name matches but behavior doesn't)
- Deprecated or private preview features

### Component Selection Rules

- **MCP over individual connector actions**: When a connector offers an MCP server, prefer MCP because it provides richer multi-tool access
- **Present options**: For each need, recommend the best option but note alternatives
- **Flag preview features**: Note GA vs preview status for each recommendation

### Update brief.json

After research (live or cache-only), update:
- `integrations[]` -- recommended tools with `type` (mcp/connector/flow/ai-tool), `purpose`, `dataProvided`, `authMethod`, `phase`
- `conversations.topics[]` -- recommended conversation topics with `triggerType`, `topicType`, `implements[]`
- `knowledge[]` -- recommended knowledge sources with `type`, `purpose`, `scope`, `phase`
