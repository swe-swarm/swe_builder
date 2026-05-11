/*---------------------------------------------------------------------------------------------
 *  Adaptive Manifest Protocol (AMP) - version constants
 *  Authoritative version + protocol pinning for swe_builder amp framework.
 *--------------------------------------------------------------------------------------------*/

"use strict";

const path = require("path");
const fs = require("fs");

const AMP_VERSION = "1.0";

/**
 * SDK protocol version that generated agents must speak. Mirrors
 * copilot-sdk/sdk-protocol-version.json.
 */
const COPILOT_SDK_PROTOCOL_VERSION = 3;

/**
 * Per-language SDK package pins. These define what gets emitted into
 * generated package.json / pyproject.toml / go.mod so that an agent
 * boots cleanly against a known-good copilot-sdk + CLI combination.
 *
 * Keep these in sync with the upstream copilot-sdk releases.
 */
const SDK_PINS = Object.freeze({
  typescript: Object.freeze({
    "@github/copilot-sdk": "^0.5.0",
    "@github/copilot": "^1.0.36-0",
  }),
  python: Object.freeze({
    "github-copilot-sdk": ">=0.5.0,<0.6.0",
  }),
  go: Object.freeze({
    "github.com/github/copilot-sdk/go": "v0.5.0",
  }),
});

const FRAMEWORK_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

module.exports = {
  AMP_VERSION,
  COPILOT_SDK_PROTOCOL_VERSION,
  SDK_PINS,
  FRAMEWORK_VERSION,
};
