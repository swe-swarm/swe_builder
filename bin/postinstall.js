#!/usr/bin/env node
/**
 * swe_builder postinstall
 *
 * Runs after `npm install` to set up dependencies and environment.
 * Failures are non-blocking — the dashboard still works without Python.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PKG_DIR = path.resolve(__dirname, "..");

function log(msg) {
  console.log(`\x1b[36m[swe_builder]\x1b[0m ${msg}`);
}

function warn(msg) {
  console.log(`\x1b[33m[swe_builder]\x1b[0m ${msg}`);
}

function ok(msg) {
  console.log(`\x1b[32m[swe_builder]\x1b[0m ${msg}`);
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", timeout: 180000, stdio: "pipe", ...opts });
}

function commandExists(cmd) {
  try {
    const which = os.platform() === "win32" ? "where" : "which";
    run(`${which} ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 1. Check Python
// ---------------------------------------------------------------------------

let hasPython = false;
let pythonCmd = "python";

for (const cmd of ["python3", "python"]) {
  if (commandExists(cmd)) {
    try {
      const ver = run(`${cmd} -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"`).trim();
      const [major, minor] = ver.split(".").map(Number);
      if (major >= 3 && minor >= 10) {
        hasPython = true;
        pythonCmd = cmd;
        log(`Python ${ver} found (${cmd})`);
        break;
      } else {
        warn(`${cmd} is version ${ver} — need 3.10+`);
      }
    } catch {}
  }
}

if (!hasPython) {
  warn("Python 3.10+ not found — the dashboard backend requires it.");
  warn("Install Python: https://python.org or run start.cmd on Windows for auto-install.");
}

// ---------------------------------------------------------------------------
// 2. Install Python dependencies
// ---------------------------------------------------------------------------

if (hasPython) {
  const reqFile = path.join(PKG_DIR, "requirements.txt");
  if (fs.existsSync(reqFile)) {
    log("Installing Python dependencies...");
    try {
      // Use pip associated with the detected python
      run(`${pythonCmd} -m pip install --quiet -r "${reqFile}"`, { stdio: "inherit" });
      ok("Python dependencies installed");
    } catch {
      warn("pip install failed — run manually: pip install -r requirements.txt");
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Build frontend if not already built
// ---------------------------------------------------------------------------

const frontendDir = path.join(PKG_DIR, "app", "frontend");
const distIndex = path.join(PKG_DIR, "app", "dist", "index.html");

if (fs.existsSync(path.join(frontendDir, "package.json")) && !fs.existsSync(distIndex)) {
  log("Building frontend...");
  try {
    run("npm install --no-audit --no-fund", { cwd: frontendDir, stdio: "inherit", timeout: 120000 });
    run("npm run build", { cwd: frontendDir, stdio: "inherit", timeout: 120000 });
    ok("Frontend built");
  } catch {
    warn("Frontend build failed — dashboard may show a placeholder page.");
    warn("Run manually: npm --prefix app/frontend install && npm --prefix app/frontend run build");
  }
} else if (fs.existsSync(distIndex)) {
  ok("Frontend already built");
}

// ---------------------------------------------------------------------------
// 4. Set environment variables (Windows only — persists for user)
// ---------------------------------------------------------------------------

if (os.platform() === "win32") {
  const envVar = "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS";
  try {
    const current = run(`powershell -Command "[Environment]::GetEnvironmentVariable('${envVar}', 'User')"`).trim();
    if (current !== "1") {
      run(`powershell -Command "[Environment]::SetEnvironmentVariable('${envVar}', '1', 'User')"`);
      log("Agent Teams environment variable set");
    }
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// 5. Install git hooks (if in a git repo)
// ---------------------------------------------------------------------------

const gitDir = path.join(PKG_DIR, ".git");
if (fs.existsSync(gitDir)) {
  const hooksDir = path.join(gitDir, "hooks");
  const hookNames = ["pre-commit", "pre-push"];
  let installed = false;
  for (const hook of hookNames) {
    const src = path.join(PKG_DIR, "tools", "git-hooks", hook);
    const dst = path.join(hooksDir, hook);
    if (!fs.existsSync(src)) continue;
    try {
      const srcContent = fs.readFileSync(src, "utf8");
      if (!fs.existsSync(dst) || fs.readFileSync(dst, "utf8") !== srcContent) {
        fs.mkdirSync(hooksDir, { recursive: true });
        fs.writeFileSync(dst, srcContent, { mode: 0o755 });
        installed = true;
      }
    } catch {}
  }
  if (installed) log("Git hooks installed");
}

// ---------------------------------------------------------------------------
// 6. Success banner
// ---------------------------------------------------------------------------

console.log(`
\x1b[32m  ✓ swe_builder installed successfully\x1b[0m

  \x1b[1mCommands:\x1b[0m
    swe_builder start       Start the dashboard
    swe_builder stop        Stop a running instance
    swe_builder restart     Restart the dashboard
    swe_builder health      Check status

  \x1b[1mAlso accepts flag syntax:\x1b[0m
    swe_builder --start
    swe_builder --stop
    swe_builder --restart
    swe_builder --health

  \x1b[90mOr use start.cmd (Windows) for full setup including winget tools.\x1b[0m
`);
