#!/usr/bin/env node
/**
 * swe_builder CLI
 *
 * Commands:
 *   swe_builder start     Start the dashboard
 *   swe_builder stop      Stop a running instance
 *   swe_builder restart   Restart the dashboard
 *   swe_builder health    Check if the dashboard is running
 *
 * Flags --start, --stop, --restart, --health also accepted.
 */

const { spawn, execSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PKG_DIR = path.resolve(__dirname, "..");
const LOCKFILE = path.join(os.homedir(), ".swe_builder.lock");
const VERSION = require(path.join(PKG_DIR, "package.json")).version;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`\x1b[36m[swe_builder]\x1b[0m ${msg}`);
}

function err(msg) {
  console.error(`\x1b[31m[swe_builder]\x1b[0m ${msg}`);
}

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(LOCKFILE, "utf8"));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function httpGet(url, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      resolve(res.statusCode);
      res.resume();
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function startServer() {
  const lock = readLock();
  if (lock && isProcessAlive(lock.pid)) {
    log(`Already running (pid ${lock.pid}, port ${lock.port}).`);
    log(`Open http://localhost:${lock.port}`);
    return;
  }

  // Clean stale lockfile
  if (lock) {
    try { fs.unlinkSync(LOCKFILE); } catch {}
  }

  log(`Starting MCS Agent Builder v${VERSION}...`);

  // Spawn start.js as a detached child so the CLI can exit
  const startJs = path.join(PKG_DIR, "start.js");
  const child = spawn(process.execPath, [startJs], {
    cwd: PKG_DIR,
    stdio: "inherit",
    env: { ...process.env, MCS_LOCKFILE: LOCKFILE },
  });

  child.on("error", (e) => {
    err(`Failed to start: ${e.message}`);
    process.exit(1);
  });

  // Forward signals for graceful shutdown
  const relay = (sig) => { try { child.kill(sig); } catch {} };
  process.on("SIGINT", () => relay("SIGINT"));
  process.on("SIGTERM", () => relay("SIGTERM"));

  child.on("exit", (code) => process.exit(code || 0));
}

function stopServer() {
  const lock = readLock();
  if (!lock) {
    log("No running instance found.");
    return;
  }

  if (!isProcessAlive(lock.pid)) {
    log("Instance already stopped (cleaning lockfile).");
    try { fs.unlinkSync(LOCKFILE); } catch {}
    return;
  }

  log(`Stopping instance (pid ${lock.pid}, port ${lock.port})...`);

  try {
    // Send SIGTERM first for graceful shutdown
    process.kill(lock.pid, "SIGTERM");
  } catch {
    // Already gone
  }

  // Wait up to 5s for process to die, then force kill
  const start = Date.now();
  const poll = setInterval(() => {
    if (!isProcessAlive(lock.pid)) {
      clearInterval(poll);
      try { fs.unlinkSync(LOCKFILE); } catch {}
      log("Stopped.");
      return;
    }
    if (Date.now() - start > 5000) {
      clearInterval(poll);
      try { process.kill(lock.pid, "SIGKILL"); } catch {}
      try { fs.unlinkSync(LOCKFILE); } catch {}
      log("Force-killed.");
    }
  }, 200);
}

async function healthCheck() {
  const lock = readLock();
  if (!lock) {
    console.log("Status: \x1b[31mNot running\x1b[0m");
    console.log("Run: swe_builder start");
    process.exit(1);
    return;
  }

  if (!isProcessAlive(lock.pid)) {
    console.log("Status: \x1b[31mDead\x1b[0m (stale lockfile)");
    try { fs.unlinkSync(LOCKFILE); } catch {}
    process.exit(1);
    return;
  }

  const url = `http://localhost:${lock.port}`;
  try {
    const status = await httpGet(`${url}/api/health`).catch(() => httpGet(url));
    if (status === 200) {
      console.log(`Status: \x1b[32mHealthy\x1b[0m`);
      console.log(`  PID:  ${lock.pid}`);
      console.log(`  Port: ${lock.port}`);
      console.log(`  URL:  ${url}`);
    } else {
      console.log(`Status: \x1b[33mDegraded\x1b[0m (HTTP ${status})`);
      console.log(`  PID:  ${lock.pid}`);
      console.log(`  Port: ${lock.port}`);
      process.exit(1);
    }
  } catch {
    console.log(`Status: \x1b[33mUnresponsive\x1b[0m (pid ${lock.pid} alive, HTTP failed)`);
    console.log(`  PID:  ${lock.pid}`);
    console.log(`  Port: ${lock.port}`);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
  \x1b[36mMCS Agent Builder\x1b[0m v${VERSION}

  Microsoft Copilot Studio agent build automation with Claude Code.

  \x1b[1mUsage:\x1b[0m
    swe_builder <command> [args]

  \x1b[1mCommands:\x1b[0m
    start, --start       Start the dashboard server
    stop, --stop         Stop a running instance
    restart, --restart   Stop then start
    health, --health     Check if the dashboard is running
    amp <subcommand>     Adaptive Manifest Protocol toolkit (build copilot-sdk
                         compliant agents from a manifest). Try 'amp help'.
    --version, -v        Show version
    --help, -h           Show this help

  \x1b[1mAlternative:\x1b[0m
    Double-click start.cmd (Windows) for full setup + launch.
`);
}

function runAmpCli(rest) {
  const ampCli = path.join(PKG_DIR, "amp", "cli", "amp.js");
  if (!fs.existsSync(ampCli)) {
    err("AMP CLI not found at " + ampCli);
    process.exit(1);
  }
  const child = spawn(process.execPath, [ampCli, ...rest], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code || 0));
  child.on("error", (e) => { err("Failed to launch amp CLI: " + e.message); process.exit(1); });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const raw = process.argv[2] || "help";
const command = raw.replace(/^-+/, "");

switch (command) {
  case "start":
    startServer();
    break;
  case "stop":
    stopServer();
    break;
  case "restart":
    stopServer();
    // Wait a beat for ports to free, then start
    setTimeout(() => startServer(), 1500);
    break;
  case "health":
    healthCheck();
    break;
  case "amp":
    runAmpCli(process.argv.slice(3));
    break;
  case "version":
  case "v":
    console.log(`swe_builder v${VERSION}`);
    break;
  case "help":
  case "h":
  default:
    showHelp();
    break;
}
