"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");

const { loadManifest, AmpManifestError } = require("../src/manifest");

const FIXTURES = path.join(__dirname, "fixtures");
const SMOKE = path.join(FIXTURES, "smoke.swe.amp.yaml");

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amp-manifest-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("loadManifest loads a YAML manifest by absolute path", () => {
  const loaded = loadManifest(SMOKE);

  assert.equal(loaded.manifestPath, SMOKE);
  assert.equal(loaded.manifestDir, FIXTURES);
  assert.equal(loaded.manifest.ampVersion, "1.0");
  assert.equal(loaded.manifest.agent.name, "smoke-agent");
});

test("loadManifest loads a YAML manifest by directory", async (t) => {
  const dir = await tempDir(t);
  await fs.copyFile(SMOKE, path.join(dir, "swe.amp.yaml"));

  const loaded = loadManifest(dir);

  assert.equal(loaded.manifestPath, path.join(dir, "swe.amp.yaml"));
  assert.equal(loaded.manifestDir, dir);
  assert.equal(loaded.manifest.agent.language, "typescript");
});

test("loadManifest loads a JSON manifest", async (t) => {
  const dir = await tempDir(t);
  const manifestPath = path.join(dir, "swe.amp.json");
  const manifest = {
    ampVersion: "1.0",
    agent: { name: "json-agent", language: "typescript" },
    runtime: { copilotSdk: { transport: "stdio" } },
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const loaded = loadManifest(manifestPath);

  assert.deepEqual(loaded.manifest, manifest);
  assert.equal(loaded.manifestPath, manifestPath);
});

test("loadManifest throws AmpManifestError if file missing", () => {
  assert.throws(
    () => loadManifest(path.join(FIXTURES, "missing.swe.amp.yaml")),
    AmpManifestError,
  );
});

test("loadManifest throws AmpManifestError if YAML is malformed", async (t) => {
  const dir = await tempDir(t);
  const manifestPath = path.join(dir, "bad.yaml");
  await fs.writeFile(manifestPath, "ampVersion: \"1.0\"\nagent: [\n", "utf8");

  assert.throws(() => loadManifest(manifestPath), AmpManifestError);
});
