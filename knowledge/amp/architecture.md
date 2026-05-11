# AMP Framework Architecture
Internal design of the swe_builder AMP load, validate, plan, and generate pipeline.

## Table of contents

- [Pipeline](#pipeline)
- [Module map](#module-map)
- [Dependency boundaries](#dependency-boundaries)
- [Data flow](#data-flow)
- [Test strategy](#test-strategy)
- [Extension model for adding a new field](#extension-model-for-adding-a-new-field)
- [Operational notes](#operational-notes)

## Pipeline

The AMP build pipeline is:

```text
load -> validate -> normalize -> plan -> generate -> write
```

1. Load: parse YAML or JSON and resolve the manifest directory.
2. Validate: enforce schema and semantic constraints.
3. Normalize: apply defaults so generators consume a predictable manifest.
4. Plan: create a build plan with language, output directory, surfaces, and file/action queues.
5. Generate: call the selected language generator to append files and logs.
6. Write: create directories and write planned files to disk.

The orchestrator for this pipeline is `amp/src/build.js`.

## Module map

| Module | Responsibility |
| --- | --- |
| `amp/src/manifest.js` | Load YAML or JSON, find default manifest names, and return manifest path plus manifest directory. |
| `amp/src/validator.js` | Compile `amp.schema.json` with AJV, add format validation, and run semantic checks. |
| `amp/src/normalizer.js` | Clone the raw manifest and apply runtime, extension, communication, build, and deployment defaults. |
| `amp/src/planner.js` | Create build plans, select used surfaces, and expose `addFile`, `addLog`, and `addExec`. |
| `amp/src/render.js` | Minimal template rendering for `{{ var }}`, `{{#if }}`, and `{{#each }}`. |
| `amp/src/build.js` | Drive the full pipeline and write generated files. |
| `amp/src/generators/typescript.js` | Emit TypeScript Node project files and SDK wiring. |
| `amp/src/generators/python.js` | Emit Python `src` layout project files and SDK wiring. |
| `amp/src/generators/go.js` | Emit Go module, command, and helper package files. |
| `amp/src/generators/index.js` | Lazy generator registry keyed by language. |
| `amp/src/extension-registry.js` | Registry of manifest fields mapped to SDK or AMP-ACS surfaces. |
| `amp/src/version.js` | AMP version, SDK protocol version, framework version, and SDK package pins. |
| `amp/src/index.js` | Public API surface for CLI and downstream consumers. |
| `amp/cli/amp.js` | CLI command handling for init, validate, build, add, list-extensions, doctor, version, and help. |

## Dependency boundaries

Only `amp/src/index.js` is the public framework surface. CLI code and downstream consumers must import from `amp/src/index.js`, not from individual internal modules.

This boundary keeps internal module refactors safe. It also ensures version constants, build helpers, validators, planners, generators, and registry helpers are exported from one reviewable place.

Internal modules may depend on each other in pipeline order. Generators may import planner helpers and version constants. The CLI may use public exports and may perform command-line formatting, but it should not own framework behavior that belongs in `src`.

## Data flow

`loadManifest` returns raw data. `validateManifest` checks raw data because defaults should not hide missing required fields. `normalizeManifest` returns a new object and does not mutate the raw manifest. `createPlan` consumes the normalized object and computes `surfaces` by walking `listExtensions()` and `isSurfaceUsed`.

Generators mutate only the plan queues:

```text
plan.files       -> generated file records
plan.postActions -> log or exec actions
plan.surfaces    -> registry rows enabled by the manifest
```

`build` writes each planned file under `plan.outDir`. Dry runs return the plan without writing files.

## Test strategy

AMP uses Node's built-in test runner.

```text
cd amp
node --test tests/
```

Expected test coverage:

- Unit tests for manifest loading, schema validation, semantic validation, normalization, planning, rendering, and CLI parsing behavior.
- Smoke fixture for the happy path from manifest to generated project.
- Per-generator snapshot tests under `examples/<name>/expected/` so output diffs are explicit.
- Negative tests for semantic constraints such as duplicate names, missing MCP fields, missing custom permission handlers, and external transport without `cliUrl`.

Docs should stay aligned with `amp.schema.json`, `extension-registry.js`, and generator snapshots.

## Extension model for adding a new field

To add a new AMP field:

1. Add the field to `amp/schemas/amp.schema.json`.
2. Add a row to `amp/src/extension-registry.js` when the field maps to an SDK or AMP-ACS surface.
3. Update `amp/src/normalizer.js` defaults if generators should see a default value.
4. Update the `planner.isSurfaceUsed` switch in `amp/src/planner.js`.
5. Update each generator to wire the field in TypeScript, Python, and Go.
6. Add tests for schema validation, semantic behavior, planning, and generated output.
7. Update [AMP manifest specification](./amp-spec.md) and [Extensibility catalog](./extensibility.md).

Do not add a generator-only field without a schema update. Do not add a CLI-only behavior without exposing the underlying framework behavior through `amp/src/index.js` when it is reusable.

## Operational notes

The CLI validates before writing mutating changes. `swe_builder amp add` also writes a `.bak` file next to the manifest before replacing it. `swe_builder amp doctor` reports Node version, AMP versions, SDK pins, manifest validation results, enabled surfaces, missing referenced files, and TODO handlers.

The planner includes `addExec`, but current generators mostly use file writes and logs. Keep generated project installs explicit for users rather than running package managers automatically during build.
