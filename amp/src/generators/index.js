/*---------------------------------------------------------------------------------------------
 *  AMP generator registry.
 *  Each generator exports `generate(plan)`; this barrel makes them switchable
 *  via plan.language.
 *--------------------------------------------------------------------------------------------*/

"use strict";

const generators = Object.freeze({
  get typescript() { return require("./typescript"); },
  get python() { return require("./python"); },
  get go() { return require("./go"); },
});

module.exports = { generators };
