# Backlog — Engineering Improvements

> Prioritized list of improvements, enhancements, and tech debt. Items discovered during the npm packaging pass (Feb 2026).

---

## P0 — Critical (fix before publish)

### 1. Missing LICENSE file
- **File**: (missing) `LICENSE`
- **Issue**: `package.json` declares `"license": "MIT"` but no LICENSE file exists. npm publish will warn/fail.
- **Fix**: Add standard MIT LICENSE file.

### 2. Path traversal in API endpoints
- **Files**: `app/server.py` (lines ~525, 650, 724, 801)
- **Issue**: Project/agent names sanitized with `re.sub(r"[^\w\-]", "", ...)` but `../` can still pass through. User-controlled `doc["filename"]` in manifest handler could escape `Build-Guides/`.
- **Fix**: Validate folder/file names don't contain `..`, `/`, or `\`. Use `Path(name).name` to strip path components. Add `resolve()` check that result stays under `BUILD_GUIDES`.

### 3. Deprecated jsdom in frontend devDeps
- **File**: `app/frontend/package.json` (line 73)
- **Issue**: `jsdom ^20.0.3` triggers deprecation warnings (DOMException, atob/btoa polyfills).
- **Fix**: Upgrade to `jsdom ^25.0.0` or switch to `happy-dom` for vitest.

---

## P1 — Important (next sprint)

### 4. Frontend type safety — eliminate `any`
- **Files**: `app/frontend/src/components/brief/*.tsx`, stores, pages
- **Issue**: 50+ instances of `: any` across brief section components. No compile-time protection for refactoring.
- **Fix**: Create proper TypeScript interfaces for each brief section. Replace `any` with discriminated unions.

### 5. React Error Boundaries
- **Files**: `app/frontend/src/pages/`, `app/frontend/src/App.tsx`
- **Issue**: No `<ErrorBoundary>` wrapping route pages. Component render errors crash the whole app.
- **Fix**: Add error boundary with fallback UI. Add terminal reconnect on ws.onerror.

### 6. Rate limiting and upload quotas
- **File**: `app/server.py`
- **Issue**: `/api/projects/{id}/upload` accepts 50MB files with no auth, rate limit, or quota. Unlimited project creation.
- **Fix**: Add FastAPI-SlowAPI rate limiter. Per-project disk quota. Max projects limit.

### 7. Subprocess security for file conversion
- **File**: `app/server.py` (~line 751)
- **Issue**: `MarkItDown` converter runs user files via `converter.convert()` with no timeout or resource limits.
- **Fix**: Add 30s timeout via `asyncio.wait_for`. Catch OOM. Validate file types before conversion.

### 8. Terminal WebSocket input validation
- **File**: `app/terminal-server.js` (lines 204–245)
- **Issue**: No length limits on `m.text`, no validation that `cols`/`rows` are reasonable numbers.
- **Fix**: Cap `m.text` at 10KB. Validate `cols` 1–500, `rows` 1–200.

### 9. Sanitize error messages returned to client
- **File**: `app/server.py` (~line 765)
- **Issue**: `f"Conversion failed: {str(e)[:200]}"` exposes internal paths and stack traces.
- **Fix**: Log full error server-side. Return generic message to client.

### 10. Remove v1 brief migration dead code
- **File**: `app/server.py`
- **Issue**: v1→v2 brief migration logic duplicated across 3+ functions. All reads still check for v1 schema.
- **Fix**: Auto-migrate once on first read, then remove v1 code paths.

### 11. Pin critical dependency versions
- **File**: `package.json`
- **Issue**: `ws ^8.19.0` allows any 8.x. Consider tighter pinning for stability.
- **Fix**: Use `~8.19.0` for patch-only updates. Consider raising `engines.node` to `>=20`.

---

## P2 — Nice to Have

### 12. Bundle size optimization
- **Files**: `app/frontend/` (vite build produces 500KB+ chunks)
- **Issue**: BriefEditor chunk is 525KB, index chunk is 636KB. All Radix UI components imported upfront. jsPDF/html2canvas loaded eagerly.
- **Fix**: Audit with `npx vite-bundle-visualizer`. Lazy-load jsPDF and html2canvas. Consider `manualChunks` in vite config.

### 13. Structured logging
- **Files**: `app/server.py`, `app/terminal-server.js`, `start.js`
- **Issue**: Only `console.log` / `print` with no timestamps, severity levels, or structured format.
- **Fix**: Add `python-json-logger` for server.py, `winston` or `pino` for Node.js files.

### 14. Terminal PTY memory leak
- **File**: `app/terminal-server.js` (lines 83–250)
- **Issue**: Each WebSocket stores `ptyProc` without cleanup on abnormal disconnect. 15s timeout fallback may leave zombie processes.
- **Fix**: Add inactivity timeout (30s). Track all PTY processes. Clean up on ws `close` event.

### 15. CLI `--port` and `--no-browser` flags
- **Files**: `bin/cli.js`, `start.js`
- **Issue**: Port range and browser-open behavior hardcoded. No way to specify a fixed port.
- **Fix**: Accept `--port 9000` and `--no-browser` flags. Pass via env vars to start.js.

### 16. Secrets detection in pre-commit hook
- **File**: `tools/git-hooks/pre-commit`
- **Issue**: Hook protects core files but doesn't scan for leaked secrets.
- **Fix**: Add pattern check for `password=`, `token=`, `secret=`, `apikey=` in staged files.

### 17. Python dependency version pinning
- **File**: `requirements.txt`
- **Issue**: No version pins — `fastapi`, `uvicorn`, etc. pull latest, risking breakage.
- **Fix**: Pin to specific versions: `fastapi==0.115.x`, `uvicorn==0.34.x`, etc.

### 18. Health check improvement
- **File**: `start.js` (`ensurePythonDeps`)
- **Issue**: Only checks `import fastapi; import uvicorn; import markitdown` — doesn't verify versions or full functionality.
- **Fix**: Check `import fastapi; print(fastapi.__version__)` and validate minimum versions.

---

## P3 — Polish

### 19. Frontend package name collision
- **File**: `app/frontend/package.json`
- **Issue**: Named `swe_builder` same as root. No conflict today (`private: true`) but confusing.
- **Fix**: Rename to `@swe_builder/frontend` or `swe_builder-dashboard`.

### 20. Terminal prompt detection brittleness
- **File**: `app/terminal-server.js` (line 119)
- **Issue**: Detects Claude prompt via hardcoded `❯` character. Will break if Claude Code changes prompt format.
- **Fix**: Make prompt detection configurable. Add regex-based fallback patterns.

### 21. Zustand store refactoring
- **Files**: `app/frontend/src/stores/`
- **Issue**: briefStore, projectStore maintain overlapping state. Loading/error duplicated.
- **Fix**: Single AppStore with derived selectors, or colocate related state.

### 22. server.py usage docstring
- **File**: `app/server.py` (lines 2–12)
- **Issue**: Docstring says `pip install fastapi uvicorn` but also needs `python-multipart`, `markitdown[all]`. Missing `PORT`/`TERMINAL_PORT` env vars.
- **Fix**: Update docstring with complete setup and env var documentation.

### 23. doc-manifest.json schema
- **File**: (missing) `templates/manifest.schema.json`
- **Issue**: `doc-manifest.json` structure inferred from code but not documented or validated.
- **Fix**: Create JSON schema. Validate on read in server.py.

### 24. Deterministic frontend builds
- **File**: `app/frontend/`
- **Issue**: No integrity check that built assets match source. Cannot reproduce builds.
- **Fix**: Add build hash to index.html comment. Document build-and-verify procedure.

### 25. Inconsistent error handling in start.js
- **File**: `start.js` (~line 153)
- **Issue**: Some errors caught silently (`catch {}`), others logged. `killPort()` swallows all errors.
- **Fix**: Standardize on `catch (e) { warn(...) }` pattern for debuggability.

---

## Summary

| Priority | Count | Theme |
|----------|-------|-------|
| **P0** | 3 | Missing LICENSE, path traversal, deprecated dep |
| **P1** | 8 | Type safety, error handling, security hardening |
| **P2** | 7 | Performance, logging, CLI flags, dep pinning |
| **P3** | 7 | Naming, DX polish, documentation |
| **Total** | 25 | |

> Run `swe_builder health` to verify the dashboard is working after applying fixes.
