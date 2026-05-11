/**
 * Direct Line API Test Runner for Copilot Studio Agents
 *
 * Sends test messages to an MCS agent via Direct Line API and compares
 * responses against expected results from evals.csv.
 *
 * Usage:
 *   node tools/direct-line-test.js --token <DL_TOKEN> --csv <path/to/evals.csv>
 *   node tools/direct-line-test.js --token-endpoint <URL> --csv <path/to/evals.csv>
 *   node tools/direct-line-test.js --token <DL_TOKEN> --csv <path/to/evals.csv> --endpoint <DL_ENDPOINT>
 *
 * Token acquisition (in priority order):
 *   1. --token-endpoint <URL> — MCS Token Endpoint (GET, no secret needed)
 *      Found in: Copilot Studio → Channels → Mobile app → Token Endpoint
 *      Returns: { Token, Expires_in, ConversationId }
 *   2. --token <TOKEN> — Direct Line token (manually copied)
 *      Found in: Copilot Studio → Settings → Security → Web channel security
 *   3. Dataverse API: PvaGetDirectLineEndpoint bound action on the bot entity
 *
 * CSV format (same as MCS native eval):
 *   "question","expectedResponse","testMethodType","passingScore"
 *
 * Exit codes:
 *   0 = all tests passed
 *   1 = some tests failed
 *   2 = fatal error (token acquisition, connection failure)
 */

const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// --- Configuration ---
const DEFAULT_ENDPOINT = 'https://directline.botframework.com/v3/directline';
const DEFAULT_TIMEOUT_MS = 60000; // 60 seconds max wait per message
const POLL_INTERVAL_MS = 1000;    // Poll every 1 second
const TOKEN_REFRESH_THRESHOLD = 0.8; // Refresh when 80% of TTL elapsed
const MAX_RETRIES = 3;
const RETRY_BACKOFF_BASE_MS = 1000; // 1s, 2s, 4s

// --- Parse CLI Args ---
function parseArgs() {
    const args = process.argv.slice(2);
    const config = { endpoint: DEFAULT_ENDPOINT, timeout: DEFAULT_TIMEOUT_MS };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--token': config.token = args[++i]; break;
            case '--token-endpoint': config.tokenEndpoint = args[++i]; break;
            case '--csv': config.csvPath = args[++i]; break;
            case '--endpoint': config.endpoint = args[++i]; break;
            case '--timeout': config.timeout = parseInt(args[++i]) || DEFAULT_TIMEOUT_MS; break;
            case '--verbose': config.verbose = true; break;
            case '--help':
                console.log(`Usage: node direct-line-test.js [options]

Token (one required):
  --token <TOKEN>            Direct Line token (manually copied from MCS UI)
  --token-endpoint <URL>     MCS Token Endpoint URL (auto-acquires token, no secret needed)
                             Found in: Copilot Studio → Channels → Mobile app

Test configuration:
  --csv <path>               Path to evals.csv file (required)
  --endpoint <URL>           Direct Line endpoint (default: botframework.com)
  --timeout <ms>             Response timeout in ms (default: 60000)
  --verbose                  Show detailed output for failed tests

Examples:
  node direct-line-test.js --token-endpoint "https://..." --csv evals.csv
  node direct-line-test.js --token "abc123" --csv evals.csv --verbose
  node direct-line-test.js --token "abc123" --csv evals.csv --timeout 90000`);
                process.exit(0);
        }
    }

    if (!config.token && !config.tokenEndpoint) {
        console.error('Error: --token or --token-endpoint is required');
        process.exit(2);
    }
    if (!config.csvPath) {
        console.error('Error: --csv is required');
        process.exit(2);
    }

    return config;
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

    // Skip header row
    const header = rows[0];
    return rows.slice(1).map(row => ({
        question: row[0] || '',
        expectedResponse: row[1] || '',
        testMethodType: row[2] || 'GeneralQuality',
        passingScore: parseInt(row[3]) || 70
    }));
}

// --- HTTP Helper with retry ---
function httpRequest(method, url, headers, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'http:' ? http : https;
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
            path: parsed.pathname + parsed.search,
            method,
            headers: { ...headers, 'Content-Type': 'application/json' }
        };

        const req = transport.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data || '{}') });
                } catch {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy(new Error('Request timeout'));
        });
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function httpRequestWithRetry(method, url, headers, body, retries = MAX_RETRIES) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await httpRequest(method, url, headers, body);

            // Retry on 429 (rate limit) or 5xx (server error)
            if ((res.status === 429 || res.status >= 500) && attempt < retries) {
                const delay = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
                console.log(`  [Retry ${attempt + 1}/${retries}] HTTP ${res.status}, waiting ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            return res;
        } catch (err) {
            lastError = err;
            if (attempt < retries) {
                const delay = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
                console.log(`  [Retry ${attempt + 1}/${retries}] ${err.message}, waiting ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}

// --- Token Manager ---
class TokenManager {
    constructor(tokenEndpoint, initialToken) {
        this.tokenEndpoint = tokenEndpoint;
        this.token = initialToken || null;
        this.expiresAt = null; // Date.now() + expires_in * 1000
    }

    async acquireToken() {
        if (!this.tokenEndpoint) {
            if (!this.token) throw new Error('No token and no token endpoint configured');
            return this.token;
        }

        console.log('Acquiring token from Token Endpoint...');
        const res = await httpRequestWithRetry('GET', this.tokenEndpoint, {}, null, 2);

        if (res.status !== 200) {
            throw new Error(`Token Endpoint returned ${res.status}: ${JSON.stringify(res.data)}`);
        }

        // MCS Token Endpoint returns { Token, Expires_in, ConversationId }
        // or possibly { token, expires_in } — handle both casings
        const token = res.data.Token || res.data.token;
        const expiresIn = res.data.Expires_in || res.data.expires_in || 3600;

        if (!token) {
            throw new Error(`Token Endpoint response missing token: ${JSON.stringify(res.data)}`);
        }

        this.token = token;
        this.expiresAt = Date.now() + (expiresIn * 1000);
        console.log(`Token acquired (expires in ${expiresIn}s)`);
        return this.token;
    }

    async getToken() {
        // If no token yet, acquire one
        if (!this.token) {
            return await this.acquireToken();
        }

        // If we have an expiry time and we're past the refresh threshold, refresh
        if (this.tokenEndpoint && this.expiresAt) {
            const now = Date.now();
            const totalTTL = this.expiresAt - (this.expiresAt - (this.expiresAt - now));
            // Simpler: check if remaining time is less than 20% of original TTL
            const remaining = this.expiresAt - now;
            if (remaining < 60000) { // Less than 60 seconds remaining
                console.log('Token expiring soon, refreshing...');
                return await this.acquireToken();
            }
        }

        return this.token;
    }

    needsRefresh() {
        if (!this.tokenEndpoint || !this.expiresAt) return false;
        const remaining = this.expiresAt - Date.now();
        return remaining < 120000; // Refresh when < 2 minutes remaining
    }

    async refreshIfNeeded() {
        if (this.needsRefresh()) {
            await this.acquireToken();
        }
    }
}

// --- Direct Line Client ---
class DirectLineClient {
    constructor(tokenManager, endpoint) {
        this.tokenManager = tokenManager;
        this.endpoint = endpoint;
        this.conversationId = null;
        this.watermark = null;
    }

    async startConversation() {
        const token = await this.tokenManager.getToken();
        const res = await httpRequestWithRetry('POST', `${this.endpoint}/conversations`, {
            Authorization: `Bearer ${token}`
        });

        if (res.status === 401 || res.status === 403) {
            // Token may have expired — try refresh and retry once
            if (this.tokenManager.tokenEndpoint) {
                console.log('  Auth failed, refreshing token...');
                const newToken = await this.tokenManager.acquireToken();
                const retryRes = await httpRequest('POST', `${this.endpoint}/conversations`, {
                    Authorization: `Bearer ${newToken}`
                });
                if (retryRes.status !== 201 && retryRes.status !== 200) {
                    throw new Error(`Failed to start conversation after token refresh: ${retryRes.status} ${JSON.stringify(retryRes.data)}`);
                }
                this.conversationId = retryRes.data.conversationId;
                if (retryRes.data.token) this.tokenManager.token = retryRes.data.token;
                return this.conversationId;
            }
            throw new Error(`Auth failed (${res.status}). Token may be expired.`);
        }

        if (res.status !== 201 && res.status !== 200) {
            throw new Error(`Failed to start conversation: ${res.status} ${JSON.stringify(res.data)}`);
        }

        this.conversationId = res.data.conversationId;
        // Update token if refreshed by Direct Line
        if (res.data.token) this.tokenManager.token = res.data.token;
        return this.conversationId;
    }

    async sendMessage(text) {
        const token = await this.tokenManager.getToken();
        const res = await httpRequestWithRetry('POST',
            `${this.endpoint}/conversations/${this.conversationId}/activities`,
            { Authorization: `Bearer ${token}` },
            { type: 'message', from: { id: 'test-user' }, text }
        );

        if (res.status === 401 && this.tokenManager.tokenEndpoint) {
            console.log('  Auth failed on send, refreshing token...');
            const newToken = await this.tokenManager.acquireToken();
            const retryRes = await httpRequest('POST',
                `${this.endpoint}/conversations/${this.conversationId}/activities`,
                { Authorization: `Bearer ${newToken}` },
                { type: 'message', from: { id: 'test-user' }, text }
            );
            if (retryRes.status !== 200 && retryRes.status !== 201) {
                throw new Error(`Failed to send message after token refresh: ${retryRes.status}`);
            }
            return retryRes.data.id;
        }

        if (res.status !== 200 && res.status !== 201) {
            throw new Error(`Failed to send message: ${res.status} ${JSON.stringify(res.data)}`);
        }

        return res.data.id;
    }

    async getResponse(timeoutMs) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            const token = await this.tokenManager.getToken();
            const wmParam = this.watermark ? `?watermark=${this.watermark}` : '';
            const res = await httpRequest('GET',
                `${this.endpoint}/conversations/${this.conversationId}/activities${wmParam}`,
                { Authorization: `Bearer ${token}` }
            );

            if (res.status === 401 && this.tokenManager.tokenEndpoint) {
                console.log('  Auth failed on poll, refreshing token...');
                await this.tokenManager.acquireToken();
                await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
                continue;
            }

            if (res.status === 200 && res.data.activities) {
                // Filter to bot responses only (not our own messages)
                const botMessages = res.data.activities.filter(a =>
                    a.type === 'message' && a.from && a.from.id !== 'test-user'
                );

                if (botMessages.length > 0) {
                    this.watermark = res.data.watermark;
                    // Return the last bot message (most complete response)
                    const lastMsg = botMessages[botMessages.length - 1];
                    return lastMsg.text || '[No text - check attachments]';
                }
            }

            // Wait before polling again
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        }

        return '[TIMEOUT - No response within ' + (timeoutMs / 1000) + 's]';
    }
}

// --- Test Method Evaluators ---
function evaluateResult(actual, expected, method, passingScore) {
    switch (method) {
        case 'ExactMatch':
            return { pass: actual.trim() === expected.trim(), score: actual.trim() === expected.trim() ? 100 : 0 };

        case 'PartialMatch':
            const contains = actual.toLowerCase().includes(expected.toLowerCase());
            return { pass: contains, score: contains ? 100 : 0 };

        case 'KeywordMatch': {
            // Check if all keywords from expected are present in actual
            const keywords = expected.toLowerCase().split(/[,;\s]+/).filter(w => w.length > 2);
            if (keywords.length === 0) return { pass: actual.length > 0, score: actual.length > 0 ? 100 : 0 };
            const actualLower = actual.toLowerCase();
            const hits = keywords.filter(kw => actualLower.includes(kw)).length;
            const score = Math.round((hits / keywords.length) * 100);
            return { pass: score >= (passingScore || 70), score };
        }

        case 'TextSimilarity': {
            const score = textSimilarity(actual, expected);
            return { pass: score >= passingScore, score };
        }

        case 'CompareMeaning': {
            // Simplified semantic comparison using keyword overlap
            // In production, use an LLM or embedding model for true semantic comparison
            const score = semanticSimilarity(actual, expected);
            return { pass: score >= passingScore, score };
        }

        case 'GeneralQuality': {
            // Basic quality heuristics - in production, use an LLM judge
            const score = qualityScore(actual, expected);
            return { pass: score >= 50, score };
        }

        case 'CapabilityUse': {
            // Check if the response indicates a capability was used (e.g., tool call, data retrieval)
            // Expected format: comma-separated indicators that should be present
            const indicators = expected.toLowerCase().split(/[,;]+/).map(s => s.trim()).filter(Boolean);
            const actualLower = actual.toLowerCase();
            const hits = indicators.filter(ind => actualLower.includes(ind)).length;
            const score = indicators.length > 0 ? Math.round((hits / indicators.length) * 100) : (actual.length > 20 ? 80 : 0);
            return { pass: score >= (passingScore || 70), score };
        }

        default:
            return { pass: false, score: 0, error: `Unknown test method: ${method}` };
    }
}

// Simple text similarity (Jaccard on word tokens)
function textSimilarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union === 0 ? 0 : Math.round((intersection / union) * 100);
}

// Simplified semantic similarity (keyword overlap + length ratio)
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

// Basic quality heuristics
function qualityScore(actual, expected) {
    let score = 0;

    // Not empty
    if (actual.length > 10) score += 20;

    // Contains some expected keywords
    const keywords = expected.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const actualLower = actual.toLowerCase();
    const keywordHits = keywords.filter(kw => actualLower.includes(kw)).length;
    if (keywords.length > 0) score += (keywordHits / keywords.length) * 50;

    // Reasonable length
    if (actual.length > 20 && actual.length < 5000) score += 15;

    // No error indicators
    if (!actualLower.includes('error') && !actualLower.includes('sorry, i can\'t')) score += 15;

    return Math.round(score);
}

// --- Write partial results (for failover support) ---
function writeResults(config, results, testCases, status, failedAtIndex) {
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    const total = testCases.length;

    const output = {
        status, // "complete", "partial", "error"
        summary: {
            total,
            executed: results.length,
            passed,
            failed: results.length - passed,
            remaining: total - results.length,
            passRate: results.length > 0 ? `${Math.round(passed / results.length * 100)}%` : '0%'
        },
        timestamp: new Date().toISOString(),
        method: 'DirectLine',
        ...(failedAtIndex !== undefined && { failedAt: failedAtIndex }),
        results
    };

    const resultsPath = config.csvPath.replace('.csv', '-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(output, null, 2));
    return resultsPath;
}

// --- Main Runner ---
async function runTests() {
    const config = parseArgs();

    // Read and parse CSV
    const csvContent = fs.readFileSync(config.csvPath, 'utf8');
    const testCases = parseCSV(csvContent);

    console.log(`\n=== Direct Line Test Runner ===`);
    console.log(`Test cases: ${testCases.length}`);
    console.log(`Endpoint: ${config.endpoint}`);
    console.log(`Timeout: ${config.timeout}ms`);
    console.log(`Token source: ${config.tokenEndpoint ? 'Token Endpoint (auto)' : 'Manual token'}`);
    console.log(`CSV: ${config.csvPath}\n`);

    // Initialize token manager
    const tokenManager = new TokenManager(config.tokenEndpoint || null, config.token || null);

    // Acquire initial token if using token endpoint
    if (config.tokenEndpoint) {
        try {
            await tokenManager.acquireToken();
        } catch (err) {
            console.error(`Fatal: Failed to acquire token: ${err.message}`);
            writeResults(config, [], testCases, 'error');
            process.exit(2);
        }
    }

    const client = new DirectLineClient(tokenManager, config.endpoint);
    const results = [];

    for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        const questionPreview = tc.question.length > 60 ? tc.question.substring(0, 57) + '...' : tc.question;
        console.log(`[${i + 1}/${testCases.length}] Testing: "${questionPreview}"`);

        // Refresh token proactively between tests if needed
        try {
            await tokenManager.refreshIfNeeded();
        } catch (err) {
            console.log(`  Warning: Token refresh failed: ${err.message}`);
        }

        try {
            // New conversation per test
            await client.startConversation();

            // Send message
            await client.sendMessage(tc.question);

            // Wait for response
            const response = await client.getResponse(config.timeout);

            // Evaluate
            const result = evaluateResult(response, tc.expectedResponse, tc.testMethodType, tc.passingScore);

            results.push({
                ...tc,
                actualResponse: response,
                pass: result.pass,
                score: result.score,
                error: result.error
            });

            const status = result.pass ? 'PASS' : 'FAIL';
            console.log(`  ${status} (score: ${result.score}, method: ${tc.testMethodType})`);

            if (config.verbose && !result.pass) {
                console.log(`  Expected: ${tc.expectedResponse.substring(0, 100)}`);
                console.log(`  Actual:   ${response.substring(0, 100)}`);
            }

        } catch (err) {
            results.push({
                ...tc,
                actualResponse: '',
                pass: false,
                score: 0,
                error: err.message
            });
            console.log(`  ERROR: ${err.message}`);

            // Check if this is a fatal error that should stop the run
            const isFatal = err.message.includes('Auth failed') ||
                            err.message.includes('token') ||
                            err.message.includes('ECONNREFUSED') ||
                            err.message.includes('ENOTFOUND');

            if (isFatal && i < testCases.length - 1) {
                console.log(`\n  Fatal error detected — writing partial results and stopping.`);
                const resultsPath = writeResults(config, results, testCases, 'partial', i);
                console.log(`  Partial results (${results.length}/${testCases.length}) saved to: ${resultsPath}`);
                process.exit(2);
            }
        }

        // Small delay between tests to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
    }

    // --- Report ---
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`RESULTS: ${passed}/${results.length} passed (${Math.round(passed / results.length * 100)}%)`);
    console.log(`${'='.repeat(60)}`);

    if (failed > 0) {
        console.log(`\nFailed tests:`);
        results.filter(r => !r.pass).forEach((r, i) => {
            console.log(`\n  ${i + 1}. [${r.testMethodType}] "${r.question}"`);
            console.log(`     Expected: ${r.expectedResponse.substring(0, 150)}`);
            console.log(`     Actual:   ${(r.actualResponse || r.error || 'N/A').substring(0, 150)}`);
            console.log(`     Score: ${r.score}${r.passingScore ? ` (needed: ${r.passingScore})` : ''}`);
        });
    }

    // Write complete results
    const resultsPath = writeResults(config, results, testCases, 'complete');
    console.log(`\nDetailed results saved to: ${resultsPath}`);

    // Exit with failure code if any tests failed
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(2);
});
