/*---------------------------------------------------------------------------------------------
 *  AMP build runner.
 *  Drives load -> validate -> normalize -> plan -> generate -> write.
 *--------------------------------------------------------------------------------------------*/

"use strict";

const fs = require("fs");
const path = require("path");
const { loadManifest } = require("./manifest");
const { validateManifest } = require("./validator");
const { normalizeManifest } = require("./normalizer");
const { createPlan } = require("./planner");
const { generators } = require("./generators");

class AmpBuildError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = "AmpBuildError";
    if (opts.cause) this.cause = opts.cause;
  }
}

/**
 * Build an agent project from a manifest path.
 * @param {object} opts
 * @param {string=} opts.manifestPath  Path to manifest file or directory.
 * @param {string=} opts.outDir        Target output directory (default: <manifestDir>/out/<agentName>).
 * @param {boolean=} opts.dryRun       If true, do not write files.
 * @param {(level: string, msg: string) => void=} opts.log
 * @returns {Promise<{plan: object, written: string[]}>}
 */
async function build(opts = {}) {
  const log = opts.log || (() => {});
  const { manifest: raw, manifestPath, manifestDir } = loadManifest(opts.manifestPath);
  log("info", `Loaded manifest: ${manifestPath}`);

  const { warnings } = validateManifest(raw);
  for (const w of warnings) log("warn", w);

  const manifest = normalizeManifest(raw);
  const language = manifest.agent.language;
  const generator = generators[language];
  if (!generator) {
    throw new AmpBuildError(`No generator registered for language '${language}'`);
  }

  const plan = createPlan({ manifest, manifestDir, outDir: opts.outDir });
  await generator.generate(plan);

  const written = [];
  if (!opts.dryRun) {
    try {
      fs.mkdirSync(plan.outDir, { recursive: true });
      for (const file of plan.files) {
        const full = path.join(plan.outDir, file.relPath);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, file.contents);
        if (file.mode != null) fs.chmodSync(full, file.mode);
        else if (file.executable) fs.chmodSync(full, 0o755);
        written.push(full);
      }
    } catch (cause) {
      throw new AmpBuildError(`Failed to write build output to ${plan.outDir}: ${cause.message}`, { cause });
    }
  }

  for (const action of plan.postActions) {
    if (action.kind === "log" && opts.dryRun !== true) log("info", action.message);
  }

  return { plan, written };
}

module.exports = { build, AmpBuildError };
