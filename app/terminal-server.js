#!/usr/bin/env node
/**
 * Terminal WebSocket server using node-pty.
 * Spawns Claude Code directly on connect (no cmd.exe shell).
 *
 * Port 8001, WebSocket at /ws.
 *
 * Protocol:
 *   Client → Server:
 *     {"type":"init","cols":N,"rows":N}       → spawn Claude Code
 *     {"type":"resize","cols":N,"rows":N}     → resize PTY
 *     {"type":"command","text":"..."}          → type prompt + submit
 *     plain text                               → raw terminal input
 *   Server → Client:
 *     plain text                               → terminal output
 */

const pty = require("node-pty");
const WebSocket = require("ws");
const path = require("path");
const os = require("os");

const fs = require("fs");

const PORT = parseInt(process.env.TERMINAL_PORT, 10) || 8001;
const BASE_DIR = path.resolve(__dirname, "..");

// Resolve Claude Code — supports native install, npm global, or PATH fallback
function resolveClaude() {
  // 1. Native installation: ~/.claude-cli/<version>/claude.exe
  const nativeDir = path.join(os.homedir(), ".claude-cli");
  if (fs.existsSync(nativeDir)) {
    try {
      const versions = fs.readdirSync(nativeDir)
        .filter(d => fs.statSync(path.join(nativeDir, d)).isDirectory())
        .sort(); // lexicographic — latest version last
      if (versions.length > 0) {
        const latest = versions[versions.length - 1];
        const exe = path.join(nativeDir, latest, "claude.exe");
        if (fs.existsSync(exe)) {
          return { exe, args: [], mode: "native" };
        }
      }
    } catch { /* scan failed, try next */ }
  }

  // 2. npm global installation: ~/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/cli.js
  const npmCli = path.join(
    os.homedir(), "AppData", "Roaming", "npm",
    "node_modules", "@anthropic-ai", "claude-code", "cli.js"
  );
  if (fs.existsSync(npmCli)) {
    return { exe: process.execPath, args: [npmCli], mode: "npm" };
  }

  // 3. Fallback: assume 'claude' is on PATH (spawned via cmd /c on Windows)
  if (os.platform() === "win32") {
    return { exe: "cmd.exe", args: ["/c", "claude"], mode: "path" };
  }
  return { exe: "claude", args: [], mode: "path" };
}

const CLAUDE = resolveClaude();

// Create server with error handling for port conflicts
const wss = new WebSocket.Server({ host: "127.0.0.1", port: PORT });

wss.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} already in use — another terminal server may be running.`);
    console.error("The parent process should have cleaned this up. Exiting gracefully.");
    process.exit(1);
  }
  throw err;
});

wss.on("listening", () => {
  console.log(`Terminal server listening on ws://localhost:${PORT}`);
  console.log(`  Claude: ${CLAUDE.exe} ${CLAUDE.args.join(" ")} (${CLAUDE.mode})`);
  console.log(`  CWD: ${BASE_DIR}`);
});

wss.on("connection", (ws) => {
  let ptyProc = null;
  let initialized = false;
  let ready = false;
  let inShell = false; // true when running a plain shell (post-exit)
  let pending = null; // queued command waiting for Claude to be ready
  let lastCols = 120;
  let lastRows = 30;

  function spawn(cols, rows) {
    lastCols = cols;
    lastRows = rows;

    try {
      // Spawn Claude Code — native exe, node+cli.js, or PATH fallback
      ptyProc = pty.spawn(CLAUDE.exe, CLAUDE.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: BASE_DIR,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
      });
    } catch (err) {
      ws.send(`\r\nFailed to start Claude Code: ${err.message}\r\n`);
      return;
    }

    ptyProc.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);

      // Detect Claude's input prompt to know when it's ready.
      // Check every chunk (not just the first) so we re-detect after each response.
      if (!inShell && (data.includes("\u276f") || data.includes("/help"))) {
        ready = true;
        flush();
      }
    });

    ptyProc.onExit(({ exitCode }) => {
      ptyProc = null;
      ready = false;

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n\x1b[90m[Claude Code exited ${exitCode}]\x1b[0m\r\n`);
        // Drop into a shell so the user can keep typing
        spawnShell(lastCols, lastRows);
      }
    });

    // Fallback: if prompt detection misses, mark ready after 15s
    setTimeout(() => {
      if (!ready) { ready = true; flush(); }
    }, 15000);
  }

  function spawnShell(cols, rows) {
    let shellExe, shellArgs;
    if (os.platform() === "win32") {
      // Prefer PowerShell 7 (pwsh) over Windows PowerShell 5.1 (powershell)
      const pwshPath = path.join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe");
      shellExe = fs.existsSync(pwshPath) ? pwshPath : "powershell.exe";
      shellArgs = ["-NoLogo"];
    } else {
      shellExe = process.env.SHELL || "/bin/bash";
      shellArgs = [];
    }

    try {
      ptyProc = pty.spawn(shellExe, shellArgs, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: BASE_DIR,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
      });
    } catch (err) {
      ws.send(`\r\n\x1b[31mFailed to start shell: ${err.message}\x1b[0m\r\n`);
      return;
    }

    inShell = true;
    ready = true;

    ptyProc.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    ptyProc.onExit(() => {
      ptyProc = null;
      inShell = false;
      initialized = false;
      ready = false;
    });
  }

  function flush() {
    if (pending && ptyProc) {
      submit(pending);
      pending = null;
    }
  }

  function submit(text) {
    if (!ptyProc) return;
    ready = false; // Mark busy — re-enabled when next prompt appears
    ptyProc.write(text);
    // Small delay then Enter — lets Claude's TUI ingest the text first
    setTimeout(() => { if (ptyProc) ptyProc.write("\r"); }, 150);
  }

  ws.on("message", (raw) => {
    const msg = raw.toString();

    if (msg.startsWith("{")) {
      try {
        const m = JSON.parse(msg);

        // Resize
        if (m.type === "resize" && ptyProc) {
          lastCols = m.cols || 120;
          lastRows = m.rows || 30;
          ptyProc.resize(lastCols, lastRows);
          return;
        }

        // Command — type into Claude and press Enter
        if (m.type === "command" && m.text) {
          if (inShell && ptyProc) {
            // Plain shell — write text + Enter directly
            ptyProc.write(m.text + "\r");
          } else if (ptyProc && ready) {
            submit(m.text);
          } else if (ptyProc) {
            pending = m.text;           // Claude starting, queue it
          } else {
            pending = m.text;           // Nothing running, start + queue
            initialized = true;
            spawn(m.cols || 120, m.rows || 30);
          }
          return;
        }

        // Init — start Claude Code
        if (m.type === "init" && !initialized) {
          initialized = true;
          lastCols = m.cols || 120;
          lastRows = m.rows || 30;
          spawn(lastCols, lastRows);
          return;
        }
      } catch { /* not JSON, fall through */ }
    }

    // Raw keystrokes from xterm.js
    if (ptyProc) ptyProc.write(msg);
  });

  ws.on("close", () => {
    if (ptyProc) try { ptyProc.kill(); } catch {}
  });
});
