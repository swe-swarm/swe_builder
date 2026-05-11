/**
 * Shared Scoring Module for MCS Eval Runners
 *
 * Extracted from direct-line-test.js. Used by Direct Line eval runner.
 * Supports all 7 methods (6 MCS native + PlanValidation) with display-name aliases.
 *
 * Exports:
 *   evaluateResult(actual, expected, method, passingScore, mode, keywords)
 *   evaluateAllMethods(actual, expected, methods, toolInvocations?, keywords?)
 *   evaluateMultiTurn(turnResults, methods, expectedTools?)
 *   normalizeMethod(rawMethod)
 *   textSimilarity(a, b)
 *   semanticSimilarity(actual, expected)
 *   qualityScore(actual, expected)
 *   parseCSV(content)
 *   parseEvalSets(briefPath, filterSets?)
 *   writeResultsToBrief(briefPath, results)
 *
 * Async GPT-enhanced variants (optional — fall back to heuristics):
 *   semanticSimilarityAsync(actual, expected)
 *   qualityScoreAsync(actual, expected)
 *   textSimilarityAsync(actual, expected)
 *   toolUseAsync(actual, expected)
 *   evaluateResultAsync(actual, expected, method, passingScore, mode)
 *   evaluateAllMethodsAsync(actual, expected, methods, toolInvocations?)
 */

const fs = require('fs');
const path = require('path');

// --- Method Name Normalization ---
// MCS uses display names with spaces; CSV uses PascalCase. Accept both.
const METHOD_ALIASES = {
    // Display names (with spaces) → canonical PascalCase
    'general quality': 'GeneralQuality',
    'compare meaning': 'CompareMeaning',
    'keyword match': 'KeywordMatch',
    'keyword match (all)': 'KeywordMatch',  // mode inferred as "all"
    'keyword match (any)': 'KeywordMatch',  // mode inferred as "any"
    'text similarity': 'TextSimilarity',
    'exact match': 'ExactMatch',
    'tool use': 'ToolUse',
    // PascalCase passthrough
    'generalquality': 'GeneralQuality',
    'comparemeaning': 'CompareMeaning',
    'keywordmatch': 'KeywordMatch',
    'textsimilarity': 'TextSimilarity',
    'exactmatch': 'ExactMatch',
    'tooluse': 'ToolUse',
    // Backward compat aliases (old name → new canonical)
    'capability use': 'ToolUse',
    'capabilityuse': 'ToolUse',
    // Legacy / incorrect names → mapped
    'partialmatch': 'KeywordMatch',  // PartialMatch doesn't exist in MCS
    // Plan validation (7th method — tool invocation verification)
    'plan validation': 'PlanValidation',
    'planvalidation': 'PlanValidation',
};

/**
 * Normalize a method name to its canonical PascalCase form.
 * Also extracts mode for KeywordMatch if embedded in the name.
 * @returns {{ method: string, inferredMode: string|null }}
 */
function normalizeMethod(rawMethod) {
    const lower = (rawMethod || '').toLowerCase().trim();
    let inferredMode = null;

    // Check for mode embedded in name: "keyword match (any)" / "keyword match (all)"
    if (lower.includes('keyword match (any)')) inferredMode = 'any';
    else if (lower.includes('keyword match (all)')) inferredMode = 'all';
    // Legacy PartialMatch → KeywordMatch (all)
    else if (lower === 'partialmatch') inferredMode = 'all';

    const canonical = METHOD_ALIASES[lower] || rawMethod;
    return { method: canonical, inferredMode };
}

// --- Scoring Functions ---

/**
 * Simple text similarity using Jaccard coefficient on word tokens.
 * Words shorter than 3 chars are filtered to remove noise.
 */
function textSimilarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union === 0 ? 0 : Math.round((intersection / union) * 100);
}

/**
 * Simplified semantic similarity using keyword overlap + length ratio bonus.
 * In production, replace with LLM or embedding model for true semantic comparison.
 */
function semanticSimilarity(actual, expected) {
    const keywordsExpected = expected.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (keywordsExpected.length === 0) return actual.length > 0 ? 70 : 0;

    const actualLower = actual.toLowerCase();
    const hits = keywordsExpected.filter(kw => actualLower.includes(kw)).length;
    const keywordScore = (hits / keywordsExpected.length) * 100;

    // Bonus for reasonable length (not too short, not way too long)
    const lengthRatio = actual.length / Math.max(expected.length, 1);
    const lengthBonus = (lengthRatio >= 0.3 && lengthRatio <= 5) ? 10 : 0;

    return Math.min(100, Math.round(keywordScore + lengthBonus));
}

/**
 * Basic quality heuristics for standalone quality check.
 * When expected is empty/null, checks only structural quality (no keyword hints).
 */
function qualityScore(actual, expected) {
    let score = 0;
    const actualLower = actual.toLowerCase();

    // Not empty — basic presence check
    if (actual.length > 10) score += 20;

    // Reasonable length (not too short, not absurdly long)
    if (actual.length > 20 && actual.length < 5000) score += 15;

    // No error indicators
    const hasErrors = actualLower.includes('[timeout') ||
        actualLower.includes('sorry, i can\'t') ||
        actualLower.includes('something went wrong') ||
        actualLower.includes('i encountered an error');
    if (!hasErrors) score += 15;

    // Keyword overlap with expected (only if expected is non-empty)
    if (expected && expected.trim().length > 0) {
        const keywords = expected.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const keywordHits = keywords.filter(kw => actualLower.includes(kw)).length;
        if (keywords.length > 0) score += (keywordHits / keywords.length) * 50;
    } else {
        // No expected — give credit for being a substantive response
        if (actual.length > 50) score += 25;
        if (actual.length > 200) score += 15;
        // Penalize very short or generic responses
        if (actual.length < 20) score -= 10;
    }

    return Math.max(0, Math.round(score));
}

/**
 * Evaluate a single test result against a method.
 *
 * @param {string} actual - The agent's actual response
 * @param {string} expected - The expected response / keywords
 * @param {string} method - Method name (display name or PascalCase)
 * @param {number} [passingScore=70] - Threshold for scored methods
 * @param {string} [mode='all'] - For KeywordMatch: 'all' or 'any'
 * @param {string} [keywords] - Dedicated keywords for KeywordMatch (preferred over expected)
 * @returns {{ pass: boolean, score: number, method: string, error?: string }}
 */
function evaluateResult(actual, expected, method, passingScore, mode, keywords) {
    const normalized = normalizeMethod(method);
    const canonicalMethod = normalized.method;
    // Use explicit mode > inferred mode from name > default 'all'
    const effectiveMode = mode || normalized.inferredMode || 'all';
    const threshold = passingScore || 70;

    actual = actual || '';
    expected = expected || '';

    switch (canonicalMethod) {
        case 'ExactMatch': {
            const match = actual.trim() === expected.trim();
            return { pass: match, score: match ? 100 : 0, method: canonicalMethod };
        }

        case 'KeywordMatch': {
            // Use dedicated keywords field if available, fall back to expected
            const keywordSource = keywords || expected;
            // Split into keywords (comma, semicolon, or whitespace separated)
            // Filter words shorter than 3 chars to remove noise
            const kwList = keywordSource.toLowerCase().split(/[,;\s]+/).filter(w => w.length > 2);
            if (kwList.length === 0) {
                return { pass: false, score: 0, method: canonicalMethod, error: 'KeywordMatch requires keywords — populate the keywords field or expected field with comma-separated keywords' };
            }
            const actualLower = actual.toLowerCase();
            const hits = kwList.filter(kw => actualLower.includes(kw)).length;

            if (effectiveMode === 'any') {
                // Any keyword suffices → binary pass/fail
                const found = hits > 0;
                return { pass: found, score: found ? 100 : 0, method: canonicalMethod };
            } else {
                // All keywords must match → scored by coverage
                const score = Math.round((hits / kwList.length) * 100);
                return { pass: score >= threshold, score, method: canonicalMethod };
            }
        }

        case 'TextSimilarity': {
            const score = textSimilarity(actual, expected);
            return { pass: score >= threshold, score, method: canonicalMethod };
        }

        case 'CompareMeaning': {
            const score = semanticSimilarity(actual, expected);
            return { pass: score >= threshold, score, method: canonicalMethod };
        }

        case 'GeneralQuality': {
            const score = qualityScore(actual, expected);
            return { pass: score >= 50, score, method: canonicalMethod };
        }

        case 'ToolUse': {
            // Expected format: comma-separated indicators that should be present
            const indicators = expected.toLowerCase().split(/[,;]+/).map(s => s.trim()).filter(Boolean);
            const actualLower = actual.toLowerCase();
            const hits = indicators.filter(ind => actualLower.includes(ind)).length;
            const score = indicators.length > 0
                ? Math.round((hits / indicators.length) * 100)
                : (actual.length > 20 ? 80 : 0);
            return { pass: score >= (threshold), score, method: canonicalMethod };
        }

        case 'PlanValidation': {
            // Verify which tools the agent actually invoked
            // `actual` should be JSON-stringified array of tool names (from activity capture)
            // `expected` is comma/semicolon-separated list of expected tool names
            let actualTools = [];
            try {
                actualTools = JSON.parse(actual);
                if (!Array.isArray(actualTools)) actualTools = [];
            } catch {
                // JSON parse failed — no tool data captured, test fails gracefully
                actualTools = [];
            }

            const expectedTools = expected.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
            if (expectedTools.length === 0) {
                return { pass: actualTools.length > 0, score: actualTools.length > 0 ? 100 : 0, method: canonicalMethod };
            }

            const actualToolsLower = actualTools.map(t => (t || '').toLowerCase());
            const matched = expectedTools.filter(exp => {
                const expLower = exp.toLowerCase();
                return actualToolsLower.some(act => act.includes(expLower) || expLower.includes(act));
            });

            const score = Math.round((matched.length / expectedTools.length) * 100);
            const missing = expectedTools.filter(exp => {
                const expLower = exp.toLowerCase();
                return !actualToolsLower.some(act => act.includes(expLower) || expLower.includes(act));
            });

            return {
                pass: score >= threshold,
                score,
                method: canonicalMethod,
                ...(missing.length > 0 ? { error: `Missing tools: ${missing.join(', ')}` } : {})
            };
        }

        default:
            return { pass: false, score: 0, method: canonicalMethod, error: `Unknown test method: ${method}` };
    }
}

/**
 * Evaluate a test against ALL methods in its eval set.
 * A test passes only if every method passes.
 *
 * @param {string} actual - The agent's actual response
 * @param {string} expected - The expected response / keywords
 * @param {Array<{type: string, mode?: string, score?: number}>} methods - Methods from the eval set
 * @param {string[]} [toolInvocations] - Optional array of tool names captured from Direct Line activities
 * @param {string} [keywords] - Dedicated keywords for KeywordMatch (preferred over expected)
 * @returns {{ pass: boolean, score: number, methodResults: Array<{method: string, pass: boolean, score: number}> }}
 */
function evaluateAllMethods(actual, expected, methods, toolInvocations, keywords) {
    if (!methods || methods.length === 0) {
        // Default to GeneralQuality if no methods specified
        const result = evaluateResult(actual, expected, 'GeneralQuality', 70);
        return {
            pass: result.pass,
            score: result.score,
            methodResults: [result]
        };
    }

    const methodResults = methods.map(m => {
        const passingScore = m.score || 70;
        const mode = m.mode || null;
        const { method: canonical } = normalizeMethod(m.type);

        // PlanValidation uses tool invocations instead of text response
        if (canonical === 'PlanValidation' && toolInvocations) {
            return evaluateResult(JSON.stringify(toolInvocations), expected, m.type, passingScore, mode);
        }

        return evaluateResult(actual, expected, m.type, passingScore, mode, canonical === 'KeywordMatch' ? keywords : undefined);
    });

    const allPass = methodResults.every(r => r.pass);
    // Overall score = average of all method scores
    const avgScore = Math.round(methodResults.reduce((sum, r) => sum + r.score, 0) / methodResults.length);

    return {
        pass: allPass,
        score: avgScore,
        methodResults
    };
}

/**
 * Evaluate a multi-turn test (ordered message sequence in one conversation).
 *
 * @param {Array<{turnIndex: number, question: string, expected?: string, critical?: boolean, actual: string, toolInvocations?: string[]}>} turnResults - Results from each turn
 * @param {Array<{type: string, mode?: string, score?: number}>} methods - Methods from the eval set
 * @param {string} [expectedTools] - Comma-separated expected tools (for PlanValidation across all turns)
 * @returns {{ pass: boolean, score: number, turnResults: Array, methodResults: Array }}
 */
function evaluateMultiTurn(turnResults, methods, expectedTools) {
    if (!turnResults || turnResults.length === 0) {
        return { pass: false, score: 0, turnResults: [], methodResults: [] };
    }

    // Identify critical turns — if none marked, last turn is implicitly critical
    const hasCritical = turnResults.some(t => t.critical);
    const evaluated = turnResults.map((turn, idx) => {
        const isCritical = hasCritical ? !!turn.critical : (idx === turnResults.length - 1);

        if (!isCritical || !turn.expected) {
            // Non-critical or no expected: record but don't score
            return {
                turnIndex: turn.turnIndex ?? idx,
                question: turn.question,
                critical: isCritical,
                pass: null,
                score: null,
                actual: turn.actual || ''
            };
        }

        // Score this critical turn
        const allTools = turn.toolInvocations || [];
        const evaluation = evaluateAllMethods(turn.actual || '', turn.expected, methods, allTools.length > 0 ? allTools : undefined);

        return {
            turnIndex: turn.turnIndex ?? idx,
            question: turn.question,
            critical: true,
            pass: evaluation.pass,
            score: evaluation.score,
            actual: turn.actual || '',
            methodResults: evaluation.methodResults
        };
    });

    // If expectedTools is set, add a PlanValidation check across all captured tools
    let planResult = null;
    if (expectedTools) {
        const allToolInvocations = turnResults.flatMap(t => t.toolInvocations || []);
        const unique = [...new Set(allToolInvocations)];
        planResult = evaluateResult(JSON.stringify(unique), expectedTools, 'PlanValidation', 70);
    }

    // Pass = ALL critical turns pass all methods (+ plan validation if present)
    const criticalTurns = evaluated.filter(t => t.critical && t.pass !== null);
    const allCriticalPass = criticalTurns.length > 0 && criticalTurns.every(t => t.pass);
    const planPass = planResult ? planResult.pass : true;

    // Score = average of critical turn scores
    const criticalScores = criticalTurns.filter(t => t.score !== null).map(t => t.score);
    const avgScore = criticalScores.length > 0
        ? Math.round(criticalScores.reduce((a, b) => a + b, 0) / criticalScores.length)
        : 0;

    // Collect all method results from critical turns
    const allMethodResults = criticalTurns.flatMap(t => t.methodResults || []);
    if (planResult) allMethodResults.push(planResult);

    return {
        pass: allCriticalPass && planPass,
        score: avgScore,
        turnResults: evaluated,
        methodResults: allMethodResults
    };
}

// --- CSV Parser (simple, handles quoted fields) ---
function parseCSV(content) {
    const lines = content.trim().split('\n');
    const rows = [];

    for (const line of lines) {
        const fields = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                fields.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        fields.push(current.trim());
        rows.push(fields);
    }

    // Skip header row — supports 3-col (legacy) and 4-col (with Keywords) CSVs
    return rows.slice(1).map(row => ({
        question: row[0] || '',
        expectedResponse: row[1] || '',
        testMethodType: row[2] || 'GeneralQuality',
        passingScore: 70,
        keywords: row[3] || null
    }));
}

/**
 * Parse evalSets from brief.json into a flat test list with set metadata.
 *
 * @param {string} briefPath - Path to brief.json
 * @param {string[]} [filterSets] - Optional set names to include (null = all)
 * @returns {{ tests: Array, evalConfig: object, agentName: string }}
 */
function parseEvalSets(briefPath, filterSets) {
    const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
    const evalSets = brief.evalSets || [];
    const evalConfig = brief.evalConfig || {
        targetPassRate: 70,
        maxIterationsPerCapability: 3,
        maxRegressionRounds: 2
    };

    const tests = [];
    let globalIndex = 0;

    for (const set of evalSets) {
        if (filterSets && !filterSets.includes(set.name)) continue;
        if (!set.tests || set.tests.length === 0) continue;

        for (let i = 0; i < set.tests.length; i++) {
            const test = set.tests[i];
            tests.push({
                id: globalIndex++,
                setName: set.name,
                setIndex: evalSets.indexOf(set),
                testIndex: i,
                question: test.question,
                expected: test.expected,
                keywords: test.keywords || null,
                capability: test.capability || null,
                methods: test.methods || set.methods || [],
                passThreshold: set.passThreshold || 70,
                scenarioId: test.scenarioId || null,
                scenarioCategory: test.scenarioCategory || null,
                coverageTag: test.coverageTag || null,
                lastResult: test.lastResult || null,
                turns: test.turns || null,
                expectedTools: test.expectedTools || null,
                toolThreshold: test.toolThreshold || null
            });
        }
    }

    return {
        tests,
        evalConfig,
        agentName: brief.agentName || brief.name || 'Unknown Agent'
    };
}

/**
 * Write per-test lastResult back to brief.json.
 *
 * @param {string} briefPath - Path to brief.json
 * @param {Array<{setName: string, setIndex: number, testIndex: number, pass: boolean, actual: string, score: number}>} results
 */
function writeResultsToBrief(briefPath, results) {
    const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
    const timestamp = new Date().toISOString();

    for (const r of results) {
        const set = brief.evalSets[r.setIndex];
        if (!set || !set.tests || !set.tests[r.testIndex]) continue;

        set.tests[r.testIndex].lastResult = {
            pass: r.pass,
            actual: r.actual,
            score: r.score,
            timestamp,
            ...(r.methodResults ? { methodResults: r.methodResults } : {}),
            ...(r.turnResults ? { turnResults: r.turnResults } : {}),
            ...(r.toolInvocations ? { toolInvocations: r.toolInvocations } : {})
        };
    }

    fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2));
}

// --- Async GPT-Enhanced Scoring (optional — falls back to heuristics) ---

let _openai = null;
function _getOpenAI() {
    if (_openai === undefined) return null;
    if (_openai) return _openai;
    try {
        _openai = require('./lib/openai');
        return _openai.isConfigured() ? _openai : (_openai = null);
    } catch {
        _openai = undefined; // Mark as permanently unavailable
        return null;
    }
}

/**
 * Parse JSON from GPT response, stripping markdown fences if present.
 * Throws with a truncated preview on parse failure for debugging.
 */
function _parseGptJson(content) {
    let cleaned = (content || '').trim();
    if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        throw new Error(`GPT returned invalid JSON: ${cleaned.substring(0, 100)}...`);
    }
}

/**
 * Merge heuristic + GPT scores: run both in parallel, take the stricter (lower) score.
 * If GPT fails, fall back to heuristic only. If they diverge >20 points, flag it.
 */
function _mergeScores(heuristicScore, gptScore, gptReasoning) {
    if (gptScore === null || gptScore === undefined) {
        return { score: heuristicScore, source: 'heuristic' };
    }
    const divergence = Math.abs(heuristicScore - gptScore);
    const finalScore = Math.min(heuristicScore, gptScore); // stricter wins
    return {
        score: finalScore,
        reasoning: gptReasoning,
        source: 'dual',
        heuristicScore,
        gptScore,
        ...(divergence > 20 ? { divergence, flagged: true } : {})
    };
}

/**
 * GPT-enhanced semantic similarity. Runs heuristic + GPT in parallel, merges with stricter-wins.
 * @param {string} actual
 * @param {string} expected
 * @returns {Promise<{score: number, reasoning?: string, source: string, heuristicScore?: number, gptScore?: number, flagged?: boolean}>}
 */
async function semanticSimilarityAsync(actual, expected) {
    const hScore = semanticSimilarity(actual, expected);
    const openai = _getOpenAI();
    if (!openai) {
        return { score: hScore, source: 'heuristic' };
    }
    try {
        const result = await openai.chatCompletion([
            { role: 'system', content: 'Compare the actual response to the expected response for semantic similarity. Output JSON: {"score": 0-100, "reasoning": "brief explanation"}' },
            { role: 'user', content: `Actual: ${actual}\n\nExpected: ${expected}` }
        ], { maxTokens: 256 });
        const parsed = _parseGptJson(result.content);
        return _mergeScores(hScore, parsed.score, parsed.reasoning);
    } catch {
        return { score: hScore, source: 'heuristic-fallback' };
    }
}

/**
 * GPT-enhanced quality score. Runs heuristic + GPT in parallel, merges with stricter-wins.
 * @param {string} actual
 * @param {string} expected
 * @returns {Promise<{score: number, reasoning?: string, source: string, heuristicScore?: number, gptScore?: number, flagged?: boolean}>}
 */
async function qualityScoreAsync(actual, expected) {
    const hScore = qualityScore(actual, expected);
    const openai = _getOpenAI();
    if (!openai) {
        return { score: hScore, source: 'heuristic' };
    }
    try {
        const prompt = expected
            ? `Evaluate response quality and relevance to the expected answer. Output JSON: {"score": 0-100, "reasoning": "brief explanation"}`
            : `Evaluate response quality, helpfulness, and completeness. Output JSON: {"score": 0-100, "reasoning": "brief explanation"}`;
        const userContent = expected
            ? `Actual: ${actual}\n\nExpected: ${expected}`
            : `Response: ${actual}`;
        const result = await openai.chatCompletion([
            { role: 'system', content: prompt },
            { role: 'user', content: userContent }
        ], { maxTokens: 256 });
        const parsed = _parseGptJson(result.content);
        return _mergeScores(hScore, parsed.score, parsed.reasoning);
    } catch {
        return { score: hScore, source: 'heuristic-fallback' };
    }
}

/**
 * GPT-enhanced text similarity. Runs heuristic + GPT in parallel, merges with stricter-wins.
 * @param {string} actual
 * @param {string} expected
 * @returns {Promise<{score: number, reasoning?: string, source: string, heuristicScore?: number, gptScore?: number, flagged?: boolean}>}
 */
async function textSimilarityAsync(actual, expected) {
    const hScore = textSimilarity(actual, expected);
    const openai = _getOpenAI();
    if (!openai) {
        return { score: hScore, source: 'heuristic' };
    }
    try {
        const result = await openai.chatCompletion([
            { role: 'system', content: 'Compare the two texts for word-level and structural similarity (not just meaning). Score how closely the actual text matches the expected text in wording, phrasing, and structure. Output JSON: {"score": 0-100, "reasoning": "brief explanation"}' },
            { role: 'user', content: `Actual: ${actual}\n\nExpected: ${expected}` }
        ], { maxTokens: 256 });
        const parsed = _parseGptJson(result.content);
        return _mergeScores(hScore, parsed.score, parsed.reasoning);
    } catch {
        return { score: hScore, source: 'heuristic-fallback' };
    }
}

/**
 * GPT-enhanced tool use check. Runs heuristic + GPT in parallel, merges with stricter-wins.
 * @param {string} actual - The agent's actual response
 * @param {string} expected - Comma-separated indicators/tools that should be present
 * @returns {Promise<{score: number, reasoning?: string, source: string, heuristicScore?: number, gptScore?: number, flagged?: boolean}>}
 */
async function toolUseAsync(actual, expected) {
    // Heuristic: same as sync ToolUse
    const indicators = expected.toLowerCase().split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    const actualLower = actual.toLowerCase();
    const hits = indicators.filter(ind => actualLower.includes(ind)).length;
    const hScore = indicators.length > 0
        ? Math.round((hits / indicators.length) * 100)
        : (actual.length > 20 ? 80 : 0);

    const openai = _getOpenAI();
    if (!openai) {
        return { score: hScore, source: 'heuristic' };
    }
    try {
        const result = await openai.chatCompletion([
            { role: 'system', content: 'Evaluate whether the agent response demonstrates use of the expected tools/topics. The expected field lists indicators (tool names, action descriptions, or output markers) that should be evident in the response. Score 0-100 based on how many expected tools are demonstrated. Output JSON: {"score": 0-100, "reasoning": "brief explanation"}' },
            { role: 'user', content: `Agent response: ${actual}\n\nExpected tools/indicators: ${expected}` }
        ], { maxTokens: 256 });
        const parsed = _parseGptJson(result.content);
        return _mergeScores(hScore, parsed.score, parsed.reasoning);
    } catch {
        return { score: hScore, source: 'heuristic-fallback' };
    }
}

/**
 * Async version of evaluateResult — uses GPT for CompareMeaning, GeneralQuality,
 * TextSimilarity, and ToolUse. All other methods use sync (deterministic).
 *
 * @param {string} actual
 * @param {string} expected
 * @param {string} method
 * @param {number} [passingScore=70]
 * @param {string} [mode='all']
 * @param {string} [keywords] - Dedicated keywords for KeywordMatch
 * @returns {Promise<{pass: boolean, score: number, method: string, reasoning?: string, source?: string}>}
 */
async function evaluateResultAsync(actual, expected, method, passingScore, mode, keywords) {
    const normalized = normalizeMethod(method);
    const canonicalMethod = normalized.method;
    const threshold = passingScore || 70;

    // CompareMeaning — GPT-enhanced semantic similarity
    if (canonicalMethod === 'CompareMeaning') {
        const result = await semanticSimilarityAsync(actual || '', expected || '');
        return {
            pass: result.score >= threshold,
            score: result.score,
            method: canonicalMethod,
            reasoning: result.reasoning,
            source: result.source
        };
    }

    // GeneralQuality — GPT-enhanced quality scoring
    if (canonicalMethod === 'GeneralQuality') {
        const result = await qualityScoreAsync(actual || '', expected || '');
        return {
            pass: result.score >= threshold,
            score: result.score,
            method: canonicalMethod,
            reasoning: result.reasoning,
            source: result.source
        };
    }

    // TextSimilarity — GPT-enhanced text closeness
    if (canonicalMethod === 'TextSimilarity') {
        const result = await textSimilarityAsync(actual || '', expected || '');
        return {
            pass: result.score >= threshold,
            score: result.score,
            method: canonicalMethod,
            reasoning: result.reasoning,
            source: result.source
        };
    }

    // ToolUse — GPT-enhanced tool use detection
    if (canonicalMethod === 'ToolUse') {
        const result = await toolUseAsync(actual || '', expected || '');
        return {
            pass: result.score >= threshold,
            score: result.score,
            method: canonicalMethod,
            reasoning: result.reasoning,
            source: result.source
        };
    }

    // All other methods — use sync (deterministic, no LLM needed)
    return evaluateResult(actual, expected, method, passingScore, mode, keywords);
}

/**
 * Async version of evaluateAllMethods — uses GPT-enhanced scoring where applicable.
 * @param {string} [keywords] - Dedicated keywords for KeywordMatch
 */
async function evaluateAllMethodsAsync(actual, expected, methods, toolInvocations, keywords) {
    if (!methods || methods.length === 0) {
        const result = await evaluateResultAsync(actual, expected, 'GeneralQuality', 70);
        return { pass: result.pass, score: result.score, methodResults: [result] };
    }

    const methodResults = await Promise.all(methods.map(async m => {
        const passingScore = m.score || 70;
        const modeVal = m.mode || null;
        const { method: canonical } = normalizeMethod(m.type);

        if (canonical === 'PlanValidation' && toolInvocations) {
            return evaluateResult(JSON.stringify(toolInvocations), expected, m.type, passingScore, modeVal);
        }

        return evaluateResultAsync(actual, expected, m.type, passingScore, modeVal, canonical === 'KeywordMatch' ? keywords : undefined);
    }));

    const allPass = methodResults.every(r => r.pass);
    const avgScore = Math.round(methodResults.reduce((sum, r) => sum + r.score, 0) / methodResults.length);

    return { pass: allPass, score: avgScore, methodResults };
}

module.exports = {
    evaluateResult,
    evaluateAllMethods,
    evaluateMultiTurn,
    normalizeMethod,
    textSimilarity,
    semanticSimilarity,
    qualityScore,
    parseCSV,
    parseEvalSets,
    writeResultsToBrief,
    // Async GPT-enhanced variants
    semanticSimilarityAsync,
    qualityScoreAsync,
    textSimilarityAsync,
    toolUseAsync,
    evaluateResultAsync,
    evaluateAllMethodsAsync
};
