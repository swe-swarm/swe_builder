# Changelog

All notable changes to the FDE MCS Agent Builder are documented here.

## [Unreleased]

### Added

- **npm packaging** — Installable via `npm install -g swe_builder` with full CLI:
  - `swe_builder start` — Launch the dashboard server
  - `swe_builder stop` — Stop a running instance
  - `swe_builder restart` — Restart the dashboard
  - `swe_builder health` — Check if running and responsive
  - `swe_builder --version` / `swe_builder --help`
  - Also accepts `--start`, `--stop`, `--restart`, `--health` flag syntax
- **`bin/cli.js`** — CLI entry point registered as `swe_builder` in npm bin
- **`bin/postinstall.js`** — Automatic post-install setup: Python dep check, pip install, frontend build, env vars, git hooks, success banner
- **`/api/health` endpoint** — Alias for `/health` so CLI health checks work with the `/api/` prefix convention
- **`LICENSE`** — MIT license file (was declared in package.json but missing)
- **`backlog.md`** — Prioritized engineering backlog (25 items across P0–P3)

### Changed

- **Parameterized user paths** — Replaced hardcoded user-profile paths with environment variables (`%USERPROFILE%`, `%LOCALAPPDATA%`, `%APPDATA%`) so the repo works on any machine without edits.
  - `.mcp.json` — Playwright MCP `--user-data-dir`
  - `.claude/settings.json` — Playwright MCP `--user-data-dir`
  - `.claude/memory/MEMORY.md` — Pandoc and WorkIQ CLI paths
  - `.claude/skills/mcs-init/SKILL.md` — Pandoc path reference
  - `.claude/skills/mcs-research/SKILL.md` — Pandoc conversion command
  - `tools/start-edge-debug.cmd` — Edge debug profile path
- **`package.json`** — Renamed from `mcs-automation` to `swe_builder`, added `bin`, `files`, `engines`, `repository`, `prepublishOnly`, `postinstall` script
- **Lockfile location** — Moved from repo root to `~/.swe_builder.lock` so it works for both local clones and global npm installs (env override via `MCS_LOCKFILE`)

### Improved

- **Tool discovery hints** — Added `where` / `gcm` resolution tips alongside env-var paths so tools are discoverable even if installed to non-default locations.
- **Pandoc invocation simplified** — Skill files now call `pandoc` directly (assumes PATH) with a fallback note, instead of requiring an absolute path.
- **Two install paths documented** — `start.cmd` for full Windows setup (winget + everything), `npm install -g` for users who already have Node/Python.
