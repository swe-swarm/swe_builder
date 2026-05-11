# Eval Scenario Library

74 structured evaluation scenarios across 13 categories for systematic Copilot Studio agent testing.

Source: [copilot-studio-eval-scenario-library](https://github.com/serenaxxiee/copilot-studio-eval-scenario-library)

## Two-Dimensional Coverage Model

Scenarios are organized along two complementary dimensions:

### Business-Problem Scenarios (5 categories, 29 scenarios)
Verify the agent **solves the right problem** — what your agent does for users:
- Information Retrieval & Policy Q&A (BP-IR) — 6 scenarios
- Troubleshooting & Guided Diagnosis (BP-TS) — 6 scenarios
- Request Submission & Task Execution (BP-RS) — 6 scenarios
- Process Navigation & Multi-Step Guidance (BP-PN) — 6 scenarios
- Triage & Routing (BP-TR) — 5 scenarios

### Capability Scenarios (8 categories, 45 scenarios)
Verify the agent's **components work correctly** — how the infrastructure behaves:
- Knowledge Grounding & Accuracy (CAP-KG) — 6 scenarios
- Tool & Connector Invocations (CAP-TI) — 6 scenarios
- Trigger Routing (CAP-TR) — 5 scenarios
- Compliance & Verbatim Content (CAP-CV) — 6 scenarios
- Safety & Boundary Enforcement (CAP-SB) — 6 scenarios
- Tone, Helpfulness & Response Quality (CAP-TQ) — 6 scenarios
- Graceful Failure & Escalation (CAP-GF) — 5 scenarios
- Regression Testing (CAP-RT) — 5 scenarios

**Both dimensions are needed.** Business-problem scenarios verify that your agent solves the right problem. Capability scenarios verify that the underlying components work correctly. An agent can return the right answer from the wrong source, or call the right tool with the wrong parameters — only capability testing catches that.

## Entry Path A: Agent-Type Routing

| My agent... | Start with these scenarios |
|-----------|----------------------|
| Answers questions using knowledge sources | BP-IR + CAP-KG + CAP-CV |
| Executes tasks via Power Automate, APIs, or connectors | BP-RS + CAP-TI + CAP-SB |
| Walks users through diagnostic/troubleshooting steps | BP-TS + CAP-KG + CAP-GF |
| Guides users through multi-step processes | BP-PN + CAP-TR + CAP-TQ |
| Routes conversations across multiple topics | BP-TR + CAP-TR + CAP-GF |
| Serves external customers | CAP-TQ + CAP-SB + CAP-CV |
| Handles sensitive data (PII, financial, health) | CAP-SB + CAP-CV |
| Is about to be updated or republished | CAP-RT + all previously passing |

Most agents match multiple rows. Combine the scenario sets that apply.

## Entry Path B: Concern-Based Routing

| I want to... | Go to |
|-------------|-------|
| Test whether my agent answers business questions correctly | BP-IR |
| Verify my agent handles troubleshooting workflows | BP-TS |
| Test request submission and task execution | BP-RS |
| Evaluate multi-step process guidance | BP-PN |
| Check that my agent triages and routes correctly | BP-TR |
| Confirm my agent doesn't hallucinate | CAP-KG |
| Check that the right flow, connector, or API fires | CAP-TI |
| Verify my topic triggers route correctly | CAP-TR |
| Confirm a legal disclaimer or policy appears word-for-word | CAP-CV |
| Test adversarial or out-of-scope input handling | CAP-SB |
| Evaluate tone, empathy, and response quality | CAP-TQ |
| Confirm escalation and failure handling | CAP-GF |
| Ensure nothing broke before publishing an update | CAP-RT |

## What Each Scenario Contains

Every scenario follows a consistent structure from the source library:

| Section | What It Provides |
|---------|-----------------|
| **When to Use** | When this scenario applies, from the customer's perspective |
| **Recommended Test Methods** | Which Copilot Studio eval methods to use and why |
| **Setup Steps** | Step-by-step instructions for creating test cases (6-7 steps) |
| **Anti-Pattern** | The most common testing mistake to avoid |
| **Evaluation Patterns** | Named sub-patterns covering different angles (3-4 per scenario) |
| **Practical Examples** | 5-8 concrete sample test cases with input, expected value, and method |
| **Tips** | Coverage targets, thresholds, and best practices |

## Coverage Targets

Tests should be distributed across four coverage tags:

| Tag | Target % | What It Covers |
|-----|---------|---------------|
| core-business | 30-40% | Happy-path tests for primary use cases |
| variations | 20-30% | Input variations, edge cases, follow-ups |
| architecture | 20-30% | Infrastructure, multi-agent, error handling |
| edge-cases | 10-20% | Adversarial, boundary, stress tests |

## Suggested Pass Thresholds

| Category | Threshold |
|----------|----------|
| Overall agent | 85% |
| Core business scenarios | 90% |
| Safety & compliance | 95% |
| Edge case scenarios | 70% |

## Integration with Our 3-Set Eval System

The scenario library enriches our eval sets:

| Eval Set | Primary Scenario Sources | Coverage Tags |
|----------|------------------------|---------------|
| boundaries (100%) | CAP-SB, CAP-CV | core-business, architecture |
| quality (85%) | BP-IR, BP-TS, BP-RS, BP-PN, BP-TR, CAP-KG, CAP-TI, CAP-TR | core-business, variations |
| edge-cases (80%) | CAP-TQ, CAP-GF, CAP-RT | variations, edge-cases |

## Per-Test Method Overrides

While eval sets define default methods, individual tests can override methods when a scenario recommends different methods. Each scenario file includes specific **Recommended Test Methods** with rationale — use these for per-test overrides.

Override precedence: `test.methods` > `set.methods`

## Resources

- `resources/scenario-index.csv` — Flat index of all 74 scenarios (filterable)
- `resources/eval-set-template.md` — Template for building eval sets from selected scenarios

## Using This Library

1. **Orient** — Use Entry Path A (agent type) or Entry Path B (concern) to find your starting scenarios
2. **Select** — Read the "When to Use" section in each file to confirm relevance. Most agents need 3-5 business-problem + 3-5 capability scenarios
3. **Build** — Use the Practical Examples as templates, adapt to your agent's domain
4. **Validate** — Check coverage distribution after generation
