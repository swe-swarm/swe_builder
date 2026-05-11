/*---------------------------------------------------------------------------------------------
 *  AMP extension registry.
 *  A single source of truth that maps AMP fields to copilot-sdk extensibility surfaces.
 *  Used by generators to know what to wire, by `swe_builder amp list-extensions`,
 *  and by the docs generator to emit the extensibility table.
 *--------------------------------------------------------------------------------------------*/

"use strict";

const REGISTRY = Object.freeze([
  {
    id: "tools",
    ampField: "extensions.tools",
    sdkSurface: "SessionConfig.tools (DefineTool / define_tool / DefineTool[T,U])",
    description: "Custom function tools the agent can call.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "availableTools",
    ampField: "extensions.availableTools",
    sdkSurface: "SessionConfig.availableTools",
    description: "Allowlist of built-in tool names. Empty array disables all built-ins.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "excludedTools",
    ampField: "extensions.excludedTools",
    sdkSurface: "SessionConfig.excludedTools",
    description: "Removes specific built-in tools.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "mcpServers",
    ampField: "extensions.mcpServers",
    sdkSurface: "SessionConfig.mcpServers (stdio / http / sse)",
    description: "MCP servers wired to the session.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "customAgents",
    ampField: "extensions.customAgents",
    sdkSurface: "SessionConfig.customAgents",
    description: "Sub-agent personas selectable at runtime.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "defaultAgent",
    ampField: "extensions.defaultAgent",
    sdkSurface: "SessionConfig.defaultAgent",
    description: "Override default agent tool list.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "agent",
    ampField: "extensions.agent",
    sdkSurface: "SessionConfig.agent",
    description: "Pre-select a custom agent at session start.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "hooks",
    ampField: "extensions.hooks",
    sdkSurface: "SessionConfig.hooks (preToolUse / postToolUse / userPromptSubmitted / sessionStart / sessionEnd / errorOccurred)",
    description: "Lifecycle hooks invoked by the runtime.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "permissions",
    ampField: "extensions.permissions",
    sdkSurface: "SessionConfig.onPermissionRequest",
    description: "Required handler for tool permission requests. mode=approveAll wires the helper; custom uses your file. NOTE: protocol v2 NO_RESULT short-circuit is not allowed.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "skills",
    ampField: "extensions.skills",
    sdkSurface: "SessionConfig.skillDirectories / disabledSkills",
    description: "Skill directories scanned at session start.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "systemMessage",
    ampField: "extensions.systemMessage",
    sdkSurface: "SessionConfig.systemMessage (customize / append / replace)",
    description: "System message customization. customize mode supports section transforms (function-valued sections trigger reverse RPC systemMessage.transform).",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "sessionFs",
    ampField: "extensions.sessionFs",
    sdkSurface: "CopilotClientOptions.createSessionFsHandler / SessionFsProvider",
    description: "Virtual session filesystem provider. memory backs operations with an in-process Map (great for WASM/sandbox).",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "ui.elicitation",
    ampField: "runtime.ui.elicitation",
    sdkSurface: "SessionConfig.capabilities.ui.elicitation + session.ui.{confirm,select,input}",
    description: "Enables interactive UI prompts from the agent.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "lifecycle",
    ampField: "extensions.lifecycle",
    sdkSurface: "CopilotClient.on(SessionLifecycleEvent)",
    description: "Client-level lifecycle event subscriber (session.created, session.resumed, session.disconnected, etc.).",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "userInput",
    ampField: "extensions.userInput",
    sdkSurface: "SessionConfig.onUserInputRequest (legacy ask_user reverse channel)",
    description: "Optional handler for user-input requests originating from the runtime.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "commands",
    ampField: "extensions.commands",
    sdkSurface: "SessionConfig.commands",
    description: "Slash-style commands the agent can execute through the runtime.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "infiniteSessions",
    ampField: "runtime.infiniteSessions",
    sdkSurface: "SessionConfig.infiniteSessions",
    description: "Persists workspace state across compaction; emits session.compaction_start / _complete events.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "streaming",
    ampField: "runtime.streaming",
    sdkSurface: "SessionConfig.streaming",
    description: "Emits assistant.message_delta / assistant.reasoning_delta. Full message events still fire.",
    languages: ["typescript", "python", "go"],
  },
  {
    id: "communication",
    ampField: "communication",
    sdkSurface: "AMP-ACS (Agent Communication Standards) - broadcast/inbox/handoff helpers generated alongside the SDK code.",
    description: "Layer on top of copilot-sdk events. See knowledge/amp/agent-communication-standards.md.",
    languages: ["typescript", "python", "go"],
  },
]);

function listExtensions() {
  return REGISTRY.map((entry) => ({ ...entry }));
}

function getExtension(id) {
  return REGISTRY.find((entry) => entry.id === id) || null;
}

module.exports = { REGISTRY, listExtensions, getExtension };
