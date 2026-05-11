/**
 * Flow Composer — Pure composition functions for Power Automate flow definitions
 *
 * Builds Logic Apps Workflow Definition Language JSON programmatically.
 * No CLI, no I/O, no HTTP calls — all composition logic isolated and testable.
 *
 * Architecture:
 *   knowledge/patterns/flow-patterns/   <- Reusable JSON templates
 *          loaded by
 *   tools/lib/flow-composer.js          <- This file (builders, wiring, validation)
 *          imported by
 *   tools/flow-manager.js              <- CLI commands (create-flow, validate, compose)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// --- Constants ---

const WDL_SCHEMA = 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#';
const CONTENT_VERSION = '1.0.0.0';
const PATTERNS_DIR = path.resolve(__dirname, '../../knowledge/patterns/flow-patterns');

// --- Trigger Builders ---

/**
 * Build a Recurrence trigger block.
 *
 * @param {object} config - { frequency, interval, timeZone?, schedule?, startTime? }
 * @returns {object} Trigger definition keyed by name
 */
function buildRecurrenceTrigger(config) {
    const trigger = {
        type: 'Recurrence',
        recurrence: {
            frequency: config.frequency,
            interval: config.interval
        },
        metadata: {
            operationMetadataId: crypto.randomUUID()
        }
    };
    if (config.timeZone) trigger.recurrence.timeZone = config.timeZone;
    if (config.schedule) trigger.recurrence.schedule = config.schedule;
    if (config.startTime) trigger.recurrence.startTime = config.startTime;
    return { Recurrence: trigger };
}

/**
 * Build an agent flow trigger (type: Request, kind: Skills).
 *
 * @param {object} [inputSchema] - Optional JSON schema for input parameters
 * @returns {object} Trigger definition keyed by name
 */
function buildSkillsTrigger(inputSchema) {
    const trigger = {
        type: 'Request',
        kind: 'Skills',
        inputs: {
            schema: inputSchema || {
                type: 'object',
                properties: {},
                required: []
            }
        }
    };
    return { manual: trigger };
}

/**
 * Build an OpenApiConnection event trigger (email, Dataverse, SharePoint, etc.).
 *
 * @param {string} connector - Connector name (e.g. 'shared_office365')
 * @param {string} operationId - Operation ID (e.g. 'OnNewEmailV3')
 * @param {object} [params] - Trigger parameters
 * @returns {object} Trigger definition keyed by name
 */
function buildEventTrigger(connector, operationId, params) {
    const triggerName = `When_${operationId}`;
    const trigger = {
        type: 'OpenApiConnectionNotification',
        inputs: {
            host: {
                connectionName: connector,
                operationId: operationId,
                apiId: `/providers/Microsoft.PowerApps/apis/${connector}`
            },
            parameters: params || {},
            authentication: "@parameters('$authentication')"
        },
        metadata: {
            operationMetadataId: crypto.randomUUID()
        }
    };
    return { [triggerName]: trigger };
}

/**
 * Build an HTTP request trigger.
 *
 * @param {string} [method] - HTTP method (default: POST)
 * @param {object} [schema] - Request body JSON schema
 * @returns {object} Trigger definition keyed by name
 */
function buildHttpTrigger(method, schema) {
    const trigger = {
        type: 'Request',
        kind: 'Http',
        inputs: {
            method: method || 'POST',
            schema: schema || {}
        }
    };
    return { manual: trigger };
}

// --- Action Builders ---
// Each returns { [actionName]: actionDefinition } for easy chaining.

/**
 * Build a connector action (OpenApiConnection).
 *
 * @param {string} name - Action name
 * @param {string} connector - Connector name (e.g. 'shared_office365')
 * @param {string} operationId - Operation ID
 * @param {object} [params] - Action parameters
 * @returns {object} Single-entry action object
 */
function buildConnectorAction(name, connector, operationId, params) {
    return {
        [name]: {
            runAfter: {},
            type: 'OpenApiConnection',
            inputs: {
                host: {
                    connectionName: connector,
                    operationId: operationId,
                    apiId: `/providers/Microsoft.PowerApps/apis/${connector}`
                },
                parameters: params || {},
                authentication: "@parameters('$authentication')"
            },
            metadata: {
                operationMetadataId: crypto.randomUUID()
            }
        }
    };
}

/**
 * Build an ExecuteCopilot action (call an MCS agent).
 *
 * @param {string} name - Action name
 * @param {string} copilotParam - Copilot parameter value
 * @param {string} connRef - Connection reference connector name
 * @param {string} message - Message to send to the copilot
 * @returns {object} Single-entry action object
 */
function buildExecuteCopilotAction(name, copilotParam, connRef, message) {
    return {
        [name]: {
            runAfter: {},
            type: 'OpenApiConnection',
            inputs: {
                host: {
                    connectionName: connRef || 'shared_microsoftcopilotstudio',
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
    };
}

/**
 * Build a Response action (kind: Skills — return data to agent).
 *
 * @param {string} name - Action name
 * @param {object} body - Response body
 * @param {object} [schema] - Output schema
 * @returns {object} Single-entry action object
 */
function buildResponseAction(name, body, schema) {
    return {
        [name]: {
            runAfter: {},
            type: 'Response',
            kind: 'Skills',
            inputs: {
                statusCode: 200,
                body: body,
                schema: schema || {
                    type: 'object',
                    properties: {}
                }
            }
        }
    };
}

/**
 * Build a Compose action (data transformation).
 *
 * @param {string} name - Action name
 * @param {*} inputs - Expression or value
 * @returns {object} Single-entry action object
 */
function buildComposeAction(name, inputs) {
    return {
        [name]: {
            runAfter: {},
            type: 'Compose',
            inputs: inputs
        }
    };
}

/**
 * Build a ParseJson action.
 *
 * @param {string} name - Action name
 * @param {string} content - Expression referencing content to parse
 * @param {object} schema - JSON schema for parsing
 * @returns {object} Single-entry action object
 */
function buildParseJsonAction(name, content, schema) {
    return {
        [name]: {
            runAfter: {},
            type: 'ParseJson',
            inputs: {
                content: content,
                schema: schema
            }
        }
    };
}

/**
 * Build an HTTP action (direct HTTP call).
 *
 * @param {string} name - Action name
 * @param {string} method - HTTP method
 * @param {string} uri - Request URI
 * @param {object} [headers] - Request headers
 * @param {*} [body] - Request body
 * @returns {object} Single-entry action object
 */
function buildHttpAction(name, method, uri, headers, body) {
    const action = {
        runAfter: {},
        type: 'Http',
        inputs: {
            method: method,
            uri: uri
        }
    };
    if (headers) action.inputs.headers = headers;
    if (body) action.inputs.body = body;
    return { [name]: action };
}

/**
 * Build an InitializeVariable action.
 *
 * @param {string} name - Action name
 * @param {string} varName - Variable name
 * @param {string} varType - Variable type (String, Integer, Float, Boolean, Array, Object)
 * @param {*} [value] - Initial value
 * @returns {object} Single-entry action object
 */
function buildInitVariableAction(name, varName, varType, value) {
    const action = {
        runAfter: {},
        type: 'InitializeVariable',
        inputs: {
            variables: [{
                name: varName,
                type: varType
            }]
        }
    };
    if (value !== undefined) action.inputs.variables[0].value = value;
    return { [name]: action };
}

/**
 * Build a SetVariable action.
 *
 * @param {string} name - Action name
 * @param {string} varName - Variable name
 * @param {*} value - New value
 * @returns {object} Single-entry action object
 */
function buildSetVariableAction(name, varName, value) {
    return {
        [name]: {
            runAfter: {},
            type: 'SetVariable',
            inputs: {
                name: varName,
                value: value
            }
        }
    };
}

/**
 * Build a Terminate action.
 *
 * @param {string} name - Action name
 * @param {string} status - 'Succeeded', 'Failed', or 'Cancelled'
 * @param {string} [message] - Status message
 * @returns {object} Single-entry action object
 */
function buildTerminateAction(name, status, message) {
    const action = {
        runAfter: {},
        type: 'Terminate',
        inputs: {
            runStatus: status
        }
    };
    if (message) action.inputs.runError = { message: message };
    return { [name]: action };
}

// --- Control Flow Builders ---

/**
 * Build a Condition (If/Else) action.
 *
 * @param {string} name - Action name
 * @param {object} expression - Condition expression (e.g. { and: [{ equals: [...] }] })
 * @param {object} ifActions - Actions for true branch (merged action objects)
 * @param {object} [elseActions] - Actions for false branch
 * @returns {object} Single-entry action object
 */
function buildCondition(name, expression, ifActions, elseActions) {
    return {
        [name]: {
            runAfter: {},
            type: 'If',
            expression: expression,
            actions: ifActions || {},
            else: {
                actions: elseActions || {}
            }
        }
    };
}

/**
 * Build a ForEach loop action.
 *
 * @param {string} name - Action name
 * @param {string} items - Expression for items to iterate (e.g. "@body('Get_Items')?['value']")
 * @param {object} actions - Loop body actions (merged action objects)
 * @param {boolean} [sequential] - Run sequentially (default: parallel)
 * @returns {object} Single-entry action object
 */
function buildForeach(name, items, actions, sequential) {
    const action = {
        runAfter: {},
        type: 'Foreach',
        foreach: items,
        actions: actions || {}
    };
    if (sequential) {
        action.operationOptions = 'Sequential';
    }
    return { [name]: action };
}

/**
 * Build an Until (do-until) loop action.
 *
 * @param {string} name - Action name
 * @param {object} expression - Loop condition expression
 * @param {object} actions - Loop body actions
 * @param {object} [limit] - { count, timeout } limits
 * @returns {object} Single-entry action object
 */
function buildUntil(name, expression, actions, limit) {
    return {
        [name]: {
            runAfter: {},
            type: 'Until',
            expression: expression,
            actions: actions || {},
            limit: limit || { count: 60, timeout: 'PT1H' }
        }
    };
}

/**
 * Build a Switch action (multi-case branching).
 *
 * @param {string} name - Action name
 * @param {string} expression - Expression to switch on
 * @param {object} cases - { CaseName: { case: value, actions: {} }, ... }
 * @param {object} [defaultActions] - Default branch actions
 * @returns {object} Single-entry action object
 */
function buildSwitch(name, expression, cases, defaultActions) {
    return {
        [name]: {
            runAfter: {},
            type: 'Switch',
            expression: expression,
            cases: cases || {},
            default: {
                actions: defaultActions || {}
            }
        }
    };
}

/**
 * Build a Scope action (group actions for try/catch pattern).
 *
 * @param {string} name - Action name
 * @param {object} actions - Actions inside the scope
 * @returns {object} Single-entry action object
 */
function buildScope(name, actions) {
    return {
        [name]: {
            runAfter: {},
            type: 'Scope',
            actions: actions || {}
        }
    };
}

// --- Wiring & Assembly ---

/**
 * Auto-wire runAfter from array order.
 * First action gets runAfter: {}, each subsequent references the previous with ["Succeeded"].
 *
 * @param {object[]} actionsArray - Array of single-entry action objects
 * @returns {object} Merged actions object with runAfter wired
 */
function chainActions(actionsArray) {
    const merged = {};
    let prevName = null;

    for (const actionObj of actionsArray) {
        const [name, def] = Object.entries(actionObj)[0];
        if (prevName) {
            def.runAfter = { [prevName]: ['Succeeded'] };
        } else {
            def.runAfter = {};
        }
        merged[name] = def;
        prevName = name;
    }

    return merged;
}

/**
 * Create a connectionReferences entry.
 *
 * @param {string} connectorName - Connector API name (e.g. 'shared_office365')
 * @param {string} logicalName - Connection reference logical name from Dataverse
 * @returns {object} Single-entry connectionReferences object
 */
function buildConnectionRef(connectorName, logicalName) {
    return {
        [connectorName]: {
            runtimeSource: 'embedded',
            connection: {
                connectionReferenceLogicalName: logicalName
            },
            api: {
                name: connectorName
            }
        }
    };
}

/**
 * Assemble a full Logic Apps workflow definition.
 *
 * @param {object} triggers - Trigger definitions (keyed by name)
 * @param {object} actions - Action definitions (keyed by name)
 * @param {object} [connectionRefs] - Connection references
 * @returns {object} Complete clientdata.properties object
 */
function buildDefinition(triggers, actions, connectionRefs) {
    return {
        connectionReferences: connectionRefs || {},
        definition: {
            '$schema': WDL_SCHEMA,
            contentVersion: CONTENT_VERSION,
            parameters: {
                '$connections': { defaultValue: {}, type: 'Object' },
                '$authentication': { defaultValue: {}, type: 'SecureObject' }
            },
            triggers: triggers || {},
            actions: actions || {},
            outputs: {}
        },
        templateName: ''
    };
}

/**
 * Build a full Dataverse POST body for a workflow record.
 *
 * @param {string} name - Flow display name
 * @param {object} properties - The properties object from buildDefinition()
 * @param {object} [options] - { description, modernflowtype }
 * @returns {object} Dataverse workflow POST body
 */
function buildWorkflowRecord(name, properties, options = {}) {
    const clientdata = JSON.stringify({
        properties: properties,
        schemaVersion: CONTENT_VERSION
    });

    return {
        category: 5,
        name: name,
        type: 1,
        primaryentity: 'none',
        modernflowtype: options.modernflowtype !== undefined ? options.modernflowtype : 1,
        description: options.description || '',
        clientdata: clientdata
    };
}

// --- Local Validation ---

/**
 * Validate a workflow definition locally.
 * Checks: $schema, exactly 1 trigger, action name uniqueness, runAfter ref validity,
 * connectionName refs match connectionReferences keys.
 *
 * @param {object} definition - The full clientdata object (parsed JSON)
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateDefinition(definition) {
    const errors = [];
    const warnings = [];

    // Navigate to the right level — handle both envelope and bare definition
    let props, def, connRefs;
    if (definition.properties) {
        props = definition.properties;
        def = props.definition;
        connRefs = props.connectionReferences || {};
    } else if (definition.definition) {
        def = definition.definition;
        connRefs = definition.connectionReferences || {};
    } else if (definition['$schema']) {
        def = definition;
        connRefs = {};
    } else {
        errors.push('Cannot find workflow definition — expected properties.definition or $schema at top level');
        return { valid: false, errors, warnings };
    }

    // Check $schema
    if (!def['$schema']) {
        errors.push('Missing $schema in definition');
    } else if (!def['$schema'].includes('workflowdefinition.json')) {
        warnings.push(`Unexpected $schema: ${def['$schema']}`);
    }

    // Check triggers
    const triggers = def.triggers || {};
    const triggerNames = Object.keys(triggers);
    if (triggerNames.length === 0) {
        errors.push('No triggers defined — exactly 1 trigger is required');
    } else if (triggerNames.length > 1) {
        errors.push(`Multiple triggers found (${triggerNames.join(', ')}) — exactly 1 is allowed`);
    }

    // Check actions
    const actions = def.actions || {};
    const actionNames = Object.keys(actions);
    const nameSet = new Set();
    for (const n of actionNames) {
        if (nameSet.has(n)) {
            errors.push(`Duplicate action name: "${n}"`);
        }
        nameSet.add(n);
    }

    // Validate runAfter references (no dangling, no circular)
    const allNames = new Set(actionNames);
    for (const [actionName, actionDef] of Object.entries(actions)) {
        const runAfter = actionDef.runAfter || {};
        for (const depName of Object.keys(runAfter)) {
            if (!allNames.has(depName)) {
                errors.push(`Action "${actionName}" has runAfter reference to non-existent action "${depName}"`);
            }
            if (depName === actionName) {
                errors.push(`Action "${actionName}" references itself in runAfter (self-cycle)`);
            }
        }

        // Recursively check nested actions (inside conditions, loops, scopes)
        validateNestedActions(actionDef, actionName, errors, warnings);
    }

    // Check for circular dependencies (simple cycle detection via DFS)
    const visited = new Set();
    const inStack = new Set();
    function hasCycle(name) {
        if (inStack.has(name)) return true;
        if (visited.has(name)) return false;
        visited.add(name);
        inStack.add(name);
        const deps = Object.keys(actions[name]?.runAfter || {});
        for (const dep of deps) {
            if (allNames.has(dep) && hasCycle(dep)) {
                errors.push(`Circular dependency detected involving "${name}" and "${dep}"`);
                return true;
            }
        }
        inStack.delete(name);
        return false;
    }
    for (const name of actionNames) {
        hasCycle(name);
    }

    // Validate connection references used in actions
    const connRefKeys = new Set(Object.keys(connRefs));
    for (const [actionName, actionDef] of Object.entries(actions)) {
        const connName = actionDef.inputs?.host?.connectionName;
        if (connName && connRefKeys.size > 0 && !connRefKeys.has(connName)) {
            warnings.push(`Action "${actionName}" uses connection "${connName}" not found in connectionReferences`);
        }
    }

    return { valid: errors.length === 0, errors, warnings };
}

/**
 * Recursively validate nested actions within control flow nodes.
 */
function validateNestedActions(actionDef, parentName, errors, warnings) {
    // Check inside If/Condition branches
    if (actionDef.actions) {
        checkNestedActionNames(actionDef.actions, `${parentName}.actions`, errors);
    }
    if (actionDef.else?.actions) {
        checkNestedActionNames(actionDef.else.actions, `${parentName}.else.actions`, errors);
    }
    // Check inside Switch cases
    if (actionDef.cases) {
        for (const [caseName, caseDef] of Object.entries(actionDef.cases)) {
            if (caseDef.actions) {
                checkNestedActionNames(caseDef.actions, `${parentName}.cases.${caseName}`, errors);
            }
        }
    }
    if (actionDef.default?.actions) {
        checkNestedActionNames(actionDef.default.actions, `${parentName}.default`, errors);
    }
}

function checkNestedActionNames(actions, context, errors) {
    const names = new Set();
    for (const name of Object.keys(actions)) {
        if (names.has(name)) {
            errors.push(`Duplicate nested action name "${name}" in ${context}`);
        }
        names.add(name);
    }
}

// --- Pattern Loading ---

/**
 * Load a pattern from the flow-patterns directory.
 *
 * @param {string} patternName - Pattern filename without extension
 * @returns {object} Parsed pattern object with _meta and fragment
 */
function loadPattern(patternName) {
    const filePath = path.join(PATTERNS_DIR, `${patternName}.json`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Pattern not found: ${patternName} (looked in ${filePath})`);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * List all available patterns.
 *
 * @returns {Array<{name: string, meta: object}>} Array of pattern names and metadata
 */
function listPatterns() {
    if (!fs.existsSync(PATTERNS_DIR)) return [];
    return fs.readdirSync(PATTERNS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const name = f.replace('.json', '');
            try {
                const pattern = JSON.parse(fs.readFileSync(path.join(PATTERNS_DIR, f), 'utf8'));
                return { name, meta: pattern._meta || {} };
            } catch {
                return { name, meta: {} };
            }
        });
}

/**
 * Deep replace {{PARAM}} placeholders in a JSON structure with provided values.
 *
 * @param {*} template - JSON value (object, array, string, etc.)
 * @param {object} params - { PARAM_NAME: replacement_value }
 * @returns {*} Template with placeholders replaced
 */
function substituteParams(template, params) {
    if (typeof template === 'string') {
        let result = template;
        for (const [key, value] of Object.entries(params)) {
            const placeholder = `{{${key}}}`;
            if (result === placeholder) {
                // Full-string match: replace with the actual type (could be number, object, etc.)
                return value;
            }
            result = result.split(placeholder).join(typeof value === 'string' ? value : JSON.stringify(value));
        }
        return result;
    }
    if (Array.isArray(template)) {
        return template.map(item => substituteParams(item, params));
    }
    if (template && typeof template === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(template)) {
            result[substituteParams(key, params)] = substituteParams(value, params);
        }
        return result;
    }
    return template;
}

// --- High-Level Compose ---

/**
 * Compose a complete flow definition from a high-level spec.
 *
 * Spec format:
 * {
 *   name: "Flow Name",
 *   trigger: { pattern?: "pattern-name", params?: {}, type?: "recurrence"|"skills"|"event"|"http", config?: {} },
 *   actions: [
 *     { name, type: "connector"|"copilot"|"response"|"compose"|"parseJson"|"http"|"initVariable"|"setVariable"|"terminate",
 *       ...typeSpecificFields },
 *     { name, type: "condition", expression, ifActions: [...], elseActions: [...] },
 *     { name, type: "foreach", items, actions: [...], sequential? },
 *     { name, type: "until", expression, actions: [...], limit? },
 *     { name, type: "switch", expression, cases: { CaseName: { case, actions: [...] } }, defaultActions: [...] },
 *     { name, type: "scope", actions: [...] }
 *   ],
 *   connectionReferences: { connectorName: { logicalName } }
 * }
 *
 * @param {object} spec - High-level flow specification
 * @returns {object} Complete clientdata-ready properties object
 */
function composeFlow(spec) {
    // Build trigger
    let triggers;
    if (spec.trigger.pattern) {
        const pattern = loadPattern(spec.trigger.pattern);
        const fragment = substituteParams(pattern.fragment, spec.trigger.params || {});
        triggers = fragment.triggers || fragment;
    } else {
        triggers = buildTriggerFromSpec(spec.trigger);
    }

    // Build actions
    const actionsArray = buildActionsFromSpec(spec.actions || []);
    const actions = chainActions(actionsArray);

    // Build connection references
    const connRefs = {};
    if (spec.connectionReferences) {
        for (const [connName, config] of Object.entries(spec.connectionReferences)) {
            Object.assign(connRefs, buildConnectionRef(connName, config.logicalName));
        }
    }

    return buildDefinition(triggers, actions, connRefs);
}

/**
 * Build a trigger from a spec trigger object (non-pattern path).
 */
function buildTriggerFromSpec(triggerSpec) {
    switch (triggerSpec.type) {
        case 'recurrence':
            return buildRecurrenceTrigger(triggerSpec.config || triggerSpec);
        case 'skills':
            return buildSkillsTrigger(triggerSpec.inputSchema);
        case 'event':
            return buildEventTrigger(triggerSpec.connector, triggerSpec.operationId, triggerSpec.params);
        case 'http':
            return buildHttpTrigger(triggerSpec.method, triggerSpec.schema);
        default:
            throw new Error(`Unknown trigger type: ${triggerSpec.type}`);
    }
}

/**
 * Recursively build actions from a spec actions array.
 * Returns an array of single-entry action objects suitable for chainActions().
 */
function buildActionsFromSpec(specActions) {
    return specActions.map(a => {
        switch (a.type) {
            case 'connector':
                return buildConnectorAction(a.name, a.connector, a.operationId, a.params);
            case 'copilot':
                return buildExecuteCopilotAction(a.name, a.copilotParam, a.connRef, a.message);
            case 'response':
                return buildResponseAction(a.name, a.body, a.schema);
            case 'compose':
                return buildComposeAction(a.name, a.inputs);
            case 'parseJson':
                return buildParseJsonAction(a.name, a.content, a.schema);
            case 'http':
                return buildHttpAction(a.name, a.method, a.uri, a.headers, a.body);
            case 'initVariable':
                return buildInitVariableAction(a.name, a.varName, a.varType, a.value);
            case 'setVariable':
                return buildSetVariableAction(a.name, a.varName, a.value);
            case 'terminate':
                return buildTerminateAction(a.name, a.status, a.message);
            case 'condition': {
                const ifActions = a.ifActions ? chainActions(buildActionsFromSpec(a.ifActions)) : {};
                const elseActions = a.elseActions ? chainActions(buildActionsFromSpec(a.elseActions)) : {};
                return buildCondition(a.name, a.expression, ifActions, elseActions);
            }
            case 'foreach': {
                const loopActions = a.actions ? chainActions(buildActionsFromSpec(a.actions)) : {};
                return buildForeach(a.name, a.items, loopActions, a.sequential);
            }
            case 'until': {
                const untilActions = a.actions ? chainActions(buildActionsFromSpec(a.actions)) : {};
                return buildUntil(a.name, a.expression, untilActions, a.limit);
            }
            case 'switch': {
                const cases = {};
                if (a.cases) {
                    for (const [caseName, caseDef] of Object.entries(a.cases)) {
                        cases[caseName] = {
                            case: caseDef.case,
                            actions: caseDef.actions ? chainActions(buildActionsFromSpec(caseDef.actions)) : {}
                        };
                    }
                }
                const defaultActions = a.defaultActions ? chainActions(buildActionsFromSpec(a.defaultActions)) : {};
                return buildSwitch(a.name, a.expression, cases, defaultActions);
            }
            case 'scope': {
                const scopeActions = a.actions ? chainActions(buildActionsFromSpec(a.actions)) : {};
                return buildScope(a.name, scopeActions);
            }
            default:
                throw new Error(`Unknown action type: "${a.type}" on action "${a.name}"`);
        }
    });
}

// --- Module Exports ---

module.exports = {
    // Trigger builders
    buildRecurrenceTrigger,
    buildSkillsTrigger,
    buildEventTrigger,
    buildHttpTrigger,

    // Action builders
    buildConnectorAction,
    buildExecuteCopilotAction,
    buildResponseAction,
    buildComposeAction,
    buildParseJsonAction,
    buildHttpAction,
    buildInitVariableAction,
    buildSetVariableAction,
    buildTerminateAction,

    // Control flow builders
    buildCondition,
    buildForeach,
    buildUntil,
    buildSwitch,
    buildScope,

    // Wiring & assembly
    chainActions,
    buildConnectionRef,
    buildDefinition,
    buildWorkflowRecord,

    // Validation
    validateDefinition,

    // Pattern loading
    loadPattern,
    listPatterns,
    substituteParams,

    // High-level compose
    composeFlow,

    // Constants
    WDL_SCHEMA,
    CONTENT_VERSION,
    PATTERNS_DIR
};
