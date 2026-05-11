# Minimal Agent

This is the hello world of AMP: a TypeScript agent with one generated echo tool, approve-all permissions, and no MCP servers, hooks, skills, session filesystem, or communication wiring.

## Copy-paste quickstart

```bash
node amp/cli/amp.js validate amp/examples/minimal-agent/swe.amp.yaml
node amp/cli/amp.js build amp/examples/minimal-agent/swe.amp.yaml --out amp/examples/minimal-agent/expected
cd amp/examples/minimal-agent/expected
npm install
npm run dev -- "Hello from AMP"
```
