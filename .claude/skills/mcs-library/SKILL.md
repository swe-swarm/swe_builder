---
name: mcs-library
description: Browse, analyze, and contribute to the team's SharePoint solution library. Uses agent teams for intelligent tagging and pattern extraction.
---

# MCS Solution Library

Browse, analyze, search, and contribute to the Builder PMs team's SharePoint "Solution & Demo Library" (~30 exported MCS agent solutions).

## Input

```
/mcs-library list                          # List all solutions in SharePoint
/mcs-library search <query>                # Search the local index
/mcs-library download <name>               # Download a solution folder locally
/mcs-library analyze <name>                # Deep analysis with team enrichment
/mcs-library index                         # Batch index all solutions
/mcs-library upload <projectId> <agentId>  # Upload built solution to library
```

## Commands

### `list` — List All Solutions

No teams needed. Fast mechanical operation.

1. Run: `node tools/solution-library.js list`
2. Display formatted table: name, last modified, file count
3. Show total count and SharePoint URL

### `search <query>` — Search Local Index

No teams needed. Searches `knowledge/solutions/index.json`.

1. Run: `node tools/solution-library.js search --query "<query>"`
2. Display matching solutions ranked by relevance
3. Show tags, agents, and instruction patterns for each match
4. If no results: suggest running `index` first

### `download <name>` — Download Solution Folder

No teams needed. Downloads to OS temp dir (or `--output <dir>`).

1. Run: `node tools/solution-library.js download --name "<name>"`
2. Show download progress and file list
3. Report total size and local path

### `analyze <name>` — Deep Analysis (Agent Teams)

Uses Research Analyst + Prompt Engineer for intelligent enrichment.

#### Step 1: Mechanical Extraction (Lead)

Run the tool to download, extract zip, parse XML:
```bash
node tools/solution-library.js analyze --name "<name>" --json
```

This outputs raw metadata: solution name/version, agent names, component counts, connection references, environment variables.

#### Step 2: Team Enrichment (Parallel)

Spawn two teammates to enrich the raw metadata:

**Research Analyst:**
- Read the raw analysis output (solution name, agents, components, connections)
- Classify by industry (healthcare, financial, retail, etc.)
- Identify capabilities (claims processing, document analysis, customer service, etc.)
- Note what tools/connectors are used and knowledge types
- Determine architecture type (single-agent, multi-agent, orchestrator)
- Write enriched tags to a temporary file for the lead to merge

**Prompt Engineer:**
- If the solution contains extractable instructions (from the analysis or deep component inspection), identify reusable patterns:
  - Greeting/persona styles
  - Boundary handling approaches
  - Tool invocation patterns
  - Output formatting conventions
- Write identified patterns to a temporary file for the lead to merge
- If no instructions available, report "no instruction patterns extractable"

#### Step 3: Merge & Save (Lead)

1. Read RA's enriched tags → update `tags` field in index entry
2. Read PE's instruction patterns → update `instructionPatterns` field
3. Save updated `knowledge/solutions/index.json`
4. Display enriched analysis to user

### `index` — Batch Index All Solutions (Agent Teams)

Full library indexing with team enrichment. Runs in three phases.

#### Phase 1: Mechanical Listing (Lead)

```bash
node tools/solution-library.js index --json
```

This lists all ~30 folders and captures basic file metadata for each.

#### Phase 2: Selective Deep Analysis (Lead)

For solutions with .zip files that haven't been deeply analyzed:
- Download and extract each zip sequentially
- Parse customizations.xml for raw metadata
- Update index entries with solution info, agents, component counts

#### Phase 3: Team Enrichment (Parallel)

Spawn team to process all raw entries:

**Research Analyst:**
- Read ALL index entries with raw metadata
- Tag each by industry, capabilities, tools, knowledge types, architecture
- Look for patterns across solutions (common tools, shared approaches)
- Write enriched tags for all solutions

**Prompt Engineer:**
- Read index entries where instructions might be extractable
- Identify cross-solution patterns (common greeting styles, boundary approaches)
- Write findings to `knowledge/learnings/customer-patterns.md`
- Write per-solution instruction patterns

#### Phase 4: Merge (Lead)

1. Read team outputs → merge into index entries
2. Save `knowledge/solutions/index.json`
3. Display summary: total solutions, analyzed count, top tags

### `upload <projectId> <agentId>` — Upload to Library

Optionally uses QA Challenger for pre-upload validation.

#### Step 1: Validate (Lead)

1. Read `Build-Guides/<projectId>/agents/<agentId>/brief.json`
2. Verify build is complete (buildStatus has `published` step)
3. Check that solution name exists in brief

#### Step 2: Optional QA Review

If the build hasn't been QA validated, spawn QA Challenger:
- Verify brief.json is complete
- Check build report exists
- Validate eval results are acceptable
- Report any concerns before upload

#### Step 3: Export & Upload (Lead)

1. Export solution: `pac solution export --name "<name>" --managed --overwrite`
2. Create SharePoint folder: `{AgentName} - {ProjectName}`
3. Generate `design-spec.md` from brief.json (human-readable spec card for team browsing)
4. Upload: solution .zip, brief.json, build-report.md, design-spec.md
5. Auto-index: the uploaded solution is automatically added to `knowledge/solutions/index.json`
6. Confirm upload success + indexed status

## Integration Points

The solution library is integrated into the build workflow:

1. **`/mcs-research` Phase B (Step 0.5)** — Checks `solutions/index.json` for similar prior builds by tag overlap (industry, capabilities, integrations). Presents matches as additional data points.
2. **`/mcs-build` Step 7** — After successful build + QA pass, offers to upload the solution to the team library. Auto-generates design-spec.md and indexes the upload.
3. **`/mcs-retro` Step 1.5** — Cross-references collected learnings against the solution index. Library matches enrich pattern confirmation and bump `confirmed` counts.
4. **`/mcs-library index`** — Delta-only by default: only processes solutions that are new, changed, or not yet analyzed. Use `--all` flag to force full re-analysis.

## Prerequisites

- **Azure CLI** authenticated to Microsoft tenant (`az login`)
- **Graph API access** to the Builder PMs SharePoint site (delegated permissions)
- **PAC CLI** authenticated for upload (solution export)

## Output

- `knowledge/solutions/index.json` — Solution metadata index (committed)
- `knowledge/solutions/cache/*.json` — Per-solution deep analysis (committed)
- Console output — Formatted results or JSON (with `--json`)
