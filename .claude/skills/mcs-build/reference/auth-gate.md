# Smart Build Account & Environment Gate

Every build targets a specific tenant and environment. This gate reads persisted context first and only asks the user when no prior build context exists.

## Unified Auth Gate

All auth layers (PAC CLI, Azure CLI, Dataverse API) derive from one account + environment selection. This gate confirms both, then verifies all layers work.

Two-step selection: Account then Environment. Confirm the environment explicitly because an account can have multiple.

### Step A: Account + Environment Selection

1. **Read brief.json** — check `buildStatus.account`, `buildStatus.environment`, `buildStatus.accountId`
2. **Read `tools/session-config.json`** — get all accounts and their environments
3. **Build the confirmation question:**
   - If `buildStatus` has account + environment (previous build): pre-fill from buildStatus
   - Else if `sessionDefaults` has values: pre-fill from sessionDefaults
   - Else: no pre-fill (first time)

4. **Confirm with the user** — even on resume:
   - **Q1: "Which account?"** — list accounts from session-config, pre-select the recommended one
   - **Q2: "Which environment?"** — list environments for the selected account. Required when the account has 2+ environments. If only 1 environment exists, auto-select but show it in the confirmation.
   - **Single question shortcut:** If the pre-filled account has only 1 environment, combine into one yes/no: "Build on {account} / {environment}?" with "Yes (Recommended)" / "Choose different"
   - **Two questions required:** If the pre-filled account has 2+ environments, ask Q2 separately because the last-used environment may not be the right one.

5. **Persist the selection** to both locations:
   - `brief.json.buildStatus` — set `account`, `environment`, `accountId`
   - `session-config.json.sessionDefaults` — set `lastAccount`, `lastEnvironment`, `lastUpdated`

### Step B: Three-Layer Verification

After account + environment are confirmed, verify all three layers actually work before proceeding.

**Layer 1 — Azure CLI (primary auth):**
```
az account show --query "{tenantId:tenantId, user:user.name}" -o json
```
- Compare `tenantId` against session-config's `tenantId` for the selected account
- **Match** — proceed
- **Mismatch or not logged in** — `az login --tenant {tenantId}` (browser popup)
- After login, re-verify: `az account show` must match

**Layer 2 — Dataverse API (environment reachable):**
```
TOKEN=$(az account get-access-token --resource <dataverseUrl> --query accessToken -o tsv)
curl -s "<dataverseUrl>/api/data/v9.2/bots?$top=1" -H "Authorization: Bearer $TOKEN"
```
- Must return HTTP 200 (regardless of how many bots exist)
- If token fails — az CLI auth is wrong for this environment
- If HTTP 4xx — Dataverse URL is wrong or environment is unreachable
- This is the critical check because Dataverse API is required for the entire build

**Layer 3 — PAC CLI (optional, best-effort):**
```
pac auth select --index {pacProfileIndex}
pac copilot list
```
- If PAC CLI works — log "PAC CLI: profile {index} verified"
- If PAC CLI fails (device auth error, connection error) — log "PAC CLI: UNAVAILABLE — using Dataverse API as fallback" and continue. Every PAC CLI operation has a Dataverse API equivalent.
- Do not block the build on PAC CLI failure

### Step C: Log Verification Summary

```
Auth verified: {account} / {environment}
  Azure CLI: {user} (tenant {tenantId}) verified
  Dataverse: {dataverseUrl} reachable
  PAC CLI: profile {index} verified | UNAVAILABLE (using API fallback)
```

If Layer 1 or Layer 2 fails, stop the build and report the failure with remediation steps.
If only Layer 3 fails, warn and continue — the build uses Dataverse API for everything.

## Rules

- Confirm the environment on every build, even on resume, because an account can have multiple environments.
- Do not run `az logout` — only `az login` to switch tenants.
- This gate runs once at build start, not before every tool call.
- If `az login` fails (network, MFA timeout): alert user, build cannot proceed.
- If the user says "switch to [account/env]" at any point, re-run the entire gate.
- If an account has no environments listed, ask the user to provide the environment name manually.
- Verification uses actual API calls, not just config lookups, because config can be stale.
