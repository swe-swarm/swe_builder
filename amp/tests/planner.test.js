"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadManifest } = require("../src/manifest");
const { normalizeManifest } = require("../src/normalizer");
const { createPlan, isSurfaceUsed, addFile, addLog, addExec } = require("../src/planner");
const { listExtensions } = require("../src/extension-registry");

const FIXTURES = path.join(__dirname, "fixtures");

function toolsOnlyManifest() {
  return normalizeManifest({
    ampVersion: "1.0",
    agent: { name: "tools-only", language: "typescript" },
    runtime: { copilotSdk: { transport: "stdio" }, streaming: false },
    extensions: {
      tools: [
        {
          name: "one_tool",
          description: "One tool",
          stub: { kind: "static", value: "ok" },
        },
      ],
      permissions: { mode: "approveAll" },
    },
  });
}

test("createPlan records expected surfaces for a tools-only manifest", () => {
  const manifest = toolsOnlyManifest();
  const plan = createPlan({ manifest, manifestDir: FIXTURES, outDir: path.join(FIXTURES, "out") });

  assert.deepEqual(plan.surfaces.map((surface) => surface.id), ["tools", "permissions"]);
});

test("createPlan covers every registered extension set by the full manifest", () => {
  const manifest = normalizeManifest(loadManifest(path.join(FIXTURES, "valid-full.yaml")).manifest);
  const plan = createPlan({ manifest, manifestDir: FIXTURES, outDir: path.join(FIXTURES, "out") });

  assert.deepEqual(
    plan.surfaces.map((surface) => surface.id),
    listExtensions().map((surface) => surface.id),
  );
});

test("isSurfaceUsed returns false for surfaces not present", () => {
  const manifest = normalizeManifest({
    ampVersion: "1.0",
    agent: { name: "empty-agent", language: "typescript" },
    runtime: { copilotSdk: { transport: "stdio" }, streaming: false },
    extensions: { permissions: { mode: "approveAll" } },
  });

  assert.equal(isSurfaceUsed(manifest, "tools"), false);
  assert.equal(isSurfaceUsed(manifest, "mcpServers"), false);
  assert.equal(isSurfaceUsed(manifest, "communication"), false);
  assert.equal(isSurfaceUsed(manifest, "ui.elicitation"), false);
  assert.equal(isSurfaceUsed(manifest, "streaming"), false);
});

test("addFile, addLog, and addExec mutate the plan", () => {
  const manifest = toolsOnlyManifest();
  const plan = createPlan({ manifest, manifestDir: FIXTURES, outDir: path.join(FIXTURES, "out") });

  addFile(plan, "file.txt", "contents", { executable: true });
  addLog(plan, "logged");
  addExec(plan, "npm", ["test"]);

  assert.deepEqual(plan.files, [
    { relPath: "file.txt", contents: "contents", executable: true, mode: undefined },
  ]);
  assert.deepEqual(plan.postActions, [
    { kind: "log", message: "logged" },
    { kind: "exec", command: "npm", args: ["test"] },
  ]);
});
