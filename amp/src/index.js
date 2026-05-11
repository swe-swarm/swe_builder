/*---------------------------------------------------------------------------------------------
 *  swe_builder amp - public entry point.
 *  Surface kept small and stable so external tooling (CLI, dashboard, tests) can rely on it.
 *--------------------------------------------------------------------------------------------*/

"use strict";

const version = require("./version");
const { loadManifest, AmpManifestError } = require("./manifest");
const { validateManifest, AmpValidationError } = require("./validator");
const { normalizeManifest } = require("./normalizer");
const { createPlan, isSurfaceUsed, addFile, addLog, addExec } = require("./planner");
const { build, AmpBuildError } = require("./build");
const { generators } = require("./generators");
const { listExtensions, getExtension } = require("./extension-registry");

module.exports = {
  // Versions
  AMP_VERSION: version.AMP_VERSION,
  COPILOT_SDK_PROTOCOL_VERSION: version.COPILOT_SDK_PROTOCOL_VERSION,
  SDK_PINS: version.SDK_PINS,
  FRAMEWORK_VERSION: version.FRAMEWORK_VERSION,

  // Pipeline
  loadManifest,
  validateManifest,
  normalizeManifest,
  createPlan,
  build,

  // Helpers
  isSurfaceUsed,
  addFile,
  addLog,
  addExec,
  generators,
  listExtensions,
  getExtension,

  // Errors
  AmpManifestError,
  AmpValidationError,
  AmpBuildError,
};
