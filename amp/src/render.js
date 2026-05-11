/*---------------------------------------------------------------------------------------------
 *  AMP minimal template renderer.
 *  Supports {{ var }}, {{#if cond}}...{{/if}}, {{#each items}}...{{/each}} on plain JS values.
 *  Intentionally tiny; generators that need richer logic should compose JS instead.
 *--------------------------------------------------------------------------------------------*/

"use strict";

function lookup(ctx, expr) {
  if (expr === "this" || expr === ".") return ctx;
  const parts = expr.split(".");
  let value = ctx;
  for (const part of parts) {
    if (value == null) return undefined;
    value = value[part];
  }
  return value;
}

function escape(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function renderString(template, ctx) {
  let out = template;
  out = renderEach(out, ctx);
  out = renderIf(out, ctx);
  out = out.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_, key) => {
    return escape(lookup(ctx, key));
  });
  return out;
}

function renderEach(template, ctx) {
  const re = /\{\{#each\s+([^{}\s]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g;
  return template.replace(re, (_, key, body) => {
    const list = lookup(ctx, key);
    if (!Array.isArray(list)) return "";
    return list
      .map((item, idx) => {
        const childCtx = Object.assign({}, ctx, item, { __index: idx, __isLast: idx === list.length - 1 });
        return renderString(body, childCtx);
      })
      .join("");
  });
}

function renderIf(template, ctx) {
  const re = /\{\{#if\s+([^{}\s]+)\s*\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;
  return template.replace(re, (_, key, ifBody, elseBody) => {
    const value = lookup(ctx, key);
    const truthy = Array.isArray(value) ? value.length > 0 : !!value;
    return renderString(truthy ? ifBody : (elseBody || ""), ctx);
  });
}

module.exports = { renderString };
