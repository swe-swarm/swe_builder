/*---------------------------------------------------------------------------------------------
 *  AMP manifest loader.
 *  Reads YAML or JSON from disk, returns raw object plus the resolved manifest dir
 *  so downstream stages can resolve relative paths (handlers, prompts, etc.).
 *--------------------------------------------------------------------------------------------*/

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const SUPPORTED_EXTS = [".yaml", ".yml", ".json"];
const DEFAULT_NAMES = [
  "swe.amp.yaml",
  "swe.amp.yml",
  "swe.amp.json",
  "amp.yaml",
  "amp.yml",
  "amp.json",
];

class AmpManifestError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = "AmpManifestError";
    if (opts.cause) this.cause = opts.cause;
    if (opts.path) this.path = opts.path;
  }
}

function findManifestInDir(dir) {
  for (const name of DEFAULT_NAMES) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function resolveManifestPath(input) {
  if (!input) {
    const here = findManifestInDir(process.cwd());
    if (here) return here;
    throw new AmpManifestError(
      "No AMP manifest found in current directory. Expected one of: " + DEFAULT_NAMES.join(", "),
    );
  }

  const stat = (() => {
    try {
      return fs.statSync(input);
    } catch (cause) {
      throw new AmpManifestError(`Manifest path not found: ${input}`, { cause, path: input });
    }
  })();

  if (stat.isDirectory()) {
    const found = findManifestInDir(input);
    if (!found) {
      throw new AmpManifestError(
        `No AMP manifest found in directory ${input}. Expected one of: ${DEFAULT_NAMES.join(", ")}`,
      );
    }
    return found;
  }

  return input;
}

function parseManifestText(text, sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!SUPPORTED_EXTS.includes(ext)) {
    throw new AmpManifestError(
      `Unsupported manifest extension '${ext}'. Use one of: ${SUPPORTED_EXTS.join(", ")}`,
      { path: sourcePath },
    );
  }
  try {
    if (ext === ".json") return JSON.parse(text);
    return yaml.load(text, { filename: sourcePath });
  } catch (cause) {
    throw new AmpManifestError(`Failed to parse manifest: ${cause.message}`, { cause, path: sourcePath });
  }
}

/**
 * Load and parse a manifest. Returns { manifest, manifestPath, manifestDir }.
 * The manifest is the raw parsed object; validation and normalization happen later.
 */
function loadManifest(input) {
  const manifestPath = resolveManifestPath(input);
  const text = fs.readFileSync(manifestPath, "utf8");
  const manifest = parseManifestText(text, manifestPath);
  if (manifest == null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new AmpManifestError("Manifest root must be an object", { path: manifestPath });
  }
  return {
    manifest,
    manifestPath,
    manifestDir: path.dirname(manifestPath),
  };
}

module.exports = {
  loadManifest,
  parseManifestText,
  resolveManifestPath,
  AmpManifestError,
  DEFAULT_NAMES,
  SUPPORTED_EXTS,
};
