# Power-CAT Copilot Studio Kit — Integration Analysis

> **Date:** 2026-03-18
> **Sources:** Kit GitHub repo (full tree + 25 docs), MS Learn (30 pages fetched), GPT-5.4 review, 3 research agents, AppSource, Power CAT blog, community blogs
> **Recommendation:** Strategy B (AUGMENT with CLI wrappers) — Claude + GPT converge
> **Latest Kit version:** March 2026 (released 2026-03-13, 5 days ago)

## Executive Summary

The Power-CAT Copilot Studio Kit is a free, MIT-licensed Power Platform solution with **18 features** (expanded from original 15), **33 Dataverse tables**, monthly releases, and active Microsoft Power CAT team maintenance. Our MCS automation system has **12 CLI tools** covering build, eval, deploy, and sync. The systems are **complementary, not competing** — we excel at CLI-first headless automation, the Kit excels at enterprise governance and stakeholder-facing dashboards.

**Critical finding:** The Kit **cannot** create, modify, or publish agents. It is purely testing + governance + monitoring. Our build pipeline is needed regardless.

**Recommendation: AUGMENT with CLI wrappers** — keep our CLI tools as the primary build/eval engine, integrate the Kit for governance/monitoring/compliance, and wrap Kit operations behind our existing CLI surface (e.g., `powercat-test.js` expansion or new `kit-adapter.js`).

---

## Feature Mapping: Our Tools vs Kit

### Where We're Stronger

| Capability | Our Tool | Kit Equivalent | Our Advantage |
|-----------|---------|---------------|---------------|
| Eval methods | eval-scoring.js (7 methods) | 6 test types | 7th method (Plan validation) + GPT-enhanced async scoring |
| Multi-turn testing | direct-line-test.js (turns[], critical marking) | Multi-turn test type | Critical turn marking, watermark tracking, abort on critical fail |
| Plan validation | Direct Line activity stream (real-time) | ConversationTranscript (post-test) | Real-time capture vs delayed Dataverse query |
| Component sync | mcs-lsp.js (LSP wrapper) | None | Headless YAML push/pull via official Language Server |
| Model/instructions | island-client.js (Gateway API) | None | Direct Gateway API for model selection, instructions, settings |
| Tool addition | add-tool.js | None | Headless connector/MCP addition |
| Flow management | flow-manager.js | None | PA flow CRUD, trigger presets |
| Cross-env deploy | replicate-agent.js | None | Agent replication across environments |
| GPT co-generation | multi-model-review.js (14 commands) | None | Dual-model review on every non-trivial task |
| YAML validation | om-cli (357 types) | None | Offline schema validation |
| Brief-driven build | brief.json as source of truth | None | Single spec drives all tools, dashboard, reports |
| Solution library | solution-library.js (SharePoint) | Component Library (5 components) | Broader scope, team SharePoint integration |

### Where the Kit Is Stronger

| Capability | Kit Feature | Our Equivalent | Kit Advantage |
|-----------|------------|---------------|---------------|
| Compliance governance | Compliance Hub | None | SLA enforcement, risk thresholds, auto quarantine/delete |
| Agent inventory | Agent Inventory | Manual tracking | Dataverse-native catalog of all agents |
| Anti-pattern detection | Agent Review Tool | None | 3-stage AI analysis of solutions for anti-patterns |
| Production KPIs | Conversation KPIs + Analyzer | None | Conversation metrics, deep analysis |
| Prompt optimization | Prompt Advisor | None | AI Builder-driven prompt improvement (120 credits/iter) |
| CI/CD quality gates | Automated Testing via Pipelines | None | PP Pipeline integration, deployment blocking |
| App Insights | Agent Insights Hub | None | App Insights enrichment for test results + monitoring |
| Custom eval standards | Rubrics Refinement | eval-scoring.js methods | User-defined rubrics via AI Builder |
| ROI tracking | Agent Value Summary | None | Business value quantification |
| Non-CLI UI | Model-driven Power App | app/ (React dashboard) | Richer, Dataverse-native, no deployment needed |
| Webchat playground | Webchat Playground | None | In-browser testing without DL token |
| SharePoint sync | SharePoint Sync | None | Knowledge source file synchronization |

### Where We Already Integrate

| Capability | Status | Details |
|-----------|--------|---------|
| Kit test execution | **Already integrated** | `powercat-test.js` reads/writes Kit Dataverse entities (cat_copilottestruns, cat_copilottestresults, etc.) |
| Kit configurations | **Already integrated** | `powercat-test.js list-configs` queries cat_copilotconfigurations |
| Kit test sets | **Already integrated** | `powercat-test.js list-sets` queries cat_copilottestsets |

---

## Three Strategies Analyzed

### Strategy A: REPLACE — Drop Our Tools, Use Kit Only

| Aspect | Assessment |
|--------|-----------|
| **Pros** | Single platform, standard Microsoft-supported, great for non-technical users |
| **Cons** | Lose CLI-first workflow, brief.json, 7 eval methods, GPT scoring, headless ops, multi-model co-gen, YAML validation, cross-env replication |
| **Risk** | HIGH — 6-12 month delivery slowdown, regression in test depth and developer ergonomics |
| **Cost** | HIGHEST — full rewrite, retraining, change management |
| **Verdict** | **REJECTED** — loses core differentiators that make our system valuable |

### Strategy B: AUGMENT — Keep Our Tools, Add Kit for Gaps (RECOMMENDED)

| Aspect | Assessment |
|--------|-----------|
| **Pros** | Preserves investment, fastest time to value, serves both audiences (CLI engineers + stakeholders), phased adoption |
| **Cons** | Two operating surfaces, requires sync layer, some metadata duplication |
| **Risk** | LOW — integration drift manageable with clear ownership (brief.json = authoritative, Kit = observational/governance) |
| **Cost** | MEDIUM — integration adapters, schema mapping, dashboard setup |
| **Verdict** | **RECOMMENDED** — union of capabilities, best ROI |

### Strategy C: WRAP — Kit as Infrastructure Layer

| Aspect | Assessment |
|--------|-----------|
| **Pros** | Clean internal platform model, minimal engineer disruption |
| **Cons** | Underuses Kit's native UX, creates abstraction to maintain, tight coupling to Kit schema |
| **Risk** | MEDIUM — "platform around a platform", slower access to new Kit features |
| **Cost** | MEDIUM-HIGH — wrapper services, API contracts, lifecycle maintenance |
| **Verdict** | **OVER-ENGINEERED** — marginal benefit over Strategy B with higher maintenance |

---

## Strategy B Implementation Plan

### Phase 1: Install & Configure (Week 1)

1. **Install Kit from AppSource** in both dev and test environments
   - Prerequisites: PP environment with Dataverse, model-driven app license, Premium PA flows
   - Creator Kit dependency auto-installed
   - PCF components included in solution

2. **Configure agent configurations** (cat_copilotconfigurations) for existing agents
   - Token endpoint, region, channel security
   - Our `powercat-test.js list-configs` already reads these

3. **Verify existing integration** — run `powercat-test.js` against Kit entities
   - Confirm test runs, results, and enrichment work

### Phase 2: Quick Wins — Read Kit Data (Week 2-3)

4. **Agent Inventory** — query Kit's agent catalog in our dashboard
   - Read cat_copilotconfigurations + bots entity
   - Display in app/ React dashboard alongside brief.json agents
   - Brief.json `buildStatus.kitAgentId` links to Kit inventory

5. **Compliance Hub** — enable governance policies
   - Configure risk thresholds for production agents
   - SLA timers for agent review cycles
   - Teams/Outlook notifications for compliance alerts

6. **Conversation KPIs** — enable production metrics
   - Kit tracks conversation volume, resolution rates, escalation rates
   - Read into brief.json `productionMetrics` for our reports

### Phase 3: Deep Integration (Week 4-6)

7. **Agent Review Tool** — pre-deploy quality gate
   - Run Kit's 3-stage AI analysis on solutions before /mcs-deploy
   - Add to `replicate-agent.js` as optional pre-deploy step
   - Severity findings block deployment (configurable threshold)

8. **Automated Testing via Pipelines** — CI/CD quality gates
   - Hook Kit's pipeline integration into our eval-driven build loop
   - Kit blocks deployment if tests fail — aligns with our boundaries gate (100%)
   - Our `powercat-test.js` already triggers Kit tests; pipeline reads results

9. **App Insights integration**
   - Configure App Insights enrichment for test runs
   - Kit enriches test results with: latency, error traces, conversation flow
   - Read enriched data back into brief.json eval results

10. **Prompt Advisor** — AI-driven optimization
    - Run Kit's Prompt Advisor on agent instructions
    - Feed recommendations back into brief.json instructions
    - Requires AI Builder credits (120/iteration)

### Phase 4: Sync Layer (Week 7-8)

11. **Brief.json → Kit sync** (write direction)
    - After eval runs, write results to Kit's cat_copilottestresults
    - Non-CLI users see eval results in Kit's model-driven app
    - Sync eval set structure to Kit test sets

12. **Kit → Brief.json sync** (read direction)
    - Read compliance status into brief.json `compliance` section
    - Read KPI data into brief.json `productionMetrics`
    - Read inventory data for agent catalog

13. **Dashboard integration**
    - app/ React dashboard shows Kit governance status
    - Links to Kit model-driven app for detailed views
    - Compliance alerts surfaced in build reports

---

## Architecture After Integration

```
brief.json (Source of Truth)
    ├── Build Engine (Our CLI)
    │   ├── mcs-lsp.js (component sync)
    │   ├── island-client.js (Gateway API)
    │   ├── add-tool.js (tool addition)
    │   ├── flow-manager.js (PA flows)
    │   └── om-cli (YAML validation)
    │
    ├── Eval Engine (Our CLI + Kit)
    │   ├── direct-line-test.js (7 methods, GPT scoring, multi-turn)
    │   ├── eval-scoring.js (shared scoring)
    │   ├── powercat-test.js ←→ Kit Dataverse (cat_copilottest*)
    │   └── multi-model-review.js (GPT co-gen)
    │
    ├── Deploy Engine (Our CLI + Kit)
    │   ├── replicate-agent.js (cross-env)
    │   ├── Kit Agent Review Tool (pre-deploy gate)
    │   └── Kit Automated Testing (CI/CD quality gates)
    │
    └── Governance Layer (Kit)
        ├── Compliance Hub (SLA enforcement)
        ├── Agent Inventory (catalog)
        ├── Conversation KPIs (production metrics)
        ├── App Insights Hub (monitoring)
        ├── Prompt Advisor (optimization)
        └── Agent Value Summary (ROI)
```

**Data flow:**
- `brief.json` → CLI tools → Kit Dataverse (eval results, agent config)
- Kit Dataverse → `brief.json` (compliance, KPIs, inventory)
- CLI users: `brief.json` + app/ dashboard
- Non-CLI stakeholders: Kit model-driven app

---

## Prerequisites & Licensing

| Requirement | Status | Notes |
|------------|--------|-------|
| PP environment with Dataverse | Have it | Both dev and test envs |
| Model-driven app license | Check | May need Power Apps per-user or per-app plan |
| Premium PA flows | Check | Kit cloud flows require Premium connectors |
| AI Builder credits | Optional | 50 credits/test (generative answers), 120/iter (Prompt Advisor) |
| Creator Kit | Auto-installed | Kit dependency, installed with solution |
| PCF components | Included | Part of Kit solution package |

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Schema drift between Kit versions and our integration | Pin to Kit version, test on upgrade |
| Two operating surfaces confuse users | Clear ownership: CLI for build/eval, Kit for governance |
| Kit Dataverse entities change | `powercat-test.js` already abstracts entities; update mappings |
| AI Builder cost overrun | Budget alert, use Prompt Advisor selectively |
| Kit cloud flows interfere with our flows | Separate solution, no shared connections |

---

## GPT-5.4 Assessment (Verbatim)

> **Choose B: AUGMENT.** Use the CLI for execution and innovation, and the Kit for enterprise governance and stakeholder transparency. Architecturally: keep brief.json as canonical, use CLI tools as producers, and sync selected artifacts/results into Kit Dataverse entities for testing, compliance, review, KPIs, and ROI. This gives the best balance of speed, control, adoption, and enterprise readiness.
