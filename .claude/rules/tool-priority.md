---
paths:
  - ".claude/skills/mcs-build/**"
  - ".claude/skills/mcs-eval/**"
  - ".claude/skills/mcs-fix/**"
  - ".claude/skills/mcs-deploy/**"
  - "tools/**"
---

# Hybrid Build Stack: Tool Priority

Use the best tool for each job. User-guided manual steps serve as a last resort because each tool layer has different strengths, and matching the right tool to the task avoids unnecessary complexity.

## Tool Priority Order

| Priority | Tool | Use For |
|----------|------|---------|
| 1 | PAC CLI | Listing agents, solution ALM |
| 2 | MCS LSP Wrapper | Instructions, model, topics, knowledge (sites/URLs), full component sync (`tools/mcs-lsp.js`) |
| 3 | Island Gateway API | Model catalog, component reads, routing, settings, eval upload/run (`tools/island-client.js`) |
| 4 | Flow Manager | Power Automate cloud flow CRUD + composition -- trigger creation, flow composition from specs, validation, connector schema discovery, schedule/message updates, activate/deactivate (`tools/flow-manager.js` + `tools/lib/flow-composer.js` + `tools/lib/connector-schema.js`) |
| 5 | Dataverse API | File uploads (PDF/DOCX), bot name PATCH, PvaPublish, security, deletion |
| 6 | Direct Line API | Evaluation / testing (send messages, compare responses) |

Detailed capabilities per layer: See `knowledge/cache/api-capabilities.md`
Decision flow and build phase mapping: See `knowledge/frameworks/tool-priority.md`

## Unified Auth Gate

Account + environment selection determines everything. Confirm the environment with the user even on resume because an account can have multiple environments and operating in the wrong one has no undo.

| Layer | What It Covers | How | Required? |
|-------|---------------|-----|-----------|
| Azure CLI | LSP, Island Gateway, Dataverse, Direct Line | `az login --tenant` (auto, browser popup) | Yes -- blocks build |
| Dataverse API | Environment reachable, token works | `az account get-access-token` + `GET /bots?$top=1` | Yes -- blocks build |
| PAC CLI | Listing agents, solution ALM | `pac auth select` (automatic) | No -- best-effort, API fallback available |

**Build gate:** Two-step selection (account then environment) + three-layer verification. Azure CLI and Dataverse must both pass. PAC CLI failure produces a warning only because API fallback covers everything PAC CLI does.

**Eval/fix:** Re-verify against `buildStatus` values + Dataverse reachable check.
