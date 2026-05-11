"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { listExtensions, getExtension } = require("../src/extension-registry");

test("listExtensions returns a non-empty array", () => {
  const entries = listExtensions();

  assert.ok(Array.isArray(entries));
  assert.ok(entries.length > 0);
});

test("every extension entry has string metadata", () => {
  for (const entry of listExtensions()) {
    assert.equal(typeof entry.id, "string");
    assert.equal(typeof entry.ampField, "string");
    assert.equal(typeof entry.sdkSurface, "string");
    assert.equal(typeof entry.description, "string");
  }
});

test("extension ids are unique", () => {
  const ids = listExtensions().map((entry) => entry.id);

  assert.equal(new Set(ids).size, ids.length);
});

test("getExtension returns matches and null for missing ids", () => {
  const [first] = listExtensions();

  assert.deepEqual(getExtension(first.id), first);
  assert.equal(getExtension("nope"), null);
});
