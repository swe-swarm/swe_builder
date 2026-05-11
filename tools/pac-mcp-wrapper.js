/**
 * PAC CLI MCP Wrapper
 *
 * Filters non-JSON-RPC lines from stdout that the PAC CLI MCP server
 * emits on startup (e.g., "Loading FeatureFlags from file: ..."),
 * which would otherwise corrupt the JSON-RPC protocol stream.
 */
const { spawn } = require('child_process');
const path = require('path');

const dnx = path.join(process.env.DOTNET_ROOT || 'C:\\Program Files\\dotnet', 'dnx.cmd');

const child = spawn(
  `"${dnx}" Microsoft.PowerApps.CLI.Tool --yes copilot mcp --run`,
  [],
  {
    env: { ...process.env, DOTNET_ROOT: 'C:\\Program Files\\dotnet' },
    stdio: ['pipe', 'pipe', 'inherit'],
    shell: true
  }
);

// Pipe stdin from Claude Code to the MCP server
process.stdin.pipe(child.stdin);

// Buffer partial lines from stdout
let buffer = '';

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  // Keep the last element as it may be incomplete
  buffer = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    // Only forward lines that look like JSON-RPC messages
    if (trimmed.startsWith('{')) {
      process.stdout.write(trimmed + '\n');
    }
  }
});

child.stdout.on('end', () => {
  // Flush remaining buffer
  const trimmed = buffer.trim();
  if (trimmed.startsWith('{')) {
    process.stdout.write(trimmed + '\n');
  }
});

child.on('exit', (code) => process.exit(code || 0));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
