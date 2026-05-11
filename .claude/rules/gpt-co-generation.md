---
paths:
  - ".claude/skills/**"
  - ".claude/agents/**"
  - "tools/**"
  - "app/**"
  - "knowledge/**"
  - "templates/**"
  - "CLAUDE.md"
  - "*.md"
  - "*.js"
  - "*.py"
  - "*.ps1"
  - "*.json"
  - "*.ts"
  - "*.tsx"
---

# Dual Model Co-Generation and Review

Fire GPT-5.4 in parallel with your work for every non-trivial task because dual-model review catches bugs during implementation rather than after. GPT serves as both a **co-generator** (produces content independently for merging) and a **reviewer** (validates content after generation). This applies to all work: MCS builds, code writing, reviews, cleanup, app updates, architecture decisions, documentation.

## When to Fire GPT (default: yes)

| Task Type | GPT Action | How |
|-----------|-----------|-----|
| Writing MCS instructions | Co-generate independently, PE merges | `generate-instructions --brief <path>` |
| Generating eval tests | Co-generate independently, QA merges | `generate-evals --brief <path>` |
| Generating topic YAML (3+ nodes) | Co-generate independently, TE merges | `generate-topics --topic-spec <path> --brief <path>` |
| Component selection | GPT reviews RA's choices | `review-components --brief <path>` |
| Flow spec design | GPT reviews FD's output | `review-flow --file <path> --brief <path>` |
| Writing code (3+ lines) | GPT reviews after writing | `review-*` or inline `chatCompletion` |
| Reviewing/auditing | GPT reviews same artifact in parallel | Fire GPT review alongside your own analysis |
| Architecture/design decisions | GPT gives a second opinion | Send decision context, get alternative perspective |
| All other non-trivial tasks | GPT reviews after completion | Appropriate `review-*` command |

## When to Skip GPT

Skip GPT for these lightweight operations because the overhead outweighs the benefit:

- Single-line fixes, typos, trivial renames
- Pure git operations (commit, push, branch)
- File reads, searches, status checks
- Trivial topics (fewer than 3 nodes) -- co-generation skipped, though review still runs
- Incremental instruction deltas (not full rewrites)
- When GPT is unavailable (exit code 3) -- proceed without it

## Merge Protocol for Co-Generation

Co-generation produces two independent outputs that must be merged. Each content type has its own merge rules:

**Instructions (PE merges):**
- Constraints: union of both sets; stricter version wins on conflicts
- Boundaries: union of both sets; "refuse" takes precedence over "redirect" over "ignore"
- Response format: take the version with tiered length floors
- Examples: pick the best from each (aim for 2-3 varied)
- Trim to 8,000 chars after merge

**Topics (TE merges):**
- Validate both with om-cli -- only merge if at least one passes
- Both pass: merge node-by-node (better error handling, richer cards, union of trigger phrases); prefer Claude's structure when they diverge
- Only one passes: use the valid one
- Neither passes: fix Claude's first because it has om-cli tooling

**Evals (QA merges):**
- Deduplicate by intent (greater than 70% keyword overlap = same test)
- Union of unique tests
- Stricter expected answers for similar tests
- Recalculate coverage distribution after merge

## Merge Protocol for Reviews

- **Union of findings** -- if either model flags something, it is worth looking at
- **Stricter wins on conflicts** -- the more conservative assessment prevails
- **Flag divergence** -- when opinions differ significantly, tell the user both positions
- **Proceed without GPT if it is slow or fails** because GPT should add value, not block progress

## Final Quality Gate — review-merged

After the lead merges all agent team outputs (instructions, topics, evals, components, flows), fire the final GPT pass:

```bash
node tools/multi-model-review.js review-merged --brief <path-to-brief.json>
```

This catches cross-artifact issues that individual reviews miss: orphaned capabilities, instruction-topic duplication, eval gaps, build feasibility blockers. Run this before any publish step. If `readyToPublish: false`, fix critical blockers first.

## How It Works

GPT-5.4 runs via the GitHub Copilot Responses API (`tools/lib/openai.js`). Auth is automatic via `gh auth token` with `copilot` scope. For structured reviews and co-generation, use `tools/multi-model-review.js` (14 commands: 3 co-generation + 7 review + 1 scoring + 1 utility + 1 learn + 1 info). For ad-hoc reviews, call `chatCompletion()` directly from a temp script via Bash.
