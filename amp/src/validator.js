/*---------------------------------------------------------------------------------------------
 *  AMP manifest validator.
 *  Uses ajv against amp.schema.json for structural validation, then runs
 *  semantic checks (cross-field constraints) the schema cannot express.
 *--------------------------------------------------------------------------------------------*/

"use strict";

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const SCHEMA_PATH = path.join(__dirname, "..", "schemas", "amp.schema.json");

class AmpValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = "AmpValidationError";
    this.errors = errors;
  }
}

let _validator = null;
function getStructuralValidator() {
  if (_validator) return _validator;
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  _validator = ajv.compile(schema);
  return _validator;
}

function formatAjvErrors(errors) {
  return (errors || []).map((e) => {
    const where = e.instancePath || "<root>";
    return `${where} ${e.message}` + (e.params ? ` (${JSON.stringify(e.params)})` : "");
  });
}

/**
 * Cross-field semantic checks. Schema enforces shape; this enforces meaning.
 */
function semanticChecks(manifest) {
  const errors = [];
  const warnings = [];

  const ext = manifest.extensions || {};
  const tools = ext.tools || [];
  const toolNames = new Set();
  for (const tool of tools) {
    if (toolNames.has(tool.name)) {
      errors.push(`Duplicate tool name: ${tool.name}`);
    }
    toolNames.add(tool.name);
    if (!tool.handler && !tool.stub) {
      warnings.push(`Tool ${tool.name} has no handler or stub; generator will emit a TODO.`);
    }
  }

  for (const builtinName of ext.availableTools || []) {
    if (!isLikelyBuiltin(builtinName)) {
      warnings.push(`availableTools references unknown built-in tool: ${builtinName}`);
    }
  }

  const mcpNames = new Set();
  for (const m of ext.mcpServers || []) {
    if (mcpNames.has(m.name)) errors.push(`Duplicate MCP server name: ${m.name}`);
    mcpNames.add(m.name);
    if (m.type === "stdio" && !m.command) {
      errors.push(`MCP server ${m.name} type=stdio requires a command`);
    }
    if ((m.type === "http" || m.type === "sse") && !m.url) {
      errors.push(`MCP server ${m.name} type=${m.type} requires a url`);
    }
  }

  const agentNames = new Set();
  for (const a of ext.customAgents || []) {
    if (agentNames.has(a.name)) errors.push(`Duplicate custom agent name: ${a.name}`);
    agentNames.add(a.name);
    for (const tname of a.tools || []) {
      if (!toolNames.has(tname) && !isLikelyBuiltin(tname)) {
        warnings.push(`Custom agent ${a.name} references tool ${tname} that is neither defined here nor a known built-in.`);
      }
    }
    for (const ref of a.mcpServers || []) {
      if (!mcpNames.has(ref)) errors.push(`Custom agent ${a.name} references unknown MCP server: ${ref}`);
    }
  }

  if (ext.agent && !agentNames.has(ext.agent)) {
    errors.push(`extensions.agent='${ext.agent}' refers to unknown custom agent`);
  }

  if (ext.permissions && ext.permissions.mode === "custom" && !ext.permissions.handler) {
    errors.push("permissions.mode='custom' requires permissions.handler");
  }
  if (ext.permissions && ext.permissions.mode === "allowList" && !(ext.permissions.autoApprove && ext.permissions.autoApprove.length)) {
    warnings.push("permissions.mode='allowList' without autoApprove entries; nothing will auto-approve.");
  }

  if (ext.sessionFs && ext.sessionFs.provider === "custom" && !ext.sessionFs.handler) {
    errors.push("extensions.sessionFs.provider='custom' requires extensions.sessionFs.handler");
  }

  const transport = manifest.runtime && manifest.runtime.copilotSdk && manifest.runtime.copilotSdk.transport;
  const cliUrl = manifest.runtime && manifest.runtime.copilotSdk && manifest.runtime.copilotSdk.cliUrl;
  if (transport === "external" && !cliUrl) {
    errors.push("runtime.copilotSdk.transport='external' requires cliUrl");
  }
  if (transport !== "external" && cliUrl) {
    warnings.push("runtime.copilotSdk.cliUrl set but transport is not 'external'; cliUrl will be ignored.");
  }

  return { errors, warnings };
}

const KNOWN_BUILTINS = new Set([
  "view", "edit", "create_file", "grep", "glob", "shell", "powershell",
  "bash", "ask_user", "fetch", "task", "lsp", "store_memory", "report_intent",
  "session_store_sql", "sql", "show_file",
]);

function isLikelyBuiltin(name) {
  return KNOWN_BUILTINS.has(name);
}

/**
 * Validate a parsed manifest. Throws AmpValidationError on failure.
 * Returns { warnings: string[] }.
 */
function validateManifest(manifest) {
  const validate = getStructuralValidator();
  const ok = validate(manifest);
  if (!ok) {
    const messages = formatAjvErrors(validate.errors);
    throw new AmpValidationError(
      "AMP manifest failed schema validation:\n  - " + messages.join("\n  - "),
      messages,
    );
  }
  const { errors, warnings } = semanticChecks(manifest);
  if (errors.length) {
    throw new AmpValidationError(
      "AMP manifest failed semantic validation:\n  - " + errors.join("\n  - "),
      errors,
    );
  }
  return { warnings };
}

module.exports = {
  validateManifest,
  AmpValidationError,
  KNOWN_BUILTINS,
  SCHEMA_PATH,
};
