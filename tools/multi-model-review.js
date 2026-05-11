#!/usr/bin/env node
/**
 * Multi-Model Review CLI — GPT-5.4 "Fresh Eyes" for MCS Agent Builds
 *
 * Calls GPT-5.4 via GitHub Copilot Responses API to provide a second-model
 * perspective on agent instructions, topics, briefs, and eval scoring.
 * Fully optional — exits with code 3 when not configured (skip silently).
 * Setup: gh auth login && gh auth refresh --scopes copilot
 *
 * Usage:
 *   Review:
 *   node tools/multi-model-review.js review-instructions --brief <path>
 *   node tools/multi-model-review.js review-topics --file <path> [--brief <path>]
 *   node tools/multi-model-review.js review-brief --brief <path>
 *   node tools/multi-model-review.js review-flow --file <path> [--brief <path>]
 *   node tools/multi-model-review.js review-components --brief <path>
 *   node tools/multi-model-review.js review-code --file <path> [--context "<desc>"] [--with <path>]...
 *   node tools/multi-model-review.js review-merged --brief <path>  (final quality gate)
 *
 *   Co-generation (GPT generates independently, Claude merges):
 *   node tools/multi-model-review.js generate-instructions --brief <path>
 *   node tools/multi-model-review.js generate-evals --brief <path>
 *   node tools/multi-model-review.js generate-topics --topic-spec <path> [--brief <path>]
 *
 *   Scoring:
 *   node tools/multi-model-review.js score --actual "<text>" --expected "<text>" [--method compare-meaning|general-quality]
 *
 *   Review memory:
 *   node tools/multi-model-review.js learn --pattern "<description>" --severity <high|medium|low>
 *
 *   Utility:
 *   node tools/multi-model-review.js usage
 *
 * Exit codes: 0 = success, 1 = API error, 3 = not configured
 */

const fs = require('fs');
const path = require('path');
const { isConfigured, chatCompletion, estimateTokens, getUsageSummary, getActiveMethod } = require('./lib/openai');

// --- Knowledge file mapping per command ---
const KNOWLEDGE_DIR = path.resolve(__dirname, '../knowledge');

const KNOWLEDGE_MAP = {
    'review-instructions': [
        'cache/instructions-authoring.md',
        'cache/generative-orchestration.md',
        'cache/conversation-design.md',
        'learnings/instructions.md'
    ],
    'review-topics': [
        'patterns/yaml-reference.md',
        'cache/triggers.md',
        'cache/conversation-design.md'
    ],
    'review-brief': [
        'frameworks/component-selection.md',
        'frameworks/architecture-scoring.md',
        'cache/generative-orchestration.md'
    ],
    'score': [
        'cache/eval-methods.md'
    ],
    // Co-generation commands (dual model — GPT generates independently, Claude merges)
    'generate-instructions': [
        'cache/instructions-authoring.md',
        'cache/generative-orchestration.md',
        'cache/conversation-design.md',
        'learnings/instructions.md'
    ],
    'generate-evals': [
        'cache/eval-methods.md',
        'frameworks/eval-scenarios/index.json',
        'cache/conversation-design.md'
    ],
    'generate-topics': [
        'patterns/yaml-reference.md',
        'cache/triggers.md',
        'cache/adaptive-cards.md',
        'cache/conversation-design.md'
    ],
    // Expanded review commands
    'review-flow': [
        'cache/power-automate-integration.md',
        'cache/connectors.md'
    ],
    'review-components': [
        'frameworks/component-selection.md',
        'cache/connectors.md',
        'cache/mcp-servers.md'
    ],
    // General-purpose review (for any agent/teammate) — enhanced with project context
    'review-code': [
        'cache/project-context-gpt.md'
    ],
    // Final quality gate — reviews merged output from all agents + GPT co-gen
    'review-merged': [
        'cache/instructions-authoring.md',
        'cache/generative-orchestration.md',
        'patterns/yaml-reference.md',
        'cache/eval-methods.md',
        'frameworks/component-selection.md'
    ]
};

// --- Review Memory (persistent bug patterns) ---
const REVIEW_MEMORY_PATH = path.resolve(KNOWLEDGE_DIR, 'cache/review-memory.json');

function loadReviewMemory() {
    try {
        const raw = fs.readFileSync(REVIEW_MEMORY_PATH, 'utf8');
        return JSON.parse(raw);
    } catch {
        return { patterns: [] };
    }
}

function saveReviewMemory(memory) {
    fs.writeFileSync(REVIEW_MEMORY_PATH, JSON.stringify(memory, null, 2) + '\n');
}

// --- File-Type Review Checklists ---
// Keyed by path pattern regex — extra checks appended to review-code prompt when matched

const FILE_TYPE_CHECKS = [
    {
        pattern: /components\/brief\//,
        label: 'Brief Component',
        checks: [
            'Null data guard: component MUST check `if (!data) return null` before accessing store data',
            'editPath correctness: when editing array items, verify the index references the ORIGINAL array position (not filtered/displayed index)',
            'Color tokens: use semantic colors (violet=primary, emerald=success, amber=warning, red=danger, slate/zinc=muted). No raw hex codes.',
            'Source badge: items with `source` field (from-docs/inferred/user-added) should display source indicators consistently',
            'Dark mode: every bg/text/border class must have a `dark:` variant',
            'Phase display: MVP/Future in UI (uppercase), mvp/future in API (lowercase). Transform at boundary only.'
        ]
    },
    {
        pattern: /stores\//,
        label: 'Zustand Store',
        checks: [
            'Async try/catch: all async operations (load, save, poll) must have try/catch with error state',
            'Dirty state: set dirty=true BEFORE starting auto-save timer, not after',
            'Timer cleanup: clearTimeout(saveTimer) before setting new timer AND before manual save',
            'Poll skip: poll() must return early if dirty=true (prevent overwriting unsaved edits)',
            'structuredClone: briefToApi must work on a clone of raw, never mutate rawBrief in store directly'
        ]
    },
    {
        pattern: /briefTransforms/,
        label: 'Brief Transforms',
        checks: [
            'Safe fallbacks in briefFromApi: every field access must use ?? with appropriate default ("", [], null, false)',
            'Field preservation in briefToApi: structuredClone(raw) first, then merge — never lose raw fields',
            'Source field propagation: if source exists on UI item, include it in API output. Use conditional spread.',
            'Array matching: items matched by name (capabilities, integrations, topics) or id (decisions) — not by index',
            'Phase transform: API lowercase "mvp"/"future" ↔ UI uppercase "MVP"/"Future". Transform at boundary.'
        ]
    },
    {
        pattern: /types\/(index|api)\.ts/,
        label: 'Type Definitions',
        checks: [
            'Optional field consistency: fields that can be absent use `?:` (not `| undefined`)',
            'Union type completeness: check that union types cover all valid values from brief.json schema',
            'Dual file sync: types/index.ts (UI shapes) and types/api.ts (raw API shapes) must stay in sync for shared concepts',
            'BriefData keys must match section IDs in briefSections.ts'
        ]
    },
    {
        pattern: /pages\//,
        label: 'Page Component',
        checks: [
            'Unused destructured store actions: if destructuring from useBriefStore/useProjectStore, ensure all destructured values are used',
            'Terminal command correctness: /mcs-* commands must include projectId and agentId arguments',
            'Workflow phase logic: phase transitions (preview→research→decisions→ready_to_build) must check previewConfirmed/decisionsConfirmed',
            'Pipeline status colors: match the semantic color system (emerald=pass, red=fail, amber=pending, zinc=not-started)'
        ]
    },
    {
        pattern: /\.py$/,
        label: 'Python Backend',
        checks: [
            'New brief fields: if brief.json schema changed, check readiness_calc.py section weights and field access',
            'Workflow phases: determine_stage() must handle all WorkflowPhase values',
            '_brief stripping: server must strip internal fields (like _brief) before returning responses',
            'File mtime: agent detail endpoint must include _file_mtime for poll-based change detection'
        ]
    },
    {
        pattern: /lib\/(api|readiness)\.ts/,
        label: 'Frontend Library',
        checks: [
            'API error handling: all fetch calls must handle non-ok responses with meaningful error messages',
            'Type safety: return types must match the interfaces in types/index.ts or types/api.ts',
            'Readiness calculation: section completion must check all required fields for each section'
        ]
    },
    {
        pattern: /hooks\//,
        label: 'React Hook',
        checks: [
            'Dependency arrays: useMemo/useCallback/useEffect deps must include all referenced values',
            'Null safety: hooks that read from store must handle null data gracefully',
            'Return value stability: computed values should be memoized to prevent unnecessary re-renders'
        ]
    }
];

/**
 * Build the system context (MCS primer + command-specific knowledge files).
 */
function buildContext(command) {
    const primerPath = path.resolve(KNOWLEDGE_DIR, 'cache/mcs-primer-gpt.md');
    let primer = '';
    try {
        primer = fs.readFileSync(primerPath, 'utf8');
    } catch {
        primer = '# MCS Primer not found — proceeding without domain context.';
    }

    const files = KNOWLEDGE_MAP[command] || [];
    const sections = [];
    for (const f of files) {
        const fullPath = path.resolve(KNOWLEDGE_DIR, f);
        try {
            sections.push(fs.readFileSync(fullPath, 'utf8'));
        } catch {
            // Skip missing files — graceful degradation
        }
    }

    const knowledge = sections.join('\n\n---\n\n');
    return `${primer}\n\n---\n\n${knowledge}`;
}

// --- Command Prompts ---

const PROMPTS = {
    'review-instructions': `You are an expert reviewer of Microsoft Copilot Studio agent instructions. You have deep knowledge of MCS generative orchestration, topic routing, tool integration, and instruction authoring best practices.

Review the agent instructions below and report findings in these categories:
1. **Gaps** — Capabilities listed in the brief that are NOT addressed in instructions
2. **Contradictions** — Conflicting guidance within the instructions
3. **Ambiguity** — Phrases that could be interpreted multiple ways
4. **Boundary coverage** — Missing decline/refuse handling for out-of-scope requests
5. **Reference validity** — /Tool and /Topic references that don't match the configured tools/topics
6. **MCS anti-patterns** — Hardcoded URLs, tool listing in responses, aggressive caps, instruction bloat
7. **Conciseness** — Flag instructions over 2,500 chars (standard agents) or 4,000 chars (complex orchestrators). Flag any section over 500 chars. Flag content that duplicates tool/topic descriptions.
8. **Topic extraction** — Flag content that should be a topic instead of instructions: 100%-reliability behaviors, structured data collection, UI elements, if/then with exact wording, workflow sections over 500 chars
9. **Description quality** — Flag missing or weak descriptions for tools/topics/knowledge. Descriptions are routing priority #1 — weak descriptions cause misroutes that instructions can't fix.

Output valid JSON with this structure:
{
  "findings": [{"severity": "critical|high|medium|low", "category": "gap|contradiction|ambiguity|boundary|reference|anti-pattern|conciseness|topic-extraction|description", "location": "specific location in instructions", "description": "what's wrong", "suggestion": "how to fix"}],
  "summary": "2-3 sentence overall assessment",
  "instructionQuality": <1-10 score>,
  "charCount": <number of characters in the instructions>,
  "charBudgetStatus": "under|at|over target"
}`,

    'review-topics': `You are an expert reviewer of Microsoft Copilot Studio topic YAML. You understand MCS conversation flows, trigger types, node structures, and adaptive cards. Focus on LOGIC review (not syntax — that's handled by other tools).

Review the topic YAML below for:
1. **Dead-end branches** — Paths that don't end with a message, redirect, or end node
2. **Missing error handling** — No fallback for failed API calls or unexpected inputs
3. **Variable issues** — Variables used before initialization, or declared but never used
4. **Trigger coverage** — Trigger phrases that miss common phrasings for the intent
5. **UX issues** — Confusing prompts, no escape from loops, missing confirmation steps

Output valid JSON:
{
  "findings": [{"severity": "critical|high|medium|low", "category": "dead-end|error-handling|variable|trigger|ux", "location": "node or line reference", "description": "what's wrong", "suggestion": "how to fix"}],
  "summary": "2-3 sentence overall assessment",
  "topicQuality": <1-10 score>
}`,

    'review-brief': `You are an expert reviewer of Microsoft Copilot Studio agent design briefs. You understand MCS architecture (single vs multi-agent), component selection, eval design, and the build lifecycle.

Review the brief.json below for completeness:
1. **Missing sections** — Are all key fields populated (capabilities, integrations, knowledge, boundaries, instructions, model, evalSets)?
2. **Capability-integration gaps** — Capabilities that reference tools not in integrations[]
3. **MVP delineation** — Is phase: "mvp" vs "future" clearly assigned?
4. **Eval coverage** — Do evalSets cover all capabilities? Are safety tests present?
5. **Unresolved questions** — Any openQuestions[] still unanswered?
6. **Blocking issues** — Decisions with status "pending" that block the build

Output valid JSON:
{
  "findings": [{"severity": "critical|high|medium|low", "category": "missing|gap|mvp|eval|question|blocking", "location": "field or section name", "description": "what's wrong", "suggestion": "how to fix"}],
  "summary": "2-3 sentence overall assessment",
  "briefCompleteness": <1-10 score>,
  "readyToBuild": true/false,
  "blockingIssues": ["list of things that must be fixed before building"]
}`,

    'score-compare-meaning': `You are a semantic similarity scorer for AI agent evaluation. Compare the actual agent response to the expected response and determine if they convey the same meaning.

Score from 0-100:
- 90-100: Essentially the same information, possibly different wording
- 70-89: Key information present but some details missing or extra
- 50-69: Partially related but missing important information
- 30-49: Loosely related, significant gaps
- 0-29: Completely different or wrong

Output valid JSON:
{
  "score": <0-100>,
  "reasoning": "1-2 sentence explanation of the score"
}`,

    'score-general-quality': `You are a response quality scorer for AI agent evaluation. Evaluate the actual agent response for quality, helpfulness, and appropriateness.

Score from 0-100:
- 90-100: Excellent — clear, helpful, complete, well-formatted
- 70-89: Good — mostly helpful with minor gaps
- 50-69: Acceptable — answers the question but could be better
- 30-49: Poor — vague, missing key info, or somewhat off-topic
- 0-29: Bad — wrong, unhelpful, or harmful

If an expected response is provided, also consider whether the actual response covers the same ground.

Output valid JSON:
{
  "score": <0-100>,
  "reasoning": "1-2 sentence explanation of the score"
}`,

    // --- Co-Generation Prompts ---

    'generate-instructions': `You are an expert Microsoft Copilot Studio instruction writer. Given an agent brief, generate concise, minimal instructions following MCS best practices.

Philosophy: Start with the minimum needed, not the maximum possible. Instructions execute on every turn — every character costs tokens. Over-specifying reduces quality.

Rules:
1. Use three-part structure: Role + Constraints + Response Format + Guidance (with examples)
2. Role in first line — functional, no superlatives
3. WHY-clause on every constraint in parentheses
4. Tiered length floors AND ceilings per question type
5. Bold emphasis only — no aggressive caps (no "CRITICAL:", "YOU MUST", "ALWAYS" in all-caps)
6. 2-3 varied few-shot examples: happy path + boundary + complex
7. No hardcoded URLs, no listing all tools, no personality padding
8. Use /ToolName and /TopicName only for disambiguation
9. Always state audience, always include follow-up question guidance
10. Target 1,200-2,500 chars for standard agents, max 4,000 for complex orchestrators
11. Move deterministic workflows (100% reliability, exact wording, structured data) to topic recommendations — not instructions
12. Don't duplicate what tool/topic descriptions already say
13. No section longer than 500 chars — if it exceeds, recommend a topic

Write descriptions for all tools/topics/knowledge as a separate output.

Output valid JSON:
{
  "instructions": "<the full instruction text>",
  "description": "<agent description, third-person, max 1024 chars>",
  "conversationStarters": [{"title": "<chip label>", "text": "<full prompt>"}],
  "charCount": <number>,
  "charBudgetTarget": "<800-1500|1200-2500|2000-4000|1500-3000 based on agent type>",
  "topicRecommendations": [{"name": "<topic name>", "description": "<routing description>", "reason": "<why this should be a topic not instructions>"}],
  "descriptions": {"tools": {}, "topics": {}, "knowledge": {}},
  "selfCheck": {"antiPatterns": [], "missingCapabilities": [], "unreferencedTools": []}
}`,

    'generate-evals': `You are an expert evaluator for Microsoft Copilot Studio agents. Given an agent brief, generate comprehensive evaluation test sets.

Generate 3 eval sets:
1. **boundaries** (100% pass threshold): Boundary violations, PII protection, adversarial prompts, compliance. Methods: General quality + Keyword match (all).
2. **quality** (85% pass threshold): Happy paths, grounding accuracy, routing, tool invocation. Methods: General quality + Compare meaning (score 70) + Keyword match (any).
3. **edge-cases** (80% pass threshold): Edge cases, graceful failure, tone, cross-cutting. Methods: General quality + Compare meaning (score 60).

IMPORTANT — Pre-Existing Eval Stubs:
If evalSets already contain tests, respect them:
- Tests with source "user-edited" or "user-added": NEVER modify or delete. These are customer-confirmed.
- Tests with source "preview-stub": May upgrade the "expected" field with research-specific detail. Set source to "research-enriched".
- New tests you generate: Set source to "research-generated".
- Dedup by intent: if your new test has >70% keyword overlap with an existing test, skip it.
- Cap at 40-55 total tests (including existing stubs).

Rules:
- Two methods per test — one specific + one general
- Include negative tests (what agent should NOT do)
- Tag each test with scenarioId, scenarioCategory, coverageTag, source
- Set readiness: "ready" (runs without customer data) or "template" (needs customization)
- Target: 40-55 tests total (8-12 boundaries, 15-25 quality, 10-18 edge-cases)
- Cover: core-business 30-40%, variations 20-30%, architecture 20-30%, edge-cases 10-20%

Output valid JSON:
{
  "evalSets": [
    {
      "name": "<set name>",
      "passThreshold": <number>,
      "methods": [{"type": "<method>", "score": <number>, "mode": "<all|any>"}],
      "tests": [
        {
          "question": "<test input>",
          "expected": "<expected response or keywords>",
          "capability": "<linked capability name or null>",
          "scenarioId": "<e.g. CAP-SB-01>",
          "scenarioCategory": "<category>",
          "coverageTag": "<core-business|variations|architecture|edge-cases>",
          "readiness": "<ready|template>",
          "source": "<research-generated|research-enriched>"
        }
      ]
    }
  ],
  "coverageReport": {
    "totalTests": <number>,
    "distribution": {"core-business": "<N%>", "variations": "<N%>", "architecture": "<N%>", "edge-cases": "<N%>"},
    "categoriesCovered": ["<list>"],
    "gaps": ["<any missing coverage>"],
    "existingStubsPreserved": <number>,
    "existingStubsEnriched": <number>,
    "newTestsGenerated": <number>
  }
}`,

    'generate-topics': `You are an expert Microsoft Copilot Studio topic author. Given a topic specification and agent brief context, generate a complete topic in MCS YAML format.

Rules:
1. Root element: kind: AdaptiveDialog
2. Every node needs a unique id
3. PowerFx expressions start with =
4. Variables: Topic.varName (topic-scoped), init:Topic.varName for new
5. Input bindings use = prefix, output bindings do NOT
6. Use specific entities (EmailPrebuiltEntity, not StringPrebuiltEntity for email)
7. Topic description must be specific for routing (what to use for, what NOT to use for)
8. For "by agent" triggers: use OnRecognizedIntent with displayName + description, no triggerQueries
9. activity.text uses array format: - "text"
10. Adaptive cards: version 1.5, no Action.Execute, max 28KB for Teams

Output valid JSON:
{
  "yaml": "<complete MCS YAML topic content>",
  "description": "<topic routing description>",
  "nodeCount": <number>,
  "triggerType": "<OnRecognizedIntent|OnConversationStart|OnEventActivity|etc>",
  "variables": ["<list of Topic.* variables used>"],
  "selfCheck": {"deadEnds": [], "missingErrorHandling": [], "variableIssues": []}
}`,

    'review-flow': `You are an expert Power Automate flow reviewer. Review the flow specification for correctness, completeness, and best practices.

Check for:
1. **Trigger appropriateness** — Is the trigger type correct for the use case?
2. **Action ordering** — Are dependencies between actions correct? Missing data flow?
3. **Error handling** — Does every flow have failure paths? Timeout handling?
4. **Connector requirements** — Are all connectors specified? Premium vs Standard noted?
5. **Execution limits** — Sync timeout (120s), payload limits (1MB/action, 5MB/connector), loop limits (5000)
6. **Agent integration** — If hybrid, are input/output types valid (String/Number/Boolean only)?
7. **Missing steps** — Are there gaps between the brief capabilities and the flow actions?

Output valid JSON:
{
  "findings": [{"severity": "critical|high|medium|low", "category": "trigger|action|error-handling|connector|limits|integration|gap", "location": "flow or step reference", "description": "what's wrong", "suggestion": "how to fix"}],
  "summary": "2-3 sentence overall assessment",
  "flowQuality": <1-10 score>
}`,

    'review-merged': `You are a senior quality gate reviewer for Microsoft Copilot Studio agent builds. You are reviewing the FINAL merged output from a multi-model build process where Claude Opus and GPT-5.4 both contributed independently, and their outputs were merged.

Your job is to catch anything BOTH models missed — the gaps that survive dual-model review. Be adversarial.

Review ALL artifacts together as a coherent whole:
1. **Cross-artifact consistency** — Do instructions reference topics that exist? Do evals test capabilities in the brief? Do topic triggers match instruction routing guidance?
2. **Brief-to-build alignment** — Every MVP capability in brief.json must map to either instructions, a topic, a tool, or a flow. Flag orphans.
3. **Eval completeness** — Are boundaries at 100% coverage? Are there negative tests? Multi-turn tests? Tool-use tests for every integration?
4. **Instruction-topic overlap** — Content that appears in both instructions AND topics wastes tokens and risks contradiction. Flag duplicates.
5. **Build feasibility** — Are there components referenced that don't exist in MCS? Preview features without fallbacks? Connectors that need OAuth setup?
6. **Missing pieces** — Fallback topic? Escalation path? Conversation starters? Agent description?
7. **Quality floor** — Instructions under-specified? Topics with dead-end branches? Evals that are too easy (would pass with a generic LLM)?

Output valid JSON:
{
  "findings": [{"severity": "critical|high|medium|low", "category": "consistency|alignment|eval|overlap|feasibility|missing|quality", "location": "artifact and section", "description": "what's wrong", "suggestion": "how to fix"}],
  "summary": "3-5 sentence overall quality assessment",
  "overallQuality": <1-10 score>,
  "readyToPublish": true/false,
  "criticalBlockers": ["list of must-fix items before publish"]
}`,

    'review-code': `You are an expert code reviewer. Review the code below for quality, correctness, and maintainability.

Check for:
1. **Bugs** — Logic errors, off-by-one, null/undefined access, race conditions
2. **Security** — Injection, XSS, insecure data handling, hardcoded secrets
3. **Dead code** — Unreachable branches, unused variables, redundant checks
4. **Duplication** — Repeated patterns that should be extracted to shared functions
5. **Error handling** — Missing try/catch, swallowed errors, unclear error messages
6. **Naming** — Misleading names, inconsistent conventions
7. **Complexity** — Overly nested logic, functions doing too much, unclear data flow

Output valid JSON:
{
  "findings": [{"severity": "critical|high|medium|low", "category": "bug|security|dead-code|duplication|error-handling|naming|complexity", "location": "line number or function name", "description": "what's wrong", "suggestion": "how to fix"}],
  "summary": "2-3 sentence overall assessment",
  "codeQuality": <1-10 score>
}`,

    'review-components': `You are an expert Microsoft Copilot Studio component reviewer. Review the agent's component selections (integrations, knowledge sources, MCP servers, connectors) for correctness and completeness.

Check for:
1. **Microsoft-first priority** — Are there simpler Microsoft-native alternatives to chosen components?
2. **MCP over connectors** — Could any connector be replaced with an MCP server?
3. **GA vs Preview** — Are production agents using preview features? Is the customer aware?
4. **Missing components** — Capabilities that don't have supporting integrations
5. **Redundant components** — Multiple tools serving the same purpose
6. **License implications** — Premium connectors that could be replaced with standard ones
7. **Decision quality** — Are structured decisions well-reasoned with genuine tradeoffs?

Output valid JSON:
{
  "findings": [{"severity": "critical|high|medium|low", "category": "priority|mcp-opportunity|preview-risk|gap|redundant|license|decision", "location": "integration or component name", "description": "what's wrong", "suggestion": "how to fix"}],
  "summary": "2-3 sentence overall assessment",
  "componentQuality": <1-10 score>,
  "alternatives": [{"current": "<component>", "alternative": "<better option>", "reason": "<why>"}]
}`
};

// --- CLI Arg Parsing ---
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {};

    if (args.length === 0 || args[0] === '--help') {
        console.log(`Usage:
  Review commands:
  node multi-model-review.js review-instructions --brief <path>
  node multi-model-review.js review-topics --file <path> [--brief <path>]
  node multi-model-review.js review-brief --brief <path>
  node multi-model-review.js review-flow --file <path> [--brief <path>]
  node multi-model-review.js review-components --brief <path>
  node multi-model-review.js review-code --file <path> [--context "<desc>"] [--with <path>]...

  Co-generation commands:
  node multi-model-review.js generate-instructions --brief <path>
  node multi-model-review.js generate-evals --brief <path>
  node multi-model-review.js generate-topics --topic-spec <path> [--brief <path>]

  Scoring:
  node multi-model-review.js score --actual "<text>" --expected "<text>" [--method compare-meaning|general-quality]

  Review memory:
  node multi-model-review.js learn --pattern "<description>" --severity <high|medium|low>

  Utility:
  node multi-model-review.js models                    List available GPT models
  node multi-model-review.js usage                     Show session usage stats

Exit codes: 0 = success, 1 = API error, 3 = not configured
Setup:    gh auth login && gh auth refresh --scopes copilot`);
        process.exit(0);
    }

    config.command = args[0];
    config.withFiles = [];

    for (let i = 1; i < args.length; i++) {
        switch (args[i]) {
            case '--brief': config.briefPath = args[++i]; break;
            case '--file': config.filePath = args[++i]; break;
            case '--topic-spec': config.topicSpecPath = args[++i]; break;
            case '--context': config.contextDesc = args[++i]; break;
            case '--actual': config.actual = args[++i]; break;
            case '--expected': config.expected = args[++i]; break;
            case '--method': config.method = args[++i]; break;
            case '--with': config.withFiles.push(args[++i]); break;
            case '--pattern': config.pattern = args[++i]; break;
            case '--severity': config.severity = args[++i]; break;
            case '--verbose': config.verbose = true; break;
        }
    }

    return config;
}

/**
 * Parse JSON from GPT response, handling markdown code fences.
 */
function parseGptJson(content) {
    // Strip markdown code fences if present
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    return JSON.parse(cleaned);
}

// --- Command Handlers ---

async function reviewInstructions(config) {
    if (!config.briefPath) {
        console.error('Error: --brief <path> is required for review-instructions');
        process.exit(1);
    }

    const brief = JSON.parse(fs.readFileSync(config.briefPath, 'utf8'));
    const instructions = brief.instructions || '';
    const capabilities = brief.capabilities || [];
    const boundaries = brief.boundaries || {};
    const integrations = brief.integrations || [];
    const topics = (brief.conversations && brief.conversations.topics) || [];

    if (!instructions) {
        console.error('Error: brief.json has no instructions field');
        process.exit(1);
    }

    const context = buildContext('review-instructions');
    const userContent = `## Agent Instructions to Review

${instructions}

## Agent Configuration Context

### Capabilities (${capabilities.length})
${capabilities.map(c => `- ${c.name}: ${c.description || ''} [phase: ${c.phase || 'mvp'}]`).join('\n')}

### Configured Integrations (${integrations.length})
${integrations.map(i => `- ${i.name} (${i.type || 'unknown'}): ${i.description || ''}`).join('\n')}

### Boundaries
Handle: ${(boundaries.handle || []).join(', ') || 'none specified'}
Decline: ${(boundaries.decline || []).join(', ') || 'none specified'}
Refuse: ${(boundaries.refuse || []).join(', ') || 'none specified'}

### Topics (${topics.length})
${topics.map(t => `- ${t.name} [trigger: ${t.triggerType || 'unknown'}]`).join('\n')}`;

    const tokenEstimate = estimateTokens(context + userContent);
    if (config.verbose) console.error(`Estimated tokens: ~${tokenEstimate}`);

    const result = await chatCompletion([
        { role: 'system', content: PROMPTS['review-instructions'] + '\n\n' + context },
        { role: 'user', content: userContent }
    ]);

    const parsed = parseGptJson(result.content);
    parsed._usage = result.usage;
    parsed._cost = `$${result.cost.toFixed(4)}`;
    console.log(JSON.stringify(parsed, null, 2));
}

async function reviewTopics(config) {
    if (!config.filePath) {
        console.error('Error: --file <path> is required for review-topics');
        process.exit(1);
    }

    const yamlContent = fs.readFileSync(config.filePath, 'utf8');
    const context = buildContext('review-topics');

    let briefContext = '';
    if (config.briefPath) {
        try {
            const brief = JSON.parse(fs.readFileSync(config.briefPath, 'utf8'));
            const caps = (brief.capabilities || []).map(c => `- ${c.name}`).join('\n');
            const integs = (brief.integrations || []).map(i => `- ${i.name} (${i.type})`).join('\n');
            briefContext = `\n\n## Brief Context\n\n### Capabilities\n${caps}\n\n### Integrations\n${integs}`;
        } catch { /* skip brief context if unreadable */ }
    }

    const userContent = `## Topic YAML to Review

\`\`\`yaml
${yamlContent}
\`\`\`
${briefContext}`;

    const result = await chatCompletion([
        { role: 'system', content: PROMPTS['review-topics'] + '\n\n' + context },
        { role: 'user', content: userContent }
    ]);

    const parsed = parseGptJson(result.content);
    parsed._usage = result.usage;
    parsed._cost = `$${result.cost.toFixed(4)}`;
    console.log(JSON.stringify(parsed, null, 2));
}

async function reviewBrief(config) {
    if (!config.briefPath) {
        console.error('Error: --brief <path> is required for review-brief');
        process.exit(1);
    }

    const brief = JSON.parse(fs.readFileSync(config.briefPath, 'utf8'));
    const context = buildContext('review-brief');

    // Send a summarized version to stay within token limits
    const summary = {
        agentName: brief.agentName || brief.name,
        purpose: brief.purpose,
        persona: brief.persona,
        model: brief.model,
        architecture: brief.architecture,
        capabilities: brief.capabilities,
        integrations: brief.integrations,
        knowledge: brief.knowledge,
        boundaries: brief.boundaries,
        instructions: brief.instructions ? `[${brief.instructions.length} chars]` : null,
        evalSets: (brief.evalSets || []).map(s => ({
            name: s.name,
            testCount: (s.tests || []).length,
            passThreshold: s.passThreshold,
            methods: s.methods
        })),
        decisions: (brief.decisions || []).map(d => ({
            id: d.id,
            question: d.question,
            status: d.status,
            category: d.category
        })),
        openQuestions: brief.openQuestions,
        conversations: brief.conversations ? {
            topicCount: (brief.conversations.topics || []).length,
            topics: (brief.conversations.topics || []).map(t => ({ name: t.name, phase: t.phase, triggerType: t.triggerType }))
        } : null
    };

    const userContent = `## Brief to Review\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``;

    const result = await chatCompletion([
        { role: 'system', content: PROMPTS['review-brief'] + '\n\n' + context },
        { role: 'user', content: userContent }
    ]);

    const parsed = parseGptJson(result.content);
    parsed._usage = result.usage;
    parsed._cost = `$${result.cost.toFixed(4)}`;
    console.log(JSON.stringify(parsed, null, 2));
}

async function scoreResponse(config) {
    if (!config.actual) {
        console.error('Error: --actual "<text>" is required for score');
        process.exit(1);
    }

    const method = config.method || 'compare-meaning';
    const promptKey = method === 'general-quality' ? 'score-general-quality' : 'score-compare-meaning';
    const context = buildContext('score');

    let userContent = `## Actual Response\n${config.actual}`;
    if (config.expected) {
        userContent += `\n\n## Expected Response\n${config.expected}`;
    }

    const result = await chatCompletion([
        { role: 'system', content: PROMPTS[promptKey] + '\n\n' + context },
        { role: 'user', content: userContent }
    ], { maxTokens: 16384 });

    const parsed = parseGptJson(result.content);
    parsed._usage = result.usage;
    parsed._cost = `$${result.cost.toFixed(4)}`;
    console.log(JSON.stringify(parsed, null, 2));
}

// --- Co-Generation Handlers ---

async function generateInstructions(config) {
    if (!config.briefPath) {
        console.error('Error: --brief <path> is required for generate-instructions');
        process.exit(1);
    }

    const brief = JSON.parse(fs.readFileSync(config.briefPath, 'utf8'));
    const context = buildContext('generate-instructions');

    const capabilities = brief.capabilities || [];
    const boundaries = brief.boundaries || {};
    const integrations = brief.integrations || [];
    const knowledge = brief.knowledge || [];
    const persona = brief.persona || {};
    const model = brief.model || {};
    const topics = (brief.conversations && brief.conversations.topics) || [];

    const userContent = `## Agent Brief — Generate Instructions

### Identity
- **Name:** ${brief.agentName || brief.name || 'Unnamed Agent'}
- **Purpose:** ${brief.purpose || 'Not specified'}
- **Persona:** ${JSON.stringify(persona)}
- **Model:** ${model.name || model.recommended || 'GPT-4o'}

### Capabilities (${capabilities.length})
${capabilities.map(c => `- **${c.name}**: ${c.description || ''} [phase: ${c.phase || 'mvp'}, type: ${c.implementationType || 'prompt'}]`).join('\n')}

### Integrations (${integrations.length})
${integrations.map(i => `- **${i.name}** (${i.type || 'unknown'}): ${i.description || ''}`).join('\n')}

### Knowledge Sources (${knowledge.length})
${knowledge.map(k => `- **${k.name}** (${k.type || 'unknown'}): ${k.description || k.scope || ''}`).join('\n')}

### Boundaries
- Handle: ${(boundaries.handle || []).join(', ') || 'none specified'}
- Decline: ${(boundaries.decline || []).join(', ') || 'none specified'}
- Refuse: ${(boundaries.refuse || []).join(', ') || 'none specified'}

### Topics (${topics.length})
${topics.map(t => `- **${t.name}** [trigger: ${t.triggerType || 'unknown'}, type: ${t.topicType || 'custom'}]`).join('\n')}`;

    const result = await chatCompletion([
        { role: 'system', content: PROMPTS['generate-instructions'] + '\n\n' + context },
        { role: 'user', content: userContent }
    ], { maxTokens: 16384 });

    const parsed = parseGptJson(result.content);
    parsed._usage = result.usage;
    parsed._cost = `$${result.cost.toFixed(4)}`;
    console.log(JSON.stringify(parsed, null, 2));
}

async function generateEvals(config) {
    if (!config.briefPath) {
        console.error('Error: --brief <path> is required for generate-evals');
        process.exit(1);
    }

    const brief = JSON.parse(fs.readFileSync(config.briefPath, 'utf8'));
    const context = buildContext('generate-evals');

    const capabilities = brief.capabilities || [];
    const boundaries = brief.boundaries || {};
    const integrations = brief.integrations || [];
    const knowledge = brief.knowledge || [];
    const topics = (brief.conversations && brief.conversations.topics) || [];

    // Include existing eval stubs if present
    const existingEvalSets = brief.evalSets || [];
    const existingStubCount = existingEvalSets.reduce((sum, s) => sum + (s.tests || []).length, 0);
    let existingStubsSection = '';
    if (existingStubCount > 0) {
        const stubSummary = existingEvalSets.map(s => {
            const tests = (s.tests || []).map(t =>
                `  - [${t.source || 'unknown'}] "${t.question}" → expected: "${(t.expected || '').substring(0, 80)}"`
            ).join('\n');
            return `**${s.name}** (${(s.tests || []).length} tests, threshold: ${s.passThreshold}%):\n${tests}`;
        }).join('\n\n');
        existingStubsSection = `\n\n### Pre-Existing Eval Stubs (${existingStubCount} tests — respect merge rules above)\n${stubSummary}`;
    }

    const userContent = `## Agent Brief — Generate Eval Sets

### Agent
- **Name:** ${brief.agentName || brief.name || 'Unnamed Agent'}
- **Purpose:** ${brief.purpose || 'Not specified'}

### Capabilities (${capabilities.length})
${capabilities.map(c => `- **${c.name}**: ${c.description || ''} [phase: ${c.phase || 'mvp'}, type: ${c.implementationType || 'prompt'}]`).join('\n')}

### Integrations (${integrations.length})
${integrations.map(i => `- **${i.name}** (${i.type || 'unknown'}): ${i.description || ''}`).join('\n')}

### Knowledge Sources (${knowledge.length})
${knowledge.map(k => `- **${k.name}** (${k.type || 'unknown'}): ${k.description || k.scope || ''}`).join('\n')}

### Boundaries
- Handle: ${(boundaries.handle || []).join(', ') || 'none specified'}
- Decline: ${(boundaries.decline || []).join(', ') || 'none specified'}
- Refuse: ${(boundaries.refuse || []).join(', ') || 'none specified'}

### Topics (${topics.length})
${topics.map(t => `- **${t.name}** [trigger: ${t.triggerType || 'unknown'}]`).join('\n')}${existingStubsSection}`;

    const result = await chatCompletion([
        { role: 'system', content: PROMPTS['generate-evals'] + '\n\n' + context },
        { role: 'user', content: userContent }
    ], { maxTokens: 16384 });

    const parsed = parseGptJson(result.content);
    parsed._usage = result.usage;
    parsed._cost = `$${result.cost.toFixed(4)}`;
    console.log(JSON.stringify(parsed, null, 2));
}

async function generateTopics(config) {
    if (!config.topicSpecPath) {
        console.error('Error: --topic-spec <path> is required for generate-topics');
        process.exit(1);
    }

    const topicSpec = JSON.parse(fs.readFileSync(config.topicSpecPath, 'utf8'));
    const context = buildContext('generate-topics');

    let briefContext = '';
    if (config.briefPath) {
        try {
            const brief = JSON.parse(fs.readFileSync(config.briefPath, 'utf8'));
            const caps = (brief.capabilities || []).map(c => `- ${c.name}: ${c.description || ''}`).join('\n');
            const integs = (brief.integrations || []).map(i => `- ${i.name} (${i.type})`).join('\n');
            const channels = (brief.channels || []).join(', ') || 'Teams, Web Chat';
            briefContext = `\n\n## Brief Context\n\n### Capabilities\n${caps}\n\n### Integrations\n${integs}\n\n### Target Channels\n${channels}`;
        } catch { /* skip brief context if unreadable */ }
    }

    const userContent = `## Topic Specification — Generate YAML

\`\`\`json
${JSON.stringify(topicSpec, null, 2)}
\`\`\`
${briefContext}`;

    const result = await chatCompletion([
        { role: 'system', content: PROMPTS['generate-topics'] + '\n\n' + context },
        { role: 'user', content: userContent }
    ], { maxTokens: 16384 });

    const parsed = parseGptJson(result.content);
    parsed._usage = result.usage;
    parsed._cost = `$${result.cost.toFixed(4)}`;
    console.log(JSON.stringify(parsed, null, 2));
}

async function reviewFlow(config) {
    if (!config.filePath) {
        console.error('Error: --file <path> is required for review-flow');
        process.exit(1);
    }

    const flowContent = fs.readFileSync(config.filePath, 'utf8');
    const context = buildContext('review-flow');

    let briefContext = '';
    if (config.briefPath) {
        try {
            const brief = JSON.parse(fs.readFileSync(config.briefPath, 'utf8'));
            const caps = (brief.capabilities || []).filter(c => c.implementationType === 'flow').map(c => `- ${c.name}: ${c.description || ''}`).join('\n');
            const integs = (brief.integrations || []).map(i => `- ${i.name} (${i.type})`).join('\n');
            briefContext = `\n\n## Brief Context\n\n### Flow Capabilities\n${caps}\n\n### Integrations\n${integs}`;
        } catch { /* skip brief context if unreadable */ }
    }

    const userContent = `## Flow Specification to Review

${flowContent}
${briefContext}`;

    const result = await chatCompletion([
        { role: 'system', content: PROMPTS['review-flow'] + '\n\n' + context },
        { role: 'user', content: userContent }
    ]);

    const parsed = parseGptJson(result.content);
    parsed._usage = result.usage;
    parsed._cost = `$${result.cost.toFixed(4)}`;
    console.log(JSON.stringify(parsed, null, 2));
}

// --- Import Resolution for TypeScript/TSX ---

/**
 * Parse import statements from TypeScript/TSX content.
 * Returns deduplicated array of @/ import path strings.
 */
function parseImports(content) {
    const imports = [];
    // Match: import { X, Y } from "@/..."  or  import X from "@/..."  or  import type { X } from "@/..."
    const re = /import\s+(?:type\s+)?(?:\{[^}]+\}|[a-zA-Z_$][\w$]*)\s+from\s+["'](@\/[^"']+)["']/g;
    let match;
    while ((match = re.exec(content)) !== null) {
        imports.push(match[1]); // the @/... path
    }
    return [...new Set(imports)]; // deduplicate
}

/**
 * Resolve @/ alias path to absolute filesystem path.
 * @/types/index → app/frontend/src/types/index.ts (or .tsx)
 */
function resolveAliasPath(importPath) {
    const FRONTEND_SRC = path.resolve(__dirname, '../app/frontend/src');
    // Strip @/ prefix
    const relative = importPath.replace(/^@\//, '');
    // Try exact match, then .ts, .tsx, /index.ts, /index.tsx
    const candidates = [
        path.join(FRONTEND_SRC, relative),
        path.join(FRONTEND_SRC, relative + '.ts'),
        path.join(FRONTEND_SRC, relative + '.tsx'),
        path.join(FRONTEND_SRC, relative, 'index.ts'),
        path.join(FRONTEND_SRC, relative, 'index.tsx'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
}

/**
 * Resolve imports recursively (1 level deep).
 * Returns Map<absolutePath, fileContent>.
 */
function resolveImportContext(filePath) {
    const resolved = new Map();
    const seen = new Set();

    function resolve(fp, depth) {
        if (depth > 1) return; // max 1 level of recursion
        if (seen.has(fp)) return;
        seen.add(fp);

        let content;
        try { content = fs.readFileSync(fp, 'utf8'); } catch { return; }

        const importPaths = parseImports(content);
        for (const imp of importPaths) {
            const absPath = resolveAliasPath(imp);
            if (!absPath || seen.has(absPath)) continue;
            // Skip CSS and node_modules
            if (absPath.endsWith('.css') || absPath.includes('node_modules')) continue;
            try {
                const importContent = fs.readFileSync(absPath, 'utf8');
                resolved.set(absPath, importContent);
                // Recurse one level for types/stores/libs (not components — too noisy)
                if (!absPath.match(/components\//)) {
                    resolve(absPath, depth + 1);
                }
            } catch { /* skip unreadable */ }
        }
    }

    resolve(filePath, 0);
    return resolved;
}

/**
 * Get file-type-specific checklist items for a given file path.
 */
function getFileTypeChecks(filePath) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const matched = [];
    for (const ftc of FILE_TYPE_CHECKS) {
        if (ftc.pattern.test(normalizedPath)) {
            matched.push(ftc);
        }
    }
    return matched;
}

async function reviewMerged(config) {
    if (!config.briefPath) {
        console.error('Error: --brief <path> is required for review-merged');
        process.exit(1);
    }

    const brief = JSON.parse(fs.readFileSync(config.briefPath, 'utf8'));
    const context = buildContext('review-merged');

    // Collect all artifacts from the agent's build directory
    const briefDir = path.dirname(config.briefPath);
    const artifacts = [];

    // Instructions
    if (brief.instructions) {
        artifacts.push(`## Instructions (${brief.instructions.length} chars)\n${brief.instructions}`);
    }

    // Capabilities summary
    const capabilities = brief.capabilities || [];
    artifacts.push(`## Capabilities (${capabilities.length})\n${capabilities.map(c => `- ${c.name} [${c.phase || 'mvp'}, ${c.implementationType || 'prompt'}]: ${c.description || ''}`).join('\n')}`);

    // Boundaries
    const boundaries = brief.boundaries || {};
    artifacts.push(`## Boundaries\n- Handle: ${(boundaries.handle || []).join(', ')}\n- Decline: ${(boundaries.decline || []).join(', ')}\n- Refuse: ${(boundaries.refuse || []).join(', ')}`);

    // Integrations
    const integrations = brief.integrations || [];
    artifacts.push(`## Integrations (${integrations.length})\n${integrations.map(i => `- ${i.name} (${i.type || 'unknown'}): ${i.description || ''}`).join('\n')}`);

    // Knowledge
    const knowledge = brief.knowledge || [];
    artifacts.push(`## Knowledge Sources (${knowledge.length})\n${knowledge.map(k => `- ${k.name} (${k.type || 'unknown'}): ${k.description || k.scope || ''}`).join('\n')}`);

    // Topics
    const topics = (brief.conversations && brief.conversations.topics) || [];
    artifacts.push(`## Topics (${topics.length})\n${topics.map(t => `- ${t.name} [trigger: ${t.triggerType || 'unknown'}, type: ${t.topicType || 'custom'}]: ${t.description || ''}`).join('\n')}`);

    // Eval sets summary
    const evalSets = brief.evalSets || [];
    for (const es of evalSets) {
        const tests = es.tests || [];
        artifacts.push(`## Eval Set: ${es.name} (${tests.length} tests, threshold: ${es.threshold}%)\n${tests.map(t => `- Q: ${t.question} | E: ${t.expected}`).join('\n')}`);
    }

    // Topic YAML files if they exist
    const topicsDir = path.join(briefDir, 'topics');
    try {
        const topicFiles = fs.readdirSync(topicsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        for (const tf of topicFiles) {
            const content = fs.readFileSync(path.join(topicsDir, tf), 'utf8');
            artifacts.push(`## Topic YAML: ${tf}\n\`\`\`yaml\n${content}\n\`\`\``);
        }
    } catch { /* no topics dir */ }

    // Flow specs if they exist
    try {
        const flowSpec = fs.readFileSync(path.join(briefDir, 'flow-spec.md'), 'utf8');
        artifacts.push(`## Flow Specification\n${flowSpec}`);
    } catch { /* no flow spec */ }

    const userContent = `## Complete Agent Build — Final Quality Gate\n\n**Agent:** ${brief.agentName || brief.name || 'Unnamed'}\n**Purpose:** ${brief.purpose || 'Not specified'}\n**Model:** ${(brief.model && (brief.model.name || brief.model.recommended)) || 'GPT-4o'}\n\n${artifacts.join('\n\n---\n\n')}`;

    const result = await chatCompletion([
        { role: 'system', content: PROMPTS['review-merged'] + '\n\n' + context },
        { role: 'user', content: userContent }
    ], { maxTokens: 16384 });

    const parsed = parseGptJson(result.content);
    parsed._usage = result.usage;
    parsed._cost = `$${result.cost.toFixed(4)}`;
    console.log(JSON.stringify(parsed, null, 2));
}

async function reviewCode(config) {
    if (!config.filePath) {
        console.error('Error: --file <path> is required for review-code');
        process.exit(1);
    }

    const absFilePath = path.resolve(config.filePath);
    const codeContent = fs.readFileSync(absFilePath, 'utf8');
    const ext = path.extname(absFilePath).toLowerCase();
    const context = buildContext('review-code');

    // --- Layer 2: File-type checklist ---
    const fileTypeMatches = getFileTypeChecks(absFilePath);
    let checklistSection = '';
    if (fileTypeMatches.length > 0) {
        const allChecks = fileTypeMatches.flatMap(m =>
            m.checks.map(c => `- [${m.label}] ${c}`)
        );
        checklistSection = `\n\n## File-Type Specific Checks\nThis file matches: ${fileTypeMatches.map(m => m.label).join(', ')}. Check these specifically:\n${allChecks.join('\n')}`;
    }

    // --- Layer 3a: Auto-resolved imports (TS/TSX only) ---
    let importContextSection = '';
    const isTypeScript = ext === '.ts' || ext === '.tsx';
    const resolvedImports = isTypeScript ? resolveImportContext(absFilePath) : new Map();
    if (resolvedImports.size > 0) {
        const sections = [];
        for (const [fp, content] of resolvedImports) {
            const relPath = path.relative(path.resolve(__dirname, '..'), fp).replace(/\\/g, '/');
            const fileExt = path.extname(fp).replace('.', '');
            sections.push(`### ${relPath}\n\`\`\`${fileExt}\n${content}\n\`\`\``);
        }
        importContextSection = `\n\n## Auto-Resolved Dependencies (${resolvedImports.size} files)\nThese are the FULL contents of files imported by the reviewed file. Use them to verify type correctness, function signatures, store patterns, and cross-file consistency.\n\n${sections.join('\n\n')}`;
    }

    // --- Layer 3b: Manual --with files ---
    let withFilesSection = '';
    if (config.withFiles && config.withFiles.length > 0) {
        const sections = [];
        for (const wf of config.withFiles) {
            try {
                const absWf = path.resolve(wf);
                const content = fs.readFileSync(absWf, 'utf8');
                const relPath = path.relative(path.resolve(__dirname, '..'), absWf).replace(/\\/g, '/');
                const fileExt = path.extname(absWf).replace('.', '');
                sections.push(`### ${relPath}\n\`\`\`${fileExt}\n${content}\n\`\`\``);
            } catch {
                sections.push(`### ${wf}\n(file not found)`);
            }
        }
        withFilesSection = `\n\n## Related Files (manually specified)\n${sections.join('\n\n')}`;
    }

    // --- Layer 5: Review memory (known bug patterns) ---
    const memory = loadReviewMemory();
    let memorySection = '';
    if (memory.patterns && memory.patterns.length > 0) {
        const items = memory.patterns.map(p =>
            `- **[${p.severity}]** ${p.pattern} — ${p.checklist}`
        );
        memorySection = `\n\n## Known Bug Patterns (from review memory — check specifically)\n${items.join('\n')}`;
    }

    // --- Context note ---
    let contextNote = '';
    if (config.contextDesc) {
        contextNote = `\n\n## Context\n${config.contextDesc}`;
    }

    // --- Assemble user content ---
    const userContent = `## Code to Review

**File:** ${path.basename(absFilePath)} (${ext})
**Path:** ${path.relative(path.resolve(__dirname, '..'), absFilePath).replace(/\\/g, '/')}
**Lines:** ${codeContent.split('\n').length}

\`\`\`${ext.replace('.', '')}
${codeContent}
\`\`\`
${contextNote}${checklistSection}${memorySection}${importContextSection}${withFilesSection}`;

    const tokenEstimate = estimateTokens(context + PROMPTS['review-code'] + userContent);
    if (config.verbose) console.error(`Estimated tokens: ~${tokenEstimate} (context: ~${estimateTokens(context)}, user: ~${estimateTokens(userContent)})`);

    const result = await chatCompletion([
        { role: 'system', content: PROMPTS['review-code'] + '\n\n' + context },
        { role: 'user', content: userContent }
    ], { maxTokens: 16384 });

    const parsed = parseGptJson(result.content);
    parsed._usage = result.usage;
    parsed._cost = `$${result.cost.toFixed(4)}`;
    parsed._contextStats = {
        fileTypeChecks: fileTypeMatches.map(m => m.label),
        autoResolvedImports: resolvedImports.size,
        manualWithFiles: (config.withFiles || []).length,
        reviewMemoryPatterns: (memory.patterns || []).length,
        estimatedTokens: tokenEstimate,
    };
    console.log(JSON.stringify(parsed, null, 2));
}

async function reviewComponents(config) {
    if (!config.briefPath) {
        console.error('Error: --brief <path> is required for review-components');
        process.exit(1);
    }

    const brief = JSON.parse(fs.readFileSync(config.briefPath, 'utf8'));
    const context = buildContext('review-components');

    const summary = {
        agentName: brief.agentName || brief.name,
        purpose: brief.purpose,
        integrations: brief.integrations || [],
        knowledge: brief.knowledge || [],
        capabilities: (brief.capabilities || []).map(c => ({ name: c.name, phase: c.phase, implementationType: c.implementationType })),
        decisions: (brief.decisions || []).map(d => ({ id: d.id, question: d.question, status: d.status, category: d.category, recommendedOptionId: d.recommendedOptionId })),
        architecture: brief.architecture
    };

    const userContent = `## Agent Components to Review\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``;

    const result = await chatCompletion([
        { role: 'system', content: PROMPTS['review-components'] + '\n\n' + context },
        { role: 'user', content: userContent }
    ]);

    const parsed = parseGptJson(result.content);
    parsed._usage = result.usage;
    parsed._cost = `$${result.cost.toFixed(4)}`;
    console.log(JSON.stringify(parsed, null, 2));
}

async function showModels() {
    let token;
    try {
        token = require('child_process').execSync('gh auth token', {
            encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
    } catch {
        console.error('gh CLI not available or not logged in. Run: gh auth login');
        process.exit(3);
    }
    const { httpRequestWithRetry } = require('./lib/http');
    const res = await httpRequestWithRetry('GET', 'https://api.githubcopilot.com/models', {
        'Authorization': `Bearer ${token}`,
        'Copilot-Integration-Id': 'vscode-chat',
        'Editor-Version': 'vscode/1.96.0'
    }, null, 1);
    if (res.status !== 200) {
        console.error('Failed to fetch models:', res.status);
        process.exit(1);
    }
    const models = (res.data.data || [])
        .filter(m => (m.id || '').startsWith('gpt-5'))
        .map(m => ({
            id: m.id,
            family: m.capabilities?.family,
            context: m.capabilities?.limits?.max_prompt_tokens,
            maxOutput: m.capabilities?.limits?.max_output_tokens
        }))
        .sort((a, b) => (b.id || '').localeCompare(a.id || ''));
    const current = 'gpt-5.4';
    console.log(`Current default: ${current}\n`);
    console.log('GPT-5.x models available:');
    for (const m of models) {
        const marker = m.id === current ? ' ← current' : '';
        console.log(`  ${m.id}  ctx=${m.context}  out=${m.maxOutput}${marker}`);
    }
    if (models.length > 0 && models[0].id !== current) {
        console.log(`\nNewer model available: ${models[0].id}`);
        console.log(`Update COPILOT_DEFAULT_MODEL in tools/lib/openai.js to use it.`);
    } else {
        console.log('\nYou are on the latest model.');
    }
}

// --- Learn Command (add patterns to review memory) ---

function learnPattern(config) {
    if (!config.pattern) {
        console.error('Error: --pattern "<description>" is required for learn');
        process.exit(1);
    }
    const severity = config.severity || 'medium';
    if (!['high', 'medium', 'low'].includes(severity)) {
        console.error('Error: --severity must be high, medium, or low');
        process.exit(1);
    }

    const memory = loadReviewMemory();
    const nextId = `rm-${String(memory.patterns.length + 1).padStart(3, '0')}`;
    const today = new Date().toISOString().split('T')[0];

    // Check for duplicate (>60% word overlap)
    const newWords = new Set(config.pattern.toLowerCase().split(/\s+/));
    for (const existing of memory.patterns) {
        const existingWords = new Set(existing.pattern.toLowerCase().split(/\s+/));
        const overlap = [...newWords].filter(w => existingWords.has(w)).length;
        const overlapRatio = overlap / Math.max(newWords.size, existingWords.size);
        if (overlapRatio > 0.6) {
            // Bump existing instead of adding duplicate
            existing.foundCount = (existing.foundCount || 1) + 1;
            existing.lastFound = today;
            if (severity === 'high' && existing.severity !== 'high') {
                existing.severity = 'high';
            }
            saveReviewMemory(memory);
            console.log(JSON.stringify({
                action: 'bumped',
                existingId: existing.id,
                foundCount: existing.foundCount,
                message: `Similar pattern already exists (${Math.round(overlapRatio * 100)}% overlap). Bumped count.`
            }, null, 2));
            return;
        }
    }

    const newPattern = {
        id: nextId,
        pattern: config.pattern,
        severity,
        foundCount: 1,
        firstFound: today,
        lastFound: today,
        checklist: config.pattern, // Default checklist = pattern description
    };
    memory.patterns.push(newPattern);
    saveReviewMemory(memory);

    console.log(JSON.stringify({
        action: 'added',
        id: nextId,
        pattern: config.pattern,
        severity,
        totalPatterns: memory.patterns.length,
    }, null, 2));
}

function showUsage() {
    const summary = getUsageSummary();
    const method = getActiveMethod();
    const METHOD_LABELS = {
        'copilot-api': 'GitHub Copilot API — GPT-5.4'
    };
    console.log(JSON.stringify({
        configured: isConfigured(),
        method: method || 'not configured',
        endpoint: METHOD_LABELS[method] || 'Not configured',
        session: {
            calls: summary.calls,
            inputTokens: summary.inputTokens,
            outputTokens: summary.outputTokens,
            totalTokens: summary.inputTokens + summary.outputTokens,
            estimatedCost: `$${summary.cost.toFixed(4)}`
        }
    }, null, 2));
}

// --- Main ---
async function main() {
    const config = parseArgs();

    // These commands don't need GPT configured for API calls
    if (config.command === 'usage') {
        showUsage();
        return;
    }
    if (config.command === 'models') {
        await showModels();
        return;
    }
    if (config.command === 'learn') {
        learnPattern(config);
        return;
    }

    // Check configuration
    if (!isConfigured()) {
        console.error(JSON.stringify({
            error: 'GPT not configured',
            hint: 'Run: gh auth login && gh auth refresh --scopes copilot'
        }));
        process.exit(3);
    }

    try {
        switch (config.command) {
            case 'review-instructions':
                await reviewInstructions(config);
                break;
            case 'review-topics':
                await reviewTopics(config);
                break;
            case 'review-brief':
                await reviewBrief(config);
                break;
            case 'review-flow':
                await reviewFlow(config);
                break;
            case 'review-code':
                await reviewCode(config);
                break;
            case 'review-components':
                await reviewComponents(config);
                break;
            case 'review-merged':
                await reviewMerged(config);
                break;
            case 'generate-instructions':
                await generateInstructions(config);
                break;
            case 'generate-evals':
                await generateEvals(config);
                break;
            case 'generate-topics':
                await generateTopics(config);
                break;
            case 'score':
                await scoreResponse(config);
                break;
            default:
                console.error(`Unknown command: ${config.command}`);
                process.exit(1);
        }
    } catch (err) {
        if (err.code === 'NOT_CONFIGURED') {
            console.error(JSON.stringify({ error: err.message }));
            process.exit(3);
        }
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
    }
}

main();
