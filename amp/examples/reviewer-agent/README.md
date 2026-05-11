# Reviewer Agent

Reviewer Agent is a code-review oriented AMP example. It wires pull request helper tools, two custom agent personas, lifecycle hooks, allow-list permissions, system message customization, streaming, and stdout JSONL broadcast for review events.

## Wired surfaces

- Tools: fetch_pr_diff, lint_check, post_review_comment.
- Custom agents: code-reviewer is the default agent, with test-author available for test planning.
- Hooks: preToolUse and sessionStart are generated as stubs that load user handlers from the source manifest tree.
- Permissions: allowList auto-approves lint_* and fetch_* tool requests, then falls back to approveAll.
- System message: persona section replaces the default persona with terse review guidance.
- Communication: stdout-jsonl broadcast on the reviews channel, with inbox disabled.

## Copy-paste quickstart

```bash
node amp/cli/amp.js validate amp/examples/reviewer-agent/swe.amp.yaml
node amp/cli/amp.js build amp/examples/reviewer-agent/swe.amp.yaml --out amp/examples/reviewer-agent/expected
cd amp/examples/reviewer-agent/expected
npm install
npm run build
node dist/index.js "Review PR 42"
```

## Hook handler stubs to add later

Create these files beside the manifest when you are ready to replace the generated loader stubs:

```ts
// amp/examples/reviewer-agent/src/hooks/preToolUse.ts
// export async function handler(input, invocation) {
//   // Inspect input.toolName and input.arguments here.
//   return {};
// }
```

```ts
// amp/examples/reviewer-agent/src/hooks/sessionStart.ts
// export async function handler(input, invocation) {
//   // Seed review context or emit startup telemetry here.
//   return {};
// }
```
