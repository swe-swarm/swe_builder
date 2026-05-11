"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "amp", "cli", "amp.js");
const SMOKE = path.join(__dirname, "fixtures", "smoke.swe.amp.yaml");
const INVALID = path.join(__dirname, "fixtures", "invalid-bad-language.yaml");

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amp-cli-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    ...options,
  });
}

function combined(result) {
  return `${result.stdout || ""}${result.stderr || ""}`;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("amp --version outputs a version string and exits 0", () => {
  const result = run(["--version"]);

  assert.equal(result.status, 0, combined(result));
  assert.match(result.stdout, /swe_builder amp v/);
});

test("amp help exits 0 and lists subcommands", () => {
  const result = run(["help"]);

  assert.equal(result.status, 0, combined(result));
  assert.match(result.stdout, /Commands:/);
  assert.match(result.stdout, /init <name>/);
  assert.match(result.stdout, /validate \[manifest\]/);
  assert.match(result.stdout, /build \[manifest\]/);
});

test("amp list-extensions exits 0 and outputs a markdown table", () => {
  const result = run(["list-extensions"]);

  assert.equal(result.status, 0, combined(result));
  assert.match(result.stdout, /\| id \| ampField \| sdkSurface \| description \|/);
  assert.match(result.stdout, /\| --- \| --- \| --- \| --- \|/);
});

test("amp validate exits 0 for the smoke fixture", () => {
  const result = run(["validate", SMOKE]);

  assert.equal(result.status, 0, combined(result));
  assert.match(result.stdout, /Valid AMP manifest/);
});

test("amp validate exits non-zero for an invalid fixture", () => {
  const result = run(["validate", INVALID]);

  assert.notEqual(result.status, 0, combined(result));
  assert.match(combined(result), /schema validation|allowed values/);
});

test("amp build --dry-run prints surfaces and writes no files", async (t) => {
  const dir = await tempDir(t);
  const outDir = path.join(dir, "dry-out");

  const result = run(["build", SMOKE, "--out", outDir, "--dry-run"]);

  assert.equal(result.status, 0, combined(result));
  assert.match(result.stdout, /Surfaces wired:/);
  assert.equal(await exists(path.join(outDir, "package.json")), false);
});

test("amp build writes files", async (t) => {
  const dir = await tempDir(t);
  const outDir = path.join(dir, "out");

  const result = run(["build", SMOKE, "--out", outDir]);

  assert.equal(result.status, 0, combined(result));
  assert.equal(await exists(path.join(outDir, "package.json")), true);
  assert.equal(await exists(path.join(outDir, "src", "index.ts")), true);
});

test("amp init creates a manifest, refuses overwrite, and supports --force", async (t) => {
  const dir = await tempDir(t);
  const name = "cli-agent";
  const manifestPath = path.join(dir, name, "swe.amp.yaml");

  const first = run(["init", name, "--dir", dir]);
  const second = run(["init", name, "--dir", dir]);
  const third = run(["init", name, "--dir", dir, "--force"]);

  assert.equal(first.status, 0, combined(first));
  assert.equal(await exists(manifestPath), true);
  assert.notEqual(second.status, 0, combined(second));
  assert.equal(third.status, 0, combined(third));
});

test("amp doctor exits 0 with no manifest and prints version info", () => {
  const result = run(["doctor"]);

  assert.equal(result.status, 0, combined(result));
  assert.match(result.stdout, /AMP doctor/);
  assert.match(result.stdout, /AMP_VERSION:/);
  assert.match(result.stdout, /COPILOT_SDK_PROTOCOL_VERSION:/);
});

test("amp add tool mutates a manifest, creates a backup, and remains valid", async (t) => {
  const dir = await tempDir(t);
  const manifestPath = path.join(dir, "smoke-copy.swe.amp.yaml");
  await fs.copyFile(SMOKE, manifestPath);

  const addResult = run(["add", "tool", "foo", "--description", "bar", "--manifest", manifestPath]);
  const validateResult = run(["validate", manifestPath]);
  const manifestText = await fs.readFile(manifestPath, "utf8");

  assert.equal(addResult.status, 0, combined(addResult));
  assert.equal(await exists(`${manifestPath}.bak`), true);
  assert.equal(validateResult.status, 0, combined(validateResult));
  assert.match(manifestText, /name: foo/);
  assert.match(manifestText, /description: bar/);
});
