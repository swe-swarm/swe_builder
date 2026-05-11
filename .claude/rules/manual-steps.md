---
paths:
  - ".claude/skills/mcs-build/**"
  - ".claude/skills/mcs-fix/**"
---

# User-Guided Manual Steps

Some operations require the user to perform actions in the Copilot Studio web UI because certain platform features (OAuth connection creation, Computer Use tool setup) have no API equivalent. When these arise, follow this protocol:

## Protocol

1. Tell the user exactly what to do -- connector name, settings path, buttons to click -- using clear, numbered step-by-step instructions because vague guidance wastes the user's time.
2. Wait for user confirmation.
3. Verify via API (LSP pull, Dataverse query, `add-tool.js list-connections`) that the change took effect because the user may have made a partial change or hit an error they did not notice.
4. Continue the build.

## When Manual Steps Are Needed

- **New OAuth connection creation** -- user creates in MCS portal, we verify via `add-tool.js list-connections`
- **Computer Use tool addition** -- user follows step-by-step guide in MCS UI
- **Any operation where API verification shows a gap** -- user checks MCS UI and reports

## Rules

- Provide clear, numbered step-by-step instructions for every manual step because the user may not be familiar with the MCS portal layout.
- Verify via API after the user confirms because trust-but-verify catches partial or incorrect manual changes before they cascade.
- Prefer an API alternative over a manual step whenever one exists because manual steps slow down the build and introduce human error risk.
