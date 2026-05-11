/**
 * Headless Tool Addition for MCS Agents
 *
 * Adds connector actions and MCP servers to agents without Playwright.
 * Uses Island Gateway API for connector discovery and LSP push for adding.
 *
 * Auth: az account get-access-token (PVA app + Dataverse tokens)
 *
 * Usage:
 *   node tools/add-tool.js list-connectors --env <envId> --bot <botId> --gateway <url>
 *   node tools/add-tool.js list-operations --env <envId> --connector shared_todo
 *   node tools/add-tool.js list-connections --env <envId> --connector shared_todo
 *   node tools/add-tool.js add --workspace <path> --connector shared_todo --action ListToDosByFolderV2 --connection <connRef>
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { httpRequest, getToken } = require('./lib/http');
const { buildHeaders, readComponents } = require('./island-client');

// --- Power Platform Connectivity API Helpers ---

/**
 * Get connector operations (actions/triggers) from the Power Platform Connectivity API.
 * Uses the environment-specific endpoint, not Island Gateway.
 *
 * @param {string} envId - Environment ID
 * @param {string} connectorId - Connector ID (e.g. shared_todo, shared_planner)
 * @returns {{ actions: Array, triggers: Array, raw: object }}
 */
async function listOperations(envId, connectorId) {
    const token = getToken('https://service.powerapps.com/');
    const baseUrl = `https://${envId}.environment.api.powerplatform.com`;
    const url = `${baseUrl}/connectivity/connectors/${connectorId}?$filter=environment+eq+'${envId}'&api-version=1`;
    const res = await httpRequest('GET', url, {
        'Authorization': `Bearer ${token}`
    });
    if (res.status !== 200) {
        throw new Error(`listOperations failed: HTTP ${res.status} — ${JSON.stringify(res.data).substring(0, 300)}`);
    }

    const props = res.data.properties || res.data;
    const actions = [];
    const triggers = [];

    // Operations are in the embedded swagger definition under paths
    const paths = props.swagger?.paths || {};
    for (const [pathStr, methods] of Object.entries(paths)) {
        for (const [method, op] of Object.entries(methods)) {
            if (typeof op !== 'object' || method.startsWith('x-')) continue;
            const entry = {
                operationId: op.operationId || `${method}_${pathStr}`,
                displayName: op.summary || op.operationId || pathStr,
                description: op.description || '',
                method: method.toUpperCase(),
                path: pathStr
            };
            if (op['x-ms-trigger']) {
                triggers.push(entry);
            } else {
                actions.push(entry);
            }
        }
    }
    return { actions, triggers, raw: res.data };
}

/**
 * List existing connections for a connector in the environment.
 * Returns connection references the user already has — needed for --connection param.
 *
 * @param {string} envId - Environment ID
 * @param {string} connectorId - Connector ID (e.g. shared_todo, shared_planner)
 * @returns {object} Connection list from the API
 */
async function listConnections(envId, connectorId) {
    const token = getToken('https://service.powerapps.com/');
    const baseUrl = `https://${envId}.environment.api.powerplatform.com`;
    const url = `${baseUrl}/connectivity/connectors/${connectorId}/connections?$expand=&api-version=1`;
    const res = await httpRequest('GET', url, {
        'Authorization': `Bearer ${token}`
    });
    if (res.status !== 200) {
        throw new Error(`listConnections failed: HTTP ${res.status} — ${JSON.stringify(res.data).substring(0, 300)}`);
    }
    return res.data;
}

// --- Island Gateway Helpers (imported from island-client.js) ---

/**
 * List connectors available in the environment via Island Gateway.
 */
async function listConnectors(gatewayUrl, envId, headers) {
    const url = `${gatewayUrl}/api/botmanagement/v1/environments/${envId}/connectors`;
    const res = await httpRequest('POST', url, headers, {});
    if (res.status !== 200) {
        throw new Error(`listConnectors failed: HTTP ${res.status} — ${JSON.stringify(res.data).substring(0, 300)}`);
    }
    return res.data;
}

// --- Tool Addition via LSP Workspace ---

/**
 * Add a connector action to an agent by creating the YAML file and pushing via LSP.
 *
 * @param {string} workspacePath - Path to cloned workspace (the agent subfolder with .mcs/)
 * @param {object} actionDef - { connectorId, operationId, displayName, description, connectionRef, kind }
 */
function createActionYaml(workspacePath, actionDef) {
    const actionsDir = path.join(workspacePath, 'actions');
    fs.mkdirSync(actionsDir, { recursive: true });

    // Clean filename: only alphanumeric, underscores, hyphens
    const safeName = `${actionDef.connectorId}_${actionDef.operationId}`.replace(/[^a-zA-Z0-9_]/g, '');
    const fileName = `${safeName}.mcs.yml`;
    const filePath = path.join(actionsDir, fileName);

    let yaml;
    if (actionDef.kind === 'mcp') {
        yaml = `# Name: ${actionDef.displayName}
kind: TaskDialog
modelDisplayName: ${actionDef.displayName}
modelDescription: "${(actionDef.description || '').replace(/"/g, '\\"')}"
action:
  kind: InvokeExternalAgentTaskAction
  connectionReference: ${actionDef.connectionRef}
  connectionProperties:
    mode: Invoker

  operationDetails:
    kind: ModelContextProtocolMetadata
    operationId: ${actionDef.operationId}
`;
    } else {
        yaml = `# Name: ${actionDef.displayName}
kind: TaskDialog
modelDisplayName: ${actionDef.displayName}
modelDescription: "${(actionDef.description || '').replace(/"/g, '\\"')}"
outputs:
  - propertyName: value

action:
  kind: InvokeConnectorTaskAction
  connectionReference: ${actionDef.connectionRef}
  connectionProperties:
    mode: Invoker

  operationId: ${actionDef.operationId}

outputMode: All
`;
    }

    fs.writeFileSync(filePath, yaml, 'utf8');
    console.error(`[add-tool] Created action file: ${fileName}`);
    return filePath;
}

/**
 * Update connectionreferences.mcs.yml to include a connection reference if not already present.
 */
function ensureConnectionReference(workspacePath, connectorId, connectionRef) {
    const connRefPath = path.join(workspacePath, 'connectionreferences.mcs.yml');
    let content = '';
    if (fs.existsSync(connRefPath)) {
        content = fs.readFileSync(connRefPath, 'utf8');
    }

    // Check if this connection reference is already listed
    if (content.includes(connectionRef)) {
        console.error(`[add-tool] Connection reference already in connectionreferences.mcs.yml`);
        return;
    }

    // Append the new connection reference
    const entry = `  - connectionReferenceLogicalName: ${connectionRef}
    connectorId: /providers/Microsoft.PowerApps/apis/${connectorId}
`;

    if (!content.includes('connectionReferences:')) {
        content = `connectionReferences:\n${entry}`;
    } else {
        content = content.trimEnd() + '\n' + entry;
    }

    fs.writeFileSync(connRefPath, content, 'utf8');
    console.error(`[add-tool] Updated connectionreferences.mcs.yml`);
}

// --- CLI ---

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {};
    if (args.length === 0 || args[0] === '--help') { printUsage(); process.exit(0); }
    config.command = args[0];
    for (let i = 1; i < args.length; i++) {
        switch (args[i]) {
            case '--env': config.envId = args[++i]; break;
            case '--bot': config.botId = args[++i]; break;
            case '--gateway': config.gatewayUrl = args[++i]; break;
            case '--workspace': config.workspace = args[++i]; break;
            case '--connector': config.connectorId = args[++i]; break;
            case '--action': config.operationId = args[++i]; break;
            case '--connection': config.connectionRef = args[++i]; break;
            case '--name': config.displayName = args[++i]; break;
            case '--description': config.description = args[++i]; break;
            case '--kind': config.kind = args[++i]; break;
            case '--dataverse-url': config.dataverseUrl = args[++i]; break;
            case '--json': config.json = true; break;
        }
    }
    return config;
}

function printUsage() {
    console.log(`Headless Tool Addition for MCS Agents

Usage: node add-tool.js <command> [options]

Commands:
  list-tools            List existing tools on an agent (via Island API component read)
  list-connectors       List connectors in the environment (via Island API)
  list-operations       List operations (actions/triggers) for a connector (via Connectivity API)
  list-connections      List existing connections for a connector (via Connectivity API)
  discover-connections  Discover connection references via Dataverse query (works when Connectivity API is unreachable)
  add                   Add a connector action to an agent (via workspace YAML + LSP push)

list-tools / list-connectors options:
  --env <envId>       Environment ID
  --bot <botId>       Agent/bot CDS ID (for list-tools)
  --gateway <url>     Island gateway URL

list-operations / list-connections options:
  --env <envId>       Environment ID
  --connector <id>    Connector ID (e.g., shared_todo, shared_planner)

add options:
  --workspace <path>  Path to cloned agent workspace (with .mcs/ directory)
  --connector <id>    Connector ID (e.g., shared_todo, shared_planner)
  --action <id>       Operation ID (e.g., ListMyTasks_V2, ListToDosByFolderV2)
  --connection <ref>  Connection reference logical name (from connectionreferences.mcs.yml)
  --name <name>       Display name for the tool
  --description <desc> Description
  --kind <type>       "connector" (default) or "mcp"
  --json              Output raw JSON

Examples:
  # Discover operations for a connector
  node tools/add-tool.js list-operations --env f9a0cae4-... --connector shared_todo

  # List existing connections for a connector
  node tools/add-tool.js list-connections --env f9a0cae4-... --connector shared_todo

  # List existing tools on an agent
  node tools/add-tool.js list-tools --env f9a0cae4-... --bot 2ae13d0e-... --gateway https://powervamg.us-il301...

  # Add a connector action (reuses existing connection)
  node tools/add-tool.js add --workspace "./Clone/Agent Name" \\
    --connector shared_todo --action ListToDosByFolderV2 \\
    --connection "auto_agent_3aiWd.shared_todo.5075650bc3ec433ba1144a3d6563a05d" \\
    --name "List to-dos by folder (V2)" --description "Retrieve all to-dos from a specific list"

  # Full headless flow: discover → pick → add → push
  #   list-connectors → list-operations → list-connections → add → mcs-lsp.js push

  # Then push: node tools/mcs-lsp.js push --workspace "./Clone/Agent Name"`);
}

async function main() {
    const config = parseArgs();

    try {
        switch (config.command) {
            case 'list-tools': {
                if (!config.envId || !config.botId || !config.gatewayUrl) {
                    console.error('Error: --env, --bot, and --gateway required');
                    process.exit(2);
                }
                const token = getToken('96ff4394-9197-43aa-b393-6a41652e21f8');
                const tenantId = execSync('az account show --query tenantId -o tsv',
                    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
                const headers = buildHeaders(token, tenantId, config.envId, config.botId);
                const gw = config.gatewayUrl.replace(/\/$/, '');

                const result = await readComponents(gw, config.envId, config.botId, headers);
                const components = result.botComponentChanges || [];
                const actions = components.filter(c => {
                    const comp = c.component;
                    return comp && (comp['$kind'] === 'SkillComponent' || comp['$kind'] === 'DialogComponent') &&
                        comp.dialog?.beginDialog?.['$kind'] === 'OnInvokeAction';
                });
                // Also find TaskDialog-style actions in the GptComponent metadata
                const gpt = components.find(c => c.component?.['$kind'] === 'GptComponent');
                const tools = gpt?.component?.metadata?.tools || [];

                if (config.json) {
                    console.log(JSON.stringify({ actions: actions.length, tools, components: components.length }, null, 2));
                } else {
                    console.log(`Agent tools (${tools.length} from GptComponent):\n`);
                    for (const tool of tools) {
                        console.log(`  ${tool.displayName || tool.schemaName || 'unnamed'}`);
                        if (tool.description) console.log(`    ${tool.description.substring(0, 80)}`);
                    }
                    console.log(`\nTotal components: ${components.length}`);
                }
                break;
            }

            case 'list-connectors': {
                if (!config.envId || !config.gatewayUrl) {
                    console.error('Error: --env and --gateway required');
                    process.exit(2);
                }
                const token = getToken('96ff4394-9197-43aa-b393-6a41652e21f8');
                const tenantId = execSync('az account show --query tenantId -o tsv',
                    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
                const headers = buildHeaders(token, tenantId, config.envId);
                const gw = config.gatewayUrl.replace(/\/$/, '');

                const result = await listConnectors(gw, config.envId, headers);
                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    const connectors = Array.isArray(result) ? result : (result.value || []);
                    console.log(`Connectors (${connectors.length}):\n`);
                    for (const c of connectors) {
                        const name = c.displayName || c.name || c.id;
                        console.log(`  ${name}`);
                    }
                }
                break;
            }

            case 'list-operations': {
                if (!config.envId || !config.connectorId) {
                    console.error('Error: --env and --connector required');
                    process.exit(2);
                }
                const ops = await listOperations(config.envId, config.connectorId);
                if (config.json) {
                    console.log(JSON.stringify(ops, null, 2));
                } else {
                    console.log(`Connector: ${config.connectorId}\n`);
                    if (ops.actions.length > 0) {
                        console.log(`Actions (${ops.actions.length}):`);
                        for (const a of ops.actions) {
                            console.log(`  ${a.operationId}`);
                            console.log(`    ${a.displayName}  [${a.method}]`);
                            if (a.description) console.log(`    ${a.description.substring(0, 100)}`);
                        }
                    }
                    if (ops.triggers.length > 0) {
                        console.log(`\nTriggers (${ops.triggers.length}):`);
                        for (const t of ops.triggers) {
                            console.log(`  ${t.operationId}`);
                            console.log(`    ${t.displayName}  [${t.method}]`);
                            if (t.description) console.log(`    ${t.description.substring(0, 100)}`);
                        }
                    }
                    if (ops.actions.length === 0 && ops.triggers.length === 0) {
                        console.log('  No operations found in embedded swagger.');
                        console.log('  Use --json to inspect the raw connector metadata.');
                    }
                }
                break;
            }

            case 'list-connections': {
                if (!config.envId || !config.connectorId) {
                    console.error('Error: --env and --connector required');
                    process.exit(2);
                }
                const conns = await listConnections(config.envId, config.connectorId);
                const connList = Array.isArray(conns) ? conns : (conns.value || []);
                if (config.json) {
                    console.log(JSON.stringify(conns, null, 2));
                } else {
                    console.log(`Connections for ${config.connectorId} (${connList.length}):\n`);
                    for (const c of connList) {
                        const name = c.name || c.id || 'unnamed';
                        const status = c.properties?.statuses?.[0]?.status || c.properties?.connectionParameters?.status || 'unknown';
                        const displayName = c.properties?.displayName || '';
                        console.log(`  ${name}`);
                        if (displayName) console.log(`    Display: ${displayName}`);
                        console.log(`    Status: ${status}`);
                    }
                    if (connList.length === 0) {
                        console.log('  No connections found. Create one in the MCS UI or Power Automate first.');
                    }
                }
                break;
            }

            case 'add': {
                if (!config.workspace || !config.connectorId || !config.operationId || !config.connectionRef) {
                    console.error('Error: --workspace, --connector, --action, and --connection required');
                    process.exit(2);
                }
                const ws = path.resolve(config.workspace);
                if (!fs.existsSync(path.join(ws, '.mcs', 'conn.json'))) {
                    console.error('Error: Not a valid workspace (missing .mcs/conn.json). Clone first.');
                    process.exit(2);
                }

                const actionDef = {
                    connectorId: config.connectorId,
                    operationId: config.operationId,
                    displayName: config.displayName || `${config.connectorId} - ${config.operationId}`,
                    description: config.description || '',
                    connectionRef: config.connectionRef,
                    kind: config.kind || 'connector'
                };

                // Create action YAML
                const actionPath = createActionYaml(ws, actionDef);

                // Ensure connection reference exists
                ensureConnectionReference(ws, config.connectorId, config.connectionRef);

                console.log(`Action file created: ${path.basename(actionPath)}`);
                console.log(`\nNow push to MCS:`);
                console.log(`  node tools/mcs-lsp.js push --workspace "${ws}"`);
                break;
            }

            case 'discover-connections': {
                // Query Dataverse connectionreference entity directly — bypasses broken Connectivity API
                // Works on any tenant, including Microsoft internal tenants where {envId}.environment.api.powerplatform.com doesn't resolve
                if (!config.dataverseUrl && !config.workspace) {
                    console.error('Error: --dataverse-url or --workspace required');
                    process.exit(2);
                }
                let dvUrl = config.dataverseUrl;
                if (!dvUrl && config.workspace) {
                    const connJson = JSON.parse(fs.readFileSync(path.join(path.resolve(config.workspace), '.mcs', 'conn.json'), 'utf8'));
                    dvUrl = connJson.DataverseEndpoint.replace(/\/$/, '');
                }
                const dvToken = getToken(dvUrl);
                const fetchXml = '<fetch><entity name="connectionreference">' +
                    '<attribute name="connectionreferenceid"/>' +
                    '<attribute name="connectionreferencedisplayname"/>' +
                    '<attribute name="connectionreferencelogicalname"/>' +
                    '<attribute name="connectorid"/>' +
                    '</entity></fetch>';
                const crRes = await httpRequest('GET',
                    `${dvUrl}/api/data/v9.2/connectionreferences?fetchXml=${encodeURIComponent(fetchXml)}`,
                    { 'Authorization': `Bearer ${dvToken}` }, null);
                if (crRes.status !== 200) {
                    console.error(`Dataverse query failed: HTTP ${crRes.status}`);
                    process.exit(1);
                }
                const refs = crRes.data.value || [];
                // Group by connectorId
                const byConnector = {};
                for (const r of refs) {
                    const cid = r.connectorid || 'unknown';
                    const shortId = cid.split('/').pop();
                    if (!byConnector[shortId]) byConnector[shortId] = [];
                    byConnector[shortId].push({
                        logicalName: r.connectionreferencelogicalname,
                        displayName: r.connectionreferencedisplayname,
                        id: r.connectionreferenceid
                    });
                }
                console.log(`Connection References in Environment (${refs.length} total):\n`);
                // Filter by connector if specified
                const filterConnector = config.connectorId;
                for (const [connector, crs] of Object.entries(byConnector).sort()) {
                    if (filterConnector && !connector.includes(filterConnector)) continue;
                    console.log(`  ${connector} (${crs.length}):`);
                    for (const cr of crs) {
                        console.log(`    logicalName: ${cr.logicalName}`);
                        if (cr.displayName && cr.displayName !== cr.logicalName)
                            console.log(`    displayName: ${cr.displayName}`);
                    }
                    console.log();
                }
                if (refs.length === 0) {
                    console.log('  No connection references found. Add a tool to any agent in this environment first (one-time manual setup).');
                }
                if (filterConnector) {
                    const matches = Object.entries(byConnector).filter(([k]) => k.includes(filterConnector));
                    if (matches.length === 0) {
                        console.log(`  No connections matching "${filterConnector}". Available connectors: ${Object.keys(byConnector).join(', ')}`);
                    }
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

module.exports = { createActionYaml, ensureConnectionReference, listOperations, listConnections };

if (require.main === module) {
    main().catch(err => { console.error('Fatal:', err.message); process.exit(2); });
}
