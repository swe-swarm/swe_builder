# Tool Priority Framework

## Priority Order

| Priority | Tool | Use For |
|----------|------|---------|
| 1 | **PAC CLI** | Agent publishing, status checks, solution export/import |
| 2 | **Dataverse API** | Instructions update, knowledge file upload, security settings |
| 3 | **Code Editor YAML** | Topic authoring, adaptive cards, branching logic, trigger phrases |
| 4 | **Direct Line API** | Evaluation / testing (send messages, compare responses) |
| 5 | **Playwright MCP** | Agent creation, model selection, tool/connector addition, OAuth connections, child agent connection, generative AI settings |

## Decision Flow

```
For each build step, ask:
  Can PAC CLI do this?       → YES → Use PAC CLI
  Can Dataverse API do this? → YES → Use Dataverse API
  Is this topic/card work?   → YES → Use Code Editor YAML
  Is this testing/eval?      → YES → Use Direct Line API
  None of the above?         → Use Playwright (with silent browser verification)
```

## Detailed Capability Matrix

See `knowledge/cache/api-capabilities.md` for the full breakdown of what each layer can do.

## Key Principle

**Every Playwright interaction is a fragility risk.** Before using the browser, always check `knowledge/cache/api-capabilities.md` to see if a non-browser alternative exists. APIs are added over time — what required Playwright last month may have an API now.

## Build Phase → Tool Mapping

| Build Phase | Primary Tool | Fallback |
|-------------|-------------|----------|
| Create agent | Playwright (MCS UI) | PAC CLI (`pac copilot create` — requires template) |
| Set instructions | Dataverse API (PATCH botcomponent type 15) | Playwright |
| Upload knowledge | Dataverse API (POST botcomponent type 16) | Playwright |
| Select model | Playwright (no API) | — |
| Add tools/connectors | Playwright (no API) | — |
| Create connections | Playwright (no API) | — |
| Author topics | Code Editor YAML (paste via Playwright) | Playwright canvas |
| Publish | PAC CLI (`pac copilot publish`) | Playwright / Dataverse PvaPublish |
| Test | Direct Line API | Playwright test chat |
| Connect child agents | Playwright (no API) | — |
| Enable sharing | Playwright (no API) | — |
