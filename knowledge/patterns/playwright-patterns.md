# Playwright Automation Patterns (MCS UI)

**Use Playwright ONLY for operations with no API alternative.** Check `knowledge/cache/api-capabilities.md` first — APIs are added over time.

## MCS Browser Preflight — Silent Verification (MANDATORY)

Before ANY Playwright interaction:

1. Read persisted account/env from `brief.json.buildStatus` or `session-config.json`
2. `browser_navigate` to `https://copilotstudio.microsoft.com`
3. `browser_snapshot` — extract Account (top-right) + Environment (header bar)
4. Compare against persisted config — if match, proceed silently; if mismatch, alert user

## Model Selection

```
Click model combobox → snapshot to see options → click desired model →
  Wait for "Processing your request..." → wait for "completed successfully"
```

## Tool Addition — MCP Server

```
Add tool → search/select from "Create new" → "Model Context Protocol" →
  Search for MCP name → Select → Add and configure
```

## Tool Addition — Connector

```
Add tool → search connector → select action →
  Create connection (handle auth popup) → Add and configure
```

## Tool Addition — Computer Use

```
Add tool → "Create new" → "Computer use" →
  Write instructions → "Add and configure" → Rename → Save
```

## Auth Popups (New Tab)

```javascript
// Click "Create" → wait 3-5s → browser_tabs select index=1 →
//   snapshot → click account → wait → switch back to tab 0
```

## Topic Code Editor (for YAML paste)

```
Navigate to Topics → Open topic (or create blank) →
  Click "..." → "Open code editor" →
  Clear existing YAML → Paste generated YAML →
  Close code editor (saves automatically) OR click Save
```

## File Upload (Dropzones) — fallback only

```javascript
await page.locator('input[type="file"]').first().setInputFiles('path/to/file');
```

## Publishing — fallback only (prefer PAC CLI)

```
Click "Publish" → dialog → "Publish" → "Close"
```

## Instructions Edit

```
Click "Edit" on Instructions → type in textbox (Lexical editor, 8000 char limit) → Save
```

## Connected Agents

```
Agents tab → Add agent → Select from published list → Add and configure
```

## Security Toggle

```
Settings → Security → "Allow other agents to connect" → toggle ON → Save
```
