@echo off
REM Launch Edge with remote debugging on port 9222
REM Use this when you want Playwright MCP to attach to your EXISTING browser
REM
REM After running this, swap Playwright MCP args in .claude/settings.json to:
REM   "args": ["/c", "npx", "-y", "@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"]
REM Then restart Claude Code session for the change to take effect.

start msedge.exe --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\.edge-debug-profile"
echo Edge launched with remote debugging on port 9222
echo.
echo To use with Playwright MCP:
echo   1. Update .claude/settings.json playwright args to:
echo      "--cdp-endpoint", "http://localhost:9222"
echo   2. Restart Claude Code session
echo.
pause
