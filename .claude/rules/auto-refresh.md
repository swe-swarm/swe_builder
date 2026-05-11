---
description: Auto-check upstream repos and knowledge cache freshness on session start
globs: ["**"]
---

# Auto-Refresh Rule (3-Day Schedule)

On session start, before doing any work, silently check freshness:

1. **Read** `knowledge/upstream-repos.json` → check `lastFullCheck` date
2. If **3+ days** since last check:
   - Run `node tools/upstream-check.js --update` in background
   - Report changes to user: "[Upstream check] N repos checked, M have changes"
   - If changes detected, suggest `/mcs-refresh` for full knowledge update
3. If **< 3 days**: skip silently (no message to user)

Also check knowledge cache staleness:
1. **Scan** `knowledge/cache/*.md` headers for `last_verified` dates
2. If any Tier 1 file (triggers, models, mcp-servers, connectors, knowledge-sources, channels) is **> 3 days stale**:
   - Flag to user: "[Cache] N Tier 1 files stale — run /mcs-refresh"
3. If only Tier 2-3 files stale: note but don't interrupt

**Do NOT block** the user's first request for this check. Run it in background or after the first response.

**Skip entirely** if the user's first message is urgent (error, fix, deploy) or if no `gh` CLI is available.
