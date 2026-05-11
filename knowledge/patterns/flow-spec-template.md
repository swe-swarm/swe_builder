# Flow Spec Template

This is the standard format for `flow-spec.md` files produced by the Flow Designer teammate.

## flow-spec.md Format

Write to `Build-Guides/{projectId}/agents/{agentId}/flow-spec.md`:

```markdown
# Power Automate Flow Specification: {Agent Name}

**Generated:** {date}
**Solution Type:** {flow | hybrid}
**Total Flows:** {N}
**Automatable:** {N} (via flow-manager.js) | **Manual Setup:** {N}

## Flow Overview

| # | Flow Name | Trigger | Capabilities Served | Automatable | License |
|---|-----------|---------|--------------------|-----------|---------|
{summary table}

---

## Flow 1: {Flow Name}

### Purpose
{What this flow does and which capabilities it serves}

### Trigger
- **Type:** {trigger type}
- **Configuration:** {specific config}
- **Automatable:** {Yes -> flow-manager.js command | No -> manual PA portal setup}

{If automatable:}
```bash
node tools/flow-manager.js create-trigger --org "{orgUrl}" --bot {botId} --preset {preset} --message "{msg}"
```

### Actions (in order)

| Step | Action | Connector | Input | Output | Notes |
|------|--------|-----------|-------|--------|-------|
| 1 | {action name} | {connector} | {what it receives} | {what it produces} | {gotchas} |
| 2 | {action name} | {connector} | {from step 1 output} | {what it produces} | |
| ... | | | | | |

### Data Flow
```
Trigger -> [Step 1: Get data from {source}]
       -> [Step 2: Transform/filter]
       -> [Step 3: Write to {destination}]
       -> [Step 4: Notify/respond]
```

### Error Handling
- **Step {N} failure:** {what happens -- retry, skip, notify}
- **Timeout:** {fallback behavior}

### Connector Requirements
| Connector | Type | License | Auth Method |
|-----------|------|---------|-------------|
{connectors needed for this flow}

{If hybrid -- agent integration point:}
### Agent Integration
- **How agent calls this flow:** {connector action / HTTP trigger / topic node}
- **Input from agent:** {parameters the agent passes}
- **Output to agent:** {what the flow returns -- remember String/Number/Boolean only}
- **Timeout consideration:** {flow must complete within 120s for sync calls}

---

{Repeat for each flow}

---

## Implementation Priority

| Priority | Flow | Reason | Dependency |
|----------|------|--------|-----------|
| 1 | {flow name} | {why first -- blocks other flows or critical path} | None |
| 2 | {flow name} | {why second} | Depends on Flow 1 |
| ... | | | |

## Limitations & Manual Steps

| Item | Why Manual | Instructions |
|------|-----------|-------------|
| {trigger/action that can't be automated} | {reason} | {step-by-step for the lead} |

## flow-manager.js Commands Summary

Copy-paste these commands in order to create all automatable flows:

```bash
# Compose flows from spec files
node tools/flow-manager.js compose --spec flow-spec.json --output flow-1-def.json

# Validate before creating
node tools/flow-manager.js validate --definition flow-1-def.json

# Create flows in Dataverse
node tools/flow-manager.js create-flow --org "{orgUrl}" --definition flow-1-def.json --name "{name}" --activate

# Or for simple recurrence triggers (legacy method):
node tools/flow-manager.js create-trigger --org "{orgUrl}" --bot {id} --preset {preset} --message "{msg}"

# Activate all flows
node tools/flow-manager.js activate --org "{orgUrl}" --flow {flowId1}
node tools/flow-manager.js activate --org "{orgUrl}" --flow {flowId2}
```
```
