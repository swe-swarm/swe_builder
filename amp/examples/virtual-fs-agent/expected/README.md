# Virtual FS Agent

Python AMP agent with memory notes, memory session filesystem, and MCP wiring.

## Quickstart

```bash
uv pip install -e .
python -m virtual_fs_agent.main "Hello from AMP"
```

Non-uv users can install the same dependencies with:

```bash
python -m pip install -r requirements.txt
python -m pip install -e .
```

## Dependencies

- github-copilot-sdk>=0.5.0,<0.6.0
- pydantic>=2

## Wired AMP surfaces

- tools: Custom function tools the agent can call.
- mcpServers: MCP servers wired to the session.
- permissions: Required handler for tool permission requests. mode=approveAll wires the helper; custom uses your file. NOTE: protocol v2 NO_RESULT short-circuit is not allowed.
- sessionFs: Virtual session filesystem provider. memory backs operations with an in-process Map (great for WASM/sandbox).
- streaming: Emits assistant.message_delta / assistant.reasoning_delta. Full message events still fire.

## Generated TODO stubs

- none

Initial prompts come from argv[1] or the `AMP_INITIAL_PROMPT` environment variable.
