<!-- CACHE METADATA
last_verified: 2026-02-19
sources: [MS Learn, MCS UI, community]
confidence: high
refresh_trigger: before_architecture
-->
# MCS Power Automate Integration — Quick Reference

## Agent Flows vs Cloud Flows (Critical)

| Aspect | Agent Flows (Native) | Cloud Flows (PA) |
|--------|---------------------|------------------|
| Created in | Copilot Studio | Power Automate |
| PA license needed? | **No** (Copilot Credits) | Yes |
| Desktop flows? | No | Yes |
| Conversion | Cloud → Agent (one-way, irreversible) | — |
| Trigger | `When an agent calls the flow` | `Run a flow from Copilot` |

## Input/Output — ONLY 3 Types Supported

| Supported | NOT Supported |
|-----------|--------------|
| **String**, **Number**, **Boolean** | Object, Date, List/Array |

**Workarounds**: serialize JSON/arrays/dates as String, parse inside flow.

## Execution Limits

| Limit | Value |
|-------|-------|
| Synchronous response | **100 seconds** |
| Express mode (preview) | **2 minutes** |
| Data received from flow | **1 MB** per action |
| Connector payload | **5 MB** (public) / **450 KB** (GCC) |
| Actions after Respond to Agent | Up to **30 days** |

## Event Triggers (Autonomous Agents)

Requires generative orchestration. Triggers use **maker credentials only**.

| Trigger | Event |
|---------|-------|
| Dataverse | Row added/modified/deleted |
| SharePoint | Item/file created |
| Outlook | New email |
| Planner | Task completed/assigned |
| Recurrence | Time schedule |
| Teams / OneDrive / Dynamics 365 | Various events |

**Payload instructions**: customize per-trigger what agent should do. Better than agent-level instructions for multi-trigger agents.

## Flow Error Codes

| Code | Meaning | Fix |
|------|---------|-----|
| `FlowActionTimedOut` | >100 sec | Optimize, express mode, defer work after Respond |
| `FlowActionBadRequest` | Type mismatch | Verify variable types match |
| `AsyncResponsePayloadTooLarge` | Output too large | Reduce payload, filter |
| `BindingKeyNotFoundError` | Inputs changed | Remove and re-add flow |

## Flow vs Connector Decision

| Need | Use |
|------|-----|
| Single API call | Connector action (direct) |
| Multi-step logic / transforms | Agent flow |
| Approval workflow | Agent flow (multistage + AI stages) |
| Error handling beyond basic | Agent flow |
| RPA / desktop automation | Computer Use tool (NOT flow) |

## Recurrence Billing

Every activation = 1 trigger payload message → counts toward Copilot Credits. Polling: Free plan = 15 min, Office 365 = 5 min.
