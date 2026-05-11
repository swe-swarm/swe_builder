<!-- CACHE METADATA
last_verified: 2026-02-19
sources: [MS Learn, MCS UI, AI Builder docs, WebSearch Feb 2026]
confidence: high
refresh_trigger: before_architecture
-->
# MCS AI Tools & Computer Use — Quick Reference

## Prompt Actions

Three ways to use: agent-level tool (autonomous), topic-level node (controlled), AI Plugin (M365 Copilot).

### Available Models (Feb 2026)

| Model | Rate | Context |
|-------|------|---------|
| GPT-4.1 mini (default) | Basic (0.1/1K tokens) | 128K |
| GPT-4.1 | Standard (1.5/1K tokens) | 128K |
| GPT-5 chat | Standard (1.5/1K tokens) | 128K |
| GPT-5 reasoning | Premium (10/1K tokens) | 400K |
| GPT-5.2 chat/reasoning (experimental) | Standard/Premium | 128K/400K |
| Claude Sonnet 4.5 / 4.6 (preview/experimental) | Standard | 200K |
| Claude Opus 4.6 (experimental) | Premium | 200K |
| Azure AI Foundry (BYOM) | Varies | Varies |

### Settings

Temperature (0-1), content moderation (Low/Moderate/High), **code interpreter** (GA — Python execution), reasoning mode, knowledge grounding (Dataverse).

## AI Builder Prebuilt Models

Sentiment analysis, entity extraction (20+ types), category classification, key phrases, language detection, translation (15+ languages), OCR, invoice/receipt/contract/ID/business card processing, image description.

**Access**: Text/generative AI → prompt actions. Prebuilt/custom models → via agent flows.

## Computer Use Agent (CUA) — Preview

### Key Facts

| Fact | Value |
|------|-------|
| Status | **Public Preview** (GA target May 2026) |
| Models | OpenAI CUA V2, Anthropic Claude Sonnet 4.5 |
| Web success rate | **~80%** |
| Desktop success rate | **~35%** |
| Region | **US only** |
| Pricing | **5 Copilot Credits per step** ($0.04/step) |

### Machine Options

| Option | Production? | Notes |
|--------|-------------|-------|
| Hosted browser | No (prototyping) | Shared, throttled, 1 session/user |
| Cloud PC pool | Yes (preview) | Win 11, auto-scale 10 VMs/pool, 5 pools/env |
| BYO machine | Yes | PA Desktop v2.61+ required |

### Jan 2026 Updates

| Feature | Details |
|---------|---------|
| New model support | Additional model options for CUA tasks |
| Built-in credentials | Stored credentials for automated authentication (Power Platform or Key Vault) |
| Cloud PC pooling | Auto-scale pools for production workloads (10 VMs/pool, 5 pools/env) |
| Enhanced audit logging | Detailed step-by-step logs for compliance and debugging |

### CUA vs RPA

| Factor | RPA | CUA |
|--------|-----|-----|
| Authoring | Script/recorder | Natural language |
| UI changes | Breaks (selectors) | Adapts (vision) |
| Speed | Fast | Slower |
| Maturity | GA | Preview |

**Use RPA**: stable UI, high volume, speed critical. **Use CUA**: shifting UIs, fast setup, fuzzy decisions.

### CUA Limitations

- Struggles with dropdowns, date pickers, custom widgets
- May get stuck in loops; no multi-screen support
- NOT for sensitive/high-risk use cases
- Desktop apps unsupported for password fields on: Electron, Java, Unity, CLI, Citrix

### Security

Stored credentials (Power Platform or Key Vault), URL + app allow-lists, human supervision (reviewer approval), dedicated isolated machines recommended.

## Generative AI Settings

| Setting | Default |
|---------|---------|
| Orchestration | Generative |
| Moderation | High (5 levels: Lowest→Highest) |
| General knowledge | On |
| Web search (Bing) | Off |

Moderation precedence: Topic-level > Agent-level. Prompt tool is independent.

## Credit Rates

| Feature | Rate |
|---------|------|
| Basic models (GPT-4.1 mini) | 0.1 credits / 1K tokens |
| Standard (GPT-4.1, GPT-5 chat, Claude Sonnet) | 1.5 credits / 1K tokens |
| Premium (GPT-5 reasoning, Claude Opus) | 10 credits / 1K tokens |
| Document processing | 8 credits / page |
| Computer Use | 5 credits / step |

Testing is free (test panel + prompt builder).
