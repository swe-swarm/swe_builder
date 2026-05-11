"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { spawnSync } = require("node:child_process");
const yaml = require("js-yaml");

const { build } = require("../src/build");
const { loadManifest } = require("../src/manifest");
const { SDK_PINS } = require("../src/version");

const FIXTURES = path.join(__dirname, "fixtures");
const SMOKE = path.join(FIXTURES, "smoke.swe.amp.yaml");

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amp-py-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function pythonManifest(t) {
  const dir = await tempDir(t);
  const manifest = JSON.parse(JSON.stringify(loadManifest(SMOKE).manifest));
  manifest.agent.language = "python";
  const manifestPath = path.join(dir, "smoke-python.swe.amp.yaml");
  await fs.writeFile(manifestPath, yaml.dump(manifest), "utf8");
  return manifestPath;
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(dir, suffix) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(full, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(full);
  }
  return files;
}

test("Python generator emits the expected smoke project files", async (t) => {
  const manifestPath = await pythonManifest(t);
  const outDir = path.join(await tempDir(t), "out");

  await build({ manifestPath, outDir, dryRun: false });

  for (const relPath of [
    "pyproject.toml",
    path.join("src", "smoke_agent", "main.py"),
    path.join("src", "smoke_agent", "tools", "lookup_issue.py"),
    "swe.amp.lock.json",
    "README.md",
  ]) {
    assert.equal(await exists(path.join(outDir, relPath)), true, `${relPath} should exist`);
  }
});

test("Python pyproject.toml contains the SDK pin", async (t) => {
  const manifestPath = await pythonManifest(t);
  const outDir = path.join(await tempDir(t), "out");

  await build({ manifestPath, outDir, dryRun: false });
  const pyproject = await readText(path.join(outDir, "pyproject.toml"));

  assert.match(pyproject, new RegExp(`github-copilot-sdk${SDK_PINS.python["github-copilot-sdk"].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("Python main.py imports copilot and wires approve_all", async (t) => {
  const manifestPath = await pythonManifest(t);
  const outDir = path.join(await tempDir(t), "out");

  await build({ manifestPath, outDir, dryRun: false });
  const mainPy = await readText(path.join(outDir, "src", "smoke_agent", "main.py"));

  assert.match(mainPy, /import copilot/);
  assert.match(mainPy, /from copilot import CopilotClient/);
  assert.match(mainPy, /PermissionHandler\.approve_all/);
});

test("Python generated files parse with ast.parse when python is available", async (t) => {
  const probe = spawnSync("python", ["--version"], { encoding: "utf8" });
  if (probe.error && probe.error.code === "ENOENT") {
    t.skip("python is not on PATH");
    return;
  }

  const manifestPath = await pythonManifest(t);
  const outDir = path.join(await tempDir(t), "out");
  await build({ manifestPath, outDir, dryRun: false });
  const files = await collectFiles(path.join(outDir, "src"), ".py");
  const script = [
    "import ast, pathlib, sys",
    "for name in sys.argv[1:]:",
    "    ast.parse(pathlib.Path(name).read_text(encoding='utf-8'), filename=name)",
  ].join("\n");
  const result = spawnSync("python", ["-c", script, ...files], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
