/**
 * Island Control Plane Gateway API Client
 *
 * Communicates with the MCS backend gateway at powervamg.{region}.gateway.prod.island.powerapps.com
 * for bot component CRUD, model selection, instructions, and settings.
 *
 * This is the same API the MCS frontend and ObjectModel VS Code extension use.
 * Zero external dependencies — uses native Node.js https.
 *
 * NOTE: For topic authoring (push/pull of .mcs.yml files), prefer tools/mcs-lsp.js instead.
 * It wraps the official Copilot Studio VS Code extension's Language Server and handles
 * YAML→JSON conversion automatically. Use this client for lightweight operations:
 * model selection, model catalog, component reads, routing info, bot settings.
 *
 * Auth: az account get-access-token --resource 96ff4394-9197-43aa-b393-6a41652e21f8  (PVA app ID)
 *
 * Usage:
 *   node tools/island-client.js read-components --env <envId> --bot <botId>
 *   node tools/island-client.js set-model --env <envId> --bot <botId> --model GPT5Chat
 *   node tools/island-client.js get-models --tenant <tenantId> --env <envId>
 *   node tools/island-client.js get-instructions --env <envId> --bot <botId>
 *   node tools/island-client.js set-instructions --env <envId> --bot <botId> --text "New instructions"
 *   node tools/island-client.js get-routing --env <envId> --bot <botId>
 *   node tools/island-client.js get-settings --env <envId> --bot <botId>
 */

const fs = require('fs');
const path = require('path');
const { httpRequest, httpRequestWithRetry, getToken, getTenantId } = require('./lib/http');

// --- Build Headers ---

function buildHeaders(token, tenantId, envId, botId) {
    const headers = {
        'Authorization': `Bearer ${token}`,
        'x-ms-client-tenant-id': tenantId,
        'x-cci-tenantid': tenantId,
        'x-cci-bapenvironmentid': envId
    };
    if (botId) {
        headers['x-cci-cdsbotid'] = botId;
    }
    return headers;
}

// --- Gateway URL Helpers ---

function buildGatewayUrl(baseUrl, ...segments) {
    const base = baseUrl.replace(/\/$/, '');
    return `${base}/${segments.join('/')}`;
}

/**
 * Load gateway URL from session-config.json if available
 */
function loadGatewayFromConfig(envId) {
    const configPaths = [
        path.join(process.cwd(), 'tools', 'session-config.json'),
        path.join(__dirname, 'session-config.json')
    ];
    for (const configPath of configPaths) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.accounts) {
                for (const account of config.accounts) {
                    for (const env of account.environments || []) {
                        if (env.gatewayUrl && (env.environmentId === envId || !envId)) {
                            return env.gatewayUrl;
                        }
                    }
                }
            }
        } catch { /* config not found or invalid */ }
    }
    return null;
}

// --- BAP (Business Application Platform) APIs ---

const BAP_BASE_URL = 'https://api.bap.microsoft.com';

/**
 * List Power Platform environments available to the current user via BAP API.
 * This is the same API the Power Platform Admin Center uses.
 *
 * @param {string} token - BAP API access token (resource: https://api.bap.microsoft.com/)
 * @returns {Array<{id: string, name: string, displayName: string, type: string, location: string, dataverseUrl: string, state: string}>}
 */
async function listEnvironments(token) {
    const url = `${BAP_BASE_URL}/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments?api-version=2023-06-01&$expand=properties/linkedEnvironmentMetadata`;
    const res = await httpRequestWithRetry('GET', url, {
        'Authorization': `Bearer ${token}`
    });

    if (res.status !== 200) {
        throw new Error(`listEnvironments failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
    }

    const envs = res.data.value || [];
    return envs.map(env => {
        const props = env.properties || {};
        const linked = props.linkedEnvironmentMetadata || {};
        return {
            id: env.name, // environment ID (GUID)
            displayName: props.displayName || env.name,
            type: linked.type || props.environmentType || 'unknown',
            location: props.azureRegion || props.location || '',
            state: props.states?.management?.id || 'unknown',
            dataverseUrl: linked.instanceUrl || '',
            dataverseApiUrl: linked.instanceApiUrl || '',
            domainName: linked.domainName || '',
            uniqueName: linked.uniqueName || '',
            securityGroupId: linked.securityGroupId || '',
            createdTime: props.createdTime || '',
            isDefault: !!props.isDefault
        };
    });
}

/**
 * Get details for a specific environment via BAP API.
 *
 * @param {string} token - BAP API access token
 * @param {string} envId - Environment ID (GUID)
 * @returns {object} Environment details
 */
async function getEnvironment(token, envId) {
    const url = `${BAP_BASE_URL}/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/${envId}?api-version=2023-06-01&$expand=properties/linkedEnvironmentMetadata`;
    const res = await httpRequestWithRetry('GET', url, {
        'Authorization': `Bearer ${token}`
    });

    if (res.status !== 200) {
        throw new Error(`getEnvironment failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
    }

    return res.data;
}

// --- Discovery APIs ---

/**
 * Get bot routing info — maps CDS bot ID to PVA bot ID, island, schema name.
 * Also reveals the gateway URL for this environment.
 */
async function getRoutingInfo(gatewayUrl, envId, botId, headers) {
    const url = buildGatewayUrl(
        gatewayUrl,
        'api/botmanagement/v1/environments', envId,
        `botroutinginfo?cdsBotId=${botId}`
    );
    const res = await httpRequestWithRetry('GET', url, headers);
    if (res.status !== 200) {
        throw new Error(`getRoutingInfo failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
    }
    return res.data;
}

/**
 * Get available model catalog for the environment.
 * Returns array of { modelDisplayName, modelHint, provider, publicStatus, sortOrder, tags }
 */
async function getModelSettings(gatewayUrl, tenantId, envId, headers) {
    const url = buildGatewayUrl(
        gatewayUrl,
        'chatbotmanagement/tenants', tenantId,
        'environments', envId,
        'api/featureSettings/modelSettings/v2'
    );
    const res = await httpRequestWithRetry('GET', url, headers);
    if (res.status !== 200) {
        throw new Error(`getModelSettings failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
    }
    return res.data;
}

/**
 * Get bot-level settings (overlap detection, topic suggestions, etc.)
 */
async function getBotSettings(gatewayUrl, envId, botId, headers) {
    const url = buildGatewayUrl(
        gatewayUrl,
        'api/botmanagement/v1/environments', envId,
        'bots', botId, 'settings'
    );
    const res = await httpRequestWithRetry('GET', url, headers);
    if (res.status !== 200) {
        throw new Error(`getBotSettings failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
    }
    return res.data;
}

// --- Publish & DLP Status ---

/**
 * Get publish status for a bot. Returns publish operation state.
 * Used after `pac copilot publish` to confirm completion.
 */
async function getPublishStatus(gatewayUrl, envId, botId, headers) {
    const url = buildGatewayUrl(
        gatewayUrl,
        'api/botmanagement/v1/environments', envId,
        'bots', botId, 'publishv2-operations'
    );
    const res = await httpRequestWithRetry('GET', url, headers);
    if (res.status !== 200) {
        throw new Error(`getPublishStatus failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
    }
    return res.data;
}

/**
 * Check DLP (Data Loss Prevention) violations for a bot.
 * Returns blocked connectors, policy issues. Used as pre-build check.
 */
async function checkDlp(gatewayUrl, envId, botId, headers) {
    const url = buildGatewayUrl(
        gatewayUrl,
        'api/botmanagement/v1/environments', envId,
        'bots', botId, 'dlpstatus'
    );
    const res = await httpRequestWithRetry('GET', url, headers);
    if (res.status !== 200) {
        throw new Error(`checkDlp failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
    }
    return res.data;
}

/**
 * List topics for a bot. Uses readComponents internally, filters for DialogComponent.
 * Returns a simplified topic list: [{name, schemaName, triggerKind, description}]
 */
async function listTopics(gatewayUrl, envId, botId, headers) {
    const readResult = await readComponents(gatewayUrl, envId, botId, headers);
    const changes = readResult.botComponentChanges || [];
    return changes
        .filter(c => c.component && c.component['$kind'] === 'DialogComponent')
        .map(c => {
            const comp = c.component;
            const trigger = comp.dialog?.beginDialog;
            return {
                name: comp.displayName || comp.schemaName,
                schemaName: comp.schemaName,
                triggerKind: trigger ? trigger['$kind'] : 'unknown',
                description: comp.description || '',
                state: comp.state || ''
            };
        });
}

// --- Component CRUD ---

/**
 * Read all bot components (initial sync or delta sync).
 * POST with {} for initial read, or { componentDeltaToken: "..." } for incremental.
 * Returns { botComponentChanges: [...], changeToken: "..." }
 */
async function readComponents(gatewayUrl, envId, botId, headers, changeToken) {
    const url = buildGatewayUrl(
        gatewayUrl,
        'api/botmanagement/v1/environments', envId,
        'bots', botId, 'content/botcomponents'
    );
    const body = changeToken ? { componentDeltaToken: changeToken } : {};
    const res = await httpRequestWithRetry('POST', url, headers, body);
    if (res.status !== 200) {
        throw new Error(`readComponents failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
    }
    return res.data;
}

/**
 * Write component changes (update, insert, delete).
 * PUT with { botComponentChanges: [...], changeToken: "..." }
 * Returns updated changeset with new changeToken.
 */
async function writeComponents(gatewayUrl, envId, botId, headers, changeSet) {
    const url = buildGatewayUrl(
        gatewayUrl,
        'api/botmanagement/v1/environments', envId,
        'bots', botId, 'content/botcomponents'
    );
    const res = await httpRequestWithRetry('PUT', url, headers, changeSet);
    if (res.status !== 200) {
        throw new Error(`writeComponents failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
    }
    return res.data;
}

// --- Convenience: Model Selection ---

/**
 * Find the GptComponent from a component read response.
 */
function findGptComponent(componentsResponse) {
    const changes = componentsResponse.botComponentChanges || [];
    for (const change of changes) {
        const comp = change.component;
        if (comp && comp['$kind'] === 'GptComponent') {
            return { change, component: comp };
        }
    }
    return null;
}

/**
 * Set the model for a bot. Reads current GptComponent, modifies modelNameHint, writes back.
 * @param {string} modelHint - e.g. "GPT41", "GPT5Chat", "sonnet4-5", "opus4-1"
 */
async function setModel(gatewayUrl, envId, botId, headers, modelHint) {
    // Read current components
    const readResult = await readComponents(gatewayUrl, envId, botId, headers);
    const gpt = findGptComponent(readResult);
    if (!gpt) {
        throw new Error('No GptComponent found — is this a valid MCS agent?');
    }

    const comp = gpt.component;
    const changeToken = readResult.changeToken;

    // Modify the model hint
    if (!comp.metadata) comp.metadata = { '$kind': 'GptComponentMetadata' };
    if (!comp.metadata.aISettings) comp.metadata.aISettings = { '$kind': 'AISettings' };
    if (!comp.metadata.aISettings.model) comp.metadata.aISettings.model = { '$kind': 'CurrentModels' };
    comp.metadata.aISettings.model.modelNameHint = modelHint;

    // Build the write changeset
    const changeSet = {
        botComponentChanges: [{
            '$kind': 'BotComponentUpdate',
            component: comp
        }],
        cloudFlowDefinitionChanges: [],
        connectorDefinitionChanges: [],
        environmentVariableChanges: [],
        connectionReferenceChanges: [],
        aIPluginOperationChanges: [],
        componentCollectionChanges: [],
        dataverseTableSearchChanges: [],
        connectedAgentDefinitionChanges: [],
        changeToken: changeToken
    };

    return await writeComponents(gatewayUrl, envId, botId, headers, changeSet);
}

// --- Convenience: Instructions ---

/**
 * Get the current instructions text from the GptComponent.
 */
async function getInstructions(gatewayUrl, envId, botId, headers) {
    const readResult = await readComponents(gatewayUrl, envId, botId, headers);
    const gpt = findGptComponent(readResult);
    if (!gpt) {
        throw new Error('No GptComponent found — is this a valid MCS agent?');
    }

    const comp = gpt.component;
    // Instructions are in metadata.instructions or metadata.displayName area
    // The GptComponent stores instructions in metadata — check common locations
    const meta = comp.metadata || {};
    return {
        instructions: meta.instructions || meta.systemMessage || null,
        displayName: comp.displayName,
        model: meta.aISettings?.model?.modelNameHint || 'unknown',
        tools: meta.tools || [],
        conversationStarters: meta.conversationStarters || [],
        changeToken: readResult.changeToken,
        component: comp
    };
}

/**
 * Set agent instructions via GptComponent update.
 */
async function setInstructions(gatewayUrl, envId, botId, headers, text) {
    const readResult = await readComponents(gatewayUrl, envId, botId, headers);
    const gpt = findGptComponent(readResult);
    if (!gpt) {
        throw new Error('No GptComponent found — is this a valid MCS agent?');
    }

    const comp = gpt.component;
    if (!comp.metadata) comp.metadata = { '$kind': 'GptComponentMetadata' };
    comp.metadata.instructions = text;

    const changeSet = {
        botComponentChanges: [{
            '$kind': 'BotComponentUpdate',
            component: comp
        }],
        cloudFlowDefinitionChanges: [],
        connectorDefinitionChanges: [],
        environmentVariableChanges: [],
        connectionReferenceChanges: [],
        aIPluginOperationChanges: [],
        componentCollectionChanges: [],
        dataverseTableSearchChanges: [],
        connectedAgentDefinitionChanges: [],
        changeToken: readResult.changeToken
    };

    return await writeComponents(gatewayUrl, envId, botId, headers, changeSet);
}

// --- CLI ---

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {};

    if (args.length === 0 || args[0] === '--help') {
        printUsage();
        process.exit(0);
    }

    config.command = args[0];

    for (let i = 1; i < args.length; i++) {
        switch (args[i]) {
            case '--env': config.envId = args[++i]; break;
            case '--bot': config.botId = args[++i]; break;
            case '--tenant': config.tenantId = args[++i]; break;
            case '--model': config.model = args[++i]; break;
            case '--text': config.text = args[++i]; break;
            case '--gateway': config.gatewayUrl = args[++i]; break;
            case '--json': config.json = true; break;
            case '--brief': config.briefPath = args[++i]; break;
            case '--topic-file': config.topicFile = args[++i]; break;
            case '--set-id': config.setId = args[++i]; break;
            case '--name': config.runName = args[++i]; break;
            case '--help': printUsage(); process.exit(0);
        }
    }

    return config;
}

function printUsage() {
    console.log(`Island Control Plane Gateway API Client

Usage: node island-client.js <command> [options]

Commands:
  read-components    Read all bot components (ObjectModel $kind types)
  set-model          Change the agent's AI model
  get-models         List available AI models for the environment
  get-instructions   Get agent instructions from GptComponent
  set-instructions   Set agent instructions via GptComponent
  get-routing        Get bot routing info (island, schema, PVA bot ID)
  get-settings       Get bot-level settings
  get-publish-status Get publish operation status (running/completed/failed)
  check-dlp          Check DLP violations — blocked connectors and policy issues
  list-topics        List topics with trigger info (filtered from components)
  create-topic       Create a new topic via Gateway API BotComponentInsert (renders in MCS canvas)
  list-environments  List Power Platform environments via BAP API (no --env/--bot needed)
  get-environment    Get detailed info for a specific environment via BAP API

Required options (most commands):
  --env <envId>      Environment ID (e.g. Default-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  --bot <botId>      Bot/agent CDS ID (GUID)

Optional:
  --tenant <tid>     Tenant ID (auto-detected from az CLI if omitted)
  --gateway <url>    Gateway URL (loaded from session-config.json if omitted)
  --model <hint>     Model hint for set-model (GPT41, GPT5Chat, sonnet4-5, etc.)
  --text <text>      Instructions text for set-instructions
  --topic-file <path> JSON file with topic definition (for create-topic)
  --json             Output raw JSON (default: formatted summary)

Examples:
  node island-client.js get-models --env Default-xxx
  node island-client.js read-components --env Default-xxx --bot fec3b192-xxx
  node island-client.js set-model --env Default-xxx --bot fec3b192-xxx --model GPT5Chat
  node island-client.js get-instructions --env Default-xxx --bot fec3b192-xxx
  node island-client.js get-publish-status --env Default-xxx --bot fec3b192-xxx
  node island-client.js check-dlp --env Default-xxx --bot fec3b192-xxx
  node island-client.js list-topics --env Default-xxx --bot fec3b192-xxx

Topics:
  node island-client.js create-topic --env Default-xxx --bot fec3b192-xxx --topic-file topic-def.json

Evaluation:
  node island-client.js upload-evals --env Default-xxx --bot fec3b192-xxx --brief path/to/brief.json
  node island-client.js run-eval --env Default-xxx --bot fec3b192-xxx --set-id <evalSetId> --name "Run 1"

Environment Discovery (BAP API — no --env/--bot needed):
  node island-client.js list-environments
  node island-client.js list-environments --json
  node island-client.js get-environment --env Default-xxx`);
}

async function main() {
    const config = parseArgs();

    // Resolve tenant ID
    const tenantId = config.tenantId || getTenantId();

    // Resolve gateway URL
    let gatewayUrl = config.gatewayUrl || loadGatewayFromConfig(config.envId);
    if (!gatewayUrl) {
        // Default — user must provide or we try common US gateway
        gatewayUrl = 'https://powervamg.us-il104.gateway.prod.island.powerapps.com';
        console.error(`No gateway URL configured. Using default: ${gatewayUrl}`);
        console.error(`Set via --gateway or add gatewayUrl to session-config.json\n`);
    }

    // Get auth token
    // PVA/Copilot Studio gateway expects audience = PVA app ID
    const token = getToken('96ff4394-9197-43aa-b393-6a41652e21f8');
    const headers = buildHeaders(token, tenantId, config.envId, config.botId);

    try {
        switch (config.command) {
            case 'get-routing': {
                if (!config.envId || !config.botId) {
                    console.error('Error: --env and --bot are required for get-routing');
                    process.exit(2);
                }
                const result = await getRoutingInfo(gatewayUrl, config.envId, config.botId, headers);
                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    console.log('Bot Routing Info:');
                    console.log(`  PVA Bot ID:    ${result.pvaBotId}`);
                    console.log(`  CDS Bot ID:    ${result.cdsBotId}`);
                    console.log(`  Island:        ${result.island}`);
                    console.log(`  Schema:        ${result.schemaName}`);
                    console.log(`  Environment:   ${result.environmentId}`);
                    console.log(`  Tenant:        ${result.tenantId}`);
                    console.log(`  Organization:  ${result.organizationId}`);
                }
                break;
            }

            case 'get-models': {
                if (!config.envId) {
                    console.error('Error: --env is required for get-models');
                    process.exit(2);
                }
                const models = await getModelSettings(gatewayUrl, tenantId, config.envId, headers);
                if (config.json) {
                    console.log(JSON.stringify(models, null, 2));
                } else {
                    console.log('Available Models:');
                    console.log('');
                    const arr = Array.isArray(models) ? models : [];
                    for (const m of arr) {
                        const def = m.isDefault ? ' (DEFAULT)' : '';
                        console.log(`  ${m.modelDisplayName}${def}`);
                        console.log(`    Hint: ${m.modelHint}  |  Provider: ${m.provider}  |  Status: ${m.publicStatus}`);
                    }
                }
                break;
            }

            case 'get-settings': {
                if (!config.envId || !config.botId) {
                    console.error('Error: --env and --bot are required for get-settings');
                    process.exit(2);
                }
                const settings = await getBotSettings(gatewayUrl, config.envId, config.botId, headers);
                console.log(JSON.stringify(settings, null, 2));
                break;
            }

            case 'read-components': {
                if (!config.envId || !config.botId) {
                    console.error('Error: --env and --bot are required for read-components');
                    process.exit(2);
                }
                const result = await readComponents(gatewayUrl, config.envId, config.botId, headers);
                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    const changes = result.botComponentChanges || [];
                    console.log(`Bot Components: ${changes.length} total\n`);
                    for (const change of changes) {
                        const comp = change.component;
                        if (!comp) continue;
                        const kind = comp['$kind'] || 'Unknown';
                        const name = comp.displayName || comp.schemaName || comp.id;
                        const state = comp.state || '';
                        console.log(`  [${kind}] ${name}  (${state})`);
                    }
                    console.log(`\nChange token: ${(result.changeToken || '').substring(0, 40)}...`);
                }
                break;
            }

            case 'set-model': {
                if (!config.envId || !config.botId || !config.model) {
                    console.error('Error: --env, --bot, and --model are required for set-model');
                    process.exit(2);
                }
                console.log(`Setting model to: ${config.model}`);
                const result = await setModel(gatewayUrl, config.envId, config.botId, headers, config.model);
                console.log('Model updated successfully.');
                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                }
                break;
            }

            case 'get-instructions': {
                if (!config.envId || !config.botId) {
                    console.error('Error: --env and --bot are required for get-instructions');
                    process.exit(2);
                }
                const info = await getInstructions(gatewayUrl, config.envId, config.botId, headers);
                if (config.json) {
                    console.log(JSON.stringify(info, null, 2));
                } else {
                    console.log(`Agent: ${info.displayName}`);
                    console.log(`Model: ${info.model}`);
                    console.log(`Tools: ${info.tools.length}`);
                    console.log(`Starters: ${info.conversationStarters.length}`);
                    console.log(`\nInstructions:`);
                    console.log(info.instructions || '(none)');
                }
                break;
            }

            case 'get-publish-status': {
                if (!config.envId || !config.botId) {
                    console.error('Error: --env and --bot are required for get-publish-status');
                    process.exit(2);
                }
                const pubStatus = await getPublishStatus(gatewayUrl, config.envId, config.botId, headers);
                if (config.json) {
                    console.log(JSON.stringify(pubStatus, null, 2));
                } else {
                    const ops = Array.isArray(pubStatus) ? pubStatus : (pubStatus.value || [pubStatus]);
                    console.log('Publish Operations:');
                    for (const op of ops) {
                        const state = op.state || op.status || 'unknown';
                        const started = op.startTime || op.createdDateTime || '';
                        const ended = op.endTime || op.completedDateTime || '';
                        console.log(`  State: ${state}`);
                        if (started) console.log(`  Started: ${started}`);
                        if (ended) console.log(`  Ended: ${ended}`);
                        if (op.error) console.log(`  Error: ${JSON.stringify(op.error)}`);
                        console.log('');
                    }
                }
                break;
            }

            case 'check-dlp': {
                if (!config.envId || !config.botId) {
                    console.error('Error: --env and --bot are required for check-dlp');
                    process.exit(2);
                }
                const dlp = await checkDlp(gatewayUrl, config.envId, config.botId, headers);
                if (config.json) {
                    console.log(JSON.stringify(dlp, null, 2));
                } else {
                    const violations = dlp.blockedConnectors || dlp.violations || [];
                    const hasViolations = Array.isArray(violations) ? violations.length > 0 : !!violations;
                    if (hasViolations) {
                        console.log('DLP Violations Found:');
                        for (const v of (Array.isArray(violations) ? violations : [violations])) {
                            console.log(`  Connector: ${v.connectorId || v.name || JSON.stringify(v)}`);
                            if (v.policyName) console.log(`  Policy: ${v.policyName}`);
                        }
                    } else {
                        console.log('No DLP violations detected.');
                    }
                    if (dlp.isBlocked !== undefined) {
                        console.log(`Blocked: ${dlp.isBlocked}`);
                    }
                }
                break;
            }

            case 'list-topics': {
                if (!config.envId || !config.botId) {
                    console.error('Error: --env and --bot are required for list-topics');
                    process.exit(2);
                }
                const topics = await listTopics(gatewayUrl, config.envId, config.botId, headers);
                if (config.json) {
                    console.log(JSON.stringify(topics, null, 2));
                } else {
                    console.log(`Topics (${topics.length}):\n`);
                    for (const t of topics) {
                        const trigger = t.triggerKind.replace('On', '').replace('Intent', '');
                        console.log(`  ${t.name}`);
                        console.log(`    Schema: ${t.schemaName}  |  Trigger: ${trigger}  |  State: ${t.state}`);
                        if (t.description) console.log(`    ${t.description.substring(0, 80)}`);
                    }
                }
                break;
            }

            case 'create-topic': {
                if (!config.envId || !config.botId || !config.topicFile) {
                    console.error('Error: --env, --bot, and --topic-file are required for create-topic');
                    console.error('  --topic-file: JSON file with { schemaName, displayName, description, triggerQueries, actions }');
                    process.exit(2);
                }
                const topicDef = JSON.parse(fs.readFileSync(config.topicFile, 'utf8'));
                console.log(`Creating topic "${topicDef.displayName}"...`);
                const created = await createTopic(gatewayUrl, config.envId, config.botId, headers, topicDef);
                console.log(`Created: ${created.displayName} (id: ${created.id})`);
                if (config.json) {
                    console.log(JSON.stringify(created, null, 2));
                }
                break;
            }

            case 'set-instructions': {
                if (!config.envId || !config.botId || !config.text) {
                    console.error('Error: --env, --bot, and --text are required for set-instructions');
                    process.exit(2);
                }
                console.log(`Setting instructions (${config.text.length} chars)...`);
                const result = await setInstructions(gatewayUrl, config.envId, config.botId, headers, config.text);
                console.log('Instructions updated successfully.');
                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                }
                break;
            }

            case 'upload-evals': {
                if (!config.briefPath) {
                    console.error('Error: --brief <path> required (path to brief.json)');
                    process.exit(2);
                }
                const brief = JSON.parse(fs.readFileSync(config.briefPath, 'utf8'));
                const evalSets = brief.evalSets || [];
                if (evalSets.length === 0) {
                    console.error('No evalSets found in brief.json');
                    process.exit(1);
                }

                // Grader type mapping: brief method names → ObjectModel grader kinds
                const GRADER_MAP = {
                    'General quality': { $kind: 'GeneralQualityGrader' },
                    'Compare meaning': (m) => ({ $kind: 'CompareMeaningGrader', threshold: (m.score || 70) / 100 }),
                    'Keyword match': (m) => m.mode === 'all' ? { $kind: 'ContainsAllGrader' } : { $kind: 'ContainsAnyGrader' },
                    'Text similarity': { $kind: 'TextSimilarityGrader' },
                    'Exact match': { $kind: 'ExactMatchGrader' },
                };

                const createdSets = [];
                for (const s of evalSets) {
                    // Map methods to graders
                    const graders = (s.methods || []).map(m => {
                        const mapper = GRADER_MAP[m.type];
                        if (!mapper) return { $kind: 'GeneralQualityGrader' };
                        return typeof mapper === 'function' ? mapper(m) : mapper;
                    });
                    if (graders.length === 0) graders.push({ $kind: 'GeneralQualityGrader' });

                    const tests = (s.tests || []).map(t => ({
                        input: t.question,
                        expectedOutput: t.expected
                    }));

                    const result = await createEvalSet(gatewayUrl, config.envId, config.botId, headers, s.name, graders, tests);
                    createdSets.push({ name: s.name, ...result });
                }

                console.log(`\nUploaded ${createdSets.length} eval sets:`);
                for (const s of createdSets) {
                    console.log(`  ${s.name}: ${Object.keys(s.testIds).length} tests (setId: ${s.setId})`);
                }
                if (config.json) console.log(JSON.stringify(createdSets, null, 2));
                break;
            }

            case 'run-eval': {
                if (!config.setId) {
                    console.error('Error: --set-id <evalSetId> required');
                    process.exit(2);
                }
                const runName = config.runName || `Eval ${new Date().toISOString().slice(0, 16)}`;
                const result = await runEval(gatewayUrl, config.envId, config.botId, headers, config.setId, runName);
                console.log(`Run started: ${result.runId} (${result.executionState || result.state})`);
                if (config.json) console.log(JSON.stringify(result, null, 2));
                break;
            }

            case 'list-environments': {
                // BAP API uses a different token audience
                const bapToken = getToken('https://api.bap.microsoft.com/');
                const envs = await listEnvironments(bapToken);
                if (config.json) {
                    console.log(JSON.stringify(envs, null, 2));
                } else {
                    console.log(`Environments (${envs.length}):\n`);
                    for (const env of envs) {
                        const def = env.isDefault ? ' (DEFAULT)' : '';
                        console.log(`  ${env.displayName}${def}`);
                        console.log(`    ID: ${env.id}  |  Type: ${env.type}  |  State: ${env.state}`);
                        if (env.dataverseUrl) console.log(`    Dataverse: ${env.dataverseUrl}`);
                        if (env.location) console.log(`    Region: ${env.location}`);
                    }
                }
                break;
            }

            case 'get-environment': {
                if (!config.envId) {
                    console.error('Error: --env is required for get-environment');
                    process.exit(2);
                }
                const bapToken = getToken('https://api.bap.microsoft.com/');
                const envDetail = await getEnvironment(bapToken, config.envId);
                if (config.json) {
                    console.log(JSON.stringify(envDetail, null, 2));
                } else {
                    const props = envDetail.properties || {};
                    const linked = props.linkedEnvironmentMetadata || {};
                    console.log('Environment Details:');
                    console.log(`  Name:        ${props.displayName}`);
                    console.log(`  ID:          ${envDetail.name}`);
                    console.log(`  Type:        ${linked.type || props.environmentType || 'unknown'}`);
                    console.log(`  State:       ${props.states?.management?.id || 'unknown'}`);
                    console.log(`  Dataverse:   ${linked.instanceUrl || 'N/A'}`);
                    console.log(`  Domain:      ${linked.domainName || 'N/A'}`);
                    console.log(`  Region:      ${props.azureRegion || props.location || 'N/A'}`);
                    console.log(`  Created:     ${props.createdTime || 'N/A'}`);
                }
                break;
            }

            default:
                console.error(`Unknown command: ${config.command}`);
                printUsage();
                process.exit(2);
        }
    } catch (err) {
        console.error(`\nError: ${err.message}`);
        process.exit(1);
    }
}

// --- Evaluation API (Island Gateway v2) ---

/**
 * Create an evaluation test set with test cases via the Island Gateway makerevaluations API.
 * This is the same API the MCS UI uses when importing CSV test cases.
 *
 * @param {string} gatewayUrl - Gateway base URL
 * @param {string} envId - Environment ID
 * @param {string} botId - Bot/agent CDS ID
 * @param {object} headers - Auth headers from buildHeaders()
 * @param {string} setName - Display name for the eval set
 * @param {Array} graders - Array of grader objects, e.g. [{$kind: "GeneralQualityGrader"}]
 * @param {Array} tests - Array of {input, expectedOutput} objects
 * @returns {{ setId: string, testIds: object }} Created IDs
 */
async function createEvalSet(gatewayUrl, envId, botId, headers, setName, graders, tests) {
    const baseUrl = `${gatewayUrl.replace(/\/$/, '')}/api/botmanagement/v2/environments/${envId}/bots/${botId}/makerevaluations/testcomponent?ApplyV2Migration=true`;

    // Step 1: Create the EvaluationSet container
    const setSchema = `mspva_${crypto.randomUUID()}`;
    const setPayload = {
        testComponents: [{
            $kind: "MakerEvaluationUpdateTestComponent",
            component: {
                $kind: "TestCaseComponent",
                schemaName: setSchema,
                definition: {
                    graders: graders.map(g => ({ diagnostics: [], ...g })),
                    diagnostics: [],
                    $kind: "EvaluationSet"
                },
                displayName: setName,
                description: setName,
                category: "Testing",
                state: "Active"
            },
            operationType: "Add"
        }]
    };

    const setRes = await httpRequest('POST', baseUrl, headers, JSON.stringify(setPayload));
    if (setRes.status !== 200) {
        throw new Error(`Failed to create eval set: HTTP ${setRes.status} ${JSON.stringify(setRes.data)}`);
    }
    const setId = setRes.data.addedComponentsIdsBySchemaName[setSchema];
    console.error(`[eval] Created set "${setName}" (${setId})`);

    // Step 2: Create EvaluationData rows (batch — all tests in one request)
    const testComponents = tests.map((t, i) => {
        const schema = `mspva_${crypto.randomUUID()}`;
        return {
            $kind: "MakerEvaluationUpdateTestComponent",
            component: {
                $kind: "TestCaseComponent",
                schemaName: schema,
                definition: {
                    rows: [{
                        diagnostics: [],
                        input: t.input || t.question || ' ',
                        expectedOutput: t.expectedOutput || t.expected || '',
                        source: "Imported",
                        $kind: "SimpleEvaluationCase"
                    }],
                    diagnostics: [],
                    extensionData: { displayOrder: String(Date.now() + i) },
                    $kind: "EvaluationData"
                },
                parentBotComponentId: setId,
                displayName: (t.input || t.question || '(empty input test)').substring(0, 100),
                description: (t.input || t.question || '(empty input test)').substring(0, 200),
                category: "Testing",
                state: "Active"
            },
            operationType: "Add"
        };
    });

    const dataRes = await httpRequest('POST', baseUrl, headers, JSON.stringify({ testComponents }));
    if (dataRes.status !== 200) {
        throw new Error(`Failed to create eval data: HTTP ${dataRes.status} ${JSON.stringify(dataRes.data)}`);
    }
    const testIds = dataRes.data.addedComponentsIdsBySchemaName || {};
    console.error(`[eval] Added ${Object.keys(testIds).length} test cases to "${setName}"`);

    return { setId, testIds };
}

/**
 * Run an evaluation on a test set.
 *
 * @param {string} gatewayUrl - Gateway base URL
 * @param {string} envId - Environment ID
 * @param {string} botId - Bot/agent CDS ID
 * @param {object} headers - Auth headers
 * @param {string} testSetId - The evaluation set ID to run
 * @param {string} runName - Display name for this run
 * @returns {{ runId: string, state: string }}
 */
async function runEval(gatewayUrl, envId, botId, headers, testSetId, runName) {
    // Discover the MCS connection ID from the environment
    const connRes = await httpRequest('GET',
        `${gatewayUrl.replace(/\/$/, '')}/api/botmanagement/v1/environments/${envId}/bots/${botId}/settings`,
        headers, null);
    let mcsConnectionId = '';
    if (connRes.status === 200) {
        // Try to find the copilot studio connection from settings
        const settings = connRes.data;
        // The connection ID pattern from the HAR trace
        // Fall back to discovering from connection references
    }

    const runUrl = `${gatewayUrl.replace(/\/$/, '')}/api/botmanagement/v2/environments/${envId}/bots/${botId}/makerevaluations?ApplyV2Migration=true`;
    const runPayload = {
        testSetId,
        clientRequestedEvaluationRunName: runName
    };
    // Add mcsConnectionId if discovered
    if (mcsConnectionId) {
        runPayload.mcsConnectionId = mcsConnectionId;
    }

    const runRes = await httpRequest('POST', runUrl, headers, JSON.stringify(runPayload));
    if (runRes.status !== 200) {
        throw new Error(`Failed to start eval run: HTTP ${runRes.status} ${JSON.stringify(runRes.data)}`);
    }

    console.error(`[eval] Started run "${runName}" (${runRes.data.runId}) — state: ${runRes.data.executionState || runRes.data.state}`);
    return runRes.data;
}

// Need crypto for UUID generation
const crypto = require('crypto');

// --- Topic Creation via Gateway API (BotComponentInsert) ---

/**
 * Helper: Build an ObjectModel TextSegment message from plain text.
 * Maps to YAML: activity.text[0] = "message"
 */
function buildTextMessage(text) {
    return {
        $kind: "Message",
        text: [{
            $kind: "TemplateLine",
            segments: [{ $kind: "TextSegment", value: text }]
        }]
    };
}

/**
 * Create a topic via Gateway API BotComponentInsert.
 *
 * This is the ONLY reliable method for creating topics that render in the MCS
 * visual editor. LSP push creates botcomponent records but skips internal MCS
 * registration (NLU trigger phrases, dependency tracking, compilation).
 *
 * The Gateway API PUT content/botcomponents with BotComponentInsert is the same
 * method MCS UI uses when saving a new topic in the code editor.
 *
 * @param {string} gatewayUrl - Gateway base URL
 * @param {string} envId - Environment ID
 * @param {string} botId - Bot/agent CDS ID
 * @param {object} headers - Auth headers from buildHeaders()
 * @param {object} topicDef - Topic definition:
 *   {
 *     schemaName: "botschema.topic.TopicName",
 *     displayName: "Topic Name",
 *     description: "When to use / when not to use",
 *     triggerQueries: ["phrase 1", "phrase 2"],
 *     actions: [
 *       { kind: "SendActivity", id: "sendMsg1", text: "message" },
 *       { kind: "Question", id: "q1", variable: "init:Topic.var", prompt: "Ask?", entity: "StringPrebuiltEntity" },
 *       { kind: "SendMessage", id: "sendCard1", text: "Fallback text", cardContent: "={...PowerFx...}" }
 *     ]
 *   }
 * @returns {object} Created component info { id, displayName, schemaName }
 */
async function createTopic(gatewayUrl, envId, botId, headers, topicDef) {
    // Step 1: Read components to get changeToken
    const components = await readComponents(gatewayUrl, envId, botId, headers);
    const changeToken = components.changeToken;

    // Step 2: Build ObjectModel actions from simplified definitions
    const omActions = topicDef.actions.map(a => {
        if (a.kind === 'SendActivity') {
            return {
                $kind: "SendActivity",
                id: a.id,
                activity: buildTextMessage(a.text)
            };
        }
        if (a.kind === 'Question') {
            return {
                $kind: "Question",
                id: a.id,
                variable: a.variable,
                prompt: buildTextMessage(a.prompt),
                entity: { $kind: a.entity || "StringPrebuiltEntity" }
            };
        }
        if (a.kind === 'SendMessage') {
            // SendMessage with adaptive card attachment
            const msg = { $kind: "SendActivity", id: a.id, activity: buildTextMessage(a.text || '') };
            // Note: for adaptive cards, the caller should update the data field
            // with YAML after creation (Gateway API JSON doesn't easily express PowerFx cards)
            return msg;
        }
        // Fallback — pass through as-is (caller provides full ObjectModel JSON)
        return a;
    });

    // Step 3: Build the DialogComponent
    const component = {
        $kind: "DialogComponent",
        id: "00000000-0000-0000-0000-000000000000",
        schemaName: topicDef.schemaName,
        displayName: topicDef.displayName,
        description: topicDef.description || '',
        dialog: {
            $kind: "AdaptiveDialog",
            beginDialog: {
                $kind: "OnRecognizedIntent",
                id: "main",
                intent: {
                    $kind: "Intent",
                    displayName: { $kind: "StringExpression", literalValue: topicDef.displayName },
                    triggerQueries: topicDef.triggerQueries || []
                },
                actions: omActions
            }
        }
    };

    // Step 4: PUT with BotComponentInsert
    const changeSet = {
        botComponentChanges: [{ $kind: "BotComponentInsert", component }],
        cloudFlowDefinitionChanges: [],
        connectorDefinitionChanges: [],
        environmentVariableChanges: [],
        connectionReferenceChanges: [],
        aIPluginOperationChanges: [],
        componentCollectionChanges: [],
        dataverseTableSearchChanges: [],
        connectedAgentDefinitionChanges: [],
        changeToken
    };

    const result = await writeComponents(gatewayUrl, envId, botId, headers, changeSet);
    const inserts = (result.botComponentChanges || []).filter(c => c.$kind === 'BotComponentInsert');

    if (inserts.length > 0) {
        const created = inserts[0].component;
        return { id: created.id, displayName: created.displayName, schemaName: created.schemaName };
    }

    throw new Error('BotComponentInsert returned no created component');
}

// --- Module Exports (for programmatic use) ---
module.exports = {
    buildHeaders,
    loadGatewayFromConfig,
    // BAP API
    listEnvironments,
    getEnvironment,
    // Discovery
    getRoutingInfo,
    getModelSettings,
    getBotSettings,
    getPublishStatus,
    checkDlp,
    listTopics,
    // Component CRUD
    readComponents,
    writeComponents,
    findGptComponent,
    setModel,
    getInstructions,
    setInstructions,
    // Eval
    createEvalSet,
    runEval,
    // Topics
    createTopic,
    buildTextMessage
};

// Run CLI if invoked directly
if (require.main === module) {
    main().catch(err => {
        console.error('Fatal:', err.message);
        process.exit(2);
    });
}
