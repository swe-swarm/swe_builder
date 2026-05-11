# Virtual FS Agent

Virtual FS Agent is a Python AMP example that combines memory tools, a memory-backed session filesystem, and one stdio MCP server. The note_write tool stores values in the generated in-process memory store, note_read retrieves one key, and note_list returns the current map. The sessionFs memory provider gives Copilot SDK file operations a virtual workspace backed by process memory, so note tools and filesystem state can be used together in tests or sandboxes without writing project files.

## MCP server wiring

The manifest wires the filesystem MCP server through npx for demonstration. To swap it for any other MCP server, replace the mcpServers entry with a new name, type, command, args, env, url, headers, or tools allowlist. Keep enabled set to true for servers that should be included in generated SessionConfig.mcpServers.

## Copy-paste quickstart

```bash
node amp/cli/amp.js validate amp/examples/virtual-fs-agent/swe.amp.yaml
node amp/cli/amp.js build amp/examples/virtual-fs-agent/swe.amp.yaml --out amp/examples/virtual-fs-agent/expected
cd amp/examples/virtual-fs-agent/expected
uv pip install -e .
python -m virtual_fs_agent.main "Remember key project_status with value green"
```
