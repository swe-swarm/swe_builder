"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadManifest } = require("../src/manifest");
const { normalizeManifest } = require("../src/normalizer");

const FULL = path.join(__dirname, "fixtures", "valid-full.yaml");

function baseManifest() {
  return {
    ampVersion: "1.0",
    agent: { name: "normalizer-agent", language: "typescript" },
    runtime: { copilotSdk: {} },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("normalizeManifest adds default runtime.copilotSdk.transport=stdio", () => {
  const normalized = normalizeManifest(baseManifest());

  assert.equal(normalized.runtime.copilotSdk.transport, "stdio");
});

test("normalizeManifest adds default permissions.mode=approveAll when absent", () => {
  const normalized = normalizeManifest(baseManifest());

  assert.equal(normalized.extensions.permissions.mode, "approveAll");
});

test("normalizeManifest preserves explicitly set fields", () => {
  const raw = baseManifest();
  raw.runtime.copilotSdk = {
    transport: "external",
    cliUrl: "https://example.test/copilot",
    logLevel: "debug",
    useLoggedInUser: false,
  };
  raw.runtime.streaming = false;
  raw.extensions = { permissions: { mode: "denyAll" } };

  const normalized = normalizeManifest(raw);

  assert.equal(normalized.runtime.copilotSdk.transport, "external");
  assert.equal(normalized.runtime.copilotSdk.cliUrl, "https://example.test/copilot");
  assert.equal(normalized.runtime.copilotSdk.logLevel, "debug");
  assert.equal(normalized.runtime.copilotSdk.useLoggedInUser, false);
  assert.equal(normalized.runtime.streaming, false);
  assert.equal(normalized.extensions.permissions.mode, "denyAll");
});

test("normalizeManifest is idempotent", () => {
  const raw = loadManifest(FULL).manifest;
  const once = normalizeManifest(raw);
  const twice = normalizeManifest(once);

  assert.deepEqual(twice, once);
});

test("normalizeManifest does not mutate the input object", () => {
  const raw = loadManifest(FULL).manifest;
  const before = clone(raw);

  normalizeManifest(raw);

  assert.deepEqual(raw, before);
});
