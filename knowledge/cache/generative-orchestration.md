<!-- CACHE METADATA
last_verified: 2026-02-19
sources: [MS Learn, MCS UI, community blogs, WebSearch Feb 2026]
confidence: high
refresh_trigger: before_architecture
-->
# MCS Generative Orchestration — Quick Reference

## How It Works

LLM-driven planner: interprets intent → selects tools/topics/knowledge/agents → executes multi-step plans → synthesizes response. Default for all new agents.

**Routing priority**: Description (most important) > Name > Input/output parameters > Agent instructions

## Requirements for Key Features

| Feature | Requires Generative Orchestration? |
|---------|-----------------------------------|
| MCP server usage | **Yes** — topics cannot call MCP servers directly |
| "A plan completes" trigger | **Yes** — generative orchestration only |
| "AI-generated response about to be sent" trigger | **Yes** — generative orchestration only |
| Autonomous tool selection | **Yes** |
| Knowledge proactive search | **Yes** |

## Limits

| Constraint | Value |
|-----------|-------|
| Conversation history considered | **Last 10 turns** |
| Messages per topic/action chain | **5 per turn** |
| Topics/actions per agent | **128 max** |
| Consecutive actions (recommended) | **< 15** |
| Performance degradation | **> 30-40 choices** → split into connected agents |

## Classic vs Generative

| Behavior | Generative | Classic |
|----------|-----------|---------|
| Topic selection | **Description**-based | **Trigger phrase** matching |
| Tools | Autonomously chosen | Explicitly called from topics |
| Knowledge | Proactively searched | Fallback only (OnUnknownIntent) |
| Missing inputs | Auto-generates questions | Must use Question nodes |
| Responses | Auto-generated | Must use Message nodes |
| Disambiguation | Planner handles internally | Multiple Topics Matched topic |

## System Topics in Generative Mode

| Topic | Behavior |
|-------|----------|
| Conversation Start | Works. In Teams: runs ONCE per user install. |
| Conversational Boosting | **NOT used** — knowledge searched proactively |
| Multiple Topics Matched | **NOT currently called** (known limitation) |
| Fallback / Escalate / On Error / Sign in | Work normally |

## Three Special Triggers (Generative Orchestration Only)

| Trigger | Fires When | Key Detail |
|---------|-----------|------------|
| **On Knowledge Requested** | Before knowledge search | YAML-only (name topic exactly `OnKnowledgeRequested`). Read `SearchPhrase`. |
| **AI Response Generated** (`OnGeneratedResponse`) | After AI drafts, before sending | Access `Response.FormattedText`. Set `ContinueResponse = false` to suppress. |
| **On Plan Complete** (`OnPlanComplete`) | After plan executes all steps | Cleanup, surveys, end logic. |

## Knowledge in Generative Mode

- Planner proactively searches — Conversational Boosting NOT used
- **> 25 knowledge sources** → internal GPT filters by descriptions
- Uploaded files exempt from 25-source limit
- **"Official Sources" NOT compatible** with generative orchestration
- **"Use general knowledge" OFF** → follow-up questions suppressed
- Custom data / Bing Custom Search must be in topic generative answers nodes

## Multi-Agent

- Connected agents treated as tools — selected by **description**
- Conversation history passed by default (toggleable)
- **Multi-level chaining NOT supported** (connected agent can't have its own connected agents)
- Types: MCS (GA), Foundry/Fabric/SDK/A2A (preview)

## Models (Feb 2026)

GPT-4o **retired** (all commercial regions). **GPT-4.1** is the default. GPT-5 Chat GA in Europe + US. GPT-5 Reasoning, GPT-5 Auto in preview. Claude Sonnet 4.5 in preview. Generative orchestration available for all supported languages.

## Generative AI Settings

| Setting | Default |
|---------|---------|
| Orchestration | Generative |
| Content moderation | High |
| General knowledge | On |
| Web search (Bing) | Off |
| Tenant graph grounding | Off (needs M365 Copilot license) |
