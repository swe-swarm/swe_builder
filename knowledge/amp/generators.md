# AMP Generators
How TypeScript, Python, and Go generators wire AMP manifest fields into runnable SDK projects.

## Table of contents

- [Generator contract](#generator-contract)
- [TypeScript generator](#typescript-generator)
- [Python generator](#python-generator)
- [Go generator](#go-generator)
- [Reproducibility and lock files](#reproducibility-and-lock-files)
- [Adding or extending generator support](#adding-or-extending-generator-support)

## Generator contract

Every generator exports `generate(plan)`. The build orchestrator creates a normalized plan with `createPlan`, selects `generators[manifest.agent.language]`, and lets the generator append files and post-action logs.

Generators consume normalized manifest values, registry-derived surfaces, and version pins from `amp/src/version.js`. They should not re-read the manifest directly except for handler or asset files referenced by path.

## TypeScript generator

### Project layout

The TypeScript generator emits a Node ESM project.

```text
package.json
tsconfig.json
.gitignore
.env.example
README.md
swe.amp.lock.json
src/index.ts
src/tools/<tool>.ts
src/hooks/<hook>.ts
src/permissions.ts
src/commands/<command>.ts
src/sessionFs.ts
src/comms/handoff.ts
skills/<inline-skill>/SKILL.md
```

Files are emitted only when the corresponding surface is used. The static templates live under `amp/templates/typescript/`. Dynamic files are built in `amp/src/generators/typescript.js`.

### Dependency pins

TypeScript dependencies come from `SDK_PINS.typescript`.

| Package | Pin |
| --- | --- |
| `@github/copilot-sdk` | `^0.5.0` |
| `@github/copilot` | `^1.0.36-0` |

The generator also emits dev dependencies for Node typing, `tsx`, and TypeScript.

### Surface wiring

Tools use the SDK `defineTool` helper.

```ts
import { defineTool } from "@github/copilot-sdk";

export const lookupTool = defineTool("lookup", {
  description: "Look up a record.",
  parameters,
  skipPermission: true,
  handler: async (args, invocation) => {
    return args;
  },
});
```

The main entrypoint creates a client, builds a `SessionConfig`, registers events, and sends the initial prompt.

```ts
const client = new CopilotClient(clientOptions);
await client.start();

const sessionConfig: SessionConfig = {
  clientName: "my-agent",
  tools: [lookupTool],
  onPermissionRequest: approveAll,
  streaming: true,
};

const session = await client.createSession(sessionConfig);
session.on(handleSessionEvent);
await session.send({ prompt: initialPrompt });
```

MCP servers are emitted as `Record<string, MCPServerConfig>`. Custom agents are emitted as an array of SDK-compatible config objects. Hooks are imported from `src/hooks/` and attached to `SessionConfig.hooks`. `allowList` permissions emit `src/permissions.ts`; unmatched requests fall back to `approveAll` to avoid a non-interactive deadlock.

### How to extend TypeScript generation

Add static files to `amp/templates/typescript/` when the file is mostly template text. Add dynamic emitters in `amp/src/generators/typescript.js` when the output depends on manifest data. Wire new surfaces inside `buildSessionConfig`, `buildClientOptions`, or a focused emit function. Add post-action logs with `addLogOnce` so the CLI summary shows what was wired.

## Python generator

### Project layout

The Python generator emits a setuptools project using a `src` layout.

```text
pyproject.toml
requirements.txt
.gitignore
.env.example
README.md
swe.amp.lock.json
src/<pkg>/__init__.py
src/<pkg>/main.py
src/<pkg>/tools/<tool>.py
src/<pkg>/hooks/<hook>.py
src/<pkg>/permissions.py
src/<pkg>/commands.py
src/<pkg>/session_fs.py
src/<pkg>/lifecycle.py
src/<pkg>/user_input.py
src/<pkg>/comms/handoff.py
src/<pkg>/skills/<inline-skill>/SKILL.md
```

### Dependency pins

Python dependencies are emitted into both `pyproject.toml` and `requirements.txt`.

| Package | Pin |
| --- | --- |
| `github-copilot-sdk` | `>=0.5.0,<0.6.0` |
| `pydantic` | `>=2` |

### Surface wiring

Tools use `define_tool` with a pydantic parameter model.

```py
from copilot import define_tool
from copilot.tools import ToolInvocation
from pydantic import BaseModel, ConfigDict, Field

class LookupParams(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    query: str = Field(default=..., description="Query text")

async def _handler(params: LookupParams, invocation: ToolInvocation):
    data = params.model_dump(by_alias=True, exclude_none=True)
    return data

tool = define_tool(
    "lookup",
    description="Look up a record.",
    handler=_handler,
    params_type=LookupParams,
)
```

`main.py` builds a `CopilotClient`, creates a session config dictionary, filters fields to SDK-supported create-session kwargs when needed, registers events, and sends `argv[1]` or `AMP_INITIAL_PROMPT`.

```py
def _build_session_config() -> dict[str, Any]:
    config: dict[str, Any] = {}
    config["on_permission_request"] = on_permission_request
    config["model"] = {"name": "claude-sonnet-4.5"}
    config["tools"] = [lookup.tool]
    config["streaming"] = True
    return _make_session_config(config)
```

MCP servers and custom agents are emitted as dictionaries. Hooks are emitted under `hooks/`. Commands are emitted in `commands.py`. Memory session FS emits `session_fs.py`. Communication helpers are split between `main.py` and `comms/handoff.py`.

### How to extend Python generation

Most Python output is generated by functions in `amp/src/generators/python.js`. Add a focused render function for new files or new config blocks, then call it from `generate(plan)`. If a static template becomes useful, add it under `amp/templates/python/` and keep dynamic manifest wiring in the generator.

## Go generator

### Project layout

The Go generator emits a Go module with a command package and feature packages.

```text
go.mod
.gitignore
.env.example
README.md
swe.amp.lock.json
cmd/<command>/main.go
tools/<tool>.go
tools/tools.go
permissions/permissions.go
hooks/<hook>.go
commands/<command>.go
commands/commands.go
sessionfs/memory.go
lifecycle/handler.go
userinput/handler.go
comms/handoff.go
skills/<inline-skill>/SKILL.md
internal/memstore/store.go
```

### Dependency pins

Go dependencies come from `SDK_PINS.go` plus schema support when tool parameter schemas are present.

| Module | Pin |
| --- | --- |
| `github.com/github/copilot-sdk/go` | `v0.5.0` |
| `github.com/google/jsonschema-go` | `v0.4.2` when needed |

### Surface wiring

Tools use the generic Go SDK helper.

```go
package tools

import copilot "github.com/github/copilot-sdk/go"

type LookupParams struct {
    Query string `json:"query"`
}

func LookupTool() copilot.Tool {
    tool := copilot.DefineTool[LookupParams, any]("lookup", "Look up a record.", func(params LookupParams, invocation copilot.ToolInvocation) (any, error) {
        return params, nil
    })
    tool.SkipPermission = true
    return tool
}
```

`cmd/<command>/main.go` creates client options, starts the client, builds a `SessionConfig`, subscribes to events, sends the initial prompt, and waits for shutdown.

```go
opts := buildClientOptions()
client := copilot.NewClient(opts)
if err := client.Start(ctx); err != nil {
    log.Fatal(err)
}

sessionCfg, err := buildSessionConfig()
if err != nil {
    log.Fatal(err)
}

session, err := client.CreateSession(ctx, sessionCfg)
```

MCP servers are emitted as `map[string]copilot.MCPServerConfig`. Hooks map AMP hook names to `copilot.SessionHooks`. Commands return `[]copilot.CommandDefinition`. Memory session FS implements a provider in `sessionfs/memory.go`.

### How to extend Go generation

Add render functions in `amp/src/generators/go.js` and call them from `generate(plan)`. If the new surface needs imports in `main.go`, update `buildMainImports`. If it needs session config fields, update `renderBuildSessionConfig`. Keep helper packages small and surface-specific.

## Reproducibility and lock files

Each generated project includes `swe.amp.lock.json`. The lock file records the framework assumptions used at generation time so rebuilds can be compared.

Core lock fields are:

```json
{
  "ampVersion": "1.0",
  "frameworkVersion": "1.0.0",
  "sdkProtocolVersion": 3,
  "generatedAt": "2025-01-01T00:00:00.000Z",
  "language": "typescript"
}
```

Current generator differences:

- TypeScript writes `ampVersion`, `frameworkVersion`, `sdkProtocolVersion`, `generatedAt`, `sourceManifest`, and `language`.
- Python writes the same conceptual pins, a deterministic `generatedAt` value for tests, and the normalized source manifest content.
- Go writes `ampVersion`, `frameworkVersion`, `copilotSdkProtocolVersion`, `sdkPins`, `manifestHash`, enabled surfaces, and language metadata.

Treat the lock as build evidence. If the manifest is unchanged but framework version, protocol version, SDK pins, or generator behavior changes, rebuild and review the output diff.

## Adding or extending generator support

Use this checklist for any new AMP field.

1. Add the field to `amp/schemas/amp.schema.json`.
2. Add a row to `amp/src/extension-registry.js` if it is an SDK or AMP-ACS surface.
3. Add defaults in `amp/src/normalizer.js` when generators should see a populated shape.
4. Update `planner.isSurfaceUsed` so the plan reports the new surface.
5. Update every generator: TypeScript, Python, and Go.
6. Add unit tests and generator snapshots.
7. Update [AMP manifest specification](./amp-spec.md) and [Extensibility catalog](./extensibility.md).
