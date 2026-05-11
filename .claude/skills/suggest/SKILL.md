---
name: suggest
description: Submit a feature suggestion conversationally — Claude gathers details, previews, and creates a GitHub issue via gh CLI.
---

# Feature Suggestion

File a feature suggestion on GitHub without leaving the dashboard.

## Process

1. **Auth & tooling check** — run `gh auth status`. If not authenticated, tell the user to run `gh auth login` and stop.

2. **Account confirmation (MANDATORY)** — show the user the signed-in account from `az account show` output and ask them to confirm:
   > You're signed in as **[account name]**. Issues will be created in **swe-swarm/swe_builder**. Is this correct?

   Do NOT proceed until the user confirms. If they say no, help them switch accounts with `gh auth login`.

3. **Check for pre-filled context** — if args were passed (from the dashboard dialog), extract the context and skip the "ask" step. The format is: `Project: X | Agent: Y | Page: Z | ... | User says: "description"`. Use the "User says" portion as the suggestion description and the rest as auto-context.

4. **If no args**, ask ONE question:
   > What would you like to see added or improved?

5. **Auto-gather context** Claude already knows:
   - Current project or workflow area (from conversation or pre-filled args)
   - Related skills or components
   - Any prior discussion context from the session

6. **Generate issue**:
   - **Title**: `Suggestion: <concise summary>` (under 70 chars)
   - **Body** (markdown/HTML):
     ```
     <h2>Problem / motivation</h2>
     <p>[why this would help]</p>

     <h2>Proposed solution</h2>
     <p>[what the user wants]</p>

     <h2>Context</h2>
     <ul>
     <li>Area: [dashboard, skills, build workflow, etc.]</li>
     <li>Related: [any related features or components]</li>
     <li>Page: [if provided]</li>
     </ul>
     ```

7. **Preview** — show the full title + body to the user and ask:
   > Here's the suggestion I'll create. Want me to submit it, or would you like to change anything?

8. **On confirmation** — run:
   ```
   gh issue create --repo swe-swarm/swe_builder --title "Suggestion: ..." --label enhancement --body "$(cat <<'EOF'
   <body>
   EOF
   )"
   ```

9. **Return** the issue URL to the user.

## Rules

- Repository is always `swe-swarm/swe_builder`
- Label is always `enhancement`
- ALWAYS confirm the user's signed-in account before creating anything
- NEVER submit without user confirmation of the issue preview
- Use HEREDOC for the body to preserve formatting
- Keep the title under 70 characters
- If the user's idea is vague, ask ONE follow-up — don't interrogate
- When invoked with pre-filled args from the dashboard, skip the description question but STILL confirm the account
