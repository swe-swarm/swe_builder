---
name: mcs-deploy
description: "Deploy agents from dev to prod environments. Two modes: agent-level (fast, replicate-agent.js) and solution-level (PAC CLI export/import, ALM-ready). Includes pre-deploy validation, connection mapping, post-deploy smoke test."
---

# MCS Deployment — Cross-Environment Agent Promotion

Deploy a built and published agent from a source (dev) environment to a target (prod) environment. Two deployment modes cover different ALM needs.

## BUILD DISCIPLINE — VERIFY-THEN-MARK

**This skill has SEVEN separate sub-tasks. Each must be tracked and verified independently.**

| Sub-task | What it does | How to verify |
|----------|-------------|--------------|
| **Pre-deploy validation** | Check build status, eval scores, workspace freshness | Validation report printed |
| **Mode selection** | Auto-detect or user-select agent vs solution | Mode logged |
| **Deploy** | Replicate agent or export/import solution | Target bot ID returned |
| **Connection mapping** | Identify tools needing manual reconnection | Report generated |
| **Publish in target** | PvaPublish bound action on target bot | Publish timestamp returned |
| **Smoke test** | Run boundaries eval set on target agent | Pass/fail result |
| **Write deployStatus** | Update brief.json with deployment results | Read brief.json back |

## Input

```
/mcs-deploy {projectId} {agentId}                    # Auto-detect mode, full deploy
/mcs-deploy {projectId} {agentId} --mode solution    # Force solution-level deploy
/mcs-deploy {projectId} {agentId} --mode agent       # Force agent-level deploy
/mcs-deploy {projectId} {agentId} --skip-smoke       # Skip post-deploy smoke test
```

Reads from:
- `Build-Guides/{projectId}/agents/{agentId}/brief.json` — buildStatus, evalSets, integrations, architecture

Writes to:
- `Build-Guides/{projectId}/agents/{agentId}/brief.json` — `deployStatus` field
- `Build-Guides/{projectId}/agents/{agentId}/deployment-report.md` — customer-shareable deployment summary

## Prerequisites (Gates)

All three must pass before deployment proceeds:

### Gate 1: Build Status
- `brief.json.buildStatus.status` must be `"published"`
- If not → **STOP:** "Agent must be published before deployment. Run `/mcs-build` first."

### Gate 2: Eval Scores (Soft Gate)
- Read `brief.json.evalSets[]` — check per-set pass rates
- If boundaries < 100% → **WARN** (not a hard stop): "Boundaries eval is below 100%. Deploying anyway — review carefully."
- If quality < evalConfig.targetPassRate → **WARN:** "Quality pass rate ({X}%) is below target ({Y}%). Consider running `/mcs-fix` first."
- If no eval results exist → **WARN:** "No eval results found. Consider running `/mcs-eval` first."

### Gate 3: Dual Auth
Deploy requires auth to BOTH source and target environments. This is different from build (which only needs source).

1. **Source auth** — verify existing auth from build:
   - Read `brief.json.buildStatus.accountId` → look up in session-config.json
   - Quick check: `az account show --query tenantId -o tsv` matches source tenant
   - Verify PAC CLI: `pac auth list` shows correct source profile

2. **Target auth** — ask user for target environment:
   - If `brief.json.deployStatus.targetEnvironment` exists → confirm: "Deploy to {env}? (Y/n)"
   - If not → ask: "Which environment should we deploy to?" (present list from `pac env list` or manual entry)
   - Persist target to `brief.json.deployStatus.targetEnvironment` and `.targetAccountId`
   - If target is on a different tenant → need separate PAC CLI profile + Azure CLI login
   - If same tenant, different env → same PAC CLI profile, just different env selection

## Step 0: Mode Auto-Detection

Determine which deployment mode to use (unless user specified `--mode`):

| Condition | Recommended Mode | Reason |
|-----------|-----------------|--------|
| `architecture.type == "multi-agent"` | `solution` | Multi-agent needs all components in one package |
| Agent is in a named solution (not default) | `solution` | Solution ALM preserves relationships |
| Single agent, default solution | `agent` | Faster, simpler, no solution overhead |

Log the decision: "Auto-detected deployment mode: {mode} ({reason})"

User can override with `--mode agent` or `--mode solution`.

## Step 1: Pre-Deploy Validation

Before deploying, validate the agent is ready:

### 1a. Component Inventory
Pull the workspace to get the latest state:
```bash
node tools/mcs-lsp.js pull --env "{sourceEnv}" --bot-id "{botId}" --workspace "Build-Guides/{projectId}/agents/{agentId}/workspace"
```

Inventory what will be deployed:
- Topics (count + names)
- Tools/connectors (count + names + auth methods)
- Knowledge sources (count + names)
- Model configuration

### 1b. Environment-Specific Value Scan
Grep the workspace for values that might be environment-specific:
- Hardcoded URLs (e.g., `https://org123.crm.dynamics.com`)
- Environment variable references
- Connection reference IDs
- Specific tenant/org IDs

Flag any found: "These values may need updating in the target environment."

### 1c. Validation Report
Print a summary:
```
Pre-Deploy Validation:
  Build status: published (2026-03-01)
  Eval scores: boundaries 100%, quality 90%, edge-cases 85%
  Components: 4 topics, 2 tools, 1 knowledge source
  Env-specific values: 1 found (Dataverse URL in tool config)
  Mode: agent (auto-detected — single agent, default solution)
```

**VERIFY:** Validation report printed and user acknowledges.

## Step 2a: Agent Mode Deploy

Uses `replicate-agent.js` for fast, lightweight deployment:

```bash
node tools/replicate-agent.js \
  --source-env "{sourceEnvUrl}" \
  --target-env "{targetEnvUrl}" \
  --bot-id "{sourceBotId}" \
  --bot-name "{agentName}"
```

This tool:
1. Creates a new bot in the target environment (Dataverse POST + PvaProvision)
2. Clones the LSP workspace from source
3. Pushes the workspace to the target bot

**VERIFY:** Command returns target bot ID. Log it.

## Step 2b: Solution Mode Deploy

Uses PAC CLI solution export/import for ALM-ready deployment:

### Export from source
```bash
pac solution export --name "{solutionName}" --path "Build-Guides/{projectId}/agents/{agentId}/{solutionName}.zip" --managed --overwrite --async
```

If the solution isn't managed yet:
```bash
pac solution export --name "{solutionName}" --path "Build-Guides/{projectId}/agents/{agentId}/{solutionName}.zip" --overwrite --async
```

### Switch to target environment
```bash
pac auth select --index {targetProfileIndex}
# OR if same tenant:
pac env select --environment "{targetEnvUrl}"
```

### Import to target
```bash
pac solution import --path "Build-Guides/{projectId}/agents/{agentId}/{solutionName}.zip" --publish-changes --activate-plugins --async
```

**VERIFY:** Import completes without errors. Check `pac solution list` in target for the solution.

### Switch back to source
```bash
pac auth select --index {sourceProfileIndex}
```

## Step 3: Connection Mapping Report

Many tools/connectors need manual reconnection in the target environment because connection references are environment-specific.

For each integration in `brief.json.integrations[]`:

| Integration | Auth Method | Action Needed |
|------------|-------------|---------------|
| MCP servers | Service principal | Re-authenticate in target MCS |
| OAuth connectors | User delegated | User must sign in via MCS UI in target |
| API key connectors | API Key | Re-enter API key in target |
| Dataverse (same tenant) | None | Auto-connects if same tenant |
| Dataverse (cross-tenant) | Service principal | Configure service principal in target |

Generate a checklist:
```markdown
## Connection Mapping — Manual Steps Required

- [ ] SharePoint/OneDrive MCP: Re-authenticate in target MCS → Settings → Tools
- [ ] ServiceNow connector: Enter API key in target Power Platform admin center
- [ ] Custom connector "OrderAPI": Update base URL to production endpoint
```

**VERIFY:** Connection mapping report written.

## Step 4: Publish in Target

After deployment and connection mapping:

### Agent mode
Get the target bot ID from Step 2a, then:
```bash
# Use Dataverse PvaPublish bound action
node -e "
const { post } = require('./tools/lib/http.js');
// PvaPublish bound action on target bot
"
```

Or use PAC CLI (switch to target env first):
```bash
pac copilot publish --bot "{targetBotId}"
```

### Solution mode
Already published via `--publish-changes` in import step. Verify:
```bash
pac copilot list
# Check that the agent appears and has a recent publish date
```

**VERIFY:** Agent is published in target environment.

## Step 5: Post-Deploy Smoke Test

Unless `--skip-smoke` was specified, run the boundaries eval set against the target agent to verify basic functionality:

1. Acquire Direct Line token for the TARGET agent
2. Run boundaries eval set only:
```bash
node tools/direct-line-test.js --token-endpoint "{targetTokenEndpoint}" --brief "Build-Guides/{projectId}/agents/{agentId}/brief.json" --set boundaries --verbose
```

3. If Direct Line token not available for target:
   - Log: "Could not acquire Direct Line token for target. Skipping smoke test."
   - Set `smokeTestResult: "skipped"` with note "Direct Line token not available in target"

4. Results:
   - **All pass** → `smokeTestResult: "pass"`
   - **Any fail** → `smokeTestResult: "fail"` + warn user: "Smoke test failed — {N} boundaries tests failed in target. Review connection mapping and agent state."

**VERIFY:** Smoke test result recorded.

## Step 6: Write deployStatus to brief.json

Update `brief.json.deployStatus`:

```json
{
  "deployStatus": {
    "status": "deployed",
    "mode": "agent",
    "targetEnvironment": "Production (org456)",
    "targetAccountId": "admin-prod",
    "targetBotId": "abc-123-def",
    "targetDataverseUrl": "https://org456.crm.dynamics.com",
    "deployedAt": "2026-03-04T14:30:00Z",
    "smokeTestResult": "pass",
    "connectionsMapped": false,
    "lastDeployError": null
  }
}
```

If deploy failed at any step:
```json
{
  "deployStatus": {
    "status": "failed",
    "lastDeployError": "Solution import failed: missing dependency XYZ"
  }
}
```

**VERIFY:** Read brief.json back. Confirm deployStatus is written correctly.

## Step 7: Generate Deployment Report

Write `Build-Guides/{projectId}/agents/{agentId}/deployment-report.md`:

```markdown
# Deployment Report: {Agent Name}

**Date:** {timestamp}
**Source:** {sourceEnv}
**Target:** {targetEnv}
**Mode:** {agent | solution}
**Status:** {Deployed | Failed}

## Pre-Deploy Validation
- Build: published ({publishDate})
- Eval scores: boundaries {X}%, quality {Y}%, edge-cases {Z}%
- Components: {N} topics, {N} tools, {N} knowledge sources

## Deployment Summary
- Target bot ID: {id}
- Deployed at: {timestamp}
- Method: {replicate-agent.js | PAC CLI solution import}

## Connection Mapping (Manual Steps)
- [ ] {list of connections needing manual setup}

## Smoke Test
- Result: {pass | fail | skipped}
- Tests run: {N} (boundaries set)
- {Details if failures}

## Next Steps
1. Complete connection mapping (see checklist above)
2. Run full eval suite on target: `/mcs-eval {projectId} {agentId}` (after switching to target env)
3. Configure channels in target environment
4. Share with pilot users
```

**VERIFY:** Report file exists and contains all sections.

### Step 7.5: GPT Deployment Report Review

After generating the deployment report, fire GPT to catch issues the lead may have missed:

```bash
node tools/multi-model-review.js review-code --file "Build-Guides/{projectId}/agents/{agentId}/deployment-report.md" --context "Deployment report review: check connection mapping completeness, verify pre/post checklists match actual integrations, flag missing rollback steps"
```

GPT catches: incomplete connection mapping (integration in brief but not in report), checklist items that contradict build status, missing environment-specific values. Merge findings into the report before finalizing. If GPT is unavailable, proceed with the report as-is.

## Error Handling

| Error | Action |
|-------|--------|
| `replicate-agent.js` fails | Check target env permissions. Try solution mode as fallback. |
| Solution import fails (missing dependency) | List missing dependencies. Ask user to install prerequisites in target. |
| Solution import fails (version conflict) | Ask user: upgrade existing or import as new? Use `--stage-and-upgrade` if upgrading. |
| Publish fails in target | Check if connections are mapped. Publish may fail with broken connection refs. |
| Smoke test token acquisition fails | Use `--skip-smoke` and test manually in MCS Test Chat. |
| Target env auth fails | Verify PAC CLI profile exists for target. May need `pac auth create` for new env. |

## Important Rules

- **brief.json deployStatus is the primary output** — the dashboard reads deployment state from it
- **deployment-report.md is the customer-shareable summary**
- **Never deploy without the 3 gates passing** because skipping gates risks deploying a broken or untested agent to production
- **Connection mapping is always generated** — even if no manual steps are needed (report says "No manual connection mapping needed"), because omitting it causes IT admins to miss reconnection steps
- **Smoke test only runs boundaries set** — full eval should be run separately via `/mcs-eval`
- **No teammates needed** — this is a lead-only execution skill (mechanical, no generation)
- **Always switch PAC CLI back to source** after solution mode deploy because leaving it on target breaks subsequent build commands
- **Never auto-delete the source agent** after deployment — that's a user decision, and accidental deletion is unrecoverable
- **Fire GPT review on every generated report** because deployment reports go to IT admins who act on them — errors in the report cause deployment failures
