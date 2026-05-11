---
name: mcs-context
description: Pull all M365 context about a customer/company using WorkIQ MCP. Searches emails, meetings, documents, Teams, and people to compile a complete customer context file before research and architecture.
---

# MCS Customer Context Pull

Use WorkIQ MCP to search all M365 history for a customer/company name and compile findings into structured files for use in research and architecture.

## Input

Provide customer/company name and optionally project name:
- `/mcs-context CDW` → searches for "CDW", uses "CDW" as project name
- `/mcs-context CDW ProjectName` → searches for "CDW", saves to Build-Guides/ProjectName/

## Prerequisites

- **WorkIQ CLI installed**: `workiq --version` (must be authenticated)
- **WorkIQ MCP configured**: In `.claude/settings.json` → mcpServers → workiq
- **Microsoft tenant authenticated**: WorkIQ must have completed interactive auth with the target tenant
- **M365 Copilot license**: Required on the authenticated account

If WorkIQ is not authenticated, guide the user:
```
WorkIQ needs one-time authentication. Run this in a terminal:
  workiq ask -q "What is my name?"
Complete the browser sign-in, then re-run /mcs-context.
```

## Process

### Step 1: Ensure Project Folder Exists

Check/create `Build-Guides/[ProjectName]/`. If it doesn't exist, create it.

### Step 2: Run Targeted WorkIQ Queries

Run these queries using WorkIQ MCP tools (`mcp__workiq__*`). If MCP tools are not available, fall back to `workiq ask -q "query"` via Bash.

**IMPORTANT**: Run queries in parallel where possible for speed. Each query targets a different M365 data source.

#### Query 1: Broad Overview
```
"Give me a comprehensive summary of everything related to [CUSTOMER]. Include any projects, discussions, decisions, pain points, and key people involved."
```

#### Query 2: Email History
```
"Find all emails mentioning [CUSTOMER]. Summarize the key threads, decisions made, action items, and any requirements or pain points discussed. Include dates and participants."
```

#### Query 3: Meetings & Transcripts
```
"Find all meetings about [CUSTOMER] or with [CUSTOMER] participants. Summarize meeting outcomes, decisions, action items, and any technical discussions. Include dates."
```

#### Query 4: Documents & Files
```
"Find all documents, presentations, and files about [CUSTOMER] in SharePoint and OneDrive. List each file with its name, location, date, and a brief description of its content."
```

#### Query 5: Teams Messages
```
"Find all Teams messages and channel discussions mentioning [CUSTOMER]. Summarize key conversations, decisions, and any blockers or issues raised."
```

#### Query 6: People & Stakeholders
```
"Who are the key people working with [CUSTOMER]? Include internal team members and any external contacts mentioned. List their roles and involvement."
```

#### Query 7: SDR & Requirements (targeted)
```
"Find any Solution Discovery Report, requirements document, use case document, or agent specification related to [CUSTOMER]. Summarize the key requirements, use cases, and technical details."
```

#### Query 8: Recent Activity (last 30 days)
```
"What has happened with [CUSTOMER] in the last 30 days? Any recent emails, meetings, documents, or decisions?"
```

### Step 3: Compile Results into customer-context.md

Organize all findings into a structured narrative:

```markdown
# Customer Context: [CUSTOMER]

> Generated on [DATE] via WorkIQ M365 search
> Tenant: [authenticated tenant]
> Queries run: [count]

## Executive Summary

[2-3 paragraph synthesis of everything found — who is this customer, what are we doing with them, what stage are they at, what are the key pain points and requirements]

## Key Stakeholders

### Internal (Our Team)
| Name | Role | Involvement |
|------|------|-------------|
| [Name] | [Role] | [How they're involved] |

### External (Customer Side)
| Name | Role | Involvement |
|------|------|-------------|
| [Name] | [Role] | [How they're involved] |

## Engagement History

### Timeline
[Chronological summary of key events — first contact, meetings, decisions, milestones]

### Key Decisions Made
- [Decision 1] — [date, context]
- [Decision 2] — [date, context]

### Open Action Items
- [ ] [Action item] — [owner, due date if known]

## Requirements & Use Cases Found

### From SDR/Requirements Documents
[Summarize any formal requirements found]

### From Conversations (Emails/Meetings/Teams)
[Summarize requirements discussed informally]

### Pain Points Mentioned
- [Pain point 1] — [where it was mentioned]
- [Pain point 2] — [where it was mentioned]

## Documents & Artifacts

| Document | Type | Location | Date | Key Content |
|----------|------|----------|------|-------------|
| [Name] | [SDR/Spec/Deck/etc.] | [SharePoint path] | [Date] | [What it contains] |

## Recent Activity (Last 30 Days)

[Summary of recent engagement — momentum indicator]

## Gaps & Unknowns

[What WASN'T found — topics with no data, unanswered questions, areas where M365 had no results]
```

### Step 4: Generate customer-interactions.csv

Create a structured timeline CSV:

```csv
"date","type","participants","summary","source"
"2026-01-15","email","Dennis Kim, John Smith","Discussed CDW agent requirements — need Jira integration","Email thread: CDW Agent Planning"
"2026-01-20","meeting","Dennis Kim, Sarah Lee, CDW team","SDR walkthrough — identified 3 agent use cases","Meeting: CDW Discovery Session"
"2026-01-22","document","Dennis Kim","SDR v1 uploaded to SharePoint","SharePoint: /sites/Customers/CDW/SDR-v1.docx"
"2026-02-01","teams","Dennis Kim, PM team","Flagged Jira on-prem as blocker for Agent 1","Teams: #customer-cdw channel"
```

### Step 5: Write Files

1. Write `Build-Guides/[ProjectName]/customer-context.md`
2. Write `Build-Guides/[ProjectName]/customer-interactions.csv`

### Step 6: Present Summary and Guide Next Step

```
## Customer Context Complete: [CUSTOMER]

**Files created:**
- Build-Guides/[ProjectName]/customer-context.md — Full narrative context
- Build-Guides/[ProjectName]/customer-interactions.csv — Structured timeline ([N] interactions)

**Summary:**
- [Key finding 1]
- [Key finding 2]
- [Key finding 3]

**SDR/Requirements found:** [Yes — list files / No — will need manual input]

**Recommended next step:**
- Run `/mcs-research [ProjectName]` → reads docs + customer-context.md, identifies agents, full enrichment
```

## How Research Uses This

When `/mcs-research` runs, it checks for `customer-context.md` in the project folder:

1. **If found**, incorporate into requirements validation:
   - **Problem & Priority** ← Executive Summary + Pain Points
   - **Users & Scenarios** ← Stakeholders + Requirements/Use Cases
   - **Requirements** ← Requirements Found + Documents
   - **Scope** ← Decisions Made + Gaps & Unknowns
   - **Open Questions** ← Gaps & Unknowns

2. **This pre-fills 60-80% of the research phase** — less manual validation needed

## WorkIQ Query Tips

- **Be specific with company names** — "CDW" not "the customer"
- **Use time ranges** when results are too broad — "in the last 6 months"
- **Follow up on interesting threads** — if a query mentions an important meeting, ask WorkIQ for details about that specific meeting
- **Cross-reference**: If emails mention a document, query for that document specifically
- **No results ≠ no data** — WorkIQ can only access data the authenticated user has permissions to see. Note permission gaps in the Gaps section.

## Error Handling

| Error | Resolution |
|-------|-----------|
| WorkIQ not authenticated | Guide user to run `workiq ask -q "test"` in terminal for interactive auth |
| MCP server not available | Fall back to `workiq ask -q "query"` via Bash |
| No results for customer | Try alternate names, abbreviations, domain names. Note "no M365 data found" |
| Timeout on queries | Run queries sequentially instead of parallel. Reduce scope with time ranges |
| Rate limiting | Add 5-second delays between queries |

## Output

Creates:
- `Build-Guides/[ProjectName]/customer-context.md` — Complete narrative context
- `Build-Guides/[ProjectName]/customer-interactions.csv` — Structured timeline

These files persist and can be referenced by `/mcs-research` and during builds.
