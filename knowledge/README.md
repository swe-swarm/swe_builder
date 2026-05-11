# Knowledge System

4-layer knowledge architecture for MCS automation. Combines **official docs** (what's available), **experience** (what works), **stable patterns** (how to do it), and **decision frameworks** (how to choose).

## Architecture

```
Layer 1: knowledge/cache/      — Official MCS capabilities, refreshed from MS Learn + WebSearch (REFRESHABLE)
Layer 2: knowledge/learnings/   — Experience from past builds, user feedback, failures (GROWS OVER TIME)
Layer 3: knowledge/patterns/    — Stable HOW-TO references: YAML, Playwright, Dataverse (STABLE)
Layer 4: knowledge/frameworks/  — Decision logic: component selection, architecture scoring (STABLE)
```

**Lookup order during research**: Cache (what's available) + Learnings (what's worked) → if stale or missing → live research → update cache/learnings

## Directory Structure

```
knowledge/
├── README.md                    # This file
├── learnings/                   # Experience-based insights (grows with each build)
│   ├── index.json               # Machine-readable learnings index (dedup, staleness)
│   ├── connectors.md            # Connector experiences (what worked, what didn't)
│   ├── architecture.md          # Architecture decisions and outcomes
│   ├── instructions.md          # Instruction writing patterns
│   ├── integrations.md          # System integration lessons (auth, custom connectors)
│   ├── topics-triggers.md       # Topic/trigger patterns
│   ├── eval-testing.md          # Eval method insights, thresholds, scoring
│   ├── build-methods.md         # Build execution lessons (API vs Playwright)
│   └── customer-patterns.md     # Industry/customer-type patterns
├── cache/                       # Refreshable inventories (each file has metadata header)
│   ├── triggers.md              # Topic trigger types, YAML kinds
│   ├── models.md                # Available LLM models in MCS
│   ├── mcp-servers.md           # Built-in MCP servers
│   ├── connectors.md            # Key Power Platform connectors
│   ├── knowledge-sources.md     # Knowledge source types + file limits
│   ├── channels.md              # Deployment channels
│   ├── api-capabilities.md      # What each API layer can do
│   ├── eval-methods.md          # Test method types for evaluations
│   ├── generative-orchestration.md  # Orchestration modes, topic routing
│   ├── security-auth.md         # Auth modes, SSO, OAuth, DLP
│   ├── instructions-authoring.md    # Instructions best practices, limits
│   ├── powerfx-variables.md     # PowerFx functions, variable scopes
│   ├── agent-lifecycle.md       # Creation methods, publishing, ALM
│   ├── power-automate-integration.md  # Flows as tools, event triggers
│   ├── adaptive-cards.md        # Card schema, PowerFx binding
│   ├── ai-tools-computer-use.md # AI Builder, prompt actions, Computer Use
│   ├── limits-licensing.md      # Message limits, quotas, licensing
│   ├── conversation-design.md   # Design patterns, entity types, escalation
│   ├── known-issues.md          # Known MCS bugs, workarounds, gotchas
│   ├── declarative-agents.md    # Declarative agent capabilities, M365 Copilot extensibility
│   ├── first-party-agents.md    # Microsoft first-party agents, capabilities, integration
│   ├── island-gateway-api.md    # Island Gateway / Direct Line API patterns
│   ├── mcs-primer-gpt.md        # MCS primer for GPT/LLM context seeding
│   └── copilot-studio-kit.md    # Copilot Studio Kit (open-source testing + ALM tools)
├── patterns/                    # Stable HOW-TO patterns
│   ├── yaml-reference.md        # YAML syntax rules, node types, variable scopes
│   ├── playwright-patterns.md   # MCS UI automation patterns
│   ├── dataverse-patterns.md    # API call patterns
│   ├── topic-patterns/          # Reusable YAML templates
│   └── flow-patterns/           # Power Automate flow JSON templates
├── solutions/                   # Solution library: index + per-solution cache files
│   ├── index.json               # Master index of all 30 solutions (id, folderName, agents)
│   └── cache/                   # Per-solution JSON files (sol-{id}.json)
└── frameworks/                  # Decision frameworks
    ├── component-selection.md   # How to evaluate and choose components
    ├── architecture-scoring.md  # Single vs multi-agent scoring
    ├── tool-priority.md         # API-first decision flow
    └── eval-scenarios/          # Eval scenario templates by agent type
```

## Cache Files

### Format

Every file in `cache/` has this metadata header:

```markdown
<!-- CACHE METADATA
last_verified: YYYY-MM-DD
sources: [list of sources used]
confidence: high | medium | low
refresh_trigger: before_architecture | weekly | on_error
-->
```

### Tiers

| Tier | Files | Refresh |
|------|-------|---------|
| **1 (build-critical)** | triggers, models, mcp-servers, connectors, knowledge-sources, channels | Auto at session start if > 7 days |
| **2 (build-phase)** | api-capabilities, instructions-authoring, generative-orchestration, adaptive-cards, ai-tools-computer-use, power-automate-integration | Before `/mcs-build` if stale |
| **3 (reference)** | eval-methods, security-auth, agent-lifecycle, limits-licensing, powerfx-variables, conversation-design, known-issues, declarative-agents, first-party-agents, island-gateway-api, mcs-primer-gpt, copilot-studio-kit | On demand via `/mcs-refresh` |

### Freshness Rules

| Age | Action |
|-----|--------|
| < 7 days | Use as-is |
| 7-30 days | Tier 1: auto-refresh. Tier 2-3: flag, refresh on demand |
| > 30 days | Refresh immediately regardless of tier |

### Refresh Protocol

Run `/mcs-refresh` to update cache files:
- `/mcs-refresh` — refresh all stale files (> 7 days)
- `/mcs-refresh triggers` — refresh just triggers.md
- `/mcs-refresh all` — force refresh everything

Per-file refresh:
1. Read current cache file
2. MS Learn MCP search for official docs
3. WebSearch for "[topic] Copilot Studio [current year]"
4. Compare findings to cached content
5. Update file with new content + `last_verified: today`
6. Report what changed

## Learnings Files

### How They're Populated — Two-Tier Capture Model

Learnings are captured automatically after every workflow phase via post-phase hooks:

| Tier | When | User Confirmation | Examples |
|------|------|-------------------|----------|
| **Tier 1 (Auto)** | Routine confirmations, cache corrections | No — silent bump/write | Same approach worked → bump confirmed count |
| **Tier 2 (User confirms)** | New discoveries, contradictions, architecture insights | Yes — present and wait | New failure pattern, contradicts existing entry |

| Phase | Capture Point | What's Captured |
|-------|--------------|-----------------|
| `/mcs-research` | Post-research | New discoveries, cache corrections, customer patterns |
| `/mcs-build` | Post-build | Spec vs actual diff, errors & fixes, build method insights |
| `/mcs-eval` | Post-eval | Failure patterns, scoring insights, test design lessons |
| `/mcs-fix` | Post-fix | Recurring failure patterns, instruction/topic fixes |

### Machine-Readable Index (`index.json`)

All learnings are tracked in `knowledge/learnings/index.json` for deduplication, confirmed-count tracking, and staleness:

```json
{
  "version": 1,
  "entries": [{
    "id": "bm-001",
    "file": "build-methods.md",
    "title": "PAC CLI create requires undocumented template YAML",
    "date": "2026-02-18",
    "confirmed": 1,
    "lastConfirmed": "2026-02-18",
    "tags": ["pac-cli", "playwright", "agent-creation", "template"],
    "status": "active",
    "projects": ["builder-pm"]
  }]
}
```

**ID format:** `{file-prefix}-NNN` — e.g., `bm-001` (build-methods), `cn-001` (connectors), `in-001` (instructions), etc.

**Status values:** `active` (in use), `stale` (not confirmed > 6 months), `deprecated` (contradicted by 2+ builds), `superseded` (references removed component).

### Comparison Engine

Before writing any learning, the 4-step comparison runs:

1. Read `index.json` entries with overlapping tags (2+ tag match)
2. Decide: same scenario → BUMP count | contradiction → FLAG | new → ADD
3. Check related cache files for missing/contradicted info
4. Execute: BUMP / ADD / SKIP / FLAG — update `index.json`

### How They're Retrieved

Learnings are consulted at specific points across **all workflow skills** (not just research):

| Skill | Phase/Step | Files Read |
|-------|-----------|-----------|
| `/mcs-research` | Phase B | `connectors.md`, `integrations.md`, `customer-patterns.md` |
| `/mcs-research` | Phase C | `architecture.md`, `instructions.md` |
| `/mcs-research` | Phase D | `topics-triggers.md`, `eval-testing.md` |
| `/mcs-build` | Before Step 1 | `build-methods.md` |
| `/mcs-build` | Before Step 3 | `connectors.md`, `integrations.md` |
| `/mcs-build` | Before Step 4 | `topics-triggers.md` |
| `/mcs-eval` | Before Step 2 | `eval-testing.md` |
| `/mcs-fix` | Step 2 | `eval-testing.md`, `instructions.md`, `topics-triggers.md` |

Learnings are **options, not defaults**. Higher `Confirmed` count = higher weight, but the user always decides.

> "Official docs recommend X. However, in a past build for [customer], we found Y works better because [reason] (confirmed in 3 builds). Consider both options."

### Entry Format

```markdown
### [Title] {#id} — [Date]
**Context:** [Customer/project, what was being built]
**Tried:** [Initial approach]
**Result:** [What happened]
**Better approach:** [What worked or was recommended]
**Confirmed:** [N] build(s) | Last confirmed: [YYYY-MM-DD]
**Related cache:** [cache file(s) if applicable]
**Tags:** #tag1 #tag2
```

When the same insight is confirmed in another build, bump `Confirmed` count and `Last confirmed` date — don't create a duplicate entry. Update `index.json` accordingly.

**Variant format:** `customer-patterns.md` uses `**Pattern:**` and `**Recommendation:**` instead of `**Tried:**` / `**Result:**` / `**Better approach:**` because customer patterns are observational (not experiment-based). All other fields (`{#id}`, `Confirmed`, `Last confirmed`, `Related cache`, `Tags`) are the same.

### Staleness Rules

| Condition | Status | Action |
|-----------|--------|--------|
| Not confirmed in > 6 months | `stale` | Flag during session startup |
| Contradicted by 2+ builds | `deprecated` | Flag and recommend removal |
| References removed component | `superseded` | Flag and recommend update |

Reported during session startup: `Learnings: N active, M stale, K deprecated`
