# AMP Manifest Specification
Schema and semantic contract for `swe.amp.yaml` and related AMP manifest files.

## Table of contents

- [Canonical files](#canonical-files)
- [Validation model](#validation-model)
- [Top-level schema](#top-level-schema)
- [ampVersion](#ampversion)
- [agent](#agent)
- [runtime](#runtime)
- [extensions](#extensions)
- [communication](#communication)
- [build](#build)
- [deployment](#deployment)
- [Extension surfaces](#extension-surfaces)
- [Semantic constraints](#semantic-constraints)
- [SDK pins and pinning policy](#sdk-pins-and-pinning-policy)
- [Permission modes and protocol quirks](#permission-modes-and-protocol-quirks)

## Canonical files

| File | Role |
| --- | --- |
| `amp/schemas/amp.schema.json` | Canonical JSON schema contract. |
| `amp/schemas/amp.types.d.ts` | TypeScript reference type file kept in sync with the schema. |
| `amp/src/validator.js` | AJV structural validation plus semantic checks. |
| `amp/src/normalizer.js` | Default application for generator inputs. |
| `amp/src/extension-registry.js` | Registry mapping AMP fields to SDK surfaces. |
| `amp/src/version.js` | AMP version, SDK protocol version, framework version, and SDK pins. |

## Validation model

AMP validation has two layers.

1. Structural validation uses AJV with `amp/schemas/amp.schema.json`.
2. Semantic validation runs cross-field checks in `amp/src/validator.js`.

A structurally valid manifest can still fail semantic validation. For example, an MCP stdio server is structurally valid with only `name` and `type`, but semantic validation requires `command` when `type` is `stdio`.

## Top-level schema

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `ampVersion` | string enum | yes | none | AMP schema version. Must be `1.0`. |
| `agent` | object | yes | none | Agent identity and target language. |
| `runtime` | object | yes | none | Copilot SDK runtime configuration. |
| `extensions` | object | no | normalized to empty collections | Optional SDK extension surfaces. |
| `communication` | object | no | none | AMP-ACS broadcast, inbox, and handoff configuration. |
| `build` | object | no | output dir, bundler, package manager | Generated project build settings. |
| `deployment` | object | no | standalone target with empty scripts and env | Deployment metadata for generated README and env files. |

```yaml
ampVersion: "1.0"
agent:
  name: sample-agent
  displayName: Sample Agent
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
extensions:
  permissions:
    mode: approveAll
```

## ampVersion

| Property | Value |
| --- | --- |
| Type | string |
| Required | yes |
| Allowed values | `1.0` |
| Default | none |

`ampVersion` selects the manifest schema. The current framework accepts only `1.0`.

```yaml
ampVersion: "1.0"
agent:
  name: versioned-agent
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
extensions:
  permissions:
    mode: approveAll
```

## agent

`agent` identifies the generated project and selects the target generator.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `agent.name` | string | yes | none | Slug used as project name and binary name. |
| `agent.displayName` | string | no | `agent.name` | Human-readable name. |
| `agent.version` | semver string | no | `0.1.0` | Agent package version. |
| `agent.description` | string | no | generator text | Description for generated metadata. |
| `agent.author` | string | no | none | Author metadata. |
| `agent.license` | string | no | `MIT` | License metadata. |
| `agent.language` | string enum | yes | none | `typescript`, `python`, or `go`. |
| `agent.tags` | string array | no | none | Search and catalog tags. |

```yaml
ampVersion: "1.0"
agent:
  name: catalog-agent
  displayName: Catalog Agent
  version: 0.1.0
  description: Searches an internal catalog.
  author: Agent Team
  license: MIT
  language: go
  tags:
    - catalog
    - amp
runtime:
  copilotSdk:
    transport: stdio
extensions:
  permissions:
    mode: approveAll
```

## runtime

`runtime` maps to Copilot client options and session configuration.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `runtime.copilotSdk` | object | yes | none | Client transport, CLI, token, and log settings. |
| `runtime.model` | object | no | `{ name: "claude-sonnet-4.5" }` | Model and reasoning settings. |
| `runtime.provider` | object | no | none | BYOK provider config passed to SDK provider options. |
| `runtime.workingDirectory` | string | no | `.` | Working directory resolved relative to the manifest. |
| `runtime.streaming` | boolean | no | `true` | Enables streaming delta events. |
| `runtime.includeSubAgentStreamingEvents` | boolean | no | `false` | Includes sub-agent streaming events. |
| `runtime.infiniteSessions` | boolean | no | `false` | Enables persisted infinite session state. |
| `runtime.ui.elicitation` | boolean | no | `false` | Enables UI elicitation capability. |

### runtime.copilotSdk

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `transport` | enum | no | `stdio` | `stdio`, `tcp`, or `external`. |
| `cliUrl` | URI string | no | none | Required when `transport` is `external`. |
| `cliPath` | string | no | none | Path override for Copilot CLI. |
| `useLoggedInUser` | boolean | no | true unless `gitHubTokenEnv` is set | Use the logged-in CLI user. |
| `gitHubTokenEnv` | string | no | none | Environment variable holding a token. |
| `logLevel` | enum | no | `warning` | `error`, `warning`, `info`, `debug`, `all`, or `none`. |
| `sessionIdleTimeoutSec` | integer | no | SDK default | Session idle timeout in seconds. |

```yaml
ampVersion: "1.0"
agent:
  name: external-cli-agent
  language: typescript
runtime:
  copilotSdk:
    transport: external
    cliUrl: http://127.0.0.1:8123
    logLevel: info
    sessionIdleTimeoutSec: 120
  model:
    name: claude-sonnet-4.5
    reasoningEffort: medium
  workingDirectory: .
  streaming: true
  includeSubAgentStreamingEvents: true
  infiniteSessions: true
  ui:
    elicitation: true
extensions:
  permissions:
    mode: approveAll
```

### runtime.provider

Provider fields are passed through as SDK provider configuration. The schema allows additional provider-specific properties.

```yaml
ampVersion: "1.0"
agent:
  name: byok-agent
  language: python
runtime:
  copilotSdk:
    transport: stdio
  provider:
    type: openai
    baseUrl: https://example.com/v1
    apiKey: ${OPENAI_API_KEY}
extensions:
  permissions:
    mode: approveAll
```

## extensions

`extensions` holds optional Copilot SDK surfaces. Normalization always creates empty arrays for list fields and default permissions.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tools` | array of Tool | no | `[]` | Custom function tools. |
| `availableTools` | string array | no | SDK default | Built-in tool allowlist. Empty array disables all built-ins. |
| `excludedTools` | string array | no | `[]` | Built-in tool denylist. |
| `mcpServers` | array of McpServer | no | `[]` | MCP server definitions. |
| `customAgents` | array of CustomAgent | no | `[]` | Sub-agent personas. |
| `defaultAgent` | object | no | none | Default agent tool override. |
| `agent` | string | no | none | Pre-selected custom agent name. |
| `hooks` | object | no | none | Session hook handler paths. |
| `permissions` | object | no | `{ mode: "custom", autoApprove: [] }` | Permission handler policy. |
| `skills` | object | no | empty directories, disabled, inline | Skill directories and inline skills. |
| `systemMessage` | object | no | none | System message customization. |
| `sessionFs` | object | no | none | Session filesystem provider. |
| `lifecycle` | object | no | none | Client lifecycle subscriber. |
| `userInput` | object | no | none | Legacy user-input reverse channel handler. |
| `commands` | array of Command | no | `[]` | Slash-style commands. |

## communication

`communication` configures AMP-ACS helpers. See [AMP-ACS](./agent-communication-standards.md) for the wire-level standard.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `communication.standard` | enum | no | `amp-acs-1.0` | Communication standard version. |
| `communication.id` | string | no | `agent.name` | Stable agent identifier. |
| `communication.broadcast.channels` | string array | no | `[]` | Channel labels for generated broadcast helpers. |
| `communication.broadcast.transport` | enum | no | `stdout-jsonl` | `stdout-jsonl`, `websocket`, `file`, or `none`. |
| `communication.inbox.enabled` | boolean | no | `false` | Enables generated inbox polling. |
| `communication.inbox.path` | string | no | generator default | JSONL inbox path. |
| `communication.handoff` | array | no | `[]` | Peer handoff entries. |

```yaml
ampVersion: "1.0"
agent:
  name: comms-agent
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
extensions:
  permissions:
    mode: approveAll
communication:
  standard: amp-acs-1.0
  id: comms-agent
  broadcast:
    transport: stdout-jsonl
    channels:
      - status
      - handoff
  inbox:
    enabled: true
    path: .amp/in.jsonl
  handoff:
    - name: reviewer
      description: Review completed work.
      transport: inbox
      endpoint: .amp/reviewer.in.jsonl
```

## build

`build` controls emitted project metadata and defaults. The CLI `--out` option overrides the output directory used by the build command.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `outputDir` | string | no | `./dist` after normalization | Preferred output directory. |
| `entrypoint` | string | no | generator default | Optional generated entrypoint hint. |
| `bundler` | enum | no | `none` | `none`, `esbuild`, `tsc`, or `tsx`. |
| `packageManager` | enum | no | language default | `npm`, `pnpm`, `yarn`, `uv`, `pip`, or `go`. |

```yaml
ampVersion: "1.0"
agent:
  name: build-agent
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
extensions:
  permissions:
    mode: approveAll
build:
  outputDir: ./dist
  entrypoint: src/index.ts
  bundler: tsx
  packageManager: npm
```

## deployment

`deployment` provides generated README and environment metadata. AMP does not deploy infrastructure from this object today.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `target` | enum | no | `standalone` | `standalone`, `container`, `wasm`, or `serverless`. |
| `scripts` | string map | no | `{}` | Named script commands. |
| `env` | string map | no | `{}` | Environment variable names and placeholder values. |

```yaml
ampVersion: "1.0"
agent:
  name: deploy-agent
  language: python
runtime:
  copilotSdk:
    transport: stdio
extensions:
  permissions:
    mode: approveAll
deployment:
  target: standalone
  scripts:
    start: uv run python -m deploy_agent.main
  env:
    GITHUB_TOKEN: ""
```

## Extension surfaces

Each subsection mirrors one row from `listExtensions()`.

### tools

- AMP field: `extensions.tools`
- SDK surface: `SessionConfig.tools` using `defineTool` in TypeScript, `define_tool` in Python, and generic `DefineTool[T,U]` in Go.
- Language notes: TypeScript emits `src/tools/<name>.ts`; Python emits pydantic parameter models in `src/<pkg>/tools/<name>.py`; Go emits typed parameter structs in `tools/<name>.go`.

```yaml
ampVersion: "1.0"
agent:
  name: tools-agent
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
extensions:
  tools:
    - name: lookup
      description: Look up a record.
      paramsSchema:
        type: object
        required:
          - query
        properties:
          query:
            type: string
      stub:
        kind: echo
  permissions:
    mode: approveAll
```

### availabletools

- AMP field: `extensions.availableTools`
- SDK surface: `SessionConfig.availableTools`
- Language notes: All generators pass through the string list. An empty array disables all built-in tools.

```yaml
ampVersion: "1.0"
agent:
  name: available-tools-agent
  language: go
runtime:
  copilotSdk:
    transport: stdio
extensions:
  availableTools:
    - view
    - grep
  permissions:
    mode: approveAll
```

### excludedtools

- AMP field: `extensions.excludedTools`
- SDK surface: `SessionConfig.excludedTools`
- Language notes: All generators pass through the string list.

```yaml
ampVersion: "1.0"
agent:
  name: excluded-tools-agent
  language: python
runtime:
  copilotSdk:
    transport: stdio
extensions:
  excludedTools:
    - edit
  permissions:
    mode: approveAll
```

### mcpservers

- AMP field: `extensions.mcpServers`
- SDK surface: `SessionConfig.mcpServers`
- Language notes: TypeScript emits a `Record<string, MCPServerConfig>`; Python emits a dictionary; Go emits `map[string]copilot.MCPServerConfig`. Go maps `sse` manifests to the HTTP MCP config shape.

```yaml
ampVersion: "1.0"
agent:
  name: mcp-agent
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
extensions:
  mcpServers:
    - name: local_docs
      type: stdio
      command: node
      args:
        - ./mcp/local-docs.js
      env:
        LOG_LEVEL: info
      tools:
        - search_docs
    - name: remote_search
      type: http
      url: https://example.com/mcp
  permissions:
    mode: approveAll
```

### customagents

- AMP field: `extensions.customAgents`
- SDK surface: `SessionConfig.customAgents`
- Language notes: TypeScript reads `systemPrompt` from a file when path-like; Python uses `prompt`; Go emits `CustomAgentConfig` and can read prompt assets.

```yaml
ampVersion: "1.0"
agent:
  name: custom-agent-host
  language: go
runtime:
  copilotSdk:
    transport: stdio
extensions:
  customAgents:
    - name: reviewer
      description: Reviews implementation plans.
      systemPrompt: Review for correctness and risk.
      model: claude-sonnet-4.5
      reasoningEffort: low
      tools:
        - view
  permissions:
    mode: approveAll
```

### defaultagent

- AMP field: `extensions.defaultAgent`
- SDK surface: `SessionConfig.defaultAgent`
- Language notes: TypeScript and Python pass tool lists directly. The Go generator currently focuses on excluded tools in its default-agent config.

```yaml
ampVersion: "1.0"
agent:
  name: default-agent-host
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
extensions:
  defaultAgent:
    name: default
    tools:
      - view
      - grep
    excludedTools:
      - edit
  permissions:
    mode: approveAll
```

### agent

- AMP field: `extensions.agent`
- SDK surface: `SessionConfig.agent`
- Language notes: The named custom agent must also appear in `extensions.customAgents`.

```yaml
ampVersion: "1.0"
agent:
  name: selected-agent-host
  language: python
runtime:
  copilotSdk:
    transport: stdio
extensions:
  customAgents:
    - name: reviewer
      description: Reviews work.
      tools:
        - view
  agent: reviewer
  permissions:
    mode: approveAll
```

### hooks

- AMP field: `extensions.hooks`
- SDK surface: `SessionConfig.hooks`
- Language notes: Handler names differ by SDK. AMP keys are `preToolUse`, `postToolUse`, `userPromptSubmitted`, `sessionStart`, `sessionEnd`, and `errorOccurred`.

```yaml
ampVersion: "1.0"
agent:
  name: hooks-agent
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
extensions:
  hooks:
    preToolUse: ./src/hooks/pre-tool-use.js
    postToolUse: ./src/hooks/post-tool-use.js
  permissions:
    mode: approveAll
```

### permissions

- AMP field: `extensions.permissions`
- SDK surface: `SessionConfig.onPermissionRequest`
- Language notes: TypeScript uses `approveAll` for `approveAll` and generated handlers for custom or allow-list modes. Python and Go emit language-specific handler files for `allowList` and `custom`.

```yaml
ampVersion: "1.0"
agent:
  name: permissions-agent
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
extensions:
  permissions:
    mode: allowList
    autoApprove:
      - tool: view
      - tool: lookup
        argsContains: docs
```

### skills

- AMP field: `extensions.skills`
- SDK surface: `SessionConfig.skillDirectories` and `SessionConfig.disabledSkills`
- Language notes: Inline skills are written to generated `skills` folders. Directory paths are passed through.

```yaml
ampVersion: "1.0"
agent:
  name: skills-agent
  language: go
runtime:
  copilotSdk:
    transport: stdio
extensions:
  skills:
    directories:
      - skills
    disabled:
      - legacy-skill
    inline:
      - name: triage
        description: Triage incoming tasks.
        instructions: Classify work by severity and owner.
  permissions:
    mode: approveAll
```

### systemmessage

- AMP field: `extensions.systemMessage`
- SDK surface: `SessionConfig.systemMessage`
- Language notes: `customize`, `append`, and `replace` modes are supported. Section transforms are represented with action and content values in generated code.

```yaml
ampVersion: "1.0"
agent:
  name: system-message-agent
  language: python
runtime:
  copilotSdk:
    transport: stdio
extensions:
  systemMessage:
    mode: customize
    sections:
      identity:
        append: You are a careful AMP agent.
      rules:
        prepend: Prefer tested changes.
  permissions:
    mode: approveAll
```

### sessionfs

- AMP field: `extensions.sessionFs`
- SDK surface: client session filesystem provider options.
- Language notes: `memory` emits an in-process provider in all languages. `custom` requires a handler path and is wired most directly in TypeScript; Python emits a TODO factory; Go currently emits memory only.

```yaml
ampVersion: "1.0"
agent:
  name: session-fs-agent
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
extensions:
  sessionFs:
    provider: memory
  permissions:
    mode: approveAll
```

### ui-elicitation

- AMP field: `runtime.ui.elicitation`
- SDK surface: UI elicitation capability and request handler.
- Language notes: Generators provide conservative default handlers that cancel or decline prompts until an application UI replaces them.

```yaml
ampVersion: "1.0"
agent:
  name: ui-agent
  language: go
runtime:
  copilotSdk:
    transport: stdio
  ui:
    elicitation: true
extensions:
  permissions:
    mode: approveAll
```

### lifecycle

- AMP field: `extensions.lifecycle`
- SDK surface: `CopilotClient.on(SessionLifecycleEvent)`
- Language notes: TypeScript imports a user handler; Python and Go emit lifecycle stubs.

```yaml
ampVersion: "1.0"
agent:
  name: lifecycle-agent
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
extensions:
  lifecycle:
    handler: ./src/lifecycle.js
  permissions:
    mode: approveAll
```

### userinput

- AMP field: `extensions.userInput`
- SDK surface: `SessionConfig.onUserInputRequest`
- Language notes: This is the legacy ask-user reverse channel. Prefer UI elicitation for new interactive agents when available.

```yaml
ampVersion: "1.0"
agent:
  name: user-input-agent
  language: python
runtime:
  copilotSdk:
    transport: stdio
extensions:
  userInput:
    handler: ./src/user-input.py
  permissions:
    mode: approveAll
```

### commands

- AMP field: `extensions.commands`
- SDK surface: `SessionConfig.commands`
- Language notes: TypeScript emits command handler modules; Python emits command definitions in `commands.py`; Go emits command packages.

```yaml
ampVersion: "1.0"
agent:
  name: commands-agent
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
extensions:
  commands:
    - name: summarize
      description: Summarize the current session.
      argsHint: <topic>
      handler: ./src/commands/summarize.js
  permissions:
    mode: approveAll
```

### infinitesessions

- AMP field: `runtime.infiniteSessions`
- SDK surface: `SessionConfig.infiniteSessions`
- Language notes: All generators wire the feature through session config. It persists workspace state and emits compaction events from the SDK.

```yaml
ampVersion: "1.0"
agent:
  name: infinite-agent
  language: go
runtime:
  copilotSdk:
    transport: stdio
  infiniteSessions: true
extensions:
  permissions:
    mode: approveAll
```

### streaming

- AMP field: `runtime.streaming`
- SDK surface: `SessionConfig.streaming`
- Language notes: All generators set streaming. When true, delta events are available while final message events still fire.

```yaml
ampVersion: "1.0"
agent:
  name: streaming-agent
  language: python
runtime:
  copilotSdk:
    transport: stdio
  streaming: true
  includeSubAgentStreamingEvents: true
extensions:
  permissions:
    mode: approveAll
```

### communication

- AMP field: `communication`
- SDK surface: AMP-ACS helper code generated alongside SDK code.
- Language notes: TypeScript emits broadcast and inbox helpers in `src/index.ts` and handoff helpers in `src/comms`; Python emits broadcast and inbox logic in `main.py` and handoff helpers in `comms`; Go emits broadcast, inbox polling, and handoff helpers.

```yaml
ampVersion: "1.0"
agent:
  name: communication-agent
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
extensions:
  permissions:
    mode: approveAll
communication:
  standard: amp-acs-1.0
  id: communication-agent
  broadcast:
    transport: stdout-jsonl
    channels:
      - review.findings
  inbox:
    enabled: true
    path: .amp/in.jsonl
  handoff:
    - name: test-agent
      description: Runs test validation.
      transport: inbox
      endpoint: .amp/test-agent.in.jsonl
```

## Semantic constraints

The validator enforces these semantic rules after schema validation.

| Rule | Severity | Reason |
| --- | --- | --- |
| Tool names must be unique. | error | `SessionConfig.tools` cannot safely register duplicates. |
| A tool without `handler` or `stub` is allowed but warned. | warning | Generators emit TODO code. |
| MCP server names must be unique. | error | MCP maps are keyed by name. |
| `mcpServers[].type: stdio` requires `command`. | error | The runtime cannot start a stdio server without a command. |
| `mcpServers[].type: http` or `sse` requires `url`. | error | Remote transports need an endpoint. |
| Custom agent names must be unique. | error | Agent selection is name based. |
| Custom agent tool names should be declared tools or known built-ins. | warning | Unknown tool references might fail at runtime. |
| Custom agent MCP server references must exist. | error | Referenced MCP server maps are generated from declared servers. |
| `extensions.agent` must name a declared custom agent. | error | The SDK cannot pre-select an unknown agent. |
| `permissions.mode: custom` requires `permissions.handler`. | error | Custom mode needs handler code. |
| `permissions.mode: allowList` should include `autoApprove`. | warning | Otherwise nothing auto-approves. |
| `sessionFs.provider: custom` requires `sessionFs.handler`. | error | Custom providers need a factory. |
| `runtime.copilotSdk.transport: external` requires `cliUrl`. | error | External transport needs a server URL. |
| `cliUrl` with non-external transport is ignored. | warning | The URL is not used unless transport is external. |

## SDK pins and pinning policy

`SDK_PINS` in `amp/src/version.js` is authoritative.

| Language | Pin |
| --- | --- |
| TypeScript | `@github/copilot-sdk@^0.5.0`, `@github/copilot@^1.0.36-0` |
| Python | `github-copilot-sdk>=0.5.0,<0.6.0` |
| Go | `github.com/github/copilot-sdk/go@v0.5.0` |

Pinning policy:

1. Pins are fixed per AMP framework version.
2. Do not change emitted dependency pins without bumping the framework version.
3. Bumping the framework version should include generator compatibility checks for all three languages.
4. Generated `swe.amp.lock.json` records the AMP version, SDK protocol version, framework version, language, and source manifest reference or manifest content. TypeScript also records a live generated timestamp. Python records a deterministic generated timestamp for reproducible tests. Go records a manifest hash and uses `copilotSdkProtocolVersion` for the protocol key.

## Permission modes and protocol quirks

| Mode | Behavior |
| --- | --- |
| `approveAll` | Wires the SDK approve-all helper. Best for demos and trusted local agents. |
| `denyAll` | Rejects tool permission requests. Best for read-only dry runs. |
| `allowList` | Auto-approves matching `autoApprove` rules. Unmatched behavior is language-specific. |
| `custom` | Delegates to a user handler. Requires `handler`. |

Protocol-v2 quirk: older server protocol behavior included a `NO_RESULT` style short-circuit for permission handlers. AMP generators targeting protocol-v2 servers must not emit no-result returns from permission handlers because v2 servers cannot treat that as an interoperable policy response. The current framework pins SDK protocol version 3. For v2 compatibility work, use explicit approve or reject responses instead of relying on no-result fallthrough.
