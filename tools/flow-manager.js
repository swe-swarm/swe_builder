/**
 * Power Automate Flow Manager — CRUD for Cloud Flows via Dataverse Web API
 *
 * Manages Power Automate cloud flows (category=5) stored as `workflow` records
 * in Dataverse. Primary use case: configuring event triggers (recurrence,
 * SharePoint, email, etc.) for MCS autonomous agents without Playwright.
 *
 * Auth: az account get-access-token --resource https://<org>.crm.dynamics.com
 *
 * Usage:
 *   node tools/flow-manager.js list --org https://orgXXX.crm.dynamics.com
 *   node tools/flow-manager.js get --org https://orgXXX.crm.dynamics.com --flow <id>
 *   node tools/flow-manager.js create-trigger --org https://orgXXX.crm.dynamics.com --bot <id> --preset weekdays-7am-pst --message "Generate daily briefing"
 *   node tools/flow-manager.js create-trigger --org https://orgXXX.crm.dynamics.com --bot <id> --schedule '{"frequency":"Week","interval":1}' --message "Check updates"
 *   node tools/flow-manager.js update-schedule --org https://orgXXX.crm.dynamics.com --flow <id> --schedule '{"frequency":"Minute","interval":10}'
 *   node tools/flow-manager.js update-message --org https://orgXXX.crm.dynamics.com --flow <id> --message "New payload"
 *   node tools/flow-manager.js activate --org https://orgXXX.crm.dynamics.com --flow <id>
 *   node tools/flow-manager.js deactivate --org https://orgXXX.crm.dynamics.com --flow <id>
 *   node tools/flow-manager.js delete --org https://orgXXX.crm.dynamics.com --flow <id>
 *   node tools/flow-manager.js discover --org https://orgXXX.crm.dynamics.com --bot <id>
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { httpRequest, httpRequestWithRetry, getToken } = require('./lib/http');
const composer = require('./lib/flow-composer');
const connectorSchema = require('./lib/connector-schema');

// --- Constants ---

const API_VERSION = 'v9.2';

/** Schedule presets for common recurrence patterns */
const PRESETS = {
    'weekdays-7am-pst': {
        frequency: 'Week',
        interval: 1,
        timeZone: 'Pacific Standard Time',
        schedule: {
            weekDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            hours: ['7'],
            minutes: [0]
        }
    },
    'weekdays-8am-est': {
        frequency: 'Week',
        interval: 1,
        timeZone: 'Eastern Standard Time',
        schedule: {
            weekDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            hours: ['8'],
            minutes: [0]
        }
    },
    'weekdays-9am-utc': {
        frequency: 'Week',
        interval: 1,
        timeZone: 'UTC',
        schedule: {
            weekDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            hours: ['9'],
            minutes: [0]
        }
    },
    'daily-9am-utc': {
        frequency: 'Day',
        interval: 1,
        timeZone: 'UTC',
        schedule: {
            hours: ['9'],
            minutes: [0]
        }
    },
    'daily-8am-pst': {
        frequency: 'Day',
        interval: 1,
        timeZone: 'Pacific Standard Time',
        schedule: {
            hours: ['8'],
            minutes: [0]
        }
    },
    'every-10-min': {
        frequency: 'Minute',
        interval: 10
    },
    'every-30-min': {
        frequency: 'Minute',
        interval: 30
    },
    'hourly': {
        frequency: 'Hour',
        interval: 1
    }
};

// --- Helpers ---

function buildApiUrl(orgUrl, entity, id, query) {
    const base = orgUrl.replace(/\/$/, '');
    let url = `${base}/api/data/${API_VERSION}/${entity}`;
    if (id) url += `(${id})`;
    if (query) url += `?${query}`;
    return url;
}

function buildHeaders(token) {
    return {
        'Authorization': `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'Prefer': 'return=representation'
    };
}

/**
 * Build the clientdata JSON for a recurrence trigger flow that calls an MCS agent.
 *
 * @param {object} schedule - Recurrence schedule (frequency, interval, timeZone, schedule)
 * @param {string} copilotParam - Copilot parameter value (e.g. "copilots_header_8b375")
 * @param {string} connRefLogicalName - Connection reference logical name
 * @param {string} message - Payload message text
 * @returns {string} Serialized clientdata JSON
 */
function buildRecurrenceClientdata(schedule, copilotParam, connRefLogicalName, message) {
    const recurrence = {
        type: 'Recurrence',
        recurrence: {
            frequency: schedule.frequency,
            interval: schedule.interval
        },
        metadata: {
            operationMetadataId: crypto.randomUUID()
        }
    };

    if (schedule.timeZone) {
        recurrence.recurrence.timeZone = schedule.timeZone;
    }
    if (schedule.schedule) {
        recurrence.recurrence.schedule = schedule.schedule;
    }
    if (schedule.startTime) {
        recurrence.recurrence.startTime = schedule.startTime;
    }

    const clientdata = {
        properties: {
            connectionReferences: {
                shared_microsoftcopilotstudio: {
                    runtimeSource: 'embedded',
                    connection: {
                        connectionReferenceLogicalName: connRefLogicalName
                    },
                    api: {
                        name: 'shared_microsoftcopilotstudio'
                    }
                }
            },
            definition: {
                '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
                contentVersion: '1.0.0.0',
                parameters: {
                    '$connections': { defaultValue: {}, type: 'Object' },
                    '$authentication': { defaultValue: {}, type: 'SecureObject' }
                },
                triggers: {
                    Recurrence: recurrence
                },
                actions: {
                    Sends_a_prompt_to_the_specified_copilot_for_processing: {
                        runAfter: {},
                        type: 'OpenApiConnection',
                        inputs: {
                            host: {
                                connectionName: 'shared_microsoftcopilotstudio',
                                operationId: 'ExecuteCopilot',
                                apiId: '/providers/Microsoft.PowerApps/apis/shared_microsoftcopilotstudio'
                            },
                            parameters: {
                                Copilot: copilotParam,
                                'body/message': message
                            },
                            authentication: "@parameters('$authentication')"
                        },
                        metadata: {
                            operationMetadataId: crypto.randomUUID()
                        }
                    }
                }
            },
            templateName: ''
        },
        schemaVersion: '1.0.0.0'
    };

    return JSON.stringify(clientdata);
}

// --- Dataverse CRUD Operations ---

/**
 * List cloud flows (category=5) in the environment.
 *
 * @param {string} orgUrl - Dataverse org URL (e.g. https://orgXXX.crm.dynamics.com)
 * @param {string} token - Access token
 * @param {object} [options] - { top, filter, select }
 * @returns {Promise<Array>} Array of workflow records
 */
async function listFlows(orgUrl, token, options = {}) {
    const top = options.top || 50;
    const select = options.select || 'name,workflowid,statecode,description,createdon,modifiedon';
    let filter = 'category eq 5';
    if (options.filter) {
        filter += ` and ${options.filter}`;
    }
    const query = `$filter=${encodeURIComponent(filter)}&$select=${select}&$top=${top}&$orderby=modifiedon desc`;
    const url = buildApiUrl(orgUrl, 'workflows', null, query);
    const headers = buildHeaders(token);

    const res = await httpRequestWithRetry('GET', url, headers);
    if (res.status !== 200) {
        throw new Error(`listFlows failed: HTTP ${res.status} — ${JSON.stringify(res.data).substring(0, 500)}`);
    }
    return res.data.value || [];
}

/**
 * Get a single flow definition with parsed clientdata.
 *
 * @param {string} orgUrl
 * @param {string} token
 * @param {string} flowId - Workflow GUID
 * @returns {Promise<{record: object, definition: object|null}>}
 */
async function getFlow(orgUrl, token, flowId) {
    const url = buildApiUrl(orgUrl, 'workflows', flowId, '$select=name,workflowid,statecode,category,clientdata,description,createdon,modifiedon');
    const headers = buildHeaders(token);

    const res = await httpRequestWithRetry('GET', url, headers);
    if (res.status !== 200) {
        throw new Error(`getFlow failed: HTTP ${res.status} — ${JSON.stringify(res.data).substring(0, 500)}`);
    }

    let definition = null;
    if (res.data.clientdata) {
        try {
            definition = JSON.parse(res.data.clientdata);
        } catch {
            // clientdata may not be valid JSON in all cases
        }
    }
    return { record: res.data, definition };
}

/**
 * Create a recurrence trigger flow for an MCS agent.
 *
 * @param {string} orgUrl
 * @param {string} token
 * @param {object} params - { name, schedule, copilotParam, connRefLogicalName, message, description }
 * @returns {Promise<object>} Created workflow record
 */
async function createTriggerFlow(orgUrl, token, params) {
    const { name, schedule, copilotParam, connRefLogicalName, message, description } = params;
    const clientdata = buildRecurrenceClientdata(schedule, copilotParam, connRefLogicalName, message);

    const body = {
        category: 5,
        name: name || `Trigger - ${schedule.frequency} - ${new Date().toISOString().split('T')[0]}`,
        type: 1,
        primaryentity: 'none',
        description: description || `Recurrence trigger for MCS agent (${schedule.frequency} every ${schedule.interval})`,
        clientdata: clientdata
    };

    const url = buildApiUrl(orgUrl, 'workflows');
    const headers = buildHeaders(token);

    const res = await httpRequestWithRetry('POST', url, headers, body);
    if (res.status !== 200 && res.status !== 201) {
        throw new Error(`createTriggerFlow failed: HTTP ${res.status} — ${JSON.stringify(res.data).substring(0, 500)}`);
    }
    return res.data;
}

/**
 * Update the recurrence schedule on an existing flow.
 *
 * @param {string} orgUrl
 * @param {string} token
 * @param {string} flowId
 * @param {object} schedule - New schedule object
 * @returns {Promise<object>}
 */
async function updateSchedule(orgUrl, token, flowId, schedule) {
    const { record, definition } = await getFlow(orgUrl, token, flowId);
    if (!definition) {
        throw new Error('Flow has no parseable clientdata');
    }

    const triggers = definition.properties?.definition?.triggers;
    if (!triggers?.Recurrence) {
        throw new Error('Flow does not have a Recurrence trigger');
    }

    // Update the recurrence settings
    triggers.Recurrence.recurrence = {
        frequency: schedule.frequency,
        interval: schedule.interval
    };
    if (schedule.timeZone) {
        triggers.Recurrence.recurrence.timeZone = schedule.timeZone;
    }
    if (schedule.schedule) {
        triggers.Recurrence.recurrence.schedule = schedule.schedule;
    }
    if (schedule.startTime) {
        triggers.Recurrence.recurrence.startTime = schedule.startTime;
    }

    const url = buildApiUrl(orgUrl, 'workflows', flowId);
    const headers = { ...buildHeaders(token), 'If-Match': '*' };

    const res = await httpRequestWithRetry('PATCH', url, headers, {
        clientdata: JSON.stringify(definition)
    });
    if (res.status !== 200 && res.status !== 204) {
        throw new Error(`updateSchedule failed: HTTP ${res.status} — ${JSON.stringify(res.data).substring(0, 500)}`);
    }
    return res.data;
}

/**
 * Update the payload message on an existing flow.
 *
 * @param {string} orgUrl
 * @param {string} token
 * @param {string} flowId
 * @param {string} message - New message text
 * @returns {Promise<object>}
 */
async function updateMessage(orgUrl, token, flowId, message) {
    const { record, definition } = await getFlow(orgUrl, token, flowId);
    if (!definition) {
        throw new Error('Flow has no parseable clientdata');
    }

    const actions = definition.properties?.definition?.actions;
    if (!actions) {
        throw new Error('Flow has no actions defined');
    }

    // Find the ExecuteCopilot action — look for any action with operationId: ExecuteCopilot
    let found = false;
    for (const [actionName, action] of Object.entries(actions)) {
        if (action.inputs?.host?.operationId === 'ExecuteCopilot') {
            action.inputs.parameters['body/message'] = message;
            found = true;
            break;
        }
    }

    if (!found) {
        throw new Error('No ExecuteCopilot action found in flow');
    }

    const url = buildApiUrl(orgUrl, 'workflows', flowId);
    const headers = { ...buildHeaders(token), 'If-Match': '*' };

    const res = await httpRequestWithRetry('PATCH', url, headers, {
        clientdata: JSON.stringify(definition)
    });
    if (res.status !== 200 && res.status !== 204) {
        throw new Error(`updateMessage failed: HTTP ${res.status} — ${JSON.stringify(res.data).substring(0, 500)}`);
    }
    return res.data;
}

/**
 * Activate a flow (statecode=1 means activated/on).
 *
 * @param {string} orgUrl
 * @param {string} token
 * @param {string} flowId
 * @returns {Promise<void>}
 */
async function activateFlow(orgUrl, token, flowId) {
    const url = buildApiUrl(orgUrl, 'workflows', flowId);
    const headers = { ...buildHeaders(token), 'If-Match': '*' };

    const res = await httpRequestWithRetry('PATCH', url, headers, { statecode: 1 });
    if (res.status !== 200 && res.status !== 204) {
        throw new Error(`activateFlow failed: HTTP ${res.status} — ${JSON.stringify(res.data).substring(0, 500)}`);
    }
}

/**
 * Deactivate a flow (statecode=0 means draft/off).
 *
 * @param {string} orgUrl
 * @param {string} token
 * @param {string} flowId
 * @returns {Promise<void>}
 */
async function deactivateFlow(orgUrl, token, flowId) {
    const url = buildApiUrl(orgUrl, 'workflows', flowId);
    const headers = { ...buildHeaders(token), 'If-Match': '*' };

    const res = await httpRequestWithRetry('PATCH', url, headers, { statecode: 0 });
    if (res.status !== 200 && res.status !== 204) {
        throw new Error(`deactivateFlow failed: HTTP ${res.status} — ${JSON.stringify(res.data).substring(0, 500)}`);
    }
}

/**
 * Delete a flow.
 *
 * @param {string} orgUrl
 * @param {string} token
 * @param {string} flowId
 * @returns {Promise<void>}
 */
async function deleteFlow(orgUrl, token, flowId) {
    const url = buildApiUrl(orgUrl, 'workflows', flowId);
    const headers = buildHeaders(token);

    const res = await httpRequestWithRetry('DELETE', url, headers);
    if (res.status !== 204) {
        throw new Error(`deleteFlow failed: HTTP ${res.status} — ${JSON.stringify(res.data).substring(0, 500)}`);
    }
}

// --- Discovery ---

/**
 * Discover the MCS connector connection reference in the environment.
 * Queries connectionreferences filtered by connectorid containing 'microsoftcopilotstudio'.
 *
 * @param {string} orgUrl
 * @param {string} token
 * @returns {Promise<Array>} Array of matching connection references
 */
async function discoverConnectionRef(orgUrl, token) {
    const filter = "contains(connectorid,'microsoftcopilotstudio')";
    const select = 'connectionreferencelogicalname,connectorid,connectionid,connectionreferencedisplayname';
    const url = buildApiUrl(orgUrl, 'connectionreferences', null, `$filter=${encodeURIComponent(filter)}&$select=${select}`);
    const headers = buildHeaders(token);

    const res = await httpRequestWithRetry('GET', url, headers);
    if (res.status !== 200) {
        throw new Error(`discoverConnectionRef failed: HTTP ${res.status} — ${JSON.stringify(res.data).substring(0, 500)}`);
    }
    return res.data.value || [];
}

/**
 * Discover the Copilot parameter value from existing trigger flows for a bot.
 * Searches cloud flows for ExecuteCopilot actions, extracts the Copilot parameter.
 *
 * @param {string} orgUrl
 * @param {string} token
 * @param {string} botId - Bot/agent CDS ID
 * @returns {Promise<{copilotParam: string|null, flowId: string|null, flowName: string|null}>}
 */
async function discoverCopilotParam(orgUrl, token, botId) {
    // Get all cloud flows and search their clientdata for the bot reference
    const flows = await listFlows(orgUrl, token, {
        select: 'name,workflowid,clientdata',
        top: 100
    });

    for (const flow of flows) {
        if (!flow.clientdata) continue;
        try {
            const def = JSON.parse(flow.clientdata);
            const actions = def.properties?.definition?.actions;
            if (!actions) continue;

            for (const [actionName, action] of Object.entries(actions)) {
                if (action.inputs?.host?.operationId === 'ExecuteCopilot') {
                    const copilotParam = action.inputs.parameters?.Copilot;
                    if (copilotParam) {
                        return {
                            copilotParam,
                            flowId: flow.workflowid,
                            flowName: flow.name
                        };
                    }
                }
            }
        } catch {
            // Skip flows with unparseable clientdata
        }
    }

    // Fallback: try to derive from bot schema name
    // The copilot param pattern is typically "copilots_header_XXXXX" derived from the bot
    return { copilotParam: null, flowId: null, flowName: null };
}

/**
 * Full discovery — find both connection reference and copilot param.
 *
 * @param {string} orgUrl
 * @param {string} token
 * @param {string} botId
 * @returns {Promise<{connRef: string|null, copilotParam: string|null, details: object}>}
 */
async function discover(orgUrl, token, botId) {
    const [connRefs, copilotInfo] = await Promise.all([
        discoverConnectionRef(orgUrl, token),
        discoverCopilotParam(orgUrl, token, botId)
    ]);

    return {
        connRef: connRefs.length > 0 ? connRefs[0].connectionreferencelogicalname : null,
        copilotParam: copilotInfo.copilotParam,
        details: {
            connectionReferences: connRefs,
            copilotParam: copilotInfo.copilotParam,
            fromFlow: copilotInfo.flowName,
            fromFlowId: copilotInfo.flowId
        }
    };
}

// --- Flow Composition & Validation ---

/**
 * Create a flow from a complete definition (clientdata JSON or raw definition).
 *
 * @param {string} orgUrl - Dataverse org URL
 * @param {string} token - Access token
 * @param {object} params - { name, description, clientdata?, definition?, activate? }
 * @returns {Promise<object>} Created workflow record
 */
async function createFlow(orgUrl, token, params) {
    let clientdata;

    if (params.clientdata) {
        // Already-wrapped clientdata (string or object)
        clientdata = typeof params.clientdata === 'string'
            ? params.clientdata
            : JSON.stringify(params.clientdata);
    } else if (params.definition) {
        // Raw definition — wrap in clientdata envelope
        const properties = params.definition.properties
            ? params.definition
            : { properties: params.definition, schemaVersion: '1.0.0.0' };
        clientdata = JSON.stringify(properties);
    } else {
        throw new Error('Either clientdata or definition is required');
    }

    const body = {
        category: 5,
        name: params.name || `Flow - ${new Date().toISOString().split('T')[0]}`,
        type: 1,
        primaryentity: 'none',
        modernflowtype: params.modernflowtype !== undefined ? params.modernflowtype : 1,
        description: params.description || '',
        clientdata: clientdata
    };

    const url = buildApiUrl(orgUrl, 'workflows');
    const headers = buildHeaders(token);

    const res = await httpRequestWithRetry('POST', url, headers, body);
    if (res.status !== 200 && res.status !== 201) {
        throw new Error(`createFlow failed: HTTP ${res.status} — ${JSON.stringify(res.data).substring(0, 500)}`);
    }

    // Activate if requested
    if (params.activate && res.data.workflowid) {
        await activateFlow(orgUrl, token, res.data.workflowid);
    }

    return res.data;
}

/**
 * Validate a flow definition (local + optional remote).
 *
 * @param {object} definition - Parsed clientdata or definition JSON
 * @param {string} [orgUrl] - If provided, also runs remote validation
 * @param {string} [token] - Required if orgUrl provided
 * @returns {Promise<{local: object, remote?: object}>}
 */
async function validateFlow(definition, orgUrl, token) {
    const local = composer.validateDefinition(definition);
    const result = { local };

    if (orgUrl && token) {
        // Remote validation via Power Platform API (best-effort)
        try {
            // Derive environment URL from org URL
            const envUrl = await deriveEnvironmentUrl(orgUrl, token);
            if (envUrl) {
                const [errRes, warnRes] = await Promise.all([
                    httpRequest('POST', `${envUrl}/powerautomate/flows/new/checkFlowErrors?api-version=1`,
                        { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        definition),
                    httpRequest('POST', `${envUrl}/powerautomate/flows/new/checkFlowWarnings?api-version=1`,
                        { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        definition)
                ]);
                result.remote = {
                    errors: errRes.status === 200 ? errRes.data : { status: errRes.status, message: 'API unavailable' },
                    warnings: warnRes.status === 200 ? warnRes.data : { status: warnRes.status, message: 'API unavailable' }
                };
            } else {
                result.remote = { errors: { message: 'Could not derive environment URL' }, warnings: {} };
            }
        } catch (err) {
            result.remote = { errors: { message: err.message }, warnings: {} };
        }
    }

    return result;
}

/**
 * Discover connector operations available in the environment.
 *
 * @param {string} orgUrl - Dataverse org URL
 * @param {string} token - Access token
 * @param {string} [connector] - Filter to specific connector
 * @returns {Promise<object>} Operations grouped by connector
 */
async function discoverOperations(orgUrl, token, connector) {
    // Try Power Platform environment API first
    const envUrl = await deriveEnvironmentUrl(orgUrl, token);
    if (envUrl) {
        try {
            const body = connector ? { filter: { connectorName: connector } } : {};
            const res = await httpRequest('POST',
                `${envUrl}/powerautomate/operations?api-version=1&$top=250`,
                { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body);
            if (res.status === 200) {
                return { source: 'powerautomate-api', data: res.data };
            }
        } catch { /* fall through to Dataverse fallback */ }
    }

    // Fallback: inspect existing flows' clientdata for connector/operation patterns
    const flows = await listFlows(orgUrl, token, {
        select: 'name,workflowid,clientdata',
        top: 50
    });

    const operations = {};
    for (const flow of flows) {
        if (!flow.clientdata) continue;
        try {
            const def = JSON.parse(flow.clientdata);
            const actions = def.properties?.definition?.actions || {};
            const triggers = def.properties?.definition?.triggers || {};
            const allNodes = { ...actions, ...triggers };

            for (const [name, node] of Object.entries(allNodes)) {
                const connName = node.inputs?.host?.connectionName;
                const opId = node.inputs?.host?.operationId;
                if (connName && opId) {
                    if (connector && connName !== connector) continue;
                    if (!operations[connName]) operations[connName] = new Set();
                    operations[connName].add(opId);
                }
            }
        } catch { /* skip */ }
    }

    // Convert Sets to arrays
    const result = {};
    for (const [conn, ops] of Object.entries(operations)) {
        result[conn] = [...ops];
    }
    return { source: 'dataverse-fallback', data: result };
}

/**
 * Compose a flow from a high-level spec file.
 *
 * @param {object} spec - High-level flow specification
 * @returns {object} Complete properties object (ready for buildWorkflowRecord or createFlow)
 */
function composeFlowFromSpec(spec) {
    return composer.composeFlow(spec);
}

/**
 * Derive the Power Platform environment URL from a Dataverse org URL.
 * Queries the environment metadata to find the environment ID.
 *
 * @param {string} orgUrl
 * @param {string} token
 * @returns {Promise<string|null>} Environment URL or null
 */
async function deriveEnvironmentUrl(orgUrl, token) {
    try {
        const url = buildApiUrl(orgUrl, 'organizations', null, '$select=environmentid');
        const headers = buildHeaders(token);
        const res = await httpRequest('GET', url, headers);
        if (res.status === 200 && res.data.value?.[0]?.environmentid) {
            const envId = res.data.value[0].environmentid;
            return `https://${envId}.environment.api.powerplatform.com`;
        }
    } catch { /* fall through */ }
    return null;
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
            case '--org': config.orgUrl = args[++i]; break;
            case '--flow': config.flowId = args[++i]; break;
            case '--bot': config.botId = args[++i]; break;
            case '--schedule': config.schedule = args[++i]; break;
            case '--preset': config.preset = args[++i]; break;
            case '--message': config.message = args[++i]; break;
            case '--name': config.name = args[++i]; break;
            case '--description': config.description = args[++i]; break;
            case '--conn-ref': config.connRef = args[++i]; break;
            case '--copilot-param': config.copilotParam = args[++i]; break;
            case '--definition': config.definitionFile = args[++i]; break;
            case '--spec': config.specFile = args[++i]; break;
            case '--output': config.outputFile = args[++i]; break;
            case '--connector': config.connector = args[++i]; break;
            case '--operation': config.operation = args[++i]; break;
            case '--cache': config.cache = true; break;
            case '--cache-all': config.cacheAll = true; break;
            case '--activate': config.activate = true; break;
            case '--json': config.json = true; break;
            case '--help': printUsage(); process.exit(0);
        }
    }

    return config;
}

function printUsage() {
    console.log(`Power Automate Flow Manager — CRUD + Composition via Dataverse Web API

Usage: node flow-manager.js <command> [options]

Commands:
  list                List cloud flows (category=5) in the environment
  get                 Get flow definition (parsed clientdata)
  create-trigger      Create a recurrence trigger flow for an MCS agent
  create-flow         Create a flow from a definition JSON file
  compose             Compose a flow from a high-level spec file
  validate            Validate a flow definition (local + optional remote)
  discover-operations List connector operations in the environment
  schema              Show connector operations and parameter schemas
  update-schedule     Update recurrence schedule on existing flow
  update-message      Update payload message on existing flow
  activate            Turn on a flow (statecode=1)
  deactivate          Turn off a flow (statecode=0)
  delete              Delete a flow
  discover            Find MCS connector connection ref + copilot param

Required:
  --org <url>         Dataverse org URL (e.g. https://orgXXX.crm.dynamics.com)

Command-specific:
  --flow <id>         Flow/workflow GUID (for get, update-*, activate, deactivate, delete)
  --bot <id>          Bot/agent CDS ID (for create-trigger, discover)
  --schedule <json>   Schedule as JSON (for create-trigger, update-schedule)
  --preset <name>     Schedule preset (for create-trigger, update-schedule)
  --message <text>    Payload message (for create-trigger, update-message)
  --name <text>       Flow display name (for create-trigger, create-flow)
  --description <t>   Flow description (for create-trigger, create-flow)
  --conn-ref <name>   Connection reference logical name (auto-discovered if omitted)
  --copilot-param     Copilot parameter value (auto-discovered if omitted)
  --definition <file> Definition JSON file path (for create-flow, validate)
  --spec <file>       Flow spec JSON file path (for compose)
  --output <file>     Output file path (for compose)
  --connector <name>  Filter by connector (for discover-operations, schema)
  --operation <id>    Operation ID for detailed schema (for schema)
  --cache             Cache results (for discover-operations, schema)
  --cache-all         Cache all top-20 connector schemas (for schema)
  --activate          Activate flow after creation (for create-flow)
  --json              Output raw JSON

Schedule presets:
  weekdays-7am-pst, weekdays-8am-est, weekdays-9am-utc,
  daily-9am-utc, daily-8am-pst, every-10-min, every-30-min, hourly

Examples:
  # List all cloud flows
  node tools/flow-manager.js list --org https://orgXXX.crm.dynamics.com

  # Get flow definition
  node tools/flow-manager.js get --org https://orgXXX.crm.dynamics.com --flow <id>

  # Discover connection ref + copilot param
  node tools/flow-manager.js discover --org https://orgXXX.crm.dynamics.com --bot <id>

  # Create trigger with preset
  node tools/flow-manager.js create-trigger --org https://orgXXX.crm.dynamics.com \\
    --bot <id> --preset weekdays-7am-pst --message "Generate daily briefing"

  # Create flow from definition file
  node tools/flow-manager.js create-flow --org https://orgXXX.crm.dynamics.com \\
    --definition flow-def.json --name "My Flow" --activate

  # Compose flow from high-level spec
  node tools/flow-manager.js compose --spec flow-spec.json --output flow-def.json

  # Validate a flow definition (local only)
  node tools/flow-manager.js validate --definition flow-def.json

  # Validate with remote checks
  node tools/flow-manager.js validate --definition flow-def.json --org https://orgXXX.crm.dynamics.com

  # Discover connector operations
  node tools/flow-manager.js discover-operations --org https://orgXXX.crm.dynamics.com
  node tools/flow-manager.js discover-operations --org https://orgXXX.crm.dynamics.com --connector shared_office365

  # Show connector operations (from cache or live)
  node tools/flow-manager.js schema --connector shared_office365

  # Show detailed schema for a specific operation
  node tools/flow-manager.js schema --connector shared_office365 --operation SendEmailV2

  # Fetch live and cache a connector schema
  node tools/flow-manager.js schema --connector shared_office365 --org https://orgXXX.crm.dynamics.com --cache

  # Pre-cache all top-20 connector schemas (one-time setup)
  node tools/flow-manager.js schema --cache-all --org https://orgXXX.crm.dynamics.com`);
}

function printOperationSchema(opSchema) {
    const dep = opSchema.deprecated ? ' [DEPRECATED]' : '';
    const trigger = opSchema.isTrigger ? ' [TRIGGER]' : '';
    console.log(`Operation: ${opSchema.operationId} (${opSchema.displayName})${dep}${trigger}`);
    console.log(`  Method: ${opSchema.method}`);
    if (opSchema.description) console.log(`  ${opSchema.description}`);

    const params = Object.entries(opSchema.parameters || {});
    if (params.length > 0) {
        console.log(`\n  Parameters:`);
        // Find max name length for alignment
        const maxLen = Math.max(...params.map(([n]) => n.length), 4);
        for (const [name, def] of params) {
            const req = def.required ? '[required]' : '[optional]';
            const type = def.type || 'string';
            const desc = def.description ? `  ${def.description}` : '';
            const extra = [];
            if (def.format) extra.push(`format: ${def.format}`);
            if (def.enum) extra.push(`Enum: ${def.enum.join(', ')}`);
            if (def.default !== undefined) extra.push(`default: ${def.default}`);
            const extraStr = extra.length > 0 ? `  (${extra.join(', ')})` : '';
            console.log(`    ${name.padEnd(maxLen)}  ${type.padEnd(8)}  ${req}${desc}${extraStr}`);
        }
    } else {
        console.log(`\n  Parameters: none`);
    }

    if (opSchema.response) {
        console.log(`\n  Response: ${opSchema.response.type || 'object'}`);
        if (opSchema.response.properties) {
            const props = Object.entries(opSchema.response.properties);
            for (const [name, def] of props.slice(0, 10)) {
                console.log(`    ${name}: ${def.type || 'string'}${def.description ? ' — ' + def.description : ''}`);
            }
            if (props.length > 10) console.log(`    ... and ${props.length - 10} more`);
        }
    }
}

async function main() {
    const config = parseArgs();

    // Commands that can run without --org (local-only or cache-based)
    const noOrgCommands = new Set(['compose', 'schema']);
    if (!config.orgUrl && !noOrgCommands.has(config.command)) {
        console.error('Error: --org is required');
        process.exit(2);
    }

    // Get Dataverse token (lazy — only when --org is provided)
    const token = config.orgUrl ? getToken(config.orgUrl) : null;

    try {
        switch (config.command) {
            case 'list': {
                const flows = await listFlows(config.orgUrl, token);
                if (config.json) {
                    console.log(JSON.stringify(flows, null, 2));
                } else {
                    console.log(`Cloud Flows (${flows.length}):\n`);
                    for (const f of flows) {
                        const state = f.statecode === 1 ? 'Active' : 'Draft';
                        const modified = f.modifiedon ? f.modifiedon.split('T')[0] : '';
                        console.log(`  ${f.name}`);
                        console.log(`    ID: ${f.workflowid}  |  State: ${state}  |  Modified: ${modified}`);
                        if (f.description) console.log(`    ${f.description.substring(0, 80)}`);
                    }
                    if (flows.length === 0) {
                        console.log('  No cloud flows found (category=5).');
                    }
                }
                break;
            }

            case 'get': {
                if (!config.flowId) {
                    console.error('Error: --flow is required for get');
                    process.exit(2);
                }
                const { record, definition } = await getFlow(config.orgUrl, token, config.flowId);
                if (config.json) {
                    console.log(JSON.stringify({ record, definition }, null, 2));
                } else {
                    const state = record.statecode === 1 ? 'Active' : 'Draft';
                    console.log(`Flow: ${record.name}`);
                    console.log(`  ID: ${record.workflowid}`);
                    console.log(`  State: ${state}`);
                    console.log(`  Category: ${record.category}`);
                    if (definition) {
                        const triggers = definition.properties?.definition?.triggers || {};
                        const actions = definition.properties?.definition?.actions || {};
                        const connRefs = definition.properties?.connectionReferences || {};
                        console.log(`  Triggers: ${Object.keys(triggers).join(', ') || 'none'}`);
                        console.log(`  Actions: ${Object.keys(actions).join(', ') || 'none'}`);
                        console.log(`  Connection refs: ${Object.keys(connRefs).join(', ') || 'none'}`);

                        // Show recurrence details if present
                        const rec = triggers.Recurrence?.recurrence;
                        if (rec) {
                            console.log(`\n  Recurrence:`);
                            console.log(`    Frequency: ${rec.frequency} every ${rec.interval}`);
                            if (rec.timeZone) console.log(`    TimeZone: ${rec.timeZone}`);
                            if (rec.schedule?.weekDays) console.log(`    Days: ${rec.schedule.weekDays.join(', ')}`);
                            if (rec.schedule?.hours) console.log(`    Hours: ${rec.schedule.hours.join(', ')}`);
                        }

                        // Show ExecuteCopilot action details
                        for (const [name, action] of Object.entries(actions)) {
                            if (action.inputs?.host?.operationId === 'ExecuteCopilot') {
                                console.log(`\n  ExecuteCopilot action:`);
                                console.log(`    Copilot: ${action.inputs.parameters?.Copilot || 'unknown'}`);
                                console.log(`    Message: ${action.inputs.parameters?.['body/message'] || 'none'}`);
                            }
                        }
                    } else {
                        console.log('  (no parseable clientdata)');
                    }
                }
                break;
            }

            case 'create-trigger': {
                if (!config.botId) {
                    console.error('Error: --bot is required for create-trigger');
                    process.exit(2);
                }
                if (!config.message) {
                    console.error('Error: --message is required for create-trigger');
                    process.exit(2);
                }

                // Resolve schedule from preset or JSON
                let schedule;
                if (config.preset) {
                    schedule = PRESETS[config.preset];
                    if (!schedule) {
                        console.error(`Error: Unknown preset "${config.preset}". Available: ${Object.keys(PRESETS).join(', ')}`);
                        process.exit(2);
                    }
                } else if (config.schedule) {
                    try {
                        schedule = JSON.parse(config.schedule);
                    } catch {
                        console.error('Error: --schedule must be valid JSON');
                        process.exit(2);
                    }
                } else {
                    console.error('Error: --preset or --schedule is required for create-trigger');
                    process.exit(2);
                }

                // Discover connection ref and copilot param if not provided
                let connRef = config.connRef;
                let copilotParam = config.copilotParam;

                if (!connRef || !copilotParam) {
                    console.error('Discovering connection reference and copilot parameter...');
                    const disc = await discover(config.orgUrl, token, config.botId);
                    if (!connRef) {
                        connRef = disc.connRef;
                        if (!connRef) {
                            console.error('Error: Could not discover connection reference. Provide --conn-ref manually.');
                            process.exit(2);
                        }
                        console.error(`  Connection ref: ${connRef}`);
                    }
                    if (!copilotParam) {
                        copilotParam = disc.copilotParam;
                        if (!copilotParam) {
                            console.error('Error: Could not discover copilot parameter. Provide --copilot-param manually.');
                            console.error('  Hint: Check existing trigger flows for this agent in Power Automate.');
                            process.exit(2);
                        }
                        console.error(`  Copilot param: ${copilotParam} (from flow: ${disc.details.fromFlow})`);
                    }
                }

                console.error(`Creating trigger flow...`);
                const result = await createTriggerFlow(config.orgUrl, token, {
                    name: config.name,
                    schedule,
                    copilotParam,
                    connRefLogicalName: connRef,
                    message: config.message,
                    description: config.description
                });

                const flowId = result.workflowid || result.workflowid;
                if (config.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    console.log(`Flow created successfully.`);
                    console.log(`  Name: ${result.name}`);
                    console.log(`  ID: ${flowId}`);
                    console.log(`  State: Draft (use 'activate' to turn on)`);
                    console.log(`\nActivate with:`);
                    console.log(`  node tools/flow-manager.js activate --org ${config.orgUrl} --flow ${flowId}`);
                }
                break;
            }

            case 'update-schedule': {
                if (!config.flowId) {
                    console.error('Error: --flow is required for update-schedule');
                    process.exit(2);
                }

                let schedule;
                if (config.preset) {
                    schedule = PRESETS[config.preset];
                    if (!schedule) {
                        console.error(`Error: Unknown preset "${config.preset}". Available: ${Object.keys(PRESETS).join(', ')}`);
                        process.exit(2);
                    }
                } else if (config.schedule) {
                    try {
                        schedule = JSON.parse(config.schedule);
                    } catch {
                        console.error('Error: --schedule must be valid JSON');
                        process.exit(2);
                    }
                } else {
                    console.error('Error: --preset or --schedule is required for update-schedule');
                    process.exit(2);
                }

                console.error(`Updating schedule on flow ${config.flowId}...`);
                await updateSchedule(config.orgUrl, token, config.flowId, schedule);
                console.log('Schedule updated successfully.');
                break;
            }

            case 'update-message': {
                if (!config.flowId) {
                    console.error('Error: --flow is required for update-message');
                    process.exit(2);
                }
                if (!config.message) {
                    console.error('Error: --message is required for update-message');
                    process.exit(2);
                }

                console.error(`Updating message on flow ${config.flowId}...`);
                await updateMessage(config.orgUrl, token, config.flowId, config.message);
                console.log('Message updated successfully.');
                break;
            }

            case 'activate': {
                if (!config.flowId) {
                    console.error('Error: --flow is required for activate');
                    process.exit(2);
                }
                console.error(`Activating flow ${config.flowId}...`);
                await activateFlow(config.orgUrl, token, config.flowId);
                console.log('Flow activated.');
                break;
            }

            case 'deactivate': {
                if (!config.flowId) {
                    console.error('Error: --flow is required for deactivate');
                    process.exit(2);
                }
                console.error(`Deactivating flow ${config.flowId}...`);
                await deactivateFlow(config.orgUrl, token, config.flowId);
                console.log('Flow deactivated.');
                break;
            }

            case 'delete': {
                if (!config.flowId) {
                    console.error('Error: --flow is required for delete');
                    process.exit(2);
                }
                console.error(`Deleting flow ${config.flowId}...`);
                await deleteFlow(config.orgUrl, token, config.flowId);
                console.log('Flow deleted.');
                break;
            }

            case 'discover': {
                if (!config.botId) {
                    console.error('Error: --bot is required for discover');
                    process.exit(2);
                }
                console.error('Discovering connection reference and copilot parameter...');
                const disc = await discover(config.orgUrl, token, config.botId);

                if (config.json) {
                    console.log(JSON.stringify(disc, null, 2));
                } else {
                    console.log('Discovery Results:\n');
                    console.log(`  Connection Reference: ${disc.connRef || '(not found)'}`);
                    console.log(`  Copilot Parameter: ${disc.copilotParam || '(not found)'}`);

                    if (disc.details.connectionReferences.length > 0) {
                        console.log(`\n  All MCS connection references:`);
                        for (const cr of disc.details.connectionReferences) {
                            console.log(`    ${cr.connectionreferencelogicalname}`);
                            console.log(`      Display: ${cr.connectionreferencedisplayname || ''}`);
                            console.log(`      Connector: ${cr.connectorid}`);
                        }
                    }

                    if (disc.details.fromFlow) {
                        console.log(`\n  Copilot param discovered from:`);
                        console.log(`    Flow: ${disc.details.fromFlow}`);
                        console.log(`    Flow ID: ${disc.details.fromFlowId}`);
                    }

                    if (!disc.connRef) {
                        console.log('\n  No MCS connection reference found.');
                        console.log('  Create a trigger in the MCS UI first, then re-run discover.');
                    }
                    if (!disc.copilotParam) {
                        console.log('\n  No copilot parameter found in existing flows.');
                        console.log('  Create a trigger in the MCS UI first, then re-run discover.');
                    }
                }
                break;
            }

            case 'create-flow': {
                if (!config.definitionFile) {
                    console.error('Error: --definition is required for create-flow');
                    process.exit(2);
                }
                const defPath = path.resolve(config.definitionFile);
                if (!fs.existsSync(defPath)) {
                    console.error(`Error: File not found: ${defPath}`);
                    process.exit(2);
                }

                let defContent;
                try {
                    defContent = JSON.parse(fs.readFileSync(defPath, 'utf8'));
                } catch (e) {
                    console.error(`Error: Invalid JSON in ${defPath}: ${e.message}`);
                    process.exit(2);
                }

                // Determine if this is raw definition or already-wrapped clientdata
                const isRawDef = !!defContent['$schema'] || !!defContent.definition;
                const createParams = {
                    name: config.name,
                    description: config.description,
                    activate: config.activate
                };

                if (isRawDef) {
                    createParams.definition = defContent;
                } else {
                    createParams.clientdata = defContent;
                }

                console.error('Creating flow...');
                const created = await createFlow(config.orgUrl, token, createParams);
                const createdId = created.workflowid;

                if (config.json) {
                    console.log(JSON.stringify(created, null, 2));
                } else {
                    console.log(`Flow created successfully.`);
                    console.log(`  Name: ${created.name}`);
                    console.log(`  ID: ${createdId}`);
                    console.log(`  State: ${config.activate ? 'Active' : 'Draft'}`);
                    if (!config.activate) {
                        console.log(`\nActivate with:`);
                        console.log(`  node tools/flow-manager.js activate --org ${config.orgUrl} --flow ${createdId}`);
                    }
                }
                break;
            }

            case 'validate': {
                if (!config.definitionFile) {
                    console.error('Error: --definition is required for validate');
                    process.exit(2);
                }
                const valPath = path.resolve(config.definitionFile);
                if (!fs.existsSync(valPath)) {
                    console.error(`Error: File not found: ${valPath}`);
                    process.exit(2);
                }

                let valContent;
                try {
                    valContent = JSON.parse(fs.readFileSync(valPath, 'utf8'));
                } catch (e) {
                    console.error(`Error: Invalid JSON in ${valPath}: ${e.message}`);
                    process.exit(2);
                }

                console.error('Validating flow definition...');
                const valToken = config.orgUrl ? getToken(config.orgUrl) : null;
                const valResult = await validateFlow(valContent, config.orgUrl, valToken);

                if (config.json) {
                    console.log(JSON.stringify(valResult, null, 2));
                } else {
                    // Local validation results
                    const local = valResult.local;
                    console.log(`Local Validation: ${local.valid ? 'PASSED' : 'FAILED'}`);
                    if (local.errors.length > 0) {
                        console.log(`\n  Errors (${local.errors.length}):`);
                        for (const e of local.errors) console.log(`    - ${e}`);
                    }
                    if (local.warnings.length > 0) {
                        console.log(`\n  Warnings (${local.warnings.length}):`);
                        for (const w of local.warnings) console.log(`    - ${w}`);
                    }
                    if (local.valid && local.warnings.length === 0) {
                        console.log('  No issues found.');
                    }

                    // Remote validation results
                    if (valResult.remote) {
                        console.log(`\nRemote Validation:`);
                        if (valResult.remote.errors?.message) {
                            console.log(`  ${valResult.remote.errors.message}`);
                        } else {
                            console.log(`  Errors: ${JSON.stringify(valResult.remote.errors)}`);
                            console.log(`  Warnings: ${JSON.stringify(valResult.remote.warnings)}`);
                        }
                    }
                }

                // Exit with non-zero if local validation failed
                if (!valResult.local.valid) process.exit(1);
                break;
            }

            case 'discover-operations': {
                console.error('Discovering connector operations...');
                const opsResult = await discoverOperations(config.orgUrl, token, config.connector);

                if (config.cache) {
                    // Extract envId from org URL for cache filename
                    const orgMatch = config.orgUrl.match(/\/\/(org[a-f0-9]+)\./);
                    const envLabel = orgMatch ? orgMatch[1] : 'unknown';
                    const cachePath = path.resolve(__dirname, `../knowledge/cache/pa-operations-${envLabel}.json`);
                    fs.writeFileSync(cachePath, JSON.stringify(opsResult, null, 2));
                    console.error(`Cached to: ${cachePath}`);
                }

                if (config.json) {
                    console.log(JSON.stringify(opsResult, null, 2));
                } else {
                    console.log(`Source: ${opsResult.source}\n`);
                    if (opsResult.source === 'dataverse-fallback') {
                        const data = opsResult.data;
                        const connectors = Object.keys(data);
                        if (connectors.length === 0) {
                            console.log('No operations found in existing flows.');
                        } else {
                            console.log(`Connectors found (${connectors.length}):\n`);
                            for (const conn of connectors.sort()) {
                                console.log(`  ${conn}`);
                                for (const op of data[conn]) {
                                    console.log(`    - ${op}`);
                                }
                            }
                        }
                    } else {
                        console.log(JSON.stringify(opsResult.data, null, 2));
                    }
                }
                break;
            }

            case 'compose': {
                if (!config.specFile) {
                    console.error('Error: --spec is required for compose');
                    process.exit(2);
                }
                const specPath = path.resolve(config.specFile);
                if (!fs.existsSync(specPath)) {
                    console.error(`Error: File not found: ${specPath}`);
                    process.exit(2);
                }

                let spec;
                try {
                    spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
                } catch (e) {
                    console.error(`Error: Invalid JSON in ${specPath}: ${e.message}`);
                    process.exit(2);
                }

                console.error(`Composing flow from spec: ${spec.name || specPath}...`);
                const composed = composeFlowFromSpec(spec);

                // Validate the composed output
                const composeValidation = composer.validateDefinition(composed);
                if (!composeValidation.valid) {
                    console.error(`\nWarning: Composed flow has validation issues:`);
                    for (const e of composeValidation.errors) console.error(`  - ${e}`);
                }
                if (composeValidation.warnings.length > 0) {
                    for (const w of composeValidation.warnings) console.error(`  Warning: ${w}`);
                }

                // Schema validation against cached connector schemas
                const schemaWarnings = connectorSchema.validateSpecActions(spec.actions || []);
                if (schemaWarnings.length > 0) {
                    console.error(`\nSchema warnings:`);
                    for (const w of schemaWarnings) console.error(`  - ${w}`);
                }

                // Wrap in full clientdata envelope
                const clientdata = {
                    properties: composed,
                    schemaVersion: '1.0.0.0'
                };

                if (config.outputFile) {
                    const outPath = path.resolve(config.outputFile);
                    fs.writeFileSync(outPath, JSON.stringify(clientdata, null, 2));
                    console.log(`Composed flow written to: ${outPath}`);
                } else {
                    console.log(JSON.stringify(clientdata, null, 2));
                }
                break;
            }

            case 'schema': {
                if (!config.connector && !config.cacheAll) {
                    console.error('Error: --connector or --cache-all required for schema');
                    process.exit(2);
                }

                // Derive envId from orgUrl if provided (for Source A: Connectivity API)
                let envId = null;
                if (config.orgUrl && token) {
                    try {
                        const envUrl = await deriveEnvironmentUrl(config.orgUrl, token);
                        if (envUrl) {
                            const match = envUrl.match(/https:\/\/([^.]+)\./);
                            envId = match ? match[1] : null;
                        }
                    } catch { /* envId remains null — Source A skipped */ }
                }
                const fetchOpts = { envId, forceRefresh: !!config.orgUrl };

                if (config.cacheAll) {
                    // Cache all top-20 connectors
                    console.error(`Caching schemas for ${connectorSchema.TOP_CONNECTORS.length} connectors...`);
                    let success = 0;
                    let failed = 0;
                    for (const connId of connectorSchema.TOP_CONNECTORS) {
                        try {
                            process.stderr.write(`  ${connId}... `);
                            const result = await connectorSchema.processAndCacheConnector(connId, fetchOpts);
                            if (result) {
                                const opCount = Object.keys(result.processed.operations || {}).length;
                                console.error(`${opCount} operations (${result.source})`);
                                success++;
                            } else {
                                console.error('not found');
                                failed++;
                            }
                        } catch (err) {
                            console.error(`error: ${err.message}`);
                            failed++;
                        }
                    }
                    console.log(`\nCached: ${success}/${connectorSchema.TOP_CONNECTORS.length} connectors`);
                    if (failed > 0) console.log(`Failed: ${failed}`);
                    console.log(`Cache dir: ${connectorSchema.CACHE_DIR}`);
                    break;
                }

                // Single connector
                if (config.cache) {
                    // Fetch live and cache
                    console.error(`Fetching schema for ${config.connector}...`);
                    const result = await connectorSchema.processAndCacheConnector(config.connector, fetchOpts);
                    if (!result) {
                        console.error(`Error: Could not fetch schema for ${config.connector}`);
                        process.exit(1);
                    }
                    console.error(`Cached to: ${result.cachedPath} (source: ${result.source})`);
                    // Fall through to display
                }

                // Fetch or read from cache
                const fetchResult = await connectorSchema.fetchConnectorSwagger(config.connector, fetchOpts);
                if (!fetchResult) {
                    console.error(`Error: No schema found for ${config.connector}. Use --org to fetch live, or --cache-all first.`);
                    process.exit(1);
                }

                // If we have raw swagger, extract operations
                let operations;
                let displayName = config.connector;
                if (fetchResult.processed) {
                    operations = fetchResult.processed.operations || {};
                    displayName = fetchResult.processed._meta?.displayName || config.connector;
                } else {
                    const ops = connectorSchema.extractOperations(fetchResult.swagger);
                    displayName = fetchResult.swagger?.info?.title || config.connector;

                    if (config.operation) {
                        // Single operation detail
                        const opSchema = connectorSchema.extractOperationSchema(fetchResult.swagger, config.operation);
                        if (!opSchema) {
                            console.error(`Error: Operation "${config.operation}" not found in ${config.connector}`);
                            process.exit(1);
                        }
                        if (config.json) {
                            console.log(JSON.stringify(opSchema, null, 2));
                        } else {
                            printOperationSchema(opSchema);
                        }
                        break;
                    }

                    // Build operations map for display
                    operations = {};
                    for (const op of [...ops.actions, ...ops.triggers]) {
                        const schema = connectorSchema.extractOperationSchema(fetchResult.swagger, op.operationId);
                        if (schema) operations[op.operationId] = schema;
                    }
                }

                // Single operation from processed cache
                if (config.operation && fetchResult.processed) {
                    const opSchema = operations[config.operation];
                    if (!opSchema) {
                        console.error(`Error: Operation "${config.operation}" not found in ${config.connector}`);
                        process.exit(1);
                    }
                    // Add operationId since cache stores it as the key, not a property
                    if (!opSchema.operationId) opSchema.operationId = config.operation;
                    if (config.json) {
                        console.log(JSON.stringify(opSchema, null, 2));
                    } else {
                        printOperationSchema(opSchema);
                    }
                    break;
                }

                // List all operations
                if (config.json) {
                    console.log(JSON.stringify({ connector: config.connector, displayName, source: fetchResult.source, operations }, null, 2));
                } else {
                    const opList = Object.entries(operations);
                    const actions = opList.filter(([, o]) => !o.isTrigger);
                    const triggers = opList.filter(([, o]) => o.isTrigger);

                    console.log(`${displayName} (${config.connector})  [source: ${fetchResult.source}]\n`);

                    if (actions.length > 0) {
                        console.log(`Actions (${actions.length}):`);
                        for (const [opId, op] of actions) {
                            const dep = op.deprecated ? ' [DEPRECATED]' : '';
                            const paramCount = Object.keys(op.parameters || {}).length;
                            const reqCount = Object.values(op.parameters || {}).filter(p => p.required).length;
                            console.log(`  ${opId}${dep}`);
                            console.log(`    ${op.displayName || ''}  [${op.method}]  params: ${paramCount} (${reqCount} required)`);
                        }
                    }

                    if (triggers.length > 0) {
                        console.log(`\nTriggers (${triggers.length}):`);
                        for (const [opId, op] of triggers) {
                            const dep = op.deprecated ? ' [DEPRECATED]' : '';
                            console.log(`  ${opId}${dep}`);
                            console.log(`    ${op.displayName || ''}  [${op.method}]`);
                        }
                    }

                    console.log(`\nUse --operation <id> for full parameter details.`);
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

// --- Module Exports ---

module.exports = {
    PRESETS,
    buildRecurrenceClientdata,
    listFlows,
    getFlow,
    createTriggerFlow,
    createFlow,
    validateFlow,
    discoverOperations,
    composeFlowFromSpec,
    updateSchedule,
    updateMessage,
    activateFlow,
    deactivateFlow,
    deleteFlow,
    discoverConnectionRef,
    discoverCopilotParam,
    discover,
    composer,
    connectorSchema
};

// Run CLI if invoked directly
if (require.main === module) {
    main().catch(err => {
        console.error('Fatal:', err.message);
        process.exit(2);
    });
}
