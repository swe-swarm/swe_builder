---
paths:
  - ".claude/skills/mcs-research/**"
  - ".claude/skills/mcs-build/**"
  - ".claude/skills/mcs-eval/**"
  - ".claude/skills/mcs-fix/**"
  - ".claude/agents/**"
---

# Agent Teams (Experimental)

Agent Teams enables bidirectional communication between specialist teammates who challenge each other's work. The lead orchestrates, teammates do the reasoning and generation, and the lead handles MCS execution (LSP Wrapper, Island Gateway API, PAC CLI, Dataverse) because MCP access in teammates is unreliable.

Enabled via: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `.claude/settings.json`

## Teammates

| Teammate | Role | Key Strength | GPT Usage |
|----------|------|-------------|-----------|
| Research Analyst | Discover MCS capabilities across multiple sources | Prevents false limitation claims | `review-components` after research |
| Prompt Engineer | Write MCS agent instructions + review/sharpen skill files | Sharp instructions, correct `/` references | `generate-instructions` co-gen + merge |
| Topic Engineer | Generate validated YAML topics + adaptive cards | Syntax-correct YAML, channel-safe cards | `generate-topics` co-gen for 3+ node topics |
| QA Challenger | Review all outputs, find gaps, challenge claims | Catches errors before they hit MCS | `generate-evals` co-gen + all `review-*` commands |
| Repo Checker | Validate repo integrity after changes | Catches broken paths, stale docs, drift | `review-code` on changed files + semantic consistency |
| Repo Optimizer | Audit repo for dead code, duplication, bloat | Catches waste before it accumulates | `review-code` for dead code + complexity analysis |
| Flow Designer | Design Power Automate flow specs from brief.json capabilities | Actionable flow specs with triggers, actions, connectors | `review-flow` before returning specs |

Every teammate has GPT-5.4 access via `tools/multi-model-review.js`. Teammates follow the same merge protocol: union of findings, stricter wins, and GPT is never blocking because if it is unavailable Claude proceeds alone.

Definitions: `.claude/agents/` (research-analyst.md, prompt-engineer.md, topic-engineer.md, qa-challenger.md, repo-checker.md, repo-optimizer.md, flow-designer.md)

## When to Use Agent Teams

**During MCS workflow skills:**
- **Research phase** (`/mcs-research`): Research Analyst searches for external connectors/MCP (only if Priority 5-6 integrations), then PE + QA + TE (+ FD if flow/hybrid) run in parallel in Phase C: PE writes instructions, QA generates eval sets, TE validates topic feasibility, Flow Designer writes flow-spec.md (only when solutionType is "flow" or "hybrid"). Lead does inline instruction review.
- **Build phase** (`/mcs-build`): Topic Engineer generates YAML, QA Challenger reviews before execution, eval-driven iteration loop (safety gate then functional per-capability then resilience), Research Analyst on-demand (connector issues), Prompt Engineer on-demand (instruction adjustments + fix iteration).
- **Eval phase** (`/mcs-eval`): Runs eval sets (all or specific), writes per-test results to evalSets. QA Challenger analyzes failures when sets miss thresholds.
- **Fix phase** (`/mcs-fix`): QA Challenger classifies failures, Prompt Engineer fixes instructions, Topic Engineer fixes topics.

**GPT-5.4 co-generation + review (all phases):**
GPT runs in parallel with every Claude generation and review at zero added latency. Teammates fire `multi-model-review.js` internally. Protocol: union of findings/content, stricter wins on conflicts. GPT is never blocking.

| Phase | GPT Action (parallel with Claude) |
|-------|----------------------------------|
| Research Phase C | PE: `generate-instructions` (co-gen), QA: `generate-evals` (co-gen), TE: `generate-topics` for feasibility |
| Research Step 3.5 | `review-brief` + `review-instructions` + `review-components` + `review-flow` (if hybrid) |
| Build Step 4 | TE: `generate-topics` for complex topics (3+ nodes, co-gen) |
| Build Step 5.6 | `review-brief` + `review-instructions` + per-topic `review-topics` |
| Eval | Dual scoring on 4 semantic methods (CompareMeaning, GeneralQuality, TextSimilarity, ToolUse) |
| Fix | PE: `generate-instructions` (co-gen for fix proposals), TE: `generate-topics` (co-gen for topic fixes) |

**During general development (Tier 2-3 checks):**
- Tier 2: Repo Checker in background after 3+ file changes or code changes
- Tier 3: QA Challenger before irreversible decisions (schema, workflow, architecture)

## Workflow: Lead + Teammates

```
Lead spawns team for build:
  Research Analyst -> discovers components (parallel)
  Prompt Engineer -> writes instructions
  Topic Engineer -> generates topic YAML + adaptive cards
  QA Challenger -> reviews all outputs, challenges, finds gaps

  Teammates communicate directly:
    QA -> Prompt Engineer: "Instructions reference /ToolName that isn't configured"
    QA -> Topic Engineer: "YAML node ID duplicated on line 14"
    Topic Engineer -> Prompt Engineer: "Your instructions expect Topic.orderStatus but no topic initializes it"

Lead executes validated outputs:
  - Pushes topic YAML via LSP Wrapper (mcs-lsp.js push)
  - Sets instructions via LSP push (agent.mcs.yml) or Dataverse API
  - Configures tools via add-tool.js + LSP push (user creates OAuth connections manually if needed)
  - Publishes (Dataverse PvaPublish, PAC CLI fallback)
```

## Rules

- The lead delegates instruction, YAML, and card generation to teammates because specialist teammates produce higher-quality domain-specific content.
- The lead handles all MCS execution (LSP Wrapper, Island Gateway API, PAC CLI, Dataverse API) because MCP access in teammates is unreliable.
- QA Challenger reviews every teammate output before the lead executes it because catching errors before MCS push avoids costly rollbacks.
- Teammates challenge each other through bidirectional communication because that is the core value of the team structure.
- All generated artifacts go to files (Build-Guides/[Project]/topics/, instructions, etc.) so the lead can read and execute them deterministically.

## Proactive Quality Checks: 3 Tiers

Quality checks scale with risk. Not every response needs a full team debate.

**Tier 1: Self-Check (after any edits)**
After any batch of edits, do a quick inline verification: grep for broken references, re-read changed files, verify cross-references. Takes 10-20 seconds and catches obvious issues. No teammate needed.

**Tier 2: Background Repo Check (after significant changes)**
After changing 3+ files or any code changes, spawn Repo Checker in background. It runs async so work continues unblocked. Results come back in approximately 60 seconds. Fix issues if found.

**Tier 3: QA Challenge (before irreversible decisions only)**
Before committing to designs that are hard to undo (schema changes, workflow redesign, architecture decisions affecting multiple files), QA Challenger reviews and challenges the approach. This blocks work but is worth the wait for high-impact decisions.

| Trigger | Tier | Blocks Work? |
|---------|------|-------------|
| Any file edits | Tier 1: self-check (grep + re-read) | No -- inline, 10 sec |
| 3+ file changes or code changes | Tier 2: Repo Checker in background | No -- runs async |
| Schema change, workflow redesign, architecture decision | Tier 3: QA Challenger | Yes -- worth the 2-3 min |
| Before any commit | Tier 2: Repo Checker | No -- runs async |
| Before commits / weekly | Tier 2: Repo Optimizer in background | No -- runs async |
| Simple answer, status check, brainstorming | None | -- |
