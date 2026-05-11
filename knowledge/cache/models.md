<!-- CACHE METADATA
last_verified: 2026-02-19
sources: [MS Learn, MCS UI snapshot, WebSearch Feb 2026]
confidence: high
refresh_trigger: before_architecture
-->
# MCS Available Models

## Models Available in MCS (Feb 2026)

### Model Categories

| Category | Purpose | Examples |
|----------|---------|---------|
| **General** | Everyday chat, FAQ, routing | GPT-4.1, GPT-5 Chat, Claude Sonnet 4.5 |
| **Deep** | Complex reasoning, multi-step analysis | GPT-5 Reasoning, GPT-5.2 Reasoning, Claude Opus 4.6 |
| **Auto** | Mixed workloads — routes dynamically between general and reasoning | GPT-5 Auto |

### Current Model Lineup

| Model | Category | Status | Availability | Notes |
|-------|----------|--------|-------------|-------|
| GPT-4o | General | **RETIRED** | All regions | Replaced by GPT-4.1 |
| **GPT-4.1** | General | **GA (Default)** | All regions | Default model for all new agents |
| **GPT-5 Chat** | General | **GA** | Europe + US | Preview in other regions |
| **GPT-5 Reasoning** | Deep | **Preview** | Cross-geo (most regions) | Complex multi-step logic |
| **GPT-5 Auto** | Auto | **Preview** | Cross-geo | Dynamically routes between general and reasoning |
| GPT-5.2 Chat | General | **Experimental** | Cross-geo | Next-gen general |
| GPT-5.2 Reasoning | Deep | **Experimental** | Cross-geo | Next-gen reasoning |
| **Claude Sonnet 4.5** | General | **Preview** | Cross-geo | Anthropic model via admin settings |
| Claude Sonnet 4.6 | General | **Experimental** | Cross-geo | Anthropic next-gen |
| Claude Opus 4.6 | Deep | **Experimental** | Cross-geo | Anthropic deep reasoning |
| Grok 4.1 Fast | General | **Experimental** | **US only** | xAI model |

### Government Cloud (GCC/GCC-H/DoD)

| Model | Status | Notes |
|-------|--------|-------|
| GPT-4o | Default | Still the only option in government clouds |

**Note:** External model providers (Anthropic, xAI) require admin settings enablement at the tenant level.

## Model Selection Guidelines

| Use Case | Recommended Model | Rationale |
|----------|-------------------|-----------|
| General-purpose agent | GPT-4.1 (default) | Best balance of capability, speed, and cost |
| Simple FAQ / routing | GPT-4.1 | Fast, cost-effective, GA |
| Complex reasoning / analysis | GPT-5 Reasoning or GPT-5 Auto | Better at multi-step logic |
| Mixed workloads | GPT-5 Auto (Preview) | Auto-routes between general and reasoning |
| Non-OpenAI preference | Claude Sonnet 4.5 (Preview) | Strong alternative, cross-geo |
| Cutting edge (accept experimental risk) | GPT-5.2 Chat/Reasoning | Most capable, may have rough edges |

## How to Set Model

Model selection requires Playwright — not available via API:
1. Navigate to agent Overview page
2. Click the model combobox
3. Snapshot to see all available options
4. Select desired model
5. Wait for "Processing your request..." → "completed successfully"

## Credit Rates by Model Tier

| Tier | Models | Rate |
|------|--------|------|
| Basic | GPT-4.1 mini | 0.1 credits / 1K tokens |
| Standard | GPT-4.1, GPT-5 Chat, Claude Sonnet 4.5/4.6 | 1.5 credits / 1K tokens |
| Premium | GPT-5 Reasoning, GPT-5.2 Reasoning, Claude Opus 4.6 | 10 credits / 1K tokens |

## Refresh Notes

- Check MCS UI model combobox for new entries (preview/experimental models appear without docs)
- Search "Copilot Studio models" on MS Learn for official updates
- External models (Anthropic, xAI) require tenant admin enablement
- Government clouds lag behind commercial — check separately
- GPT-4o retired — migration complete in all commercial regions
