"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadManifest } = require("../src/manifest");
const { validateManifest, AmpValidationError } = require("../src/validator");

const FIXTURES = path.join(__dirname, "fixtures");

function fixture(name) {
  return path.join(FIXTURES, name);
}

function readFixture(name) {
  return loadManifest(fixture(name)).manifest;
}

function assertValidationFailure(name, pattern) {
  let err;
  try {
    validateManifest(readFixture(name));
  } catch (caught) {
    err = caught;
  }
  assert.ok(err instanceof AmpValidationError, "expected AmpValidationError");
  assert.match(`${err.message}\n${(err.errors || []).join("\n")}`, pattern);
}

test("validateManifest accepts the smoke fixture", () => {
  const result = validateManifest(readFixture("smoke.swe.amp.yaml"));

  assert.deepEqual(result.errors || [], []);
  assert.deepEqual(result.warnings, []);
});

test("validateManifest accepts valid-full.yaml", () => {
  const result = validateManifest(readFixture("valid-full.yaml"));

  assert.deepEqual(result.errors || [], []);
  assert.deepEqual(result.warnings, []);
});

test("validateManifest rejects invalid-missing-version.yaml", () => {
  assertValidationFailure("invalid-missing-version.yaml", /ampVersion/);
});

test("validateManifest rejects invalid-bad-language.yaml", () => {
  assertValidationFailure("invalid-bad-language.yaml", /agent\/language|allowed values/);
});

test("validateManifest rejects invalid-tool-no-name.yaml", () => {
  assertValidationFailure("invalid-tool-no-name.yaml", /name/);
});

test("validateManifest rejects invalid-mcp-bad-transport.yaml", () => {
  assertValidationFailure("invalid-mcp-bad-transport.yaml", /mcpServers\/0\/type|allowed values/);
});

test("validateManifest reports allowList without rules as a warning", () => {
  const result = validateManifest(readFixture("invalid-permissions-allowlist-no-rules.yaml"));

  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /allowList.*autoApprove/);
});

test("validateManifest rejects invalid-customagent-duplicate.yaml", () => {
  assertValidationFailure("invalid-customagent-duplicate.yaml", /Duplicate custom agent name: helper-agent/);
});

test("validateManifest warns for unknown built-in tools in availableTools", () => {
  const manifest = {
    ampVersion: "1.0",
    agent: { name: "warning-agent", language: "typescript" },
    runtime: { copilotSdk: { transport: "stdio" } },
    extensions: { availableTools: ["view", "definitely_not_builtin"] },
  };

  const result = validateManifest(manifest);

  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /availableTools.*definitely_not_builtin/);
});
