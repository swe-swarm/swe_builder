"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const yaml = require("js-yaml");

const { build, AmpBuildError } = require("../src/build");
const { loadManifest } = require("../src/manifest");

const FIXTURES = path.join(__dirname, "fixtures");
const SMOKE = path.join(FIXTURES, "smoke.swe.amp.yaml");

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amp-build-"));
  t.after(async () => {
    try {
      await fs.chmod(dir, 0o755);
    } catch {
      // Best effort cleanup on platforms that support chmod.
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function manifestForLanguage(t, language) {
  const dir = await tempDir(t);
  const manifest = JSON.parse(JSON.stringify(loadManifest(SMOKE).manifest));
  manifest.agent.language = language;
  const manifestPath = path.join(dir, `${language}.swe.amp.yaml`);
  await fs.writeFile(manifestPath, yaml.dump(manifest), "utf8");
  return manifestPath;
}

test("build dryRun=true does not write files and returns a populated plan", async (t) => {
  const dir = await tempDir(t);
  const outDir = path.join(dir, "out");

  const result = await build({ manifestPath: SMOKE, outDir, dryRun: true });

  assert.equal(result.written.length, 0);
  assert.ok(result.plan.files.length > 0);
  assert.equal(await exists(outDir), false);
});

test("build dryRun=false writes files and returns written paths", async (t) => {
  const dir = await tempDir(t);
  const outDir = path.join(dir, "out");

  const result = await build({ manifestPath: SMOKE, outDir, dryRun: false });

  assert.equal(result.written.length, result.plan.files.length);
  assert.ok(result.written.length > 0);
  for (const filePath of result.written) {
    assert.equal(await exists(filePath), true);
  }
});

test("build routes typescript manifests to the TypeScript generator", async (t) => {
  const dir = await tempDir(t);

  const result = await build({ manifestPath: SMOKE, outDir: path.join(dir, "out"), dryRun: true });

  assert.equal(result.plan.language, "typescript");
  assert.ok(result.plan.files.some((file) => file.relPath === "src/index.ts"));
});

test("build routes python manifests to the Python generator", async (t) => {
  const manifestPath = await manifestForLanguage(t, "python");
  const dir = await tempDir(t);

  const result = await build({ manifestPath, outDir: path.join(dir, "out"), dryRun: true });

  assert.equal(result.plan.language, "python");
  assert.ok(result.plan.files.some((file) => file.relPath === "pyproject.toml"));
});

test("build routes go manifests to the Go generator", async (t) => {
  const manifestPath = await manifestForLanguage(t, "go");
  const dir = await tempDir(t);

  const result = await build({ manifestPath, outDir: path.join(dir, "out"), dryRun: true });

  assert.equal(result.plan.language, "go");
  assert.ok(result.plan.files.some((file) => file.relPath === "go.mod"));
});

test("build throws AmpBuildError if outDir is not writable", { skip: process.platform === "win32" ? "chmod write permissions are unreliable on Windows" : false }, async (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("root can write to read-only directories");
    return;
  }
  const dir = await tempDir(t);
  const outDir = path.join(dir, "readonly");
  await fs.mkdir(outDir);
  await fs.chmod(outDir, 0o555);
  t.after(async () => {
    await fs.chmod(outDir, 0o755).catch(() => {});
  });

  await assert.rejects(
    () => build({ manifestPath: SMOKE, outDir, dryRun: false }),
    AmpBuildError,
  );
});
