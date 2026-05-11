---
paths:
  - ".claude/skills/mcs-build/**"
  - ".claude/skills/mcs-eval/**"
  - ".claude/skills/mcs-fix/**"
  - ".claude/skills/mcs-deploy/**"
  - "tools/**"
---

# Build Discipline: Verify-Then-Mark

Every build step must be verified before marking complete. These rules prevent silent failures and ensure the agent state matches the spec.

## Rules

1. **Atomic tasks.** Every build step is a separate task because combining steps that span different systems (local file vs MCS API) makes failures harder to diagnose. "Generate CSV" + "upload to MCS" + "run eval" = three tasks, not one.

2. **Verify after every action.** After each change, snapshot or read-back to confirm it worked because MCS APIs can return success without actually persisting the change:
   - Instructions updated: LSP pull confirms text saved
   - Tool added/removed: LSP pull or `add-tool.js list-connections` confirms tool list matches spec
   - Trigger created/deleted: LSP pull confirms expected state
   - Published: `pac copilot status` or Dataverse query confirms Published date is today
   - CSV generated: read file back to confirm content
   - Eval uploaded: Dataverse query confirms test case count

3. **Do not mark a step complete until it is verified.** If verification is not possible, tell the user "I did X but couldn't verify Y" because silently assuming success leads to cascading failures in later steps.

4. **Writing a local file is not the same as deploying it.** File creation and MCS upload are separate tasks because a local file has no effect on the agent until it reaches the platform.

5. **Check the environment before PAC CLI operations.** Verify the agent's environment matches PAC CLI's active profile (`pac auth list`) because operating against the wrong environment creates agents in unintended locations.

6. **Keep the LSP workspace fresh.** Follow the `pull -> modify -> push` sequence when using the LSP Wrapper because stale row versions cause `ConcurrencyVersionMismatch` errors, which force a re-pull that overwrites your changes.

7. **Attempt every MVP item.** Try every item tagged `phase: "mvp"` because a failed attempt with a clear error message is valuable diagnostic information, while a silently skipped item is a build gap that goes unnoticed. If an item fails, document what was tried, the specific error, and what is needed to unblock it.

8. **Reconcile at end of build.** After all changes, walk the spec's build checklist and snapshot-verify every item against the actual agent state because drift between spec and reality compounds over the build. Every MVP item must show MATCH, PARTIAL, FAILED, or BLOCKED. Then spawn QA Challenger (Step 5.5) to validate brief-vs-actual, cross-references, and deviation impact. The QA verdict determines whether the build proceeds to the report or escalates issues.
