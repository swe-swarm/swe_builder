#!/usr/bin/env node
/**
 * Copilot CLI terminal WebSocket server using node-pty.
 * Spawns GitHub Copilot CLI directly on connect (no cmd.exe shell).
 *
 * Runs alongside terminal-server.js (Claude Code) on a separate port.
 * Default port: COPILOT_TERMINAL_PORT env var, or 8002.
 *
 * Protocol (identical to terminal-server.js):
 *   Client -> Server:
 *     {"type":"init","cols":N,"rows":N}       -> spawn Copilot CLI
 *     {"type":"resize","cols":N,"rows":N}     -> resize PTY
 *     {"type":"command","text":"..."}          -> type prompt + submit
 *     plain text                               -> raw terminal input
 *   Server -> Client:
 *     plain text                               -> terminal output
 */

const pty = require("node-pty");
const WebSocket = require("ws");
const path = require("path");
const os = require("os");
const fs = require("fs");

const PORT = parseInt(process.env.COPILOT_TERMINAL_PORT, 10) || 8002;
const BASE_DIR = path.resolve(__dirname, "..");

// Resolve GitHub Copilot CLI — supports WinGet install, native versioned dir, npm global, or PATH fallback
function resolveCopilot() {
  if (os.platform() === "win32") {
    // 1. WinGet installation: AppData/Local/Microsoft/WinGet/Links/copilot.exe
    const wingetLink = path.join(
      os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links", "copilot.exe"
    );
    if (fs.existsSync(wingetLink)) {
      return { exe: wingetLink, args: [], mode: "winget" };
    }

    // 2. Native versioned directory: ~/.copilot-cli/<version>/copilot.exe
    const nativeDir = path.join(os.homedir(), ".copilot-cli");
    if (fs.existsSync(nativeDir)) {
      try {
        const versions = fs.readdirSync(nativeDir)
          .filter(d => fs.statSync(path.join(nativeDir, d)).isDirectory())
          .sort();
        // Walk from latest to oldest, find the first dir containing copilot.exe
        for (let i = versions.length - 1; i >= 0; i--) {
          const exe = path.join(nativeDir, versions[i], "copilot.exe");
          if (fs.existsSync(exe)) {
            return { exe, args: [], mode: "native" };
          }
        }
      } catch { /* scan failed, try next */ }
    }
  }

  // 3. npm global installation: ~/AppData/Roaming/npm/node_modules/@github/copilot/npm-loader.js
  const npmCli = path.join(
    os.homedir(), "AppData", "Roaming", "npm",
    "node_modules", "@github", "copilot", "npm-loader.js"
  );
  if (fs.existsSync(npmCli)) {
    return { exe: process.execPath, args: [npmCli], mode: "npm" };
  }

  // 4. Fallback: assume 'copilot' is on PATH
  if (os.platform() === "win32") {
    return { exe: "cmd.exe", args: ["/c", "copilot"], mode: "path" };
  }
  return { exe: "copilot", args: [], mode: "path" };
}

const COPILOT = resolveCopilot();

const wss = new WebSocket.Server({ host: "127.0.0.1", port: PORT });

wss.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} already in use — another Copilot terminal server may be running.`);
    console.error("The parent process should have cleaned this up. Exiting gracefully.");
    process.exit(1);
  }
  throw err;
});

wss.on("listening", () => {
  console.log(`Copilot terminal server listening on ws://localhost:${PORT}`);
  console.log(`  Copilot: ${COPILOT.exe} ${COPILOT.args.join(" ")} (${COPILOT.mode})`);
  console.log(`  CWD: ${BASE_DIR}`);
});

wss.on("connection", (ws) => {
  let ptyProc = null;
  let initialized = false;
  let ready = false;
  let inShell = false;
  let pending = null;
  let lastCols = 120;
  let lastRows = 30;

  function spawn(cols, rows) {
    lastCols = cols;
    lastRows = rows;

    try {
      ptyProc = pty.spawn(COPILOT.exe, COPILOT.args, {
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
      ws.send(`\r\nFailed to start Copilot CLI: ${err.message}\r\n`);
      return;
    }

    ptyProc.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);

      // Detect Copilot CLI's input prompt to know when it's ready.
      // Copilot CLI uses ">" prompt and shows "/help" hint on startup.
      // Also detect the chevron used by some versions.
      if (!inShell && (data.includes("\u276f") || data.includes("> ") || data.includes("/help"))) {
        ready = true;
        flush();
      }
    });

    ptyProc.onExit(({ exitCode }) => {
      ptyProc = null;
      ready = false;

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n\x1b[90m[Copilot CLI exited ${exitCode}]\x1b[0m\r\n`);
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
    ready = false;
    ptyProc.write(text);
    setTimeout(() => { if (ptyProc) ptyProc.write("\r"); }, 150);
  }

  ws.on("message", (raw) => {
    const msg = raw.toString();

    if (msg.startsWith("{")) {
      try {
        const m = JSON.parse(msg);

        if (m.type === "resize" && ptyProc) {
          lastCols = m.cols || 120;
          lastRows = m.rows || 30;
          ptyProc.resize(lastCols, lastRows);
          return;
        }

        if (m.type === "command" && m.text) {
          if (inShell && ptyProc) {
            ptyProc.write(m.text + "\r");
          } else if (ptyProc && ready) {
            submit(m.text);
          } else if (ptyProc) {
            pending = m.text;
          } else {
            pending = m.text;
            initialized = true;
            spawn(m.cols || 120, m.rows || 30);
          }
          return;
        }

        if (m.type === "init" && !initialized) {
          initialized = true;
          lastCols = m.cols || 120;
          lastRows = m.rows || 30;
          spawn(lastCols, lastRows);
          return;
        }
      } catch { /* not JSON, fall through */ }
    }

    if (ptyProc) ptyProc.write(msg);
  });

  ws.on("close", () => {
    if (ptyProc) try { ptyProc.kill(); } catch {}
  });
});
