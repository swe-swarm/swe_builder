# Multi-Agent Build

## Build Order

Build specialists first, then the orchestrator, because the orchestrator needs to connect to already-published specialists.

### For each specialist agent:

1. Create agent via Dataverse POST + PvaProvision
2. Clone workspace (`mcs-lsp.js clone`)
3. Set instructions (LSP push — `agent.mcs.yml`) — specialist-focused, with scope limits
4. Add knowledge (LSP push — `knowledge/*.mcs.yml` for sites; Dataverse API for file uploads)
5. Add tools/model (LSP push — `agent.mcs.yml` for model, `add-tool.js` for tools)
6. Enable "Allow other agents to connect" (Dataverse PATCH `bot.configuration.isAgentConnectable`)
7. Author topics (LSP push — `topics/*.mcs.yml`)
8. Publish (Dataverse PvaPublish, PAC CLI fallback)
9. **Verify:** Pull latest state via `mcs-lsp.js pull`, confirm all items

### Build the orchestrator:

1. Create orchestrator via Dataverse POST + PvaProvision
2. Clone workspace (`mcs-lsp.js clone`)
3. Set instructions with routing rules (LSP push — `agent.mcs.yml`):
   ```
   ## Connected Specialists
   /[SpecialistName] - [when to use]

   ## Routing Rules
   - [Intent] -> /[Specialist]
   ```
4. Select model (LSP push — `agent.mcs.yml`)
5. Connect child agents (Island Gateway API `connectedAgentDefinitionChanges`)
6. Add orchestrator-level tools/knowledge if needed (LSP push)
7. Author topics if needed (LSP push — `topics/*.mcs.yml`)
8. Publish (Dataverse PvaPublish, PAC CLI fallback)
9. **Verify:** All specialists connected, routing rules in instructions

## Multi-Agent Verification

After building all agents:
- Each specialist: published, sharing enabled
- Orchestrator: published, all children connected
- Routing test: send test queries to verify the correct specialist is invoked
