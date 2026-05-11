# AMP Extensibility Catalog
Every AMP extension point mapped to its generated Copilot SDK surface.

This document mirrors the in-code registry at amp/src/extension-registry.js. Run `swe_builder amp list-extensions` for the canonical machine-readable form.

## Table of contents

- [Registry table](#registry-table)
- [tools](#tools)
- [availableTools](#availabletools)
- [excludedTools](#excludedtools)
- [mcpServers](#mcpservers)
- [customAgents](#customagents)
- [defaultAgent](#defaultagent)
- [agent](#agent)
- [hooks](#hooks)
- [permissions](#permissions)
- [skills](#skills)
- [systemMessage](#systemmessage)
- [sessionFs](#sessionfs)
- [ui.elicitation](#uielicitation)
- [lifecycle](#lifecycle)
- [userInput](#userinput)
- [commands](#commands)
- [infiniteSessions](#infinitesessions)
- [streaming](#streaming)
- [communication](#communication)

## Registry table

| ID | AMP Field | SDK Surface | Description |
| --- | --- | --- | --- |
| tools | extensions.tools | SessionConfig.tools (DefineTool / define_tool / DefineTool[T,U]) | Custom function tools the agent can call. |
| availableTools | extensions.availableTools | SessionConfig.availableTools | Allowlist of built-in tool names. Empty array disables all built-ins. |
| excludedTools | extensions.excludedTools | SessionConfig.excludedTools | Removes specific built-in tools. |
| mcpServers | extensions.mcpServers | SessionConfig.mcpServers (stdio / http / sse) | MCP servers wired to the session. |
| customAgents | extensions.customAgents | SessionConfig.customAgents | Sub-agent personas selectable at runtime. |
| defaultAgent | extensions.defaultAgent | SessionConfig.defaultAgent | Override default agent tool list. |
| agent | extensions.agent | SessionConfig.agent | Pre-select a custom agent at session start. |
| hooks | extensions.hooks | SessionConfig.hooks (preToolUse / postToolUse / userPromptSubmitted / sessionStart / sessionEnd / errorOccurred) | Lifecycle hooks invoked by the runtime. |
| permissions | extensions.permissions | SessionConfig.onPermissionRequest | Required handler for tool permission requests. mode=approveAll wires the helper; custom uses your file. NOTE: protocol v2 NO_RESULT short-circuit is not allowed. |
| skills | extensions.skills | SessionConfig.skillDirectories / disabledSkills | Skill directories scanned at session start. |
| systemMessage | extensions.systemMessage | SessionConfig.systemMessage (customize / append / replace) | System message customization. customize mode supports section transforms (function-valued sections trigger reverse RPC systemMessage.transform). |
| sessionFs | extensions.sessionFs | CopilotClientOptions.createSessionFsHandler / SessionFsProvider | Virtual session filesystem provider. memory backs operations with an in-process Map (great for WASM/sandbox). |
| ui.elicitation | runtime.ui.elicitation | SessionConfig.capabilities.ui.elicitation + session.ui.{confirm,select,input} | Enables interactive UI prompts from the agent. |
| lifecycle | extensions.lifecycle | CopilotClient.on(SessionLifecycleEvent) | Client-level lifecycle event subscriber (session.created, session.resumed, session.disconnected, etc.). |
| userInput | extensions.userInput | SessionConfig.onUserInputRequest (legacy ask_user reverse channel) | Optional handler for user-input requests originating from the runtime. |
| commands | extensions.commands | SessionConfig.commands | Slash-style commands the agent can execute through the runtime. |
| infiniteSessions | runtime.infiniteSessions | SessionConfig.infiniteSessions | Persists workspace state across compaction; emits session.compaction_start / _complete events. |
| streaming | runtime.streaming | SessionConfig.streaming | Emits assistant.message_delta / assistant.reasoning_delta. Full message events still fire. |
| communication | communication | AMP-ACS (Agent Communication Standards) - broadcast/inbox/handoff helpers generated alongside the SDK code. | Layer on top of copilot-sdk events. See knowledge/amp/agent-communication-standards.md. |

## tools

When to use: Add `extensions.tools` when the agent needs project-specific callable functions beyond built-in CLI tools.

Design rationale: AMP treats tools as the primary boundary between reasoning and deterministic work. The manifest holds the schema and handler contract while generators produce language-native tool registration.

Spec link: [tools](./amp-spec.md#tools).

## availableTools

When to use: Add `extensions.availableTools` when you want to restrict built-in tools to a known safe list or disable them all with an empty list.

Design rationale: Built-in tool allowlists are easier to audit than ad hoc permission prompts. This field keeps built-in tool policy independent of custom tool definitions.

Spec link: [availableTools](./amp-spec.md#availabletools).

## excludedTools

When to use: Add `extensions.excludedTools` when most built-ins are allowed but a small set should be removed.

Design rationale: Denylists are concise for mature workspaces where the default tool set is acceptable except for a few high-risk actions.

Spec link: [excludedTools](./amp-spec.md#excludedtools).

## mcpServers

When to use: Add `extensions.mcpServers` when the agent should connect to MCP servers for external tools, data, or actions.

Design rationale: MCP configuration belongs in the manifest so custom agents and generated session config can refer to stable server names.

Spec link: [mcpServers](./amp-spec.md#mcpservers).

## customAgents

When to use: Add `extensions.customAgents` when a single generated process should expose multiple personas or specialist sub-agents.

Design rationale: Custom agents let one runtime switch policies, prompts, tools, and MCP access without creating separate projects.

Spec link: [customAgents](./amp-spec.md#customagents).

## defaultAgent

When to use: Add `extensions.defaultAgent` to override the default agent tool set before any custom agent is selected.

Design rationale: Default policy should be explicit in shared or production manifests. This field makes the baseline agent easier to review.

Spec link: [defaultAgent](./amp-spec.md#defaultagent).

## agent

When to use: Add `extensions.agent` to start sessions with one named custom agent selected by default.

Design rationale: Pre-selection makes scripted agents deterministic and avoids prompting or runtime selection logic.

Spec link: [agent](./amp-spec.md#agent).

## hooks

When to use: Add `extensions.hooks` when code must observe or transform session events such as tool use or prompt submission.

Design rationale: Hooks are lifecycle interceptors. AMP keeps their handler paths declarative so generated projects can attach them consistently.

Spec link: [hooks](./amp-spec.md#hooks).

## permissions

When to use: Always set `extensions.permissions` deliberately for production manifests. Use `approveAll` only for trusted demos, `denyAll` for strict runs, `allowList` for simple policy, and `custom` for advanced policy.

Design rationale: Tool permission policy is security-sensitive and should be visible at manifest review time.

Spec link: [permissions](./amp-spec.md#permissions).

## skills

When to use: Add `extensions.skills` when the generated agent should load file-based or inline skills at session start.

Design rationale: Skills package reusable instructions while keeping the main system message smaller and more maintainable.

Spec link: [skills](./amp-spec.md#skills).

## systemMessage

When to use: Add `extensions.systemMessage` when the generated agent needs identity, rule, or behavior changes beyond the default SDK prompt.

Design rationale: System message customization is central to agent behavior, so AMP makes it explicit and versioned in the manifest.

Spec link: [systemMessage](./amp-spec.md#systemmessage).

## sessionFs

When to use: Add `extensions.sessionFs` for sandboxed, in-memory, WASM-like, or custom filesystem scenarios.

Design rationale: The session filesystem is a process boundary. AMP separates the provider choice from language-specific implementation details.

Spec link: [sessionFs](./amp-spec.md#sessionfs).

## ui.elicitation

When to use: Set `runtime.ui.elicitation` when the agent can ask interactive questions through a host UI.

Design rationale: UI elicitation requires host capability negotiation. AMP keeps the capability switch in runtime config rather than hiding it in handlers.

Spec link: [ui.elicitation](./amp-spec.md#ui-elicitation).

## lifecycle

When to use: Add `extensions.lifecycle` when a client-level subscriber must track sessions being created, resumed, disconnected, or compacted.

Design rationale: Lifecycle observability belongs at client scope instead of inside a single session handler.

Spec link: [lifecycle](./amp-spec.md#lifecycle).

## userInput

When to use: Add `extensions.userInput` only when integrating with legacy ask-user request flows.

Design rationale: The field preserves compatibility while keeping newer UI elicitation config separate.

Spec link: [userInput](./amp-spec.md#userinput).

## commands

When to use: Add `extensions.commands` when users need slash-style commands exposed inside the agent runtime.

Design rationale: Commands are structured entry points that are easier to discover and test than free-form prompts.

Spec link: [commands](./amp-spec.md#commands).

## infiniteSessions

When to use: Set `runtime.infiniteSessions` for long-running workspaces where compaction and persisted state are desired.

Design rationale: Infinite sessions change storage and event behavior. AMP makes that decision visible in runtime config.

Spec link: [infiniteSessions](./amp-spec.md#infinitesessions).

## streaming

When to use: Set `runtime.streaming` to control streaming deltas. Keep it true for responsive UIs and false for simpler batch transcripts.

Design rationale: Streaming affects event consumers but not final assistant messages. The manifest records the expected event mode.

Spec link: [streaming](./amp-spec.md#streaming).

## communication

When to use: Add `communication` when generated agents must broadcast status, receive inbox prompts, or coordinate handoffs with peers.

Design rationale: AMP-ACS is intentionally layered beside the SDK. It gives orchestrators a stable inter-agent envelope without replacing MCP.

Spec link: [communication](./amp-spec.md#communication).
