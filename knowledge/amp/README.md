# AMP Framework Documentation
Reference documentation for the Adaptive Manifest Protocol framework in swe_builder.

## Table of contents

- [Version block](#version-block)
- [What AMP is](#what-amp-is)
- [Documentation set](#documentation-set)
- [Canonical code references](#canonical-code-references)
- [Quick command map](#quick-command-map)

## Version block

| Item | Value | Source |
| --- | --- | --- |
| AMP version | 1.0 | amp/src/version.js:AMP_VERSION |
| SDK protocol version | 3 | amp/src/version.js:COPILOT_SDK_PROTOCOL_VERSION |
| Framework version | 1.0.0 | amp/src/version.js:FRAMEWORK_VERSION from amp/package.json |

## What AMP is

AMP is the declarative manifest layer for swe_builder agents. A project author writes a `swe.amp.yaml` manifest, validates it with the AMP CLI, and builds a runnable GitHub Copilot SDK agent in TypeScript, Python, or Go. The framework loads the manifest, validates the schema and semantic rules, normalizes defaults, plans enabled SDK surfaces, and emits a language project.

AMP keeps the agent contract stable while language generators evolve. The canonical contract is `amp/schemas/amp.schema.json`; generated TypeScript reference types live in `amp/schemas/amp.types.d.ts`.

## Documentation set

| Document | Purpose |
| --- | --- |
| [Getting started](./getting-started.md) | End-to-end tutorial from `amp init` through running a generated TypeScript agent. |
| [AMP manifest specification](./amp-spec.md) | Full schema reference, semantic validator rules, SDK pins, and permission quirks. |
| [Extensibility catalog](./extensibility.md) | Every registry row from `amp/src/extension-registry.js`, with use guidance. |
| [Generators](./generators.md) | How the TypeScript, Python, and Go generators map AMP fields to SDK code. |
| [Architecture](./architecture.md) | Internal load, validate, normalize, plan, generate, and write pipeline. |
| [AMP-ACS](./agent-communication-standards.md) | Agent Communication Standards for broadcasts, inbox delivery, and handoff. |

## Canonical code references

- Schema: `amp/schemas/amp.schema.json`
- Public API: `amp/src/index.js`
- CLI: `amp/cli/amp.js`
- Extension registry: `amp/src/extension-registry.js`
- Generators: `amp/src/generators/typescript.js`, `amp/src/generators/python.js`, `amp/src/generators/go.js`
- Version pins: `amp/src/version.js`

## Quick command map

```text
swe_builder amp init my-agent --language typescript
swe_builder amp validate
swe_builder amp build --out ./out
swe_builder amp list-extensions
swe_builder amp doctor
```
