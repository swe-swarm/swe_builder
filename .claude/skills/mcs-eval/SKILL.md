---
name: mcs-eval
description: "Run evaluation tests using eval sets (tiered test suites). Three-tier execution: Direct Line API, Playwright Test Chat (fallback), or Native MCS Eval (async). Results written per-test to evalSets[].tests[].lastResult."
---

# MCS Evaluation Runner — Three-Tier Strategy

Run evaluation tests for an agent and write results back to `brief.json` so the dashboard can display them.

## Three-Tier Eval Strategy

| Tier | Method | When | Speed | Reliability |
|------|--------|------|-------|-------------|
| 1 | **Direct Line API (hardened)** | Token available, agent published | Fast (~2s/test) | High (auto-token, retry, refresh) |
| 2 | **Playwright Test Chat** | Direct Line fails OR no token | Medium (~5-8s/test) | High (no token needed) |
| 3 | **Native MCS Eval (async)** | User explicitly requests | Slow (minutes) | High but non-blocking |

**Automatic failover:** Try Tier 1 → if token acquisition fails or first test errors out → fall back to Tier 2. Tier 3 only on explicit user request (`/mcs-eval {projectId} {agentId} --native`).

## BUILD DISCIPLINE — VERIFY-THEN-MARK (MANDATORY)

**This skill has THREE separate sub-tasks. Each must be tracked and verified independently.**

| Sub-task | What it does | How to verify |
|----------|-------------|--------------|
| **Generate CSV** | Write evals.csv to disk (if not present) | Read the file back |
| **Run evaluation** | Execute tests via Tier 1/2/3 | Results JSON exists with scores |
| **Write results** | Update evalSets[].tests[].lastResult in brief.json | Read brief.json back |

## Input

```
/mcs-eval {projectId} {agentId}                    # Run all eval sets
/mcs-eval {projectId} {agentId} --set critical,functional  # Run specific sets
/mcs-eval {projectId} {agentId} --native           # Force Tier 3 (native MCS eval)
/mcs-eval {projectId} {agentId} --check-results    # Check pending native eval results
```

Reads from:
- `Build-Guides/{projectId}/agents/{agentId}/brief.json` — evalSets array + buildStatus
- `Build-Guides/{projectId}/agents/{agentId}/evals.csv` — if already generated (for native eval only)

Writes to:
- `Build-Guides/{projectId}/agents/{agentId}/evals.csv` — flat CSV (generated from evalSets for native eval)
- `Build-Guides/{projectId}/agents/{agentId}/evals-results.json` — raw test results
- `Build-Guides/{projectId}/agents/{agentId}/brief.json` — `evalSets[].tests[].lastResult` updated per test

## Before Evaluating — Knowledge Cache + Learnings Check

1. Read `knowledge/cache/eval-methods.md` — check `last_verified` date
2. If stale (> 7 days), refresh: WebSearch + MS Learn for "Copilot Studio evaluation"
3. Read `knowledge/learnings/eval-testing.md` (if non-empty) — check for:
   - Eval method insights (which methods work best for which scenario types)
   - Threshold calibration findings (e.g., "GeneralQuality scores vary 20+ points — not reliable for strict thresholds")
   - Test design lessons (e.g., "Multi-turn scenarios need context setup in first message")
4. Update cache if new findings

## Step 1: Load Eval Sets & Determine Scope

Read `brief.json.evalSets[]`. If empty or missing → **exit:** "Run `/mcs-research` first — no eval sets found."

**Determine which sets to run:**
- Default (no `--set` flag): run ALL sets
- `--set critical,functional`: run only named sets
- Skip sets with zero tests

**Generate evals.csv** from evalSets if not present (needed for Tier 3 native eval only):

```csv
"question","expectedResponse","testMethodType","passingScore"
```

Flattening rules:
- Each test becomes one CSV row
- `testMethodType` = first method from the test's set
- `passingScore` = that method's score threshold, or empty for binary methods

**VERIFY:** Eval sets loaded, target sets identified, test count > 0.

## Step 2: Acquire Direct Line Token (Tier 1 Preparation)

Try these sources in order. Stop at first success:

### Try 1: Cached token from previous run
- Read `brief.json.buildStatus.directLineToken`
- If present AND `brief.json.buildStatus.tokenAcquiredAt` is < 30 min ago, use it
- Otherwise continue to Try 2

### Try 2: Token Endpoint (preferred — no secret needed)
- Read `brief.json.buildStatus.tokenEndpoint` for the URL
- If not in brief, check MCS: Copilot Studio → Channels → Mobile app → Token Endpoint
- GET request to the Token Endpoint URL returns `{ Token, Expires_in, ConversationId }`
- Cache the token endpoint URL in `brief.json.buildStatus.tokenEndpoint` for future runs
- Pass to the test runner via `--token-endpoint <URL>`

### Try 3: Dataverse bound action
- Use `tools/dataverse-helper.ps1` to call `PvaGetDirectLineEndpoint` bound action on the bot entity
- Requires PAC CLI auth to be active for the correct environment

### Try 4: Ask user (last resort)
- Ask user to provide token from MCS UI: Settings → Security → Web channel security → Copy token

### All failed → Skip to Tier 2 (Test Chat)
- Log: "Could not acquire Direct Line token. Falling back to Playwright Test Chat (Tier 2)."

## Step 3: Run Tests — Tier 1 (Direct Line API)

Run the hardened Direct Line test runner:

```bash
# With Token Endpoint (auto-acquires and refreshes token)
node tools/direct-line-test.js --token-endpoint "<URL>" --csv "Build-Guides/{projectId}/agents/{agentId}/evals.csv" --verbose

# With manual token
node tools/direct-line-test.js --token "<TOKEN>" --csv "Build-Guides/{projectId}/agents/{agentId}/evals.csv" --verbose

# With custom timeout (for agents with slow tool calls)
node tools/direct-line-test.js --token-endpoint "<URL>" --csv "evals.csv" --timeout 90000 --verbose
```

### Handle Partial Results

If the runner exits with code 2 (fatal error) and writes partial results:
1. Read `evals-results.json` — check `status` field
2. If `status: "partial"`:
   - Check `summary.executed` vs `summary.total`
   - If > 50% completed → report partial results, offer to continue remaining tests with Tier 2
   - If < 50% completed → fall back entirely to Tier 2
3. If `status: "error"` (no tests ran) → fall back entirely to Tier 2

### Results

Results saved to `Build-Guides/{projectId}/agents/{agentId}/evals-results.json`:
```json
{
  "status": "complete",
  "summary": { "total": 10, "executed": 10, "passed": 8, "failed": 2, "remaining": 0, "passRate": "80%" },
  "method": "DirectLine",
  "results": [
    { "question": "...", "expectedResponse": "...", "actualResponse": "...", "pass": true, "score": 85 }
  ]
}
```

## Step 3 alt: Run Tests — Tier 2 (Playwright Test Chat)

**Use when:** Direct Line token acquisition fails, OR Tier 1 produced partial results and needs continuation, OR user requests.

### Silent Browser Verification (MANDATORY)

1. Read `brief.json.buildStatus.account` / `.environment` (set during `/mcs-build`)
2. `browser_navigate` to `https://copilotstudio.microsoft.com`
3. `browser_snapshot` — wait for load
4. Compare snapshot account/environment against persisted buildStatus
5. **If match** → log `Browser verified: {account} / {environment}` and proceed
6. **If mismatch** → alert user: `Browser shows {X} but eval targets {Y}. Switch?` — WAIT for user
7. **If no persisted config** → ask once via `AskUserQuestion`, persist to `brief.json.buildStatus` + `session-config.json`

### Navigate to Agent

1. Navigate to the target agent in MCS
2. Open the Test Chat pane (bottom-right "Test" button or "Test your agent" panel)
3. If Test Chat is already open, proceed. If not, click to open it.

### Run Each Test Case

For each test case in the CSV (or remaining cases if continuing from Tier 1 partial results):

1. **Reset conversation** — Click the reset/new conversation icon in the Test Chat header to clear context
2. **Type the test question** — Type the question into the chat input field
3. **Submit** — Press Enter or click Send
4. **Wait for response** — Poll `browser_snapshot` until the agent's response appears (max 60s):
   - Look for a new message bubble from the agent (not "Typing..." indicator)
   - If the snapshot shows "Typing..." or loading, wait 2-3 seconds and re-snapshot
   - If no response after 60s, record as timeout
5. **Extract response text** — Read the agent's response text from the snapshot
6. **Score locally** — Use the same scoring logic as `direct-line-test.js`:
   - `Exact match`: exact string comparison
   - `Keyword match (all)`: all keywords from expected present in response
   - `Keyword match (any)`: any keyword from expected present in response
   - `Text similarity`: Jaccard word overlap
   - `Compare meaning`: keyword overlap + length ratio
   - `General quality`: quality heuristics (non-empty, keywords, length, no errors)
   - `Capability use`: check for capability indicators in response

### Write Results

Write results to `evals-results.json` in the **same format** as Direct Line output:
```json
{
  "status": "complete",
  "summary": { "total": 10, "executed": 10, "passed": 7, "failed": 3, "remaining": 0, "passRate": "70%" },
  "method": "PlaywrightTestChat",
  "results": [...]
}
```

If continuing from Tier 1 partial results, merge: include Tier 1 results (keep existing scores) + Tier 2 results for remaining tests. Set `method: "DirectLine+PlaywrightTestChat"`.

## Step 3 opt: Run Tests — Tier 3 (Native MCS Eval, Async)

**Use ONLY when:** User explicitly requests native eval (e.g., "use native eval", "run MCS evaluation", or `--native` flag).

### Silent Browser Verification (MANDATORY)

Same as Tier 2 — silent verification against persisted buildStatus.

### Upload and Start

1. Open the agent → Evaluation tab
2. Click "New evaluation"
3. Upload CSV: `page.locator('input[type="file"]').first().setInputFiles(path)`
4. Wait for upload confirmation
5. **VERIFY:** Snapshot → "Review your test cases (N)" shows expected count
6. Click "Evaluate" → wait for start
7. **VERIFY:** Snapshot shows "Running" status

### DO NOT BLOCK — Return Immediately

After confirming the eval has started:

```
Native eval started in MCS. This runs in the background (typically 2-5 minutes).

Run `/mcs-eval {projectId} {agentId} --check-results` to retrieve results when ready.
```

Write to brief.json:
```json
{
  "evalStatus": "native-eval-pending",
  "nativeEvalStartedAt": "2026-02-18T...",
  "nativeEvalMethod": "MCSNative"
}
```

### Check Results (`--check-results`)

When invoked with `--check-results`:

1. Run silent browser verification (compare against `brief.json.buildStatus`)
2. Navigate to agent → Evaluation tab
3. Snapshot the results table
4. **If results available:**
   - Extract scores from the evaluation results table
   - Convert to standard `evals-results.json` format
   - Write results with `method: "MCSNative"`
   - Continue to Step 4 (write to brief.json)
5. **If still running:**
   - Report: "Native eval still running. Check back in 1-2 minutes."
   - Do NOT update brief.json

## Step 4: Write Results to brief.json

After evaluation completes (any tier), update `brief.json.evalSets[].tests[].lastResult` for each test that was run:

```json
{
  "lastResult": {
    "pass": true,
    "actual": "Here are your high-priority items...",
    "score": 85,
    "timestamp": "2026-02-18T14:30:00Z"
  }
}
```

Do NOT write a flat `evalResults` field — results live per-test in their eval set.

Also cache the token endpoint URL if we discovered it:
```json
{
  "buildStatus": {
    "tokenEndpoint": "<URL>",
    "directLineToken": "<TOKEN>",
    "tokenAcquiredAt": "2026-02-18T14:25:00Z"
  }
}
```

**VERIFY:** Read brief.json back. Confirm each test in the run sets has a `lastResult` with `pass`, `actual`, and `timestamp`.

## Step 5: Report Results

```
## Evaluation Results: {Agent Name}

**Method:** {Direct Line API | Playwright Test Chat | Direct Line + Test Chat | MCS Native}
**Sets run:** {set names}
**Overall:** {X}/{Y} passed ({Z}%)

**Per-Set Results:**
| Set | Passed | Total | Rate | Target | Status |
|-----|--------|-------|------|--------|--------|
| critical | X | Y | Z% | 100% | PASS/FAIL |
| functional | X | Y | Z% | 70% | PASS/FAIL |
| integration | X | Y | Z% | 80% | PASS/FAIL |
| conversational | X | Y | Z% | 60% | PASS/FAIL |
| regression | X | Y | Z% | 70% | PASS/FAIL |

**Failed Cases:**
| Set | Question | Expected | Got | Issue |
|-----|----------|----------|-----|-------|
| [set] | [input] | [expected] | [actual] | [analysis] |

**Recommendations:**
- [If critical failures] STOP — fix safety/boundary issues before anything else
- [If knowledge gap] Update knowledge sources
- [If boundary fail] Strengthen instructions
- [If routing fail] Expand trigger phrases / routing rules

**Files Updated:**
- brief.json → evalSets[].tests[].lastResult updated
- evals-results.json → raw results saved
```

## Quality Standards

- **Critical set MUST pass 100%** — hard stop if any critical test fails
- **Functional set at 70%+** is acceptable for initial build
- **Integration set at 80%+** verifies tools are actually working
- **Re-run eval after any agent changes** — instructions, knowledge, tools
- **GeneralQuality evals have variance** — run multiple times for confidence
- **Tier 1 and Tier 2 should produce equivalent scores** — same scoring logic, different transport

## Post-Eval Learnings Capture (Two-Tier)

After reporting results, run the two-tier learnings capture.

### Tier 1: Auto-Capture (no user confirmation)

- **All-pass runs:** If 100% pass rate, auto-bump `confirmed` count for any `eval-testing.md` entries whose tags overlap with the eval methods used (e.g., if Direct Line was used and a learning about Direct Line exists, bump it).
- **Confirmed thresholds:** If passing scores matched expectations from prior learnings, bump those entries.
- **Token method success:** If Token Endpoint worked, bump any learnings about token acquisition.
- Update `knowledge/learnings/index.json` silently.

### Tier 2: User-Confirmed Capture (when failures exist)

Only capture if there are actual insights — don't log routine passes.

**What to capture:**
- **Eval method insights**: "Compare meaning with 70% was too lenient for boundary tests — Keyword match (all) caught violations that Compare meaning missed"
- **Failure patterns**: "All boundary-decline tests failed because instructions didn't explicitly say 'I cannot do that'"
- **Scoring calibration**: "GeneralQuality scores varied 20+ points across runs — not reliable for strict thresholds"
- **Test design lessons**: "Multi-turn scenarios need context setup in the first message or agent loses context"
- **Tier comparison**: "Test Chat produced scores within 5 points of Direct Line for the same test set"
- **Token acquisition**: "Token Endpoint was the most reliable method — no manual steps needed"

**Before writing, run the comparison engine** (see CLAUDE.md "Learnings Protocol" section B):
1. Check `index.json` for entries with overlapping tags
2. Same pattern → BUMP (Tier 1); new pattern → present to user; contradiction → FLAG

**Generate summary (only if there are Tier 2 insights):**

```markdown
## Eval Learnings: [Agent Name] — [Date]

### Failure Analysis Patterns
| Pattern | Affected Tests | Root Cause | Category | Action |
|---------|---------------|------------|----------|--------|
| [pattern] | [N] tests | [why] | eval-testing / instructions | ADD / BUMP et-001 |

### Method/Threshold Insights
| Insight | Category | Action |
|---------|----------|--------|
| [what we learned] | eval-testing | ADD / BUMP |
```

Present to user. If confirmed, write to `knowledge/learnings/{category}.md` and update `index.json`.

---

## Important Rules

- **brief.json evalSets is the primary output** — the dashboard reads per-test lastResult from it
- **evals-results.json is the detailed backup** — for debugging
- **Never mark eval complete after only generating CSV** — must run AND write per-test results
- **Use QA Challenger** to analyze failures and suggest fixes if any set fails its threshold
- **Tier 2 (Test Chat) uses the SAME scoring logic** as Tier 1 (Direct Line) — only the transport differs
- **Tier 3 (Native) is non-blocking** — start and return, check results separately
- **Cache the token endpoint URL** in brief.json for future eval runs
- **Per-set pass logic:** each test must pass ALL methods in its set. Scored methods check threshold, binary methods are pass/fail.
