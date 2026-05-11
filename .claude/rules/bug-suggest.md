---
paths:
  - ".claude/skills/bug/**"
  - ".claude/skills/suggest/**"
---

# Bug Reports and Suggestions

Users file bugs and suggestions via the header buttons, which open a feedback dialog. The dialog collects a description plus auto-gathered context (project, agent, page, build/eval status), then dispatches `/bug` or `/suggest` to the embedded Claude terminal for GitHub issue creation.

## Issue Creation Rules

- Target the GitHub repository `swe-swarm/swe_builder` using `gh issue create --repo swe-swarm/swe_builder`.
- Use the `bug` label for bugs and the `enhancement` label for suggestions because consistent labeling enables triage filtering.
- Preview the title and body before submitting because auto-submit risks creating malformed or duplicate issues. Confirm with the user first.
- Use a HEREDOC for the `--body` argument to preserve formatting because inline strings lose newlines and markdown structure.
- Auto-enrich with session context (project, agent, page, build status, eval score) when available because contextual issues are faster to triage.
- Keep titles under 70 characters, prefixed with `Bug: ...` or `Suggestion: ...` because short titles render well in GitHub issue lists.
- When invoked with pre-filled args from the dashboard dialog, skip the "ask" step and go straight to drafting because the user already provided the description through the UI.
