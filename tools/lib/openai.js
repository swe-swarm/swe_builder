/**
 * Shared GPT Client — GitHub Copilot API (GPT-5.4)
 *
 * Provides GPT chat completion via the GitHub Copilot Responses API.
 * Zero npm dependencies — uses shared HTTP helpers from ./http.js.
 *
 * Auth: GitHub PAT with `copilot` scope, auto-detected via `gh auth token`.
 * Setup: `gh auth login` then `gh auth refresh --scopes copilot`
 * Works for anyone with GitHub Copilot — no Azure resources or API keys needed.
 *
 * Exports:
 *   isConfigured()            Check if GPT is available
 *   chatCompletion(messages, options)  Send chat completion (GPT-5.4)
 *   estimateTokens(text)      Rough token count (chars/4)
 *   estimateCost(usage)       USD cost estimate
 *   getUsageSummary()         Cumulative session stats
 *   resetUsage()              Reset counters
 *   getActiveMethod()         Returns 'copilot-api' or null
 */

const { execSync } = require('child_process');
const { httpRequestWithRetry } = require('./http');

// --- Copilot API constants ---
const COPILOT_API_ENDPOINT = 'https://api.githubcopilot.com/responses';
const COPILOT_DEFAULT_MODEL = 'gpt-5.4';
const COPILOT_HEADERS = {
    'Copilot-Integration-Id': 'vscode-chat',
    'Editor-Version': 'vscode/1.96.0'
};

// Pricing per 1M tokens (GPT-5.4 class)
const PRICING = {
    input: 2.50,   // $ per 1M input tokens
    output: 10.00  // $ per 1M output tokens
};

// --- GitHub Token Cache ---
let _ghToken = null;
let _ghTokenChecked = false;
let _ghHasCopilotScope = null;

/**
 * Get GitHub token from gh CLI. Cached after first call.
 * @returns {string|null}
 */
function getGitHubToken() {
    if (_ghTokenChecked) return _ghToken;
    _ghTokenChecked = true;
    try {
        const token = execSync('gh auth token', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        if (token && token.length > 10) {
            _ghToken = token;
        }
    } catch {
        // gh CLI not installed or not logged in
    }
    return _ghToken;
}

/**
 * Check if the GitHub token has the `copilot` scope.
 * Cached after first call.
 * @returns {boolean}
 */
function hasCopilotScope() {
    if (_ghHasCopilotScope !== null) return _ghHasCopilotScope;
    try {
        // gh auth status writes to stderr; capture both streams without shell: true
        const status = execSync('gh auth status', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        _ghHasCopilotScope = status.includes("'copilot'") || status.includes('"copilot"');
    } catch (err) {
        // gh auth status exits non-zero when not logged in, but still outputs to stderr
        const output = (err.stdout || '') + (err.stderr || '');
        _ghHasCopilotScope = output.includes("'copilot'") || output.includes('"copilot"');
    }
    return _ghHasCopilotScope;
}

// --- Session Usage Tracking ---
let _usage = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };

/**
 * Returns 'copilot-api' if configured, null otherwise.
 * @returns {'copilot-api'|null}
 */
function getActiveMethod() {
    return (getGitHubToken() && hasCopilotScope()) ? 'copilot-api' : null;
}

/**
 * Check if GPT is available.
 * @returns {boolean}
 */
function isConfigured() {
    return getActiveMethod() !== null;
}

/**
 * Rough token estimate (chars / 4).
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
}

/**
 * Estimate USD cost from usage object.
 * @param {object} usage
 * @returns {number} USD cost
 */
function estimateCost(usage) {
    const inputTokens = usage.prompt_tokens || usage.input_tokens || 0;
    const outputTokens = usage.completion_tokens || usage.output_tokens || 0;
    return (inputTokens / 1_000_000 * PRICING.input) + (outputTokens / 1_000_000 * PRICING.output);
}

function getUsageSummary() {
    return { ..._usage };
}

function resetUsage() {
    _usage = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
}

/**
 * Convert chat messages [{role, content}] to Responses API input format.
 * Maps 'system' → 'developer' (Responses API terminology).
 */
function toResponsesInput(messages) {
    return messages.map(m => ({
        role: m.role === 'system' ? 'developer' : m.role,
        content: m.content
    }));
}

/**
 * Extract text content from Responses API output.
 */
function extractResponsesText(data) {
    if (!data.output) return '';
    for (const item of data.output) {
        if (item.type === 'message' && item.content) {
            for (const c of item.content) {
                if (c.type === 'output_text' && c.text) return c.text;
            }
        }
    }
    return '';
}

/**
 * Normalize Responses API usage to the common {prompt_tokens, completion_tokens} format.
 */
function normalizeUsage(data) {
    const usage = data.usage || {};
    return {
        prompt_tokens: usage.input_tokens || 0,
        completion_tokens: usage.output_tokens || 0,
        total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
    };
}

/**
 * Send a chat completion request to GPT-5.4 via GitHub Copilot API.
 *
 * @param {Array<{role: string, content: string}>} messages - Chat messages (system/user/assistant)
 * @param {object} [options]
 * @param {number} [options.maxTokens=4096] - Max output tokens
 * @param {number} [options.timeout=60000] - Request timeout in ms
 * @param {string} [options.model] - Model override (default: gpt-5.4)
 * @returns {Promise<{content: string, usage: object, cost: number}>}
 */
async function chatCompletion(messages, options = {}) {
    if (!isConfigured()) {
        const err = new Error(
            'GPT not configured. Run:\n' +
            '  gh auth login\n' +
            '  gh auth refresh --scopes copilot'
        );
        err.code = 'NOT_CONFIGURED';
        throw err;
    }

    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('chatCompletion: messages must be a non-empty array');
    }

    const maxTokens = options.maxTokens ?? 16384;
    const timeout = options.timeout ?? 60000;

    const body = {
        model: options.model || COPILOT_DEFAULT_MODEL,
        input: toResponsesInput(messages),
        ...(maxTokens ? { max_output_tokens: maxTokens } : {})
    };

    const res = await httpRequestWithRetry('POST', COPILOT_API_ENDPOINT, {
        'Authorization': `Bearer ${getGitHubToken()}`,
        'Content-Type': 'application/json',
        ...COPILOT_HEADERS
    }, body, 2, timeout);

    if (res.status !== 200) {
        const raw = typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data);
        throw new Error(`GPT API returned ${res.status}: ${raw.substring(0, 300)}`);
    }

    const content = extractResponsesText(res.data);
    const usage = normalizeUsage(res.data);
    const cost = estimateCost(usage);

    _usage.calls++;
    _usage.inputTokens += usage.prompt_tokens;
    _usage.outputTokens += usage.completion_tokens;
    _usage.cost += cost;

    return { content, usage, cost };
}

module.exports = {
    isConfigured,
    chatCompletion,
    estimateTokens,
    estimateCost,
    getUsageSummary,
    resetUsage,
    getActiveMethod
};
