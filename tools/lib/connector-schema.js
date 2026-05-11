/**
 * Connector Schema Discovery — Fetch, Parse & Cache Swagger Definitions
 *
 * Provides connector operation schemas for the flow builder pipeline.
 * Three data sources with cascading fallback:
 *   A. Power Platform Connectivity API (env-specific)
 *   B. Azure ARM Managed APIs (any tenant, most reliable)
 *   C. Local cache (offline)
 *
 * Used by:
 *   - flow-manager.js `schema` command (CLI access)
 *   - flow-manager.js `compose` command (optional param validation)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { httpRequest, getToken } = require('./http');

// --- Constants ---

const CACHE_DIR = path.resolve(__dirname, '../../knowledge/cache/connector-schemas');

/** Top ~20 connectors to pre-cache (covers 90%+ of agent flow use cases) */
const TOP_CONNECTORS = [
    'shared_office365',
    'shared_sharepointonline',
    'shared_commondataserviceforapps',
    'shared_teams',
    'shared_microsoftcopilotstudio',
    'shared_planner',
    'shared_todo',
    'shared_onenote',
    'shared_excelonlinebusiness',
    'shared_approvals',
    'shared_flowpush',
    'shared_office365users',
    'shared_office365groups',
    'shared_dynamicscrmonline',
    'shared_azuread',
    'shared_azureblob',
    'shared_sendmail',
    'shared_microsoftforms',
    'shared_onedriveforbusiness',
    'shared_flowmanagement'
];

// --- Helpers ---

/** Convert connector ID to ARM Managed APIs name. */
const ARM_NAME_MAP = {
    'shared_commondataserviceforapps': 'commondataservice'
};
function toArmName(connectorId) {
    return ARM_NAME_MAP[connectorId] || connectorId.replace(/^shared_/, '');
}

function getSubscriptionId() {
    try {
        return execSync('az account show --query id -o tsv',
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch (err) {
        throw new Error(`Failed to get subscription ID from az CLI: ${err.stderr || err.message}`);
    }
}

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

// --- Source A: Power Platform Connectivity API ---

async function fetchFromConnectivityApi(connectorId, envId) {
    if (!envId) return null;
    try {
        const token = getToken('https://service.powerapps.com/');
        const url = `https://${envId}.environment.api.powerplatform.com/connectivity/connectors/${connectorId}?$filter=environment+eq+'${envId}'&api-version=1`;
        const res = await httpRequest('GET', url, { 'Authorization': `Bearer ${token}` });
        if (res.status !== 200) return null;
        const props = res.data.properties || res.data;
        return props.swagger || null;
    } catch {
        return null;
    }
}

// --- Source B: Azure ARM Managed APIs ---

async function fetchFromArmApi(connectorId, options = {}) {
    try {
        const subId = options.subscriptionId || getSubscriptionId();
        const location = options.location || 'westus';
        const armName = toArmName(connectorId);
        const token = getToken('https://management.azure.com');
        const base = `https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Web/locations/${location}/managedApis/${armName}`;

        const res = await httpRequest('GET', `${base}?api-version=2016-06-01`, { 'Authorization': `Bearer ${token}` });
        if (res.status !== 200) return null;

        const props = res.data.properties || {};

        // Inline swagger (some API versions return this)
        if (props.swagger) return props.swagger;

        // Fetch from swagger URL if provided
        const swaggerUrl = props.apiDefinitions?.originalSwaggerUrl || props.apiDefinitions?.modifiedSwaggerUrl;
        if (swaggerUrl) {
            const swaggerRes = await httpRequest('GET', swaggerUrl, {});
            if (swaggerRes.status === 200 && typeof swaggerRes.data === 'object') {
                return swaggerRes.data;
            }
        }

        // Fallback: build a synthetic swagger from apiOperations endpoint
        // This gives operation IDs, display names, descriptions — but not parameter schemas
        const opsRes = await httpRequest('GET', `${base}/apiOperations?api-version=2016-06-01`, { 'Authorization': `Bearer ${token}` });
        if (opsRes.status === 200 && opsRes.data.value) {
            const paths = {};
            for (const op of opsRes.data.value) {
                const opProps = op.properties || {};
                const opId = op.name;
                const isTrigger = opProps.isWebhook || opProps.isNotification;
                // Build a minimal swagger path entry
                const pathKey = `/${opId}`;
                paths[pathKey] = {
                    post: {
                        operationId: opId,
                        summary: opProps.summary || '',
                        description: opProps.description || '',
                        deprecated: opProps.annotation?.status === 'Deprecated',
                        ...(isTrigger ? { 'x-ms-trigger': 'single' } : {}),
                        'x-ms-visibility': opProps.visibility || 'important',
                        parameters: [],
                        responses: { '200': { description: 'OK' } }
                    }
                };
            }
            return {
                info: { title: props.generalInformation?.displayName || props.name || connectorId },
                paths,
                _synthetic: true // Flag that this lacks parameter schemas
            };
        }

        return null;
    } catch {
        return null;
    }
}

// --- Source C: Local Cache ---

function getCachedSchema(connectorId) {
    const filePath = path.join(CACHE_DIR, `${connectorId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function cacheSchema(connectorId, schema) {
    ensureCacheDir();
    const filePath = path.join(CACHE_DIR, `${connectorId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(schema, null, 2));
    return filePath;
}

// --- Main Fetch with Cascading Fallback ---

/**
 * Fetch connector Swagger definition. Tries Source A → B → C.
 *
 * @param {string} connectorId - Connector ID (e.g. 'shared_office365')
 * @param {object} [options] - { envId, forceRefresh, subscriptionId, location }
 * @returns {Promise<{swagger: object|null, processed: object|null, source: string}|null>}
 */
async function fetchConnectorSwagger(connectorId, options = {}) {
    const { envId, forceRefresh = false } = options;

    // Try cache first (unless force refresh)
    if (!forceRefresh) {
        const cached = getCachedSchema(connectorId);
        if (cached) return { swagger: null, processed: cached, source: 'cache' };
    }

    // Source A: Connectivity API (env-specific)
    const swagger = await fetchFromConnectivityApi(connectorId, envId);
    if (swagger) return { swagger, processed: null, source: 'connectivity-api' };

    // Source B: ARM API (any tenant)
    const armSwagger = await fetchFromArmApi(connectorId, options);
    if (armSwagger) return { swagger: armSwagger, processed: null, source: 'arm-api' };

    // Source C: Cache (fallback even on force refresh — better than nothing)
    if (forceRefresh) {
        const cached = getCachedSchema(connectorId);
        if (cached) return { swagger: null, processed: cached, source: 'cache' };
    }

    return null;
}

// --- Swagger Parsing ---

/** Resolve a JSON $ref pointer within the swagger document. */
function resolveRef(swagger, ref) {
    if (!ref || typeof ref !== 'string' || !ref.startsWith('#/')) return null;
    const parts = ref.substring(2).split('/');
    let current = swagger;
    for (const p of parts) {
        current = current?.[p];
        if (current === undefined || current === null) return null;
    }
    return current;
}

/**
 * Flatten a Swagger schema's properties into a flat parameter map.
 * Recurses one level for nested objects.
 */
function flattenSchemaProperties(schema, swagger, prefix) {
    const params = {};
    if (!schema) return params;

    let resolved = schema;
    if (schema.$ref) {
        resolved = resolveRef(swagger, schema.$ref) || schema;
    }

    if (!resolved.properties) return params;

    const required = new Set(resolved.required || []);
    for (const [propName, propDef] of Object.entries(resolved.properties)) {
        const fullName = prefix ? `${prefix}/${propName}` : propName;
        let prop = propDef;
        if (propDef.$ref) {
            prop = resolveRef(swagger, propDef.$ref) || propDef;
        }

        if (prop.type === 'object' && prop.properties) {
            Object.assign(params, flattenSchemaProperties(prop, swagger, fullName));
        } else {
            params[fullName] = {
                type: prop.type || 'string',
                required: required.has(propName),
                description: prop.description || prop['x-ms-summary'] || ''
            };
            if (prop.enum) params[fullName].enum = prop.enum;
            if (prop.default !== undefined) params[fullName].default = prop.default;
            if (prop.format) params[fullName].format = prop.format;
        }
    }

    return params;
}

/**
 * Extract all operations from a Swagger document.
 *
 * @param {object} swagger - Parsed Swagger/OpenAPI document
 * @returns {{ actions: Array, triggers: Array }}
 */
function extractOperations(swagger) {
    const actions = [];
    const triggers = [];
    const paths = swagger?.paths || {};

    for (const [pathStr, methods] of Object.entries(paths)) {
        for (const [method, op] of Object.entries(methods)) {
            if (typeof op !== 'object' || method.startsWith('x-')) continue;
            const entry = {
                operationId: op.operationId || `${method}_${pathStr}`,
                displayName: op.summary || op['x-ms-summary'] || op.operationId || pathStr,
                description: op.description || '',
                method: method.toUpperCase(),
                path: pathStr,
                deprecated: !!op.deprecated
            };
            if (op['x-ms-trigger']) {
                triggers.push(entry);
            } else {
                actions.push(entry);
            }
        }
    }

    const sortFn = (a, b) => {
        if (a.deprecated !== b.deprecated) return a.deprecated ? 1 : -1;
        return a.operationId.localeCompare(b.operationId);
    };
    actions.sort(sortFn);
    triggers.sort(sortFn);

    return { actions, triggers };
}

/**
 * Extract full schema for a single operation (input params + response).
 *
 * @param {object} swagger - Parsed Swagger document
 * @param {string} operationId - Target operation ID
 * @returns {object|null} Operation schema with parameters and response
 */
function extractOperationSchema(swagger, operationId) {
    const paths = swagger?.paths || {};

    for (const [pathStr, methods] of Object.entries(paths)) {
        for (const [method, op] of Object.entries(methods)) {
            if (typeof op !== 'object' || op.operationId !== operationId) continue;

            // Extract input parameters
            const parameters = {};
            for (const param of (op.parameters || [])) {
                let resolved = param;
                if (param.$ref) {
                    resolved = resolveRef(swagger, param.$ref) || param;
                }

                if (resolved.in === 'body' && resolved.schema) {
                    Object.assign(parameters, flattenSchemaProperties(resolved.schema, swagger, ''));
                } else {
                    parameters[resolved.name] = {
                        type: resolved.type || 'string',
                        required: !!resolved.required,
                        description: resolved.description || resolved['x-ms-summary'] || '',
                        in: resolved.in
                    };
                    if (resolved.enum) parameters[resolved.name].enum = resolved.enum;
                    if (resolved.default !== undefined) parameters[resolved.name].default = resolved.default;
                    if (resolved.format) parameters[resolved.name].format = resolved.format;
                }
            }

            // Extract response schema
            let response = null;
            const responses = op.responses || {};
            const successResp = responses['200'] || responses['201'] || responses.default;
            if (successResp?.schema) {
                let respSchema = successResp.schema;
                if (respSchema.$ref) {
                    respSchema = resolveRef(swagger, respSchema.$ref) || respSchema;
                }
                response = {
                    type: respSchema.type || 'object',
                    description: successResp.description || ''
                };
                if (respSchema.properties) {
                    response.properties = {};
                    for (const [k, v] of Object.entries(respSchema.properties)) {
                        let rv = v;
                        if (v.$ref) rv = resolveRef(swagger, v.$ref) || v;
                        response.properties[k] = {
                            type: rv.type || 'string',
                            description: rv.description || rv['x-ms-summary'] || ''
                        };
                    }
                }
            }

            return {
                operationId,
                displayName: op.summary || op['x-ms-summary'] || operationId,
                description: op.description || '',
                method: method.toUpperCase(),
                path: pathStr,
                deprecated: !!op.deprecated,
                isTrigger: !!op['x-ms-trigger'],
                parameters,
                response
            };
        }
    }

    return null;
}

/**
 * Convert an operation schema to the params format flow-composer expects.
 * Required params get placeholder strings; optional params are omitted.
 */
function formatSchemaForCompose(operationSchema) {
    if (!operationSchema) return null;
    const params = {};
    for (const [name, def] of Object.entries(operationSchema.parameters || {})) {
        if (def.required) {
            params[name] = def.enum
                ? `<${def.type}: ${def.enum.join('|')}>`
                : `<${def.type}>`;
        }
    }
    return params;
}

// --- Process & Cache a Full Connector ---

/**
 * Fetch, extract all operations, and cache a connector schema.
 *
 * @param {string} connectorId - Connector ID
 * @param {object} [options] - Fetch options (envId, subscriptionId, location)
 * @returns {Promise<{processed: object, cachedPath: string, source: string}|null>}
 */
async function processAndCacheConnector(connectorId, options = {}) {
    const result = await fetchConnectorSwagger(connectorId, { ...options, forceRefresh: true });
    if (!result) return null;

    let processed;
    if (result.processed) {
        // Already processed (from cache fallback) — re-cache as-is
        processed = result.processed;
    } else {
        const { actions, triggers } = extractOperations(result.swagger);
        const operations = {};

        for (const op of [...actions, ...triggers]) {
            const schema = extractOperationSchema(result.swagger, op.operationId);
            if (schema) {
                operations[op.operationId] = {
                    displayName: schema.displayName,
                    method: schema.method,
                    description: schema.description,
                    deprecated: schema.deprecated,
                    isTrigger: schema.isTrigger,
                    parameters: schema.parameters,
                    response: schema.response
                };
            }
        }

        processed = {
            _meta: {
                connectorId,
                displayName: result.swagger?.info?.title || connectorId,
                source: result.source,
                fetchedAt: new Date().toISOString().split('T')[0],
                hasParameterSchemas: !result.swagger?._synthetic
            },
            operations
        };
    }

    const cachedPath = cacheSchema(connectorId, processed);
    return { processed, cachedPath, source: result.source };
}

// --- Compose-Time Validation ---

/**
 * Validate flow spec actions against cached connector schemas.
 * Returns warnings (non-blocking) for missing operations or required params.
 *
 * @param {Array} specActions - Actions array from a flow spec
 * @returns {string[]} Array of warning messages
 */
function validateSpecActions(specActions) {
    const warnings = [];

    for (const action of (specActions || [])) {
        if (action.type === 'connector' && action.connector && action.operationId) {
            const cached = getCachedSchema(action.connector);
            if (!cached) continue; // No schema cached — skip validation

            const opSchema = cached.operations?.[action.operationId];
            if (!opSchema) {
                warnings.push(`Action "${action.name}": operationId "${action.operationId}" not found in cached schema for ${action.connector}`);
                continue;
            }

            // Check required parameters
            const provided = action.params || {};
            for (const [paramName, paramDef] of Object.entries(opSchema.parameters || {})) {
                if (paramDef.required && !(paramName in provided)) {
                    warnings.push(`Action "${action.name}": missing required param "${paramName}" for ${action.operationId}`);
                }
            }
        }

        // Recurse into nested actions (conditions, loops, etc.)
        if (action.ifActions) warnings.push(...validateSpecActions(action.ifActions));
        if (action.elseActions) warnings.push(...validateSpecActions(action.elseActions));
        if (action.actions) warnings.push(...validateSpecActions(action.actions));
        if (action.defaultActions) warnings.push(...validateSpecActions(action.defaultActions));
        if (action.cases) {
            for (const caseDef of Object.values(action.cases)) {
                if (caseDef.actions) warnings.push(...validateSpecActions(caseDef.actions));
            }
        }
    }

    return warnings;
}

// --- Module Exports ---

module.exports = {
    // Fetch
    fetchConnectorSwagger,
    fetchFromConnectivityApi,
    fetchFromArmApi,
    processAndCacheConnector,

    // Parse
    extractOperations,
    extractOperationSchema,
    formatSchemaForCompose,
    resolveRef,
    flattenSchemaProperties,

    // Cache
    getCachedSchema,
    cacheSchema,

    // Validation
    validateSpecActions,

    // Constants
    TOP_CONNECTORS,
    CACHE_DIR,
    toArmName
};
