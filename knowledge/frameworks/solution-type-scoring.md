# Solution Type Assessment: Does This Need an Agent?

> **Pre-gate:** Run this BEFORE architecture scoring (single vs multi-agent). Not every use case needs a Copilot Studio agent. Some are better as Power Automate flows, SharePoint views, or are too complex for MCS entirely.

## 5-Factor Scoring

| # | Factor | Agent (1 pt) | Simpler Solution (0 pts) |
|---|--------|-------------|--------------------------|
| 1 | **Conversational Need** | Users need dialogue — ask questions, get explanations, back-and-forth. The VALUE is in the conversation itself. | Users need data moved, transformed, or displayed. A dashboard, list view, or notification achieves the same. |
| 2 | **Interaction Pattern** | Dominant pattern is reactive: user initiates, agent responds with judgment/reasoning. 40%+ MVP capabilities need AI interpretation. | Dominant pattern is procedural: event -> pipeline of deterministic steps. Describable as a flowchart with no AI decision points. |
| 3 | **Capability Distribution** | 50%+ MVP capabilities have `implementationType` of `prompt`, `topic`, or `knowledge`. | 50%+ MVP capabilities have `implementationType` of `flow` or `tool` with deterministic I/O. |
| 4 | **User Value of Natural Language** | Users gain clear value from NL: ambiguous queries, contextual follow-ups, multi-domain synthesis. Broad/non-technical audience. | Users equally served by structured UI (form, button, list filter). Inputs predictable, outputs fixed-format. |
| 5 | **MCS Feasibility** | Fits within MCS: response times <30s, data volumes within limits, connectors/MCPs exist, no batch processing. | Requires capabilities beyond MCS: sub-second responses, bulk records, multi-system transactions, batch jobs, heavy compute. |

## Scoring Thresholds

| Score | Solution Type | Action |
|-------|--------------|--------|
| **4-5** | `agent` | Proceed with full research (Phases B + C). Current workflow unchanged. |
| **3** | Borderline | Create `solution-type` decision with `agent`, `hybrid`, and/or `flow` options. Pre-apply `hybrid` as default. |
| **1-2** | `flow` | Write simplified brief with recommendation. Skip Phases B + C (no instructions, eval sets, or architecture scoring). |
| **0** | `not-recommended` | Write minimal brief with alternative recommendation. Skip all deep research. |

## How to Score

For each factor, evaluate the agent candidate's MVP capabilities:

### Factor 1: Conversational Need
- **Ask:** "If we removed the conversation interface entirely, would users still get what they need?"
- **Score 1 if:** Users need to ask freeform questions, get explanations, or have multi-turn interactions. The conversation IS the product.
- **Score 0 if:** The outcome is a record created, a notification sent, or data displayed. A form/dashboard/list achieves the same result.

### Factor 2: Interaction Pattern
- **Ask:** "Can I describe the dominant flow as a deterministic flowchart?"
- **Score 1 if:** The flow requires AI judgment — classifying intent, interpreting context, selecting from open-ended options. 40%+ of MVP capabilities need this.
- **Score 0 if:** The flow is: event triggers -> extract data -> transform -> write to system -> notify. Every step is deterministic.

### Factor 3: Capability Distribution
- **Count** MVP capabilities by `implementationType`:
  - Conversational types: `prompt`, `topic`, `knowledge`
  - Automation types: `flow`, `tool` (with deterministic inputs/outputs)
- **Score 1 if:** 50%+ are conversational types.
- **Score 0 if:** 50%+ are automation types.

### Factor 4: User Value of Natural Language
- **Ask:** "Would a dropdown menu or search box work just as well as typing a question?"
- **Score 1 if:** Users ask ambiguous questions ("what's the status of the thing John mentioned?"), need contextual follow-ups, or span multiple knowledge domains. Broad non-technical audience benefits from NL.
- **Score 0 if:** Users input predictable structured data (order numbers, dates, names) and receive fixed-format outputs (status, lists, confirmations).

### Factor 5: MCS Feasibility
- **Ask:** "Can MCS handle the technical requirements?"
- **Score 1 if:** Response times under 30s are acceptable, data volumes fit MCS limits, required connectors/MCPs exist, no batch processing needed.
- **Score 0 if:** Requires sub-second responses, processing thousands of records, multi-system transactions, batch/scheduled heavy compute, or capabilities MCS doesn't support.

## Alternative Recommendations by Type

### `flow` (Score 1-2)
Recommend Power Automate as the primary solution:
- **Triggers:** Map agent triggers to PA trigger types (Recurrence, When an item is created, When an email arrives, etc.)
- **Actions:** Map capabilities to PA actions (Create item, Send email, Update item, HTTP request, etc.)
- **Optional agent:** If 1-2 capabilities genuinely need conversation, recommend a minimal "status query" agent alongside the flow
- **Dashboard:** If status visibility is needed, recommend a SharePoint list view or Power BI dashboard

### `not-recommended` (Score 0)
Recommend the appropriate alternative:
- **Batch processing:** Azure Functions / Logic Apps with scheduled triggers
- **Real-time data pipelines:** Azure Data Factory / Event Hubs
- **Complex multi-system transactions:** Custom API / Microservices
- **High-frequency low-latency:** Direct API integration, no orchestrator needed

### `hybrid` (Score 3 — borderline)
Recommend agent + flow combination:
- **Agent handles:** Conversational capabilities (queries, explanations, multi-domain synthesis)
- **Flow handles:** Automation capabilities (triggered pipelines, scheduled tasks, data movement)
- **Integration:** Flow results feed into agent knowledge (SharePoint list that agent queries), or agent triggers flows via Power Automate connector

## Validation Example: Chargeback Tracking

A real example that exposed the problem:

**Use case:** Track IT chargebacks — monitor email for disputes, extract data, create tracker records, assign to teams, send reminders, answer status queries.

**6 capabilities identified:**
1. Monitor shared mailbox for chargeback disputes (`flow`)
2. Extract dispute details from emails (`flow` — AI Builder receipt processing)
3. Create/update chargeback tracker entries in SharePoint (`flow`)
4. Assign ownership based on department lookup (`flow`)
5. Send reminder notifications for aging disputes (`flow`)
6. Answer status queries about chargebacks (`knowledge` — but a SharePoint list view does this)

**Factor scoring:**
1. **Conversational Need (0)** — Users need tracking, not dialogue. The one "conversational" capability (status queries) is better served by a SharePoint list view with filters.
2. **Interaction Pattern (0)** — Email -> extract -> create record -> assign -> remind is a textbook deterministic pipeline. Zero AI decision points.
3. **Capability Distribution (0)** — 5/6 capabilities are `flow`/`tool`. Only 1/6 is potentially `knowledge`, and even that's a stretch.
4. **User Value of NL (0)** — Status queries = "show me chargebacks for Q3 in department X." A filtered SharePoint list view does this without AI.
5. **MCS Feasibility (1)** — Technically possible in MCS, but inefficient. MCS would be a thin wrapper around Power Automate flows.

**Score: 1/5 = `flow`**

**Correct recommendation:** Power Automate flow with SharePoint list as the data store. Optional: minimal agent that queries the SharePoint list, if stakeholders insist on chat interface.

**What the old system did wrong:** Researched this as a full agent with 6 capabilities, generated instructions, created eval sets, scored architecture. All wasted effort — 5 of 6 capabilities don't benefit from an agent at all.
