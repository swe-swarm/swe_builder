/**
 * CopilotStudio Client SDK Test Runner for MCS Agents
 *
 * Alternative to direct-line-test.js — uses the official Microsoft 365 Agents SDK
 * (@microsoft/agents-copilotstudio-client) instead of Direct Line API.
 *
 * Advantages over Direct Line:
 *   - No token endpoint or DL secret needed — uses Azure AD auth directly
 *   - Streaming support via async generators
 *   - Official Microsoft SDK with Activity type safety
 *   - Simpler setup: environment ID + agent schema name + app client ID
 *
 * Prerequisites:
 *   npm install @microsoft/agents-copilotstudio-client @microsoft/agents-activity @azure/msal-node
 *
 * Auth: Entra ID delegated token with CopilotStudio.Copilots.Invoke permission.
 *   - App registration: redirect URI http://localhost (public client)
 *   - API permission: CopilotStudio.Copilots.Invoke (delegated)
 *   - Token scope: https://api.powerplatform.com/.default
 *
 * Environment variables (.env file):
 *   COPILOT_STUDIO_ENVIRONMENT_ID=<environment-guid>
 *   COPILOT_STUDIO_AGENT_SCHEMA_NAME=<cr123_agentSchemaName>
 *   COPILOT_STUDIO_APP_CLIENT_ID=<app-registration-client-id>
 *   COPILOT_STUDIO_TENANT_ID=<tenant-guid>
 *
 * Usage:
 *   node tools/copilotstudio-test.js --brief <path/to/brief.json> [--set safety,functional]
 *   node tools/copilotstudio-test.js --csv <path/to/evals.csv>
 *   node tools/copilotstudio-test.js --brief <path/to/brief.json> --token <token>
 *
 * Exit codes:
 *   0 = all tests passed
 *   1 = some tests failed
 *   2 = fatal error (auth, SDK not installed, connection failure)
 */

const fs = require('fs');
const path = require('path');

// --- Lazy SDK imports (fail gracefully if not installed) ---
let CopilotStudioClient, ConnectionSettings, loadCopilotStudioConnectionSettingsFromEnv, Activity, ActivityTypes;

function loadSDK() {
    try {
        const csClient = require('@microsoft/agents-copilotstudio-client');
        CopilotStudioClient = csClient.CopilotStudioClient;
        ConnectionSettings = csClient.ConnectionSettings;
        loadCopilotStudioConnectionSettingsFromEnv = csClient.loadCopilotStudioConnectionSettingsFromEnv;

        const activityPkg = require('@microsoft/agents-activity');
        Activity = activityPkg.Activity;
        ActivityTypes = activityPkg.ActivityTypes;

        return true;
    } catch (err) {
        return false;
    }
}

// --- Shared eval scoring ---
const { evaluateResult, evaluateResultAsync, evaluateAllMethods, evaluateAllMethodsAsync, evaluateMultiTurn, parseCSV, parseEvalSets } = require('./eval-scoring');

// --- Parse CLI Args ---
function parseArgs() {
    const args = process.argv.slice(2);
    const config = { timeout: 60000 };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--csv': config.csvPath = args[++i]; break;
            case '--brief': config.briefPath = args[++i]; break;
            case '--set': config.filterSets = args[++i].split(',').map(s => s.trim()); break;
            case '--token': config.token = args[++i]; break;
            case '--env': config.envFile = args[++i]; break;
            case '--timeout': config.timeout = parseInt(args[++i]) || 60000; break;
            case '--agent-dir': config.agentDir = args[++i]; break;
            case '--gpt': config.gpt = true; break;
            case '--verbose': config.verbose = true; break;
            case '--help':
                console.log(`CopilotStudio Client SDK Test Runner

Usage: node copilotstudio-test.js [options]

Test input (one required):
  --csv <path>    Path to evals.csv file
  --brief <path>  Path to brief.json (supports multi-turn + plan validation)
  --set <names>   Comma-separated eval set filter (with --brief only)

Auth (optional — defaults to interactive browser auth):
  --token <jwt>   Pre-acquired access token (skip interactive auth)
  --env <path>    Path to .env file with connection settings

Options:
  --timeout <ms>  Response timeout per message (default: 60000)
  --gpt           Use GPT-enhanced scoring
  --verbose       Show detailed output

Environment variables (or .env file):
  COPILOT_STUDIO_ENVIRONMENT_ID     Environment GUID
  COPILOT_STUDIO_AGENT_SCHEMA_NAME  Agent schema name (from settings.mcs.yml schemaName)
  COPILOT_STUDIO_APP_CLIENT_ID      App registration client ID (with CopilotStudio.Copilots.Invoke)
  COPILOT_STUDIO_TENANT_ID          Tenant GUID

Auto-discovery (alternative to env vars):
  --agent-dir <path>  Path to cloned agent workspace (reads .mcs/conn.json + settings.mcs.yml)

Prerequisites:
  npm install @microsoft/agents-copilotstudio-client @microsoft/agents-activity @azure/msal-node`);
                process.exit(0);
        }
    }

    if (!config.csvPath && !config.briefPath) {
        console.error('Error: --csv or --brief is required');
        process.exit(2);
    }

    return config;
}

// --- Token Acquisition ---

/**
 * Acquire a token via MSAL interactive browser auth.
 * Falls back to az CLI if MSAL is not available.
 */
async function acquireToken(settings) {
    // Try MSAL interactive auth first
    try {
        const msal = require('@azure/msal-node');
        const open = require('open');

        const pca = new msal.PublicClientApplication({
            auth: {
                clientId: settings.appClientId,
                authority: `https://login.microsoftonline.com/${settings.tenantId}`
            }
        });

        const tokenRequest = {
            scopes: ['https://api.powerplatform.com/.default'],
            openBrowser: async (url) => { await open(url); }
        };

        // Try silent first (cached tokens)
        const accounts = await pca.getAllAccounts();
        if (accounts.length > 0) {
            const response = await pca.acquireTokenSilent({ account: accounts[0], scopes: tokenRequest.scopes });
            return response.accessToken;
        }

        // Interactive browser auth
        const response = await pca.acquireTokenInteractive(tokenRequest);
        return response.accessToken;
    } catch {
        // Fallback: az CLI
        try {
            const { execSync } = require('child_process');
            const result = execSync(
                'az account get-access-token --resource https://api.powerplatform.com/ -o json',
                { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
            );
            return JSON.parse(result).accessToken;
        } catch (err) {
            throw new Error(
                'Token acquisition failed. Install @azure/msal-node for interactive auth, or use az CLI.\n' +
                `Error: ${err.message}`
            );
        }
    }
}

// --- CopilotStudio Client Wrapper ---

class CopilotStudioTestClient {
    constructor(client) {
        this._client = client;
        this._conversationId = null;
    }

    async startConversation() {
        const replies = await this._client.startConversationAsync(true);
        // Extract conversation ID from first reply
        for (const reply of replies) {
            if (reply.conversation && reply.conversation.id) {
                this._conversationId = reply.conversation.id;
                break;
            }
        }
        return replies;
    }

    /**
     * Send a message and collect all response activities.
     * Returns { text, activities, toolInvocations }
     */
    async sendAndReceive(text, timeoutMs = 60000) {
        const activity = new Activity('message');
        activity.text = text;
        if (this._conversationId) {
            activity.conversation = { id: this._conversationId };
        }

        const activities = [];
        const textParts = [];
        const tools = new Set();

        try {
            // Use streaming API for real-time collection
            for await (const reply of this._client.sendActivityStreaming(activity, this._conversationId)) {
                activities.push(reply);

                // Update conversation ID
                if (reply.conversation && reply.conversation.id) {
                    this._conversationId = reply.conversation.id;
                }

                // Collect text from message activities
                if (reply.type === ActivityTypes.Message && reply.text) {
                    textParts.push(reply.text);
                }

                // Detect sign-in cards
                if (reply.attachments) {
                    for (const att of reply.attachments) {
                        const ct = (att.contentType || '').toLowerCase();
                        if (ct.includes('oauthcard') || ct.includes('signincard')) {
                            return {
                                text: `[SIGN_IN_REQUIRED] ${ct}: Sign in required`,
                                activities,
                                toolInvocations: [],
                                signIn: { detected: true, cardType: ct }
                            };
                        }
                    }
                }

                // Collect tool/action invocations from trace/event activities
                if (reply.type === ActivityTypes.Trace || reply.type === ActivityTypes.Event) {
                    if (reply.name) tools.add(reply.name);
                }

                // End of conversation
                if (reply.type === ActivityTypes.EndOfConversation) {
                    if (reply.text) textParts.push(reply.text);
                    break;
                }
            }
        } catch (err) {
            if (textParts.length === 0) {
                return {
                    text: `[ERROR] ${err.message}`,
                    activities,
                    toolInvocations: [...tools]
                };
            }
        }

        const responseText = textParts.join('\n') || '[No text response]';
        return {
            text: responseText,
            activities,
            toolInvocations: [...tools]
        };
    }
}

// --- Write Results ---
function writeResults(config, results, testCases, status) {
    const passed = results.filter(r => r.pass).length;
    const output = {
        status,
        summary: {
            total: testCases.length,
            executed: results.length,
            passed,
            failed: results.length - passed,
            remaining: testCases.length - results.length,
            passRate: results.length > 0 ? `${Math.round(passed / results.length * 100)}%` : '0%'
        },
        timestamp: new Date().toISOString(),
        method: 'CopilotStudioSDK',
        results
    };

    const basePath = config.briefPath || config.csvPath;
    const resultsPath = basePath.replace(/\.(csv|json)$/, '-sdk-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(output, null, 2));
    return resultsPath;
}

// --- Main Runner ---
async function runTests() {
    const config = parseArgs();

    // Check SDK availability
    if (!loadSDK()) {
        console.error('Error: @microsoft/agents-copilotstudio-client is not installed.');
        console.error('Install: npm install @microsoft/agents-copilotstudio-client @microsoft/agents-activity @azure/msal-node');
        console.error('\nAlternative: Use tools/direct-line-test.js (no npm packages needed).');
        process.exit(2);
    }

    // Load .env file if specified
    if (config.envFile) {
        const envContent = fs.readFileSync(config.envFile, 'utf8');
        for (const line of envContent.split('\n')) {
            const match = line.match(/^([^#=]+)=(.+)$/);
            if (match) process.env[match[1].trim()] = match[2].trim();
        }
    }

    // Auto-discover settings from agent workspace if --agent-dir provided
    if (config.agentDir) {
        const agentDir = path.resolve(config.agentDir);
        try {
            // Read .mcs/conn.json for environment ID and tenant ID
            const connPath = path.join(agentDir, '.mcs', 'conn.json');
            if (fs.existsSync(connPath)) {
                const conn = JSON.parse(fs.readFileSync(connPath, 'utf8'));
                if (conn.EnvironmentId && !process.env.COPILOT_STUDIO_ENVIRONMENT_ID) {
                    process.env.COPILOT_STUDIO_ENVIRONMENT_ID = conn.EnvironmentId;
                }
                if (conn.AccountInfo?.TenantId && !process.env.COPILOT_STUDIO_TENANT_ID) {
                    process.env.COPILOT_STUDIO_TENANT_ID = conn.AccountInfo.TenantId;
                }
            }
            // Read settings.mcs.yml for schema name (agent identifier)
            const settingsPath = path.join(agentDir, 'settings.mcs.yml');
            if (fs.existsSync(settingsPath)) {
                const settingsContent = fs.readFileSync(settingsPath, 'utf8');
                const schemaMatch = settingsContent.match(/schemaName:\s*(.+)/);
                if (schemaMatch && !process.env.COPILOT_STUDIO_AGENT_SCHEMA_NAME) {
                    process.env.COPILOT_STUDIO_AGENT_SCHEMA_NAME = schemaMatch[1].trim();
                }
            }
            console.log(`Agent workspace: ${agentDir}`);
        } catch (err) {
            console.error(`Warning: Failed to read agent workspace: ${err.message}`);
        }
    }

    // Load connection settings
    let settings;
    try {
        settings = loadCopilotStudioConnectionSettingsFromEnv();
    } catch (err) {
        console.error('Error loading connection settings from environment variables.');
        console.error('Required: COPILOT_STUDIO_ENVIRONMENT_ID, COPILOT_STUDIO_AGENT_SCHEMA_NAME,');
        console.error('          COPILOT_STUDIO_APP_CLIENT_ID, COPILOT_STUDIO_TENANT_ID');
        console.error('\nAlternative: Use --agent-dir <path> to auto-discover from a cloned workspace.');
        console.error(`\nDetails: ${err.message}`);
        process.exit(2);
    }

    // Acquire token
    let token = config.token;
    if (!token) {
        try {
            console.log('Acquiring token...');
            token = await acquireToken(settings);
            console.log('Token acquired.');
        } catch (err) {
            console.error(`Fatal: Token acquisition failed: ${err.message}`);
            process.exit(2);
        }
    }

    // Create SDK client
    const sdkClient = new CopilotStudioClient(settings, token);
    const testClient = new CopilotStudioTestClient(sdkClient);

    // Load test cases
    let testCases, inputSource;
    if (config.briefPath) {
        const { tests, agentName } = parseEvalSets(config.briefPath, config.filterSets);
        testCases = tests.map(t => ({
            ...t,
            expectedResponse: t.expected || '',
            testMethodType: t.methods && t.methods[0] ? t.methods[0].type : 'GeneralQuality',
            passingScore: t.methods && t.methods[0] && t.methods[0].score ? t.methods[0].score : 70
        }));
        inputSource = `brief.json (${agentName})`;
    } else {
        const csvContent = fs.readFileSync(config.csvPath, 'utf8');
        testCases = parseCSV(csvContent);
        inputSource = `CSV: ${config.csvPath}`;
    }

    console.log(`\n=== CopilotStudio SDK Test Runner ===`);
    console.log(`Test cases: ${testCases.length}`);
    console.log(`Transport: CopilotStudio Client SDK`);
    console.log(`Timeout: ${config.timeout}ms`);
    console.log(`Input: ${inputSource}\n`);

    // Start conversation
    console.log('Starting conversation...');
    try {
        await testClient.startConversation();
        console.log(`Conversation started (ID: ${testClient._conversationId || 'unknown'})\n`);
    } catch (err) {
        console.error(`Fatal: Failed to start conversation: ${err.message}`);
        process.exit(2);
    }

    const results = [];

    for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        const preview = tc.question.length > 60 ? tc.question.substring(0, 57) + '...' : tc.question;
        console.log(`[${i + 1}/${testCases.length}] Testing: "${preview}"`);

        try {
            const resp = await testClient.sendAndReceive(tc.question, config.timeout);
            const text = resp.text;

            // Check for sign-in
            if (text.startsWith('[SIGN_IN_REQUIRED]')) {
                console.log(`  SIGN_IN: ${text}`);
                console.log('\n  Agent requires authentication. Stopping.');
                results.push({ ...tc, actual: text, pass: false, score: 0, error: text });
                const resultsPath = writeResults(config, results, testCases, 'partial');
                console.log(`  Partial results saved to: ${resultsPath}`);
                process.exit(2);
            }

            // Evaluate
            const result = config.gpt
                ? await evaluateResultAsync(text, tc.expectedResponse, tc.testMethodType, tc.passingScore, undefined, tc.keywords)
                : evaluateResult(text, tc.expectedResponse, tc.testMethodType, tc.passingScore, undefined, tc.keywords);

            results.push({
                ...tc,
                actualResponse: text,
                actual: text,
                pass: result.pass,
                score: result.score,
                error: result.error,
                toolInvocations: resp.toolInvocations
            });

            const status = result.pass ? 'PASS' : 'FAIL';
            console.log(`  ${status} (score: ${result.score}, method: ${tc.testMethodType})`);

            if (config.verbose && !result.pass) {
                console.log(`  Expected: ${tc.expectedResponse.substring(0, 100)}`);
                console.log(`  Actual:   ${text.substring(0, 100)}`);
            }
        } catch (err) {
            results.push({ ...tc, actual: '', pass: false, score: 0, error: err.message });
            console.log(`  ERROR: ${err.message}`);
        }
    }

    // Report
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`RESULTS: ${passed}/${results.length} passed (${Math.round(passed / results.length * 100)}%)`);
    console.log(`${'='.repeat(60)}`);

    if (failed > 0) {
        console.log(`\nFailed tests:`);
        results.filter(r => !r.pass).forEach((r, idx) => {
            console.log(`\n  ${idx + 1}. "${r.question}"`);
            console.log(`     Expected: ${(r.expectedResponse || '').substring(0, 150)}`);
            console.log(`     Actual:   ${(r.actual || r.error || 'N/A').substring(0, 150)}`);
            console.log(`     Score: ${r.score}`);
        });
    }

    const resultsPath = writeResults(config, results, testCases, 'complete');
    console.log(`\nDetailed results saved to: ${resultsPath}`);

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(2);
});
