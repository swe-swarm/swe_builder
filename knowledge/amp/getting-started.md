# Getting Started with AMP
Build and run a Copilot SDK agent from a declarative AMP manifest.

## Table of contents

- [Prerequisites](#prerequisites)
- [Create a new AMP project](#create-a-new-amp-project)
- [Edit the manifest](#edit-the-manifest)
- [Validate the manifest](#validate-the-manifest)
- [Build the agent](#build-the-agent)
- [Run the generated TypeScript agent](#run-the-generated-typescript-agent)
- [Add tools, hooks, MCP servers, agents, skills, and session FS](#add-tools-hooks-mcp-servers-agents-skills-and-session-fs)
- [Switch target languages](#switch-target-languages)
- [Common errors and fixes](#common-errors-and-fixes)
- [Next steps](#next-steps)

## Prerequisites

Install the required runtime before using AMP.

| Requirement | Needed for | Notes |
| --- | --- | --- |
| Node.js 18 or newer | AMP CLI and TypeScript agents | Required for all AMP commands because the CLI is Node based. |
| Python 3.11 or newer | Python agents | Optional unless `agent.language` is `python`. |
| Go 1.22 or newer | Go agents | Optional unless `agent.language` is `go`. |
| GitHub Copilot CLI | Generated agents | The SDK starts or connects to the CLI server at runtime. |

Check Node from the project root:

```text
node --version
```

## Create a new AMP project

Run the initializer from the swe_builder project root or any workspace where `swe_builder` is on your PATH.

```text
swe_builder amp init my-agent --language typescript
cd my-agent
```

The command writes `swe.amp.yaml`. The minimal manifest contains a stub tool and `approveAll` permissions so the first build can run without extra handler files.

## Edit the manifest

Open `swe.amp.yaml` and describe the agent. The schema is documented in [AMP manifest specification](./amp-spec.md). The following full manifest is valid and keeps the generated TypeScript agent runnable.

```yaml
ampVersion: "1.0"
agent:
  name: my-agent
  displayName: My Agent
  version: 0.1.0
  description: A starter AMP agent.
  language: typescript
runtime:
  copilotSdk:
    transport: stdio
    logLevel: warning
  model:
    name: claude-sonnet-4.5
  workingDirectory: .
  streaming: true
extensions:
  tools:
    - name: hello
      description: Return a friendly greeting.
      paramsSchema:
        type: object
        properties:
          name:
            type: string
      stub:
        kind: static
        value: Hello from AMP
  permissions:
    mode: approveAll
build:
  outputDir: ./dist
  bundler: tsx
  packageManager: npm
deployment:
  target: standalone
  env:
    GITHUB_TOKEN: ""
```

## Validate the manifest

Validate before every build.

```text
swe_builder amp validate
```

A valid manifest prints `Valid AMP manifest`. Validation has two categories:

- Schema validation: enforced by AJV against `amp/schemas/amp.schema.json`.
- Semantic validation: enforced in `amp/src/validator.js` for cross-field rules such as duplicate names and missing transport settings.

Warnings do not stop the build, but they usually indicate generated TODO stubs or ignored configuration.

## Build the agent

Build into a deterministic output directory.

```text
swe_builder amp build --out ./out
```

The build pipeline loads, validates, normalizes, plans, generates, and writes files. For TypeScript, the output includes `package.json`, `tsconfig.json`, `.env.example`, `README.md`, `src/index.ts`, tool files under `src/tools/`, and `swe.amp.lock.json`.

## Run the generated TypeScript agent

From the AMP project directory:

```text
cd out
npm install
npm run dev -- "Say hello from the generated agent"
```

If you do not pass a prompt argument, set `AMP_INITIAL_PROMPT` before running. Generated agents need either a local Copilot CLI installation or an external CLI server configured with `runtime.copilotSdk.transport: external` and `runtime.copilotSdk.cliUrl`.

## Add tools, hooks, MCP servers, agents, skills, and session FS

The `add` command mutates the manifest, writes a `.bak` backup, and validates the result before saving.

Add a tool with a static stub:

```text
swe_builder amp add tool lookup --stub static --value "lookup-OK" --description "Look up local context."
```

Add a tool that delegates to a handler file:

```text
swe_builder amp add tool search_docs --handler ./src/tools/search-docs.js --description "Search project docs."
```

Add a lifecycle hook:

```text
swe_builder amp add hook audit --kind preToolUse --handler ./src/hooks/pre-tool-use.js
```

Add an MCP server:

```text
swe_builder amp add mcp local_docs --type stdio --command node --args ./mcp/local-docs.js
```

Add a custom agent:

```text
swe_builder amp add agent reviewer --description "Reviews planned changes." --systemPrompt ./prompts/reviewer.md
```

Add an inline skill:

```text
swe_builder amp add skill triage --description "Triage work items." --instructions "Classify and route the task."
```

Add a memory-backed session filesystem:

```text
swe_builder amp add sessionfs memoryfs --provider memory
```

See [Extensibility catalog](./extensibility.md) for every supported surface and [AMP manifest specification](./amp-spec.md#extension-surfaces) for schema details.

## Switch target languages

AMP language switching is manifest driven. Change `agent.language`, adjust `build.packageManager` if needed, then rebuild.

```yaml
ampVersion: "1.0"
agent:
  name: my-agent
  displayName: My Agent
  version: 0.1.0
  description: A starter AMP agent.
  language: python
runtime:
  copilotSdk:
    transport: stdio
  model:
    name: claude-sonnet-4.5
extensions:
  tools:
    - name: hello
      description: Return a friendly greeting.
      paramsSchema:
        type: object
        properties: {}
      stub:
        kind: static
        value: Hello from Python
  permissions:
    mode: approveAll
build:
  outputDir: ./dist
  packageManager: uv
```

Then run:

```text
swe_builder amp validate
swe_builder amp build --out ./out-python
```

Language-specific wiring is documented in [Generators](./generators.md).

## Common errors and fixes

| Category | Message shape | Cause | Fix |
| --- | --- | --- | --- |
| Manifest load | `No AMP manifest found` | The CLI cannot find `swe.amp.yaml`, `swe.amp.yml`, `swe.amp.json`, `amp.yaml`, `amp.yml`, or `amp.json`. | Run from the manifest directory or pass the manifest path. |
| Manifest load | `Unsupported manifest extension` | The file is not YAML or JSON. | Rename to `.yaml`, `.yml`, or `.json`. |
| Schema validation | `AMP manifest failed schema validation` | Required fields, enum values, patterns, or object shapes do not match the schema. | Compare the field with [AMP manifest specification](./amp-spec.md). |
| Semantic validation | `Duplicate tool name` | Two `extensions.tools` entries share the same name. | Rename or remove one tool. |
| Semantic validation | `Duplicate MCP server name` | Two `extensions.mcpServers` entries share the same name. | Rename or remove one server. |
| Semantic validation | `type=stdio requires a command` | An MCP stdio server is missing `command`. | Add `command` and optional `args`. |
| Semantic validation | `type=http requires a url` or `type=sse requires a url` | An HTTP or SSE MCP server is missing `url`. | Add a valid URL. |
| Semantic validation | `Duplicate custom agent name` | Two custom agents have the same name. | Make custom agent names unique. |
| Semantic validation | `references unknown MCP server` | A custom agent lists an MCP server that is not declared. | Add the server or remove the reference. |
| Semantic validation | `extensions.agent refers to unknown custom agent` | The selected agent does not exist in `extensions.customAgents`. | Add the custom agent or change `extensions.agent`. |
| Semantic validation | `permissions.mode='custom' requires permissions.handler` | Custom permission mode has no handler. | Add `extensions.permissions.handler` or use `approveAll`, `denyAll`, or `allowList`. |
| Semantic warning | `allowList without autoApprove entries` | Allow-list mode has no rules. | Add `autoApprove` rules or choose a different mode. |
| Semantic validation | `transport='external' requires cliUrl` | External CLI transport has no server URL. | Add `runtime.copilotSdk.cliUrl`. |
| Semantic warning | `cliUrl set but transport is not 'external'` | The URL will be ignored. | Change transport to `external` or remove `cliUrl`. |

## Next steps

- Read the full [AMP manifest specification](./amp-spec.md).
- Review [Extensibility catalog](./extensibility.md) before adding new fields.
- Use [Architecture](./architecture.md#extension-model-for-adding-a-new-field) when adding framework features.
- Use [AMP-ACS](./agent-communication-standards.md) when configuring cross-agent communication.
