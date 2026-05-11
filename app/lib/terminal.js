/**
 * Terminal WebSocket handler — extracted from terminal-server.js.
 *
 * Attaches to a WebSocketServer and manages Claude Code PTY sessions.
 *
 * Protocol:
 *   Client → Server:
 *     {"type":"init","cols":N,"rows":N}       → spawn Claude Code
 *     {"type":"resize","cols":N,"rows":N}     → resize PTY
 *     {"type":"command","text":"..."}          → type prompt + submit
 *     {"type":"write","text":"..."}            → type into prompt (no submit)
 *     plain text                               → raw terminal input
 *   Server → Client:
 *     plain text                               → terminal output
 */

const pty = require("@homebridge/node-pty-prebuilt-multiarch");
const path = require("path");
const os = require("os");
const fs = require("fs");
const WebSocket = require("ws");

// Resolve Claude Code — supports native install, npm global, or PATH fallback
function resolveClaude() {
  // 1. Native installation: ~/.claude-cli/<version>/claude.exe
  const nativeDir = path.join(os.homedir(), ".claude-cli");
  if (fs.existsSync(nativeDir)) {
    try {
      const versions = fs
        .readdirSync(nativeDir)
        .filter((d) => fs.statSync(path.join(nativeDir, d)).isDirectory())
        .sort();
      if (versions.length > 0) {
        const latest = versions[versions.length - 1];
        const exe = path.join(nativeDir, latest, "claude.exe");
        if (fs.existsSync(exe)) {
          return { exe, args: [], mode: "native" };
        }
      }
    } catch {
      /* scan failed, try next */
    }
  }

  // 2. npm global installation
  const npmCli = path.join(
    os.homedir(),
    "AppData",
    "Roaming",
    "npm",
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "cli.js"
  );
  if (fs.existsSync(npmCli)) {
    return { exe: process.execPath, args: [npmCli], mode: "npm" };
  }

  // 3. Fallback: assume 'claude' is on PATH
  if (os.platform() === "win32") {
    return { exe: "cmd.exe", args: ["/c", "claude"], mode: "path" };
  }
  return { exe: "claude", args: [], mode: "path" };
}

const CLAUDE = resolveClaude();

// Strip ANSI escape sequences for clean text analysis
function stripAnsi(str) {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
    ""
  );
}

/**
 * Attach terminal handling to a WebSocketServer.
 *
 * @param {import('ws').WebSocketServer} wss - The WebSocket server (already created with path routing)
 * @param {string} baseDir - Working directory for spawned processes
 */
function attachTerminal(wss, baseDir) {
  console.log(`  Terminal handler attached`);
  console.log(`  Claude: ${CLAUDE.exe} ${CLAUDE.args.join(" ")} (${CLAUDE.mode})`);

  wss.on("connection", (ws) => {
    let ptyProc = null;
    let initialized = false;
    let ready = false;
    let inShell = false;
    let pending = null;
    let pendingWrite = null;
    let lastCols = 120;
    let lastRows = 30;
    let readyFallbackTimer = null;

    function spawn(cols, rows) {
      lastCols = cols;
      lastRows = rows;

      try {
        ptyProc = pty.spawn(CLAUDE.exe, CLAUDE.args, {
          name: "xterm-256color",
          cols,
          rows,
          cwd: baseDir,
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

        // Detect Claude Code readiness: only the ❯ prompt character (U+276F).
        // Do NOT check for "/help" — it appears in the startup banner BEFORE
        // the input handler is initialized, causing premature command submission.
        if (!inShell && !ready) {
          const clean = stripAnsi(data);
          if (clean.includes("\u276f")) {
            ready = true;
            if (readyFallbackTimer) {
              clearTimeout(readyFallbackTimer);
              readyFallbackTimer = null;
            }
            flush();
          }
        }
      });

      ptyProc.onExit(({ exitCode }) => {
        ptyProc = null;
        ready = false;
        if (readyFallbackTimer) {
          clearTimeout(readyFallbackTimer);
          readyFallbackTimer = null;
        }

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            `\r\n\x1b[90m[Claude Code exited ${exitCode}]\x1b[0m\r\n`
          );
          spawnShell(lastCols, lastRows);
        }
      });

      // Fallback: if prompt detection misses, mark ready after 10s
      readyFallbackTimer = setTimeout(() => {
        readyFallbackTimer = null;
        if (!ready) {
          ready = true;
          flush();
        }
      }, 10000);
    }

    function spawnShell(cols, rows) {
      let shellExe, shellArgs;
      if (os.platform() === "win32") {
        const pwshPath = path.join(
          process.env.ProgramFiles || "C:\\Program Files",
          "PowerShell",
          "7",
          "pwsh.exe"
        );
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
          cwd: baseDir,
          env: {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
          },
        });
      } catch (err) {
        ws.send(
          `\r\n\x1b[31mFailed to start shell: ${err.message}\x1b[0m\r\n`
        );
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
      } else if (pendingWrite && ptyProc) {
        ptyProc.write(pendingWrite);
        pendingWrite = null;
      }
    }

    function submit(text) {
      if (!ptyProc) return;
      ready = false;
      // Send text + Enter atomically in one write to avoid the 100ms gap
      // where \r could be lost on Windows ConPTY or during terminal mode changes.
      ptyProc.write(text + "\r");
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

          if (m.type === "write" && m.text) {
            if (ptyProc && ready) {
              ptyProc.write(m.text);
            } else if (ptyProc) {
              pendingWrite = m.text;
            }
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
        } catch {
          /* not JSON, fall through */
        }
      }

      // Raw keystrokes from xterm.js
      if (ptyProc) ptyProc.write(msg);
    });

    ws.on("close", () => {
      if (ptyProc)
        try {
          ptyProc.kill();
        } catch {
          /* already gone */
        }
    });
  });
}

module.exports = { attachTerminal, resolveClaude };
