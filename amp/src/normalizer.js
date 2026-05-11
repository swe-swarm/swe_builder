/*---------------------------------------------------------------------------------------------
 *  AMP manifest normalizer.
 *  Applies defaults so generators see a fully populated, predictable manifest.
 *  Pure function: returns a new object. Original is not mutated.
 *--------------------------------------------------------------------------------------------*/

"use strict";

function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = clone(v);
  return out;
}

function normalizeManifest(rawManifest) {
  const m = clone(rawManifest);

  m.agent = Object.assign(
    { version: "0.1.0", license: "MIT", displayName: m.agent && m.agent.name },
    m.agent || {},
  );

  m.runtime = m.runtime || {};
  m.runtime.copilotSdk = Object.assign(
    {
      transport: "stdio",
      logLevel: "warning",
      useLoggedInUser: !m.runtime.copilotSdk || !m.runtime.copilotSdk.gitHubTokenEnv,
    },
    m.runtime.copilotSdk || {},
  );
  m.runtime.model = Object.assign({ name: "claude-sonnet-4.5" }, m.runtime.model || {});
  m.runtime.workingDirectory = m.runtime.workingDirectory || ".";
  m.runtime.streaming = m.runtime.streaming !== false;
  m.runtime.includeSubAgentStreamingEvents = !!m.runtime.includeSubAgentStreamingEvents;
  m.runtime.infiniteSessions = !!m.runtime.infiniteSessions;
  m.runtime.ui = Object.assign({ elicitation: false }, m.runtime.ui || {});

  m.extensions = m.extensions || {};
  m.extensions.tools = m.extensions.tools || [];
  m.extensions.mcpServers = m.extensions.mcpServers || [];
  m.extensions.customAgents = m.extensions.customAgents || [];
  m.extensions.commands = m.extensions.commands || [];
  m.extensions.skills = Object.assign({ directories: [], disabled: [], inline: [] }, m.extensions.skills || {});
  m.extensions.permissions = Object.assign({ mode: "approveAll", autoApprove: [] }, m.extensions.permissions || {});
  m.extensions.systemMessage = m.extensions.systemMessage || null;
  m.extensions.sessionFs = m.extensions.sessionFs ? Object.assign({ provider: "real" }, m.extensions.sessionFs) : null;
  m.extensions.lifecycle = m.extensions.lifecycle || null;
  m.extensions.userInput = m.extensions.userInput || null;

  for (const tool of m.extensions.tools) {
    tool.skipPermission = !!tool.skipPermission;
    tool.overridesBuiltIn = !!tool.overridesBuiltIn;
  }

  m.communication = m.communication || null;
  if (m.communication) {
    m.communication.standard = m.communication.standard || "amp-acs-1.0";
    m.communication.broadcast = Object.assign({ transport: "stdout-jsonl", channels: [] }, m.communication.broadcast || {});
    m.communication.inbox = Object.assign({ enabled: false }, m.communication.inbox || {});
    m.communication.handoff = m.communication.handoff || [];
    if (!m.communication.id) m.communication.id = m.agent.name;
  }

  m.build = Object.assign(
    {
      outputDir: "./dist",
      bundler: "none",
      packageManager: defaultPackageManager(m.agent.language),
    },
    m.build || {},
  );

  m.deployment = Object.assign(
    { target: "standalone", scripts: {}, env: {} },
    m.deployment || {},
  );

  return m;
}

function defaultPackageManager(language) {
  switch (language) {
    case "typescript": return "npm";
    case "python": return "uv";
    case "go": return "go";
    default: return "npm";
  }
}

module.exports = { normalizeManifest, defaultPackageManager };
