# Architecture Scoring: Single vs Multi-Agent

## Scoring Matrix

| Factor | Single Agent (0 pts) | Multi-Agent (1 pt) |
|--------|---------------------|-------------------|
| **Domain** | All tasks in same domain | Truly separate domains |
| **Data sources** | Shared data across all capabilities | Different systems per capability |
| **Team ownership** | Same team owns everything | Different teams own different parts |
| **Reusability** | One-off agent | Specialists reusable by other orchestrators |
| **Instruction size** | Fits in 8000 chars | Would exceed 8000 chars per agent |
| **Knowledge isolation** | Same knowledge base | Each needs its own deep knowledge |

## Decision

- **Score 0-2** → Single Agent
- **Score 3+** → Multi-Agent

Present the score with rationale for each factor.

## Multi-Agent Build Order

1. Build all specialist agents first (children before parent)
2. Publish each specialist (`pac copilot publish`)
3. Enable "Allow other agents to connect" on each specialist
4. Create orchestrator → set instructions with routing rules → connect children
5. Publish orchestrator
6. Generate evals.csv and run via Direct Line API

## Orchestrator Instructions Pattern

```
You are [Agent Name], a [description].
Your purpose is to [main function] by coordinating with specialist agents.

## Connected Specialists
/[SpecialistName1] - [When to use, what it handles]
/[SpecialistName2] - [When to use, what it handles]

## Routing Rules
- [Intent pattern] → /[SpecialistName]
- [General questions] → Answer directly
- [Unclear intent] → Ask clarifying question

## Response Guidelines
- Summarize specialist responses naturally
- Don't expose routing mechanics to users
- Maintain consistent tone
```

## Specialist Instructions Pattern

```
You are [Name], a specialist in [domain].

## Your Expertise
- [Area 1]

## Scope Limits
- [Handle]
- [Decline - return to orchestrator]
```
