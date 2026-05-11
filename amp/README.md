# swe_builder AMP

The Adaptive Manifest Protocol (AMP) framework. Generates copilot-sdk compliant
terminal SWE agents in TypeScript, Python, or Go from a single declarative
manifest.

```
swe.amp.yaml  -->  swe_builder amp build  -->  ./out/<agent-name>/   (runnable copilot-sdk agent)
```

## Core idea

Reasoning should be spent on solutioning, not on architecture. AMP encodes
every copilot-sdk extensibility surface (tools, MCP servers, hooks, custom
agents, permissions, sessionFs, system message customization, skills, UI
elicitation, lifecycle, commands, communication standards) in one schema that
runs through one validator and one set of generators.

## Layout

```
amp/
  schemas/amp.schema.json    Canonical JSON Schema for the manifest
  schemas/amp.types.d.ts     TypeScript types mirroring the schema
  src/                       Pipeline: load -> validate -> normalize -> plan -> generate
  src/generators/{ts,py,go}  Per-language emitters
  templates/                 Static template files copied or rendered
  cli/amp.js                 CLI subcommands (init / validate / build / add / list-extensions / doctor)
  examples/                  Example manifests
  tests/                     node --test suite
```

## Quick start

```bash
# From the swe_builder repo root
swe_builder amp init my-agent --language typescript
cd amp/examples/my-agent
swe_builder amp validate
swe_builder amp build --out ./dist
```

See `knowledge/amp/getting-started.md` for the full walkthrough and
`knowledge/amp/extensibility.md` for the AMP-field-to-copilot-sdk-surface map.
