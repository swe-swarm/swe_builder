# Component Selection Framework

## Principle

**Never assume components. Research BROADLY first, recommend based on requirements.**

MCS ships continuously — preview features, new MCP servers, new connectors, and UI changes can appear at any time. Research at decision time, not from cached knowledge alone.

## Research Protocol (Run EVERY Architecture Phase)

For each agent capability, ask: **"What's the best way to implement this?"** then:

1. **Check cache** — read relevant `knowledge/cache/` files first for baseline knowledge
2. **Check freshness** — if cache is > 7 days old, proceed to live research
3. **WebSearch** for the capability + "Copilot Studio" + current year (catch preview/new features)
4. **MS Learn MCP** for official docs and code samples
5. **MCS UI snapshot** — browse the actual Add Tool / Add Knowledge / Model picker UI to see what's available RIGHT NOW (preview badges, new entries)
6. **Community search** if relevant (custom connectors, community MCP servers, sample repos)
7. **Update cache** with any new findings
8. Cross-reference findings across sources — if something shows in the UI but not in docs, it's likely preview. Note it.

## Component Categories (Checklist)

These are CATEGORIES of where to look, not a static inventory. Check each cache file for current details:

| Category | Cache File | Key Question |
|----------|-----------|-------------|
| MCP Servers | `knowledge/cache/mcp-servers.md` | Does an MCP server exist for this? (prefer over connectors) |
| Standard Connectors | `knowledge/cache/connectors.md` | Is there a built-in connector? |
| Computer Use Tool | — | Does this task lack an API? Could a human do it in a GUI? |
| Power Automate Flows | — | Does this need scheduling, loops, or multi-step orchestration? |
| AI Builder / AI Tools | — | Does this need prompt actions, extraction, or classification? |
| Third-Party Connectors | `knowledge/cache/connectors.md` | Is there a premium connector? |
| Custom Code | — | Is Azure Functions / Custom Connector the only option? |
| Custom MCP Servers | — | Does a community MCP server exist? |
| Knowledge Sources | `knowledge/cache/knowledge-sources.md` | What data does the agent need to read? |
| Channels | `knowledge/cache/channels.md` | Where will users interact with this agent? |
| Agent Settings | — | What auth mode, access control, AI settings? |

## Selection Output

For each capability in the spec, document:

1. **Research performed** — what sources checked, what was found
2. **Options considered** — minimum 2, with current status (GA / Preview / Private Preview)
3. **What was selected and why**
4. **What was rejected and why**
5. **Status** — ready / needs setup / blocked

## Architecture Decision: Agent vs Tool vs Computer Use

| Type | Characteristics | Implementation |
|------|-----------------|----------------|
| **Tool** | Fetches data, executes actions, stateless | MCP Server / Connector |
| **Expert** | Has knowledge, makes judgments, has persona | Child Agent |
| **Desktop task** | No API available, human could do it in a GUI app | Computer Use tool |
