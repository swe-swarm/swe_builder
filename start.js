#!/usr/bin/env node
/**
 * MCS Agent Builder — Launcher
 *
 * Starts the dashboard server (which manages the terminal sidecar),
 * opens the browser, and shuts everything down cleanly on exit.
 *
 * Handles:
 *   - Auto-updating from the remote repo (git pull)
 *   - Killing stale processes on ports 8000/8001/8002
 *   - Auto-installing npm + pip dependencies if missing
 *   - Opening the browser once the dashboard responds
 *   - Graceful shutdown on Ctrl+C
 *
 * Usage: npm start
 */

const { spawn, execSync } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");
const os = require("os");
const fs = require("fs");

const PORT_START = 8000;
const PORT_MAX = 8020;
const LOCKFILE = process.env.MCS_LOCKFILE || path.join(os.homedir(), ".swe_builder.lock");

// Minimum required versions
const MIN_NODE = 18;
const MIN_PYTHON = [3, 10];

// Flags set by autoUpdate when pulled commits change dependency files
let depsChanged = { npm: false, pip: false, frontend: false };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`\x1b[36m[launcher]\x1b[0m ${msg}`);
}

function warn(msg) {
  console.log(`\x1b[33m[launcher]\x1b[0m ${msg}`);
}

function err(msg) {
  console.error(`\x1b[31m[launcher]\x1b[0m ${msg}`);
}

// ---------------------------------------------------------------------------
// Single-instance lockfile
// ---------------------------------------------------------------------------

function checkSingleInstance() {
  if (fs.existsSync(LOCKFILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LOCKFILE, "utf8"));
      // Check if the PID is still running
      try {
        process.kill(data.pid, 0); // signal 0 = existence check
        err(`MCS Agent Builder is already running (pid ${data.pid}, port ${data.port}).`);
        err(`Open http://localhost:${data.port} or stop it first.`);
        process.exit(1);
      } catch {
        // PID not running — stale lock, clean up
        log("Cleaning up stale lockfile...");
        fs.unlinkSync(LOCKFILE);
      }
    } catch {
      // Corrupt lockfile — remove it
      try { fs.unlinkSync(LOCKFILE); } catch {}
    }
  }
}

function writeLockfile(port) {
  fs.writeFileSync(LOCKFILE, JSON.stringify({ pid: process.pid, port }, null, 2));
}

function removeLockfile() {
  try { fs.unlinkSync(LOCKFILE); } catch {}
}

// ---------------------------------------------------------------------------
// Port probing — find an available port pair (app, app+1 for terminal)
// ---------------------------------------------------------------------------

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => { srv.close(); resolve(true); });
    srv.listen(port, "127.0.0.1");
  });
}

async function findPortPair() {
  for (let p = PORT_START; p <= PORT_MAX; p += 2) {
    const appOk = await isPortAvailable(p);
    const termOk = await isPortAvailable(p + 1);
    if (appOk && termOk) return { app: p, terminal: p + 1 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Kill stale processes on a port (Windows + Unix)
// ---------------------------------------------------------------------------

function killPort(port) {
  try {
    if (os.platform() === "win32") {
      const result = execSync(`netstat -ano -p TCP`, {
        encoding: "utf8",
        timeout: 5000,
      });
      const killed = new Set();
      for (const line of result.split("\n")) {
        // Match ANY state (LISTENING, TIME_WAIT, CLOSE_WAIT, etc.)
        if (line.match(new RegExp(`[:.:]${port}\\s`))) {
          const pid = line.trim().split(/\s+/).pop();
          if (pid && /^\d+$/.test(pid) && pid !== "0" && !killed.has(pid)) {
            try {
              execSync(`taskkill /F /PID ${pid}`, {
                stdio: "ignore",
                timeout: 5000,
              });
              log(`Killed process on port ${port} (pid ${pid})`);
              killed.add(pid);
            } catch {
              // Process may have already exited
            }
          }
        }
      }
    } else {
      // macOS / Linux
      try {
        const pid = execSync(`lsof -ti:${port}`, {
          encoding: "utf8",
          timeout: 5000,
        }).trim();
        if (pid) {
          execSync(`kill -9 ${pid}`, { stdio: "ignore", timeout: 5000 });
          log(`Killed stale process on port ${port} (pid ${pid})`);
        }
      } catch {
        // No process on port — fine
      }
    }
  } catch {
    // netstat/lsof failed — not critical
  }
}

// ---------------------------------------------------------------------------
// Auto-update: pull latest from remote if possible
// ---------------------------------------------------------------------------

function autoUpdate() {
  // Skip if not a git repo
  if (!fs.existsSync(path.join(__dirname, ".git"))) {
    return false;
  }

  // Skip if git isn't available
  try {
    execSync("git --version", { stdio: "ignore", timeout: 5000 });
  } catch {
    return false;
  }

  // Fetch latest from remote
  try {
    log("Checking for updates...");
    execSync("git fetch --quiet", { cwd: __dirname, stdio: "ignore", timeout: 30000 });
  } catch {
    warn("Could not reach remote — starting with current version.");
    return false;
  }

  // Check if we're behind
  try {
    const behind = execSync("git rev-list --count HEAD..@{upstream}", {
      encoding: "utf8",
      cwd: __dirname,
      timeout: 5000,
    }).trim();

    if (behind === "0") {
      log("Already up to date.");
      return false;
    }

    // Record current HEAD to detect what changed
    const headBefore = execSync("git rev-parse HEAD", {
      encoding: "utf8",
      cwd: __dirname,
      timeout: 5000,
    }).trim();

    // Stash local changes if working tree is dirty
    let stashed = false;
    const status = execSync("git status --porcelain", {
      encoding: "utf8",
      cwd: __dirname,
      timeout: 10000,
    }).trim();
    if (status) {
      try {
        execSync('git stash push --quiet -m "auto-stash before update"', {
          cwd: __dirname,
          stdio: "ignore",
          timeout: 10000,
        });
        stashed = true;
        log("Stashed local changes.");
      } catch {
        warn("Could not stash local changes — skipping update.");
        return false;
      }
    }

    // Fast-forward only — never create merge commits
    log(`${behind} new commit(s) available — updating...`);
    execSync("git pull --ff-only", { cwd: __dirname, stdio: "inherit", timeout: 60000 });
    log("Updated to latest version.");

    // Restore stashed changes
    if (stashed) {
      try {
        execSync("git stash pop --quiet", { cwd: __dirname, stdio: "ignore", timeout: 10000 });
        log("Restored local changes.");
      } catch {
        warn("Could not restore local changes — run 'git stash pop' manually.");
      }
    }

    // Detect which dependency files changed — triggers targeted reinstall
    try {
      const changed = execSync(`git diff --name-only ${headBefore} HEAD`, {
        encoding: "utf8",
        cwd: __dirname,
        timeout: 5000,
      });
      if (/^package\.json$/m.test(changed) || /^package-lock\.json$/m.test(changed)) {
        depsChanged.npm = true;
        log("Root dependencies changed — will reinstall.");
      }
      if (changed.includes("requirements.txt")) {
        depsChanged.pip = true;
        log("Python dependencies changed — will reinstall.");
      }
      if (changed.includes("app/frontend/package.json") || changed.includes("app/frontend/package-lock.json")) {
        depsChanged.frontend = true;
      }
      if (changed.includes("app/frontend/")) {
        log("Frontend changes detected — will rebuild.");
        // Remove dist/index.html so the existing build step triggers
        const distIdx = path.join(__dirname, "app", "dist", "index.html");
        if (fs.existsSync(distIdx)) {
          fs.unlinkSync(distIdx);
        }
      }
    } catch {
      // If diff fails, just let the user rebuild manually
    }

    return true;
  } catch (e) {
    warn("Auto-update failed (merge conflict?) — starting with current version.");
    warn("Run 'git pull' manually to resolve.");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Preflight: check required tools exist
// ---------------------------------------------------------------------------

function checkCommand(cmd, name, hint) {
  try {
    execSync(cmd, { stdio: "ignore", timeout: 10000 });
    return true;
  } catch {
    err(`${name} not found. ${hint}`);
    return false;
  }
}

function checkClaudeCode() {
  // 1. Native installation: ~/.claude-cli/<version>/claude.exe
  const nativeDir = path.join(os.homedir(), ".claude-cli");
  if (fs.existsSync(nativeDir)) {
    try {
      const versions = fs.readdirSync(nativeDir)
        .filter(d => fs.statSync(path.join(nativeDir, d)).isDirectory())
        .sort();
      if (versions.length > 0) {
        const latest = versions[versions.length - 1];
        if (fs.existsSync(path.join(nativeDir, latest, "claude.exe"))) {
          return true;
        }
      }
    } catch { /* scan failed */ }
  }

  // 2. npm global installation
  const npmCli = path.join(
    os.homedir(), "AppData", "Roaming", "npm",
    "node_modules", "@anthropic-ai", "claude-code", "cli.js"
  );
  if (fs.existsSync(npmCli)) return true;

  // 3. PATH fallback
  try {
    execSync(os.platform() === "win32" ? "where claude" : "which claude", {
      stdio: "ignore",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Preflight: auto-install dependencies
// ---------------------------------------------------------------------------

function ensureNodeModules() {
  const missing = !fs.existsSync(path.join(__dirname, "node_modules"));
  if (missing || depsChanged.npm) {
    log(missing ? "node_modules not found — running npm install..." : "package.json changed — running npm install...");
    try {
      execSync("npm install", { stdio: "inherit", cwd: __dirname, timeout: 120000 });
      log("npm install complete");
    } catch {
      err("npm install failed");
      process.exit(1);
    }
  }
}

function ensurePythonDeps() {
  // Check if core packages are importable
  let installed = false;
  try {
    execSync('python -c "import fastapi; import uvicorn; import markitdown"', {
      stdio: "ignore",
      timeout: 15000,
    });
    installed = true;
  } catch {}

  if (!installed || depsChanged.pip) {
    log(!installed ? "Python deps missing — running pip install..." : "requirements.txt changed — running pip install...");
    try {
      execSync('pip install fastapi uvicorn python-multipart "markitdown[all]"', {
        stdio: "inherit",
        timeout: 180000,
      });
      log("pip install complete");
    } catch {
      err('pip install failed. Run manually: pip install fastapi uvicorn python-multipart "markitdown[all]"');
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// Preflight: ensure Azure CLI + DevOps extension (for bug/suggest skills)
// ---------------------------------------------------------------------------

function ensureAzDevOps() {
  // Check if az CLI is available
  try {
    execSync("az --version", { stdio: "ignore", timeout: 15000 });
  } catch {
    warn("Azure CLI not found — bug/suggest buttons won't work until installed.");
    warn("Run start.cmd to install, or: https://aka.ms/installazurecli");
    return; // Non-blocking — the rest of the app works fine
  }

  // Check if azure-devops extension is installed
  try {
    execSync("az extension show --name azure-devops", { stdio: "ignore", timeout: 15000 });
  } catch {
    log("Installing Azure DevOps CLI extension...");
    try {
      execSync("az extension add --name azure-devops", { stdio: "inherit", timeout: 120000 });
      log("Azure DevOps extension installed");
    } catch {
      warn("Could not install azure-devops extension — run manually: az extension add --name azure-devops");
    }
  }
}

// ---------------------------------------------------------------------------
// Preflight: install git hooks for core file protection
// ---------------------------------------------------------------------------

function ensureGitHooks() {
  const hooksDir = path.join(__dirname, ".git", "hooks");
  const hooks = ["pre-commit", "pre-push"];
  let installed = false;
  for (const hook of hooks) {
    const src = path.join(__dirname, "tools", "git-hooks", hook);
    const dst = path.join(hooksDir, hook);
    if (!fs.existsSync(src)) continue;
    try {
      const srcContent = fs.readFileSync(src, "utf8");
      const dstExists = fs.existsSync(dst);
      if (!dstExists || fs.readFileSync(dst, "utf8") !== srcContent) {
        fs.mkdirSync(hooksDir, { recursive: true });
        fs.writeFileSync(dst, srcContent, { mode: 0o755 });
        installed = true;
      }
    } catch {
      warn(`Could not install ${hook} hook (non-critical)`);
    }
  }
  if (installed) log("Git hooks installed \u2014 core files protected + om-cli auto-update");
}

// ---------------------------------------------------------------------------
// Cleanup: purge Playwright MCP browser cache (keeps cookies/logins)
// ---------------------------------------------------------------------------

function cleanPlaywrightCache() {
  const profileDir = path.join(os.homedir(), ".playwright-mcp-edge");
  if (!fs.existsSync(profileDir)) return;

  // Expendable dirs that regrow on next launch — safe to nuke
  const expendable = [
    path.join(profileDir, "Default", "Service Worker"),
    path.join(profileDir, "Default", "Code Cache"),
    path.join(profileDir, "Default", "Cache"),
    path.join(profileDir, "Default", "GPUCache"),
    path.join(profileDir, "Default", "DawnWebGPUCache"),
    path.join(profileDir, "Default", "DawnGraphiteCache"),
    path.join(profileDir, "GrShaderCache"),
    path.join(profileDir, "ShaderCache"),
    path.join(profileDir, "GraphiteDawnCache"),
    path.join(profileDir, "BrowserMetrics"),
    path.join(profileDir, "DeferredBrowserMetrics"),
    path.join(profileDir, "Crashpad"),
  ];

  let freed = 0;
  for (const dir of expendable) {
    if (!fs.existsSync(dir)) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      freed++;
    } catch {
      // Locked by running browser — skip silently
    }
  }
  if (freed > 0) log(`Cleaned ${freed} Playwright cache dirs (cookies & logins preserved)`);
}

// ---------------------------------------------------------------------------
// Wait for server to respond
// ---------------------------------------------------------------------------

function waitForReady(url, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (Date.now() - start > timeout) return reject(new Error("timeout"));
      http
        .get(url, (res) => {
          if (res.statusCode === 200) resolve();
          else setTimeout(poll, 500);
          res.resume();
        })
        .on("error", () => setTimeout(poll, 500));
    };
    poll();
  });
}

// ---------------------------------------------------------------------------
// Open browser
// ---------------------------------------------------------------------------

function openBrowser(url) {
  try {
    if (os.platform() === "win32")
      execSync(`start "" "${url}"`, { stdio: "ignore" });
    else if (os.platform() === "darwin")
      execSync(`open "${url}"`, { stdio: "ignore" });
    else execSync(`xdg-open "${url}"`, { stdio: "ignore" });
  } catch {
    log(`Open in your browser: ${url}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("\n\x1b[36m  MCS Agent Builder\x1b[0m\n");

// 1. Check required tools + versions
const ok = [
  checkCommand("node --version", "Node.js", "Run start.cmd to install"),
  checkCommand("python --version", "Python", "Run start.cmd to install"),
];
if (!ok.every(Boolean)) {
  err("Fix the above issues and try again. Run start.cmd for automatic installation.");
  process.exit(1);
}

// 1a. Verify Node.js version
const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < MIN_NODE) {
  err(`Node.js ${process.versions.node} is too old — ${MIN_NODE}+ required. Run start.cmd to upgrade.`);
  process.exit(1);
}

// 1b. Verify Python version
try {
  const pyVer = execSync('python -c "import sys; print(sys.version_info.major, sys.version_info.minor)"', {
    encoding: "utf8",
    timeout: 10000,
  }).trim().split(" ").map(Number);
  if (pyVer[0] < MIN_PYTHON[0] || (pyVer[0] === MIN_PYTHON[0] && pyVer[1] < MIN_PYTHON[1])) {
    err(`Python ${pyVer.join(".")} is too old — ${MIN_PYTHON.join(".")}+ required. Run start.cmd to upgrade.`);
    process.exit(1);
  }
} catch {
  warn("Could not determine Python version — continuing.");
}

// 1c. Check .NET 10 runtime (non-blocking — om-cli needs it)
try {
  const runtimes = execSync("dotnet --list-runtimes", { encoding: "utf8", timeout: 10000 });
  if (!runtimes.includes("Microsoft.NETCore.App 10."))
    warn(".NET 10 runtime not found — om-cli tools won't work until installed. Run start.cmd --full to install.");
} catch {
  warn(".NET 10 not detected — om-cli tools may not work.");
}

// 1d. Check Claude Code (non-blocking — dashboard works without it)
if (!checkClaudeCode()) {
  warn("Claude Code not found — the embedded terminal won't work until installed.");
  warn("Run start.cmd or: npm install -g @anthropic-ai/claude-code");
}

// 2. Auto-update from remote
autoUpdate();

// 3. Auto-install dependencies
ensureNodeModules();
ensurePythonDeps();

// 4. Install git hooks + ensure az devops
ensureGitHooks();
ensureAzDevOps();

// 4a. Clean Playwright MCP browser cache (accumulates 400MB+ over time)
cleanPlaywrightCache();

// 5. Auto-build frontend if dist is missing or stale (cleared by auto-update)
const frontendDir = path.join(__dirname, "app", "frontend");
const distIndex = path.join(__dirname, "app", "dist", "index.html");
if (fs.existsSync(path.join(frontendDir, "package.json")) && !fs.existsSync(distIndex)) {
  log("Frontend not built — building app/frontend...");
  if (!fs.existsSync(path.join(frontendDir, "node_modules")) || depsChanged.frontend) {
    log(depsChanged.frontend ? "Frontend deps changed — reinstalling..." : "Installing frontend deps...");
    try {
      execSync("npm install", { stdio: "inherit", cwd: frontendDir, timeout: 120000 });
    } catch {
      warn("npm install failed in app/frontend — frontend may not work");
    }
  }
  try {
    execSync("npm run build", { stdio: "inherit", cwd: frontendDir, timeout: 120000 });
    log("Frontend build complete");
  } catch {
    warn("Frontend build failed — dashboard may show placeholder page");
  }
}

// 6. Single-instance check + find available ports + launch
checkSingleInstance();

(async () => {
  log("Finding available ports...");
  const ports = await findPortPair();
  if (!ports) {
    err(`No available port pair found in range ${PORT_START}-${PORT_MAX + 1}. Close some apps and retry.`);
    process.exit(1);
  }

  const PORT_APP = ports.app;
  const PORT_TERMINAL = ports.terminal;
  const URL = `http://localhost:${PORT_APP}`;

  if (PORT_APP !== PORT_START) {
    log(`Default port ${PORT_START} busy — using ${PORT_APP}/${PORT_TERMINAL}`);
  }

  writeLockfile(PORT_APP);

  // 7. Start the dashboard server (it manages terminal-server.js as a sidecar)
  //    Use spawn without shell to avoid DEP0190 deprecation warning.
  //    On Windows, resolve python to its full path to avoid needing shell: true.
  let pythonCmd = "python";
  try {
    pythonCmd = execSync(
      os.platform() === "win32" ? "where python" : "which python",
      { encoding: "utf8", timeout: 5000 }
    )
      .split("\n")[0]
      .trim();
  } catch {
    // Fall back to "python" and hope it's on PATH
  }

  const serverScript = path.join(__dirname, "app", "server.py");
  const server = spawn(pythonCmd, [serverScript], {
    cwd: __dirname,
    stdio: "inherit",
    env: { ...process.env, PORT: String(PORT_APP), TERMINAL_PORT: String(PORT_TERMINAL) },
  });

  server.on("error", (e) => {
    removeLockfile();
    err(`Failed to start server: ${e.message}`);
    process.exit(1);
  });

  server.on("exit", (code) => {
    removeLockfile();
    if (code !== null && code !== 0) {
      err(`Server exited with code ${code}`);
    }
    process.exit(code || 0);
  });

  // 8. Wait for dashboard to respond, then open browser
  waitForReady(URL)
    .then(() => {
      console.log(
        `\n\x1b[32m  ✓ Dashboard ready at ${URL}\x1b[0m`
      );
      console.log("\x1b[90m  Press Ctrl+C to stop\x1b[0m\n");
      openBrowser(URL);
    })
    .catch(() => {
      warn(`Dashboard may still be starting. Open manually: ${URL}`);
    });

  // 9. Graceful shutdown
  function shutdown() {
    console.log("\n\x1b[90m  Shutting down...\x1b[0m");
    removeLockfile();
    try {
      server.kill();
    } catch {}
    // Give server a moment to clean up its sidecar, then force exit
    setTimeout(() => process.exit(0), 2000);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
})();
