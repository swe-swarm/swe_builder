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
const GO_SDK = "github.com/github/copilot-sdk/go";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amp-go-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function goManifest(t) {
  const dir = await tempDir(t);
  const manifest = JSON.parse(JSON.stringify(loadManifest(SMOKE).manifest));
  manifest.agent.language = "go";
  const manifestPath = path.join(dir, "smoke-go.swe.amp.yaml");
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

test("Go generator emits the expected smoke project files", async (t) => {
  const manifestPath = await goManifest(t);
  const outDir = path.join(await tempDir(t), "out");

  await build({ manifestPath, outDir, dryRun: false });

  for (const relPath of [
    "go.mod",
    path.join("cmd", "smoke_agent", "main.go"),
    path.join("tools", "lookup_issue.go"),
    "swe.amp.lock.json",
    "README.md",
  ]) {
    assert.equal(await exists(path.join(outDir, relPath)), true, `${relPath} should exist`);
  }
});

test("Go go.mod contains the SDK pin", async (t) => {
  const manifestPath = await goManifest(t);
  const outDir = path.join(await tempDir(t), "out");

  await build({ manifestPath, outDir, dryRun: false });
  const goMod = await readText(path.join(outDir, "go.mod"));

  assert.match(goMod, new RegExp(`${GO_SDK} ${SDK_PINS.go[GO_SDK]}`));
});

test("Go main.go imports the SDK package", async (t) => {
  const manifestPath = await goManifest(t);
  const outDir = path.join(await tempDir(t), "out");

  await build({ manifestPath, outDir, dryRun: false });
  const mainGo = await readText(path.join(outDir, "cmd", "smoke_agent", "main.go"));

  assert.match(mainGo, /copilot "github\.com\/github\/copilot-sdk\/go"/);
});

test("Go generated files are gofmt-clean when gofmt is available", async (t) => {
  const probe = spawnSync("gofmt", ["-h"], { encoding: "utf8" });
  if (probe.error && probe.error.code === "ENOENT") {
    t.skip("gofmt is not on PATH");
    return;
  }

  const manifestPath = await goManifest(t);
  const outDir = path.join(await tempDir(t), "out");
  await build({ manifestPath, outDir, dryRun: false });
  const files = await collectFiles(outDir, ".go");
  const result = spawnSync("gofmt", ["-l", ...files], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "");
});
