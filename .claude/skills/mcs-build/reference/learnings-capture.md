# Post-Build Learnings Capture (Two-Tier)

After reconciliation and the build report, run the two-tier learnings capture. This is how the system gets smarter over time.

## Tier 1: Auto-Capture (no user confirmation)

Run automatically after every build. Scan for:

1. **Zero-deviation builds:** If nothing deviated from the spec (build-report Section 9 is "Built as specified"), auto-bump `confirmed` count for every learnings entry whose tags overlap with this build's components (e.g., an agent using Dataverse API for creation confirms `bm-001`).
2. **Cache corrections:** If any cache file was updated during the build (Step 3 refreshed api-capabilities), log the correction.
3. **Confirmed approaches:** For each build step that used a known pattern from learnings, bump the entry's `confirmed` and `lastConfirmed` in `index.json`.

## Tier 2: User-Confirmed Capture (when deviations exist)

Run when the build had deviations, errors, or discoveries:

- Did something deviate from the spec? (Already captured in build-report.md Section 9)
- Did an error force a workaround? You researched the fix — that's a learning.
- Did you discover a new component or better method? That's a learning.
- Did the user override a recommendation? That's a learning.

**Before writing, run the comparison engine** (see CLAUDE.md "Learnings Protocol" section B):
1. Check `index.json` for entries with overlapping tags
2. Same scenario -> BUMP (becomes Tier 1); new scenario -> present to user; contradiction -> FLAG both

Output a short learnings block:

```
## Learnings from this build

1. [Natural language description — e.g., "GPT-5.2 Reasoning ignores soft DECLINE boundaries. DO NOT language required."]
   **Tags:** #instructions #boundaries #gpt-5
   **File:** instructions.md
   **Action:** ADD (new entry) / BUMP bm-001 (same pattern confirmed)

Anything else to add? These will be saved to our knowledge base for future builds.
```

## Write Confirmed Learnings

After user confirms (or adds more):
- Write each learning to the appropriate `knowledge/learnings/{topic}.md` file using the entry format with `{#id}` anchors
- Update `knowledge/learnings/index.json` — add new entries or bump existing ones
- If an existing entry covers the same pattern, bump its `Confirmed` count and `lastConfirmed` instead of duplicating

## Rules

- Do not force Tier 2 — if the build was clean and routine, Tier 1 runs silently. Say "No new learnings. Approach confirmed (N entries bumped)." and move on.
- Tier 2 requires user confirmation — ask before writing new entries to learnings files.
- Tier 1 is silent — bump operations happen without user interaction.
- Keep entries concise — one insight per entry, not paragraphs.
- Update index.json in both tiers to keep the index in sync.
