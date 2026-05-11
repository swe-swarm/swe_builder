# Step 5.5: QA Build Validation Gate (Agent Teams)

After publish and reconciliation snapshot collection, spawn QA Challenger for formal validation.

The lead collects snapshot data during reconciliation (overview, tools tab, knowledge, topics, triggers). Instead of the lead both collecting and judging:
- **Lead collects** snapshots (existing behavior)
- **QA Challenger analyzes** the data (this step)
- **Lead reports** QA's findings and acts on the verdict

## Pre-QA: Automated Drift Detection

Before spawning QA, run automated drift detection on all built topics:
```bash
python tools/drift-detect.py Build-Guides/{projectId}/agents/{agentId}/brief.json --validate
```
This catches missing/extra topics, trigger mismatches, and variable drift automatically. Include the drift report in QA's input data.

## QA Challenger Receives

1. The full `brief.json` (spec — what should be configured)
2. The reconciliation snapshot summaries (what is configured — collected by the lead)
3. The drift detection report (from `drift-detect.py` above)
4. The list of deferred `phase: "future"` items (so QA doesn't flag them as missing)

## Check 1: Brief-vs-Actual Comparison

Walk each MVP-scoped section and compare spec to actual:

| Brief Section | What QA Checks |
|---------------|---------------|
| `agent.name` / `agent.description` | Match overview heading |
| `instructions` | Text matches (or char-count delta if large) |
| `integrations[]` (MVP) | Each tool name appears in Tools tab snapshot |
| `knowledge[]` (MVP) | Each source appears in Knowledge section |
| `conversations.topics[]` (MVP) | Each topic name appears in Topics list |
| `architecture.triggers[]` | Trigger types configured |
| `boundaries.refuse[]` | Hard boundaries present in instructions text |

## Check 2: Cross-Reference Validation

These catch issues that simple reconciliation misses:

| Cross-Reference | What Could Be Wrong |
|----------------|-------------------|
| Instructions -> Tools | Instructions mention a tool name that wasn't configured |
| Instructions -> Topics | Instructions reference a `/TopicName` that doesn't exist |
| Topics -> Variables | Topic YAML uses a variable that's never prompted for |
| Topics -> Integrations | Topic calls a connector action that wasn't added |
| Capabilities -> Instructions | Instructions include sections for future-tagged capabilities, or MVP capabilities missing from instructions |
| Adaptive Cards -> Channels | Card uses features unsupported on target channel |
| Topics -> outputFormat | Brief says `outputFormat: "adaptive-card"` but built topic uses plain text `SendActivity` |
| Conversation Start -> Welcome Card | Agent has 2+ capabilities but Conversation Start uses default text greeting instead of adaptive card (bm-024) |
| (Multi-agent) Routing rules -> Children | Instructions route to a child agent that isn't connected |

## Check 3: Deviation Impact Assessment

For each deviation found during the build (Section 9 material), QA assesses:
- **Severity**: Critical (blocks core use case) / High (degrades quality) / Medium (cosmetic or edge case)
- **Can ship?**: Yes / Yes with caveat / No — blocks deployment
- **Suggested fix**: What to do about it (manual step, config change, defer to next iteration)

## QA Output

QA writes results to `Build-Guides/{projectId}/agents/{agentId}/qa-validation.md`:

```markdown
# QA Build Validation: [Agent Name]

## Brief-vs-Actual: {N}/{M} items match
| Item | Brief Says | Agent Has | Status |
|------|-----------|-----------|--------|
| ... | ... | ... | Match / Mismatch / Missing |

## Cross-References: {N} issues found
| Issue | Severity | Detail |
|-------|----------|--------|
| ... | Critical/High/Medium | ... |

## Deviations: {N} with impact assessment
| Deviation | Severity | Can Ship? | Suggested Fix |
|-----------|----------|-----------|---------------|
| ... | ... | ... | ... |

## QA Verdict: PASS / PASS WITH CAVEATS / FAIL
[1-2 sentence summary]
```

## How the Lead Uses the Verdict

1. **PASS** — proceed to build report
2. **PASS WITH CAVEATS** — log caveats in build report Section 9, proceed
3. **FAIL** — stop, report critical issues to user, do not write `"published"` to buildStatus

## Terminal Output

The reconciliation line updates based on QA verdict:
```
QA Validation: PASS (N/N items match, 0 cross-ref issues)
```
or:
```
QA Validation: PASS WITH CAVEATS (N/N items match, 2 cross-ref issues — see qa-validation.md)
```
