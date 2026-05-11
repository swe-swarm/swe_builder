---
name: bug
description: Report a bug conversationally — Claude gathers details, previews, and creates a GitHub issue via gh CLI.
---

# Bug Report

File a bug report on GitHub without leaving the dashboard.

## Process

1. **Auth & tooling check** — run `gh auth status`. If not authenticated, tell the user to run `gh auth login` and stop.

2. **Account confirmation (MANDATORY)** — show the user the signed-in account from `az account show` output and ask them to confirm:
   > You're signed in as **[account name]**. Issues will be created in **swe-swarm/swe_builder**. Is this correct?

   Do NOT proceed until the user confirms. If they say no, help them switch accounts with `gh auth login`.

3. **Check for pre-filled context** — if args were passed (from the dashboard dialog), extract the context and skip the "ask" step. The format is: `Project: X | Agent: Y | Page: Z | ... | User says: "description"`. Use the "User says" portion as the bug description and the rest as auto-context.

4. **If no args**, ask ONE question:
   > What went wrong? Describe the bug — what happened, what you expected, and any steps to reproduce.

5. **Auto-gather context** Claude already knows:
   - Current project (from Build-Guides/ or conversation or pre-filled args)
   - Skill or workflow that failed (if applicable)
   - Environment / account (from session config)
   - Any error messages from the current session

6. **Generate issue**:
   - **Title**: `Bug: <concise summary>` (under 70 chars)
   - **Body** (markdown/HTML):
     ```
     <h2>What happened</h2>
     <p>[user's description]</p>

     <h2>Steps to reproduce</h2>
     <p>[extracted from description, or "Not provided"]</p>

     <h2>Expected behavior</h2>
     <p>[extracted or inferred]</p>

     <h2>Environment</h2>
     <ul>
     <li>Account: [if known]</li>
     <li>Environment: [if known]</li>
     <li>Skill/workflow: [if applicable]</li>
     <li>Page: [if provided]</li>
     </ul>
     ```

7. **Preview** — show the full title + body to the user and ask:
   > Here's the work item I'll create. Want me to submit it, or would you like to change anything?

8. **On confirmation** — run:
   ```
   gh issue create --repo swe-swarm/swe_builder --title "Bug: ..." --label bug --body "$(cat <<'EOF'
   <body>
   EOF
   )"
   ```

9. **Return** the issue URL to the user.

## Rules

- Repository is always `swe-swarm/swe_builder`
- Label is always `bug`
- ALWAYS confirm the user's signed-in account before creating anything
- NEVER submit without user confirmation of the issue preview
- Use HEREDOC for the body to preserve formatting
- Keep the title under 70 characters
- If the user's description is vague, ask ONE follow-up — don't interrogate
- When invoked with pre-filled args from the dashboard, skip the description question but STILL confirm the account
