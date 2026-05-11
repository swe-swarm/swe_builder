<!-- CACHE METADATA
last_verified: 2026-02-19
sources: [MS Learn, PAC CLI docs, VS Code Extension docs, Dataverse entity reference, WebSearch Feb 2026]
confidence: high
refresh_trigger: weekly
-->
# MCS Agent Lifecycle & ALM — Quick Reference

## Creation Methods

| Method | Native MCS? | Captures Tools/Knowledge/Model? |
|--------|------------|--------------------------------|
| MCS UI | Yes | Yes (full) |
| PAC CLI (`pac copilot create`) | Yes | **No** — topics/instructions only. Template format undocumented. **Prefer Playwright for creation.** PAC CLI template-based creation is a fallback for environments where browser is unavailable. |
| **VS Code Extension (GA Jan 2026)** | Yes | Yes (full YAML clone) — clone/edit/sync YAML, but clone/apply are GUI-only |
| Agent Builder (M365) | Yes (limited) | Limited |
| M365 Agents SDK | No — external | N/A |
| Azure AI Foundry | No — connected (preview) | N/A |

**Agent limits**: name 42 chars, description 1,024 chars, instructions 8,000 chars, icon PNG <72KB 192x192. Primary language CANNOT change after creation.

## Publishing

- Draft → Publish → Live on ALL channels simultaneously
- Existing Teams conversations: old version until idle >30 min (or "start over")
- **Not included in publish** (manual post-deploy): App Insights, manual auth, Direct Line security, channels, sharing

### Methods
| Method | Command |
|--------|---------|
| PAC CLI | `pac copilot publish --bot <id>` |
| Dataverse API | `POST bots(<id>)/Microsoft.Dynamics.CRM.PvaPublish` |
| MCS UI | Click "Publish" |

## Component Type Codes

| Code | Type | Code | Type |
|------|------|------|------|
| 0 | Topic (classic) | 9 | Topic (V2/modern) |
| 14 | Bot File Attachment | **15** | **Custom GPT (instructions)** |
| **16** | **Knowledge Source** | 17 | External Trigger |
| 18 | Copilot Settings | 19 | Test Case |

Full list: 0-19 (also includes Skill, Variable, Entity, Dialog, Trigger, NLU, LG, Schema, Translations — types 1-8, 10-13)

## Bot Entity Key Fields

| Field | Values |
|-------|--------|
| `statecode` | 0=Active, 1=Inactive |
| `statuscode` | 1=Provisioned, 2=Deprovisioned, 3=Provisioning, 4=ProvisionFailed, 5=MissingLicense |
| `componentstate` | 0=Published, 1=Unpublished, 2=Deleted |
| `accesscontrolpolicy` | 0=Any, 1=Copilot readers, 2=Group membership, 3=Any multi-tenant |
| `authenticationmode` | 0=Unspecified, 1=None, 2=Integrated, 3=Custom AAD, 4=Generic OAuth2 |

## Bound Actions on `bot` Entity

`PvaPublish`, `PvaPublishStatus`, `PvaProvision`, `PvaGetDirectLineEndpoint`, `PvaDeleteBot`, `PvaAuthorize`, `PvaCreateBotComponents`, `PvaCreateContentSnapshot`

## Solution ALM

- Export: `pac solution export --name "Name" --path "file.zip" [--managed]`
- Import: `pac solution import --path "file.zip" --publish-changes`
- **Custom connectors must be imported FIRST**, then agent solution
- Cannot export topics with `.` in names; comments NOT exported
- Managed = read-only in target; Unmanaged = editable

## VS Code Extension (GA Jan 2026)

Clone → Get (cloud→local) → Edit → Apply (local→cloud, does NOT publish). Apply blocked if unreviewed remote changes. Reattach Agent for cross-environment.

**Key capabilities:**
- Full YAML clone of agents (topics, instructions, settings)
- Edit locally with IntelliSense
- Sync changes back to MCS
- **Limitation:** Clone and Apply operations are GUI-only (not scriptable)

## Versioning & Rollback

- **No built-in version numbering** for agents
- Rollback via: solution reimport, Git revert + VS Code apply, template recreation
- No native "rollback to previous version" button

## PAC CLI Quick Reference

```powershell
pac copilot list | create | publish | status | extract-template
pac copilot extract-translation | merge-translation
pac copilot model list | model predict
pac copilot mcp --run
pac solution list | export | import | check
pac pipeline list | deploy
```
