"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");

const { build } = require("../src/build");
const { AMP_VERSION, COPILOT_SDK_PROTOCOL_VERSION, SDK_PINS } = require("../src/version");

const FIXTURES = path.join(__dirname, "fixtures");
const SMOKE = path.join(FIXTURES, "smoke.swe.amp.yaml");

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "amp-ts-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
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

function normalizeGeneratedFile(file) {
  if (file.relPath !== "swe.amp.lock.json") return file.contents;
  const lock = JSON.parse(file.contents);
  if (lock.generatedAt) lock.generatedAt = "<generated>";
  return JSON.stringify(lock, null, 2);
}

test("TypeScript generator emits the expected smoke project files", async (t) => {
  const outDir = path.join(await tempDir(t), "out");

  await build({ manifestPath: SMOKE, outDir, dryRun: false });

  for (const relPath of [
    "package.json",
    "tsconfig.json",
    path.join("src", "index.ts"),
    path.join("src", "tools", "lookup_issue.ts"),
    "swe.amp.lock.json",
    "README.md",
    ".gitignore",
  ]) {
    assert.equal(await exists(path.join(outDir, relPath)), true, `${relPath} should exist`);
  }
});

test("TypeScript package.json contains the SDK pins", async (t) => {
  const outDir = path.join(await tempDir(t), "out");

  await build({ manifestPath: SMOKE, outDir, dryRun: false });
  const pkg = JSON.parse(await readText(path.join(outDir, "package.json")));

  assert.equal(pkg.dependencies["@github/copilot-sdk"], SDK_PINS.typescript["@github/copilot-sdk"]);
  assert.equal(pkg.dependencies["@github/copilot"], SDK_PINS.typescript["@github/copilot"]);
});

test("TypeScript src/index.ts wires CopilotClient, tools, permissions, and broadcast", async (t) => {
  const outDir = path.join(await tempDir(t), "out");

  await build({ manifestPath: SMOKE, outDir, dryRun: false });
  const indexTs = await readText(path.join(outDir, "src", "index.ts"));

  assert.match(indexTs, /import \{ CopilotClient, approveAll \} from "@github\/copilot-sdk";/);
  assert.match(indexTs, /import \{ tool_lookup_issue \} from "\.\/tools\/lookup_issue\.js";/);
  assert.match(indexTs, /tools: \[tool_lookup_issue\]/);
  assert.match(indexTs, /onPermissionRequest: approveAll/);
  assert.match(indexTs, /function broadcast\(/);
  assert.match(indexTs, /function broadcastToAll\(/);
});

test("TypeScript swe.amp.lock.json has the AMP and SDK protocol versions", async (t) => {
  const outDir = path.join(await tempDir(t), "out");

  await build({ manifestPath: SMOKE, outDir, dryRun: false });
  const lock = JSON.parse(await readText(path.join(outDir, "swe.amp.lock.json")));

  assert.equal(lock.ampVersion, AMP_VERSION);
  assert.equal(lock.sdkProtocolVersion, COPILOT_SDK_PROTOCOL_VERSION);
});

test("TypeScript generator produces deterministic bytes apart from lockfile timestamp", async (t) => {
  const outDir = path.join(await tempDir(t), "out");

  const first = await build({ manifestPath: SMOKE, outDir, dryRun: true });
  const second = await build({ manifestPath: SMOKE, outDir, dryRun: true });
  const firstFiles = new Map(first.plan.files.map((file) => [file.relPath, normalizeGeneratedFile(file)]));
  const secondFiles = new Map(second.plan.files.map((file) => [file.relPath, normalizeGeneratedFile(file)]));

  assert.deepEqual(secondFiles, firstFiles);
});
