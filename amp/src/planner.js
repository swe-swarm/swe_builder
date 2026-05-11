/*---------------------------------------------------------------------------------------------
 *  AMP build planner.
 *  Translates a normalized AMP manifest into a per-language build plan
 *  (list of file emissions + post-actions). Generators consume the plan
 *  and emit files. Pure data; no I/O.
 *--------------------------------------------------------------------------------------------*/

"use strict";

const path = require("path");
const { listExtensions } = require("./extension-registry");

/**
 * Returns:
 * {
 *   language: "typescript" | "python" | "go",
 *   outDir: string,           // absolute path
 *   manifestDir: string,      // absolute path of the manifest's directory
 *   files: Array<{ relPath, contents, executable?, mode? }>,
 *   postActions: Array<{ kind: "log" | "exec", message?, command?, args? }>,
 *   surfaces: Array<{id, ampField, sdkSurface, description}>,
 *   manifest: NormalizedManifest,
 * }
 *
 * Generators add file entries via createPlan() returning the skeleton, then
 * mutate plan.files / plan.postActions as they emit.
 */
function createPlan({ manifest, manifestDir, outDir }) {
  const language = manifest.agent.language;
  const absOutDir = path.resolve(outDir || path.join(manifestDir, "out", manifest.agent.name));
  const surfaces = listExtensions().filter((s) => isSurfaceUsed(manifest, s.id));
  return {
    language,
    outDir: absOutDir,
    manifestDir,
    files: [],
    postActions: [],
    surfaces,
    manifest,
  };
}

function isSurfaceUsed(manifest, surfaceId) {
  const ext = manifest.extensions || {};
  switch (surfaceId) {
    case "tools": return (ext.tools || []).length > 0;
    case "availableTools": return Array.isArray(ext.availableTools);
    case "excludedTools": return (ext.excludedTools || []).length > 0;
    case "mcpServers": return (ext.mcpServers || []).length > 0;
    case "customAgents": return (ext.customAgents || []).length > 0;
    case "defaultAgent": return !!ext.defaultAgent;
    case "agent": return !!ext.agent;
    case "hooks": return !!ext.hooks && Object.keys(ext.hooks).length > 0;
    case "permissions": return true;
    case "skills":
      return (ext.skills && (
        (ext.skills.directories || []).length > 0 ||
        (ext.skills.disabled || []).length > 0 ||
        (ext.skills.inline || []).length > 0
      ));
    case "systemMessage": return !!ext.systemMessage;
    case "sessionFs": return !!ext.sessionFs;
    case "ui.elicitation": return !!(manifest.runtime && manifest.runtime.ui && manifest.runtime.ui.elicitation);
    case "lifecycle": return !!ext.lifecycle;
    case "userInput": return !!ext.userInput;
    case "commands": return (ext.commands || []).length > 0;
    case "infiniteSessions": return !!(manifest.runtime && manifest.runtime.infiniteSessions);
    case "streaming": return !!(manifest.runtime && manifest.runtime.streaming);
    case "communication": return !!manifest.communication;
    default: return false;
  }
}

function addFile(plan, relPath, contents, opts = {}) {
  plan.files.push({ relPath, contents, executable: !!opts.executable, mode: opts.mode });
}

function addLog(plan, message) {
  plan.postActions.push({ kind: "log", message });
}

function addExec(plan, command, args = []) {
  plan.postActions.push({ kind: "exec", command, args });
}

module.exports = { createPlan, isSurfaceUsed, addFile, addLog, addExec };
