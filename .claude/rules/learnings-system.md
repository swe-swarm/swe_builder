---
paths:
  - ".claude/skills/mcs-research/**"
  - ".claude/skills/mcs-build/**"
  - ".claude/skills/mcs-eval/**"
  - ".claude/skills/mcs-fix/**"
  - ".claude/skills/mcs-retro/**"
  - "knowledge/**"
---

# Learning System and Knowledge Management

The system captures learnings from every build and makes them available in future research. This creates a feedback loop: builds generate insights, insights improve future research, better specs produce better builds.

## Knowledge Layers

| Layer | Location | What | Refresh |
|-------|----------|------|---------|
| Official cache | `knowledge/cache/` | MCS capabilities from MS Learn + WebSearch | Auto (session start + before research) |
| Experience learnings | `knowledge/learnings/` | Insights from past builds, user feedback, failures | After every build/research/eval |
| Stable patterns | `knowledge/patterns/` | YAML syntax, Dataverse API, solution patterns | Manual (rarely changes) |
| Decision frameworks | `knowledge/frameworks/` | Component selection, architecture scoring | Manual (rarely changes) |

### Cache Structure

- `knowledge/cache/` -- 20 quick-reference cheat sheets covering MCS capabilities: options, limits, gotchas, and decision tables. Each file has freshness metadata. For step-by-step details, use MS Learn MCP.
- `knowledge/patterns/` -- Stable HOW-TO references (YAML syntax, Dataverse API patterns, solution patterns, topic templates).
- `knowledge/frameworks/` -- Decision frameworks (component selection, architecture scoring, tool priority).

Check cache freshness before architecture decisions because stale data leads to incorrect component choices.

## Tiered Cache Refresh

- **Tier 1 (build-critical):** triggers, models, mcp-servers, connectors, knowledge-sources, channels -- auto-refreshed at session start if older than 7 days
- **Tier 2 (build-phase):** api-capabilities, island-gateway-api, instructions-authoring, generative-orchestration, adaptive-cards, ai-tools-computer-use, power-automate-integration -- refreshed before `/mcs-build` if stale
- **Tier 3 (reference):** eval-methods, security-auth, agent-lifecycle, limits-licensing, powerfx-variables, conversation-design -- refreshed on demand via `/mcs-refresh`

### Freshness Rules

- Less than 7 days old: use as-is
- 7-30 days old: Tier 1 auto-refreshes; Tier 2-3 flagged, refresh on demand
- Over 30 days old: refresh immediately regardless of tier

After live research, update the cache file with findings and a new `last_verified` date because future sessions rely on cache accuracy.

See `knowledge/README.md` for full details.

## Learnings Capture Points

| When | What Gets Captured | How |
|------|-------------------|-----|
| Post-build | Spec vs actual diff, errors and fixes, new discoveries, build method insights | Structured summary, user confirms, written to topic files |
| Post-research | New components found, cache corrections, customer/industry patterns | Summary if discoveries exist, user confirms |
| Post-eval | Failure patterns, eval method insights, scoring calibration | Summary if insights exist, user confirms |
| Anytime | User says "remember that X" or provides feedback | Write directly to relevant topic file |

## Learnings Topic Files (`knowledge/learnings/`)

| File | Consulted During |
|------|-----------------|
| `connectors.md` | `/mcs-research` Phase B (component research) |
| `integrations.md` | `/mcs-research` Phase B (system integration choices) |
| `architecture.md` | `/mcs-research` Phase C (architecture scoring) |
| `instructions.md` | `/mcs-research` Phase C (Prompt Engineer) |
| `topics-triggers.md` | `/mcs-research` Phase C + `/mcs-build` Step 4 |
| `eval-testing.md` | `/mcs-research` Phase C + `/mcs-eval` |
| `build-methods.md` | `/mcs-build` (tool selection per step) |
| `customer-patterns.md` | `/mcs-research` Phase B (component research) |

## How Learnings Are Used

During research, learnings are presented as additional options rather than defaults because the user should make the final call:

> "Official docs recommend Connector X. However, in a past build for [customer], we found Y works better because [reason] (confirmed in 3 builds). Consider both options."

Higher `Confirmed` count equals higher weight, but the user decides.

### Confidence Levels

| Confirmed In | Weight | Presentation |
|-------------|--------|-------------|
| 1 build | Low | "In one past build, we observed..." |
| 2-3 builds | Medium | "Based on multiple builds, we recommend considering..." |
| 4+ builds | High | "Consistently confirmed: ..." |

## Learnings Protocol: Automated Capture and Consultation

Learnings are captured automatically after every phase and consulted throughout every skill. A machine-readable `knowledge/learnings/index.json` enables deduplication, confirmed-count tracking, and staleness detection.

### A. Two-Tier Capture Model

Every post-phase hook classifies learnings into one of two tiers:

| Tier | When | User Confirmation | Examples |
|------|------|-------------------|----------|
| Tier 1 (Auto) | Routine confirmations, cache corrections | No -- silent bump/write | Same approach worked again: bump Confirmed count; cache file had wrong info: correct and log |
| Tier 2 (User confirms) | New discoveries, contradictions, architecture insights | Yes -- present summary and wait | New failure pattern; learning contradicts existing entry; non-obvious architecture recommendation |

**Tier 1 actions:** Bump `confirmed` count and `lastConfirmed` date in `index.json`, update the entry's `Last confirmed` line in the `.md` file. No user interaction needed.

**Tier 2 actions:** Present the learning to the user with proposed file + tags. If confirmed, write entry to `.md` file and add to `index.json`.

### B. Comparison Engine (4-step decision protocol)

Before writing any learning, run this comparison because deduplication prevents the learnings files from growing unbounded:

1. **Read `index.json`** entries with overlapping tags (match 2+ tags with the proposed learning)
2. **For each match, decide:**
   - Same scenario, same conclusion: **BUMP** confirmed count (Tier 1)
   - Same scenario, different conclusion: **FLAG** contradiction for user (Tier 2)
   - Different scenario, related tags: **ADD** as new entry (Tier 2)
   - No matches: **ADD** as new entry (Tier 2)
3. **Check related cache files:** Does the learning reveal info missing from `knowledge/cache/`? Update cache + add learning. Does it contradict cache? Flag for user.
4. **Execute decision:** BUMP / ADD / SKIP / FLAG, then update `index.json` accordingly.

### C. Staleness Rules

| Condition | Status | Action |
|-----------|--------|--------|
| Not confirmed in over 6 months | `stale` | Flag during session startup |
| Contradicted by 2+ builds | `deprecated` | Flag and recommend removal |
| References removed component | `superseded` | Flag and recommend update |

Report during session startup alongside cache freshness:
```
Learnings: N active, M stale, K deprecated
```

### D. Consultation Points (All Skills)

Learnings are consulted at these specific points across all workflow skills because each phase benefits from different experience files:

| Skill | Phase/Step | Learnings Files Read |
|-------|-----------|---------------------|
| `/mcs-research` | Phase B Step 0.5 (library check) | `solutions/index.json`, `solutions/cache/*.json` |
| `/mcs-research` | Phase B (component research) | `connectors.md`, `integrations.md`, `customer-patterns.md`, `patterns/solution-patterns.md` |
| `/mcs-research` | Phase C (architecture + instructions + evals + topics) | `architecture.md`, `instructions.md`, `topics-triggers.md`, `eval-testing.md` |
| `/mcs-build` | Before Step 1 (agent creation) | `build-methods.md` |
| `/mcs-build` | Before Step 3 (tools config) | `connectors.md`, `integrations.md` |
| `/mcs-build` | Before Step 4 (topics) | `topics-triggers.md` |
| `/mcs-eval` | Before Step 2 (run evaluation) | `eval-testing.md` |
| `/mcs-fix` | Step 2 (classify failures) | `eval-testing.md`, `instructions.md`, `topics-triggers.md` |
| `/mcs-retro` | Step 1.5 (library consultation) | `solutions/index.json`, `solutions/cache/*.json` |
| `/mcs-retro` | All steps (collect + compare) | All learnings files + `index.json` + all cache files |
