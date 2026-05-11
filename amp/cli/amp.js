#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 * swe_builder amp CLI.
 * Plain Node.js/CommonJS command surface for the AMP framework.
 *--------------------------------------------------------------------------------------------*/

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const amp = require("../src");

const {
  AMP_VERSION,
  COPILOT_SDK_PROTOCOL_VERSION,
  SDK_PINS,
  FRAMEWORK_VERSION,
  loadManifest,
  validateManifest,
  normalizeManifest,
  createPlan,
  build,
  listExtensions,
  AmpManifestError,
  AmpValidationError,
  AmpBuildError,
} = amp;

const YAML_DUMP_OPTIONS = { sortKeys: false, lineWidth: 100, noRefs: true };
const USE_COLOR = !!process.stdout.isTTY && !process.env.NO_COLOR;
const COLORS = {
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

function color(name, text) {
  return USE_COLOR ? `${COLORS[name]}${text}${COLORS.reset}` : text;
}

function logError(message) {
  console.error(color("red", message));
}

function logWarning(message) {
  console.error(color("yellow", message));
}

function prefixedLog(level, message) {
  const prefix = color("cyan", "[swe-amp] ");
  if (level === "warn") logWarning(`${prefix}warning: ${message}`);
  else if (level === "error") logError(`${prefix}${message}`);
  else console.log(`${prefix}${message}`);
}

function versionText() {
  return `swe_builder amp v${FRAMEWORK_VERSION} (AMP ${AMP_VERSION}, SDK protocol ${COPILOT_SDK_PROTOCOL_VERSION})`;
}

function camelCase(flagName) {
  return flagName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function setFlag(flags, key, value) {
  if (Object.prototype.hasOwnProperty.call(flags, key)) {
    flags[key] = Array.isArray(flags[key]) ? flags[key].concat(value) : [flags[key], value];
  } else {
    flags[key] = value;
  }
  const camel = camelCase(key);
  if (camel !== key) flags[camel] = flags[key];
}

function parseArgs(argv, valueFlags = new Set()) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token === "-h") {
      setFlag(flags, "help", true);
      continue;
    }
    if (token === "-v") {
      setFlag(flags, "version", true);
      continue;
    }
    if (token.startsWith("--")) {
      const raw = token.slice(2);
      const eq = raw.indexOf("=");
      let key = raw;
      let value;
      if (eq >= 0) {
        key = raw.slice(0, eq);
        value = raw.slice(eq + 1);
      } else if (valueFlags.has(key)) {
        if (i + 1 >= argv.length) throw new CliError(`Missing value for --${key}`);
        value = argv[i + 1];
        i += 1;
      } else {
        value = true;
      }
      setFlag(flags, key, value);
      continue;
    }
    positionals.push(token);
  }
  return { flags, positionals };
}

function flagValue(flags, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(flags, name)) return flags[name];
  }
  return undefined;
}

function flagString(flags, ...names) {
  const value = flagValue(flags, ...names);
  if (Array.isArray(value)) return String(value[value.length - 1]);
  if (value === true || value == null) return value;
  return String(value);
}

function hasFlag(flags, ...names) {
  return flagValue(flags, ...names) !== undefined;
}

function normalizeLanguage(input) {
  const value = (input || "typescript").toLowerCase();
  if (value === "ts" || value === "typescript") return "typescript";
  if (value === "py" || value === "python") return "python";
  if (value === "go") return "go";
  throw new CliError(`Unsupported language '${input}'. Use typescript|python|go (aliases: ts|py|go).`);
}

function displayNameFromSlug(slug) {
  return slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ensureObject(parent, key) {
  if (!parent[key] || typeof parent[key] !== "object" || Array.isArray(parent[key])) parent[key] = {};
  return parent[key];
}

function ensureArray(parent, key) {
  if (!Array.isArray(parent[key])) parent[key] = [];
  return parent[key];
}

function escapeMarkdownCell(value) {
  return String(value == null ? "" : value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function printMarkdownTable(rows, columns) {
  console.log(`| ${columns.map((c) => c.title).join(" | ")} |`);
  console.log(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    console.log(`| ${columns.map((c) => escapeMarkdownCell(row[c.key])).join(" | ")} |`);
  }
}

function printWarnings(warnings) {
  for (const warning of warnings || []) logWarning(`Warning: ${warning}`);
}

function printValidationError(err) {
  logError(err.message.split("\n")[0]);
  const details = Array.isArray(err.errors) && err.errors.length ? err.errors : err.message.split("\n").slice(1);
  for (const detail of details) {
    const cleaned = String(detail).replace(/^\s*-\s*/, "");
    if (cleaned) console.error(`  - ${cleaned}`);
  }
}

function manifestFailureCode(err) {
  if (err instanceof AmpValidationError || err instanceof AmpManifestError) return 2;
  return 1;
}

function makeMinimalManifest(name, language) {
  return {
    ampVersion: AMP_VERSION,
    agent: {
      name,
      displayName: displayNameFromSlug(name),
      version: "0.1.0",
      description: `A minimal AMP agent named ${name}.`,
      language,
    },
    runtime: {
      copilotSdk: {
        transport: "stdio",
        logLevel: "warning",
      },
      model: {
        name: "claude-sonnet-4.5",
      },
      streaming: true,
    },
    extensions: {
      tools: [
        {
          name: "hello",
          description: "Return a friendly greeting from this AMP agent.",
          paramsSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Optional name to greet." },
            },
          },
          stub: {
            kind: "static",
            value: `Hello from ${name}!`,
          },
        },
      ],
      permissions: {
        mode: "approveAll",
      },
    },
  };
}

function makeFullManifest(name, language) {
  return {
    ampVersion: AMP_VERSION,
    agent: {
      name,
      displayName: displayNameFromSlug(name),
      version: "0.1.0",
      description: `A full AMP reference agent named ${name}.`,
      author: "Your Team",
      license: "MIT",
      language,
      tags: ["amp", "reference", language],
    },
    runtime: {
      copilotSdk: {
        transport: "stdio",
        logLevel: "info",
        useLoggedInUser: true,
      },
      model: {
        name: "claude-sonnet-4.5",
        reasoningEffort: "medium",
      },
      workingDirectory: ".",
      streaming: true,
      includeSubAgentStreamingEvents: true,
      infiniteSessions: true,
      ui: {
        elicitation: true,
      },
    },
    extensions: {
      tools: [
        {
          name: "lookup_context",
          description: "Look up project context for the active task.",
          paramsSchema: {
            type: "object",
            required: ["query"],
            properties: {
              query: { type: "string" },
            },
          },
          handler: "src/tools/lookup-context.js",
          skipPermission: true,
        },
        {
          name: "memo",
          description: "Return a static memo used by generated smoke tests.",
          paramsSchema: {
            type: "object",
            properties: {},
          },
          stub: {
            kind: "static",
            value: "memo-OK",
          },
        },
      ],
      availableTools: ["view", "grep", "glob", "powershell"],
      excludedTools: ["edit"],
      mcpServers: [
        {
          name: "local_docs",
          type: "stdio",
          command: "node",
          args: ["./mcp/local-docs.js"],
          env: {
            LOG_LEVEL: "info",
          },
          tools: ["search_docs"],
        },
        {
          name: "remote_search",
          type: "http",
          url: "https://example.com/mcp",
          headers: {
            "X-Agent": name,
          },
        },
      ],
      customAgents: [
        {
          name: "reviewer",
          description: "Reviews planned changes before implementation.",
          systemPrompt: "prompts/reviewer.md",
          model: "claude-sonnet-4.5",
          reasoningEffort: "low",
          tools: ["lookup_context", "grep"],
          excludedTools: ["edit"],
          mcpServers: ["local_docs"],
        },
      ],
      defaultAgent: {
        name: "default",
        tools: ["lookup_context", "view"],
        excludedTools: ["edit"],
      },
      agent: "reviewer",
      hooks: {
        preToolUse: "src/hooks/pre-tool-use.js",
        postToolUse: "src/hooks/post-tool-use.js",
        userPromptSubmitted: "src/hooks/user-prompt-submitted.js",
        sessionStart: "src/hooks/session-start.js",
        sessionEnd: "src/hooks/session-end.js",
        errorOccurred: "src/hooks/error-occurred.js",
      },
      permissions: {
        mode: "allowList",
        autoApprove: [
          { tool: "lookup_context" },
          { tool: "view" },
        ],
      },
      skills: {
        directories: ["skills"],
        disabled: ["legacy-skill"],
        inline: [
          {
            name: "triage",
            description: "Triage issues and route them to the right owner.",
            instructions: "skills/triage.md",
          },
        ],
      },
      systemMessage: {
        mode: "customize",
        sections: {
          identity: {
            append: `You are ${displayNameFromSlug(name)}, generated from an AMP manifest.`,
          },
          rules: {
            prepend: "Prefer precise, test-backed changes.",
          },
        },
      },
      sessionFs: {
        provider: "memory",
      },
      lifecycle: {
        handler: "src/lifecycle.js",
      },
      userInput: {
        handler: "src/user-input.js",
      },
      commands: [
        {
          name: "summarize",
          description: "Summarize the current session for handoff.",
          argsHint: "<topic>",
          handler: "src/commands/summarize.js",
        },
      ],
    },
    communication: {
      standard: "amp-acs-1.0",
      id: name,
      broadcast: {
        transport: "stdout-jsonl",
        channels: [name, "amp"],
      },
      inbox: {
        enabled: true,
        path: ".amp/inbox.jsonl",
      },
      handoff: [
        {
          name: "human-review",
          description: "Escalate implementation decisions for manual review.",
          transport: "inbox",
          endpoint: ".amp/human-review.jsonl",
        },
      ],
    },
    build: {
      outputDir: "./dist",
      bundler: language === "typescript" ? "tsx" : "none",
      packageManager: language === "python" ? "uv" : language === "go" ? "go" : "npm",
    },
    deployment: {
      target: "standalone",
      scripts: {
        start: language === "python" ? "uv run python -m agent" : language === "go" ? "go run ." : "npm start",
      },
      env: {
        GITHUB_TOKEN: "",
      },
    },
  };
}

async function handleInit(argv) {
  const valueFlags = new Set(["language", "dir"]);
  const { flags, positionals } = parseArgs(argv, valueFlags);
  const name = positionals[0];
  if (!name) throw new CliError("Usage: swe_builder amp init <name> [--language ts|py|go] [--dir <path>] [--minimal | --full]");
  if (hasFlag(flags, "minimal") && hasFlag(flags, "full")) throw new CliError("Choose either --minimal or --full, not both.");

  const language = normalizeLanguage(flagString(flags, "language"));
  const baseDir = path.resolve(flagString(flags, "dir") || process.cwd());
  const targetDir = path.join(baseDir, name);
  const force = hasFlag(flags, "force");
  const full = hasFlag(flags, "full");

  if (fs.existsSync(targetDir) && !force) {
    throw new CliError(`Refusing to overwrite existing directory: ${targetDir}. Re-run with --force to overwrite swe.amp.yaml.`);
  }
  if (fs.existsSync(targetDir) && !fs.statSync(targetDir).isDirectory()) {
    throw new CliError(`Target exists and is not a directory: ${targetDir}`);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const manifest = full ? makeFullManifest(name, language) : makeMinimalManifest(name, language);
  validateManifest(manifest);
  const manifestPath = path.join(targetDir, "swe.amp.yaml");
  fs.writeFileSync(manifestPath, yaml.dump(manifest, YAML_DUMP_OPTIONS), "utf8");

  console.log(color("green", `Created AMP project: ${targetDir}`));
  console.log(`Manifest: ${manifestPath}`);
  console.log("\nNext steps:");
  const cdTarget = path.relative(process.cwd(), targetDir) || ".";
  console.log(`  cd ${cdTarget}`);
  console.log("  swe_builder amp validate");
  console.log("  swe_builder amp build");
  return 0;
}

async function handleValidate(argv) {
  const { positionals } = parseArgs(argv);
  const manifestArg = positionals[0];
  try {
    const { manifest, manifestPath } = loadManifest(manifestArg);
    const { warnings } = validateManifest(manifest);
    console.log(color("green", `Valid AMP manifest: ${manifestPath}`));
    printWarnings(warnings);
    return 0;
  } catch (err) {
    if (err instanceof AmpValidationError) printValidationError(err);
    else if (err instanceof AmpManifestError) logError(err.message);
    else throw err;
    return 2;
  }
}

function summarizePlan(result) {
  const { plan, written } = result;
  const surfaces = plan.surfaces.map((surface) => surface.id);
  console.log("\nPlan summary:");
  console.log(`  Output directory: ${plan.outDir}`);
  console.log(`  Files: ${plan.files.length}`);
  console.log(`  Surfaces wired: ${surfaces.length ? surfaces.join(", ") : "none"}`);
  console.log(`  Post-actions: ${plan.postActions.length}`);
  if (plan.postActions.length) {
    for (const action of plan.postActions) {
      if (action.kind === "log") console.log(`    - log: ${action.message}`);
      else if (action.kind === "exec") console.log(`    - exec: ${action.command} ${(action.args || []).join(" ")}`.trim());
      else console.log(`    - ${action.kind}`);
    }
  }
  if (written && written.length) console.log(`  Written: ${written.length}`);
}

function summarizePreGenerationPlan(manifestArg, outDir) {
  const { manifest: raw, manifestDir } = loadManifest(manifestArg);
  validateManifest(raw);
  const manifest = normalizeManifest(raw);
  const plan = createPlan({ manifest, manifestDir, outDir });
  console.log("\nPre-generation plan summary:");
  console.log("  Files: 0 (generator did not run)");
  const surfaces = plan.surfaces.map((surface) => surface.id);
  console.log(`  Output directory: ${plan.outDir}`);
  console.log(`  Surfaces wired: ${surfaces.length ? surfaces.join(", ") : "none"}`);
  console.log("  Post-actions: 0");
}

function detectGeneratorLanguage(err, fallbackLanguage) {
  const message = err && err.message ? err.message : "";
  const direct = message.match(/^([a-z]+) generator not yet implemented/i);
  if (direct) return normalizeLanguage(direct[1]);
  const registered = message.match(/No generator registered for language '([^']+)'/i);
  if (registered) return registered[1];
  return fallbackLanguage || null;
}

async function handleBuild(argv) {
  const valueFlags = new Set(["out"]);
  const { flags, positionals } = parseArgs(argv, valueFlags);
  const manifestArg = positionals[0];
  const dryRun = hasFlag(flags, "dry-run", "dryRun");
  let outDir = flagString(flags, "out");
  let language = null;

  try {
    const { manifest } = loadManifest(manifestArg);
    language = manifest && manifest.agent && manifest.agent.language;
    if (!outDir && manifest && manifest.agent && manifest.agent.name) {
      outDir = path.resolve(process.cwd(), "out", manifest.agent.name);
    }
  } catch (err) {
    if (err instanceof AmpManifestError) {
      logError(err.message);
      return 2;
    }
    throw err;
  }

  if (outDir) outDir = path.resolve(outDir);

  try {
    prefixedLog("info", `${dryRun ? "Planning" : "Building"} AMP project${outDir ? ` into ${outDir}` : ""}`);
    const result = await build({ manifestPath: manifestArg, outDir, dryRun, log: prefixedLog });
    if (dryRun) {
      prefixedLog("info", "Dry run complete; no files written.");
      summarizePlan(result);
    } else {
      prefixedLog("info", `Build complete. Wrote ${result.written.length} file(s) to ${result.plan.outDir}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof AmpValidationError) {
      printValidationError(err);
      return 2;
    }
    const generatorLanguage = detectGeneratorLanguage(err, language);
    if (generatorLanguage && /generator (not yet implemented|registered)/i.test(err.message || "")) {
      logError(`Generator for ${generatorLanguage} not implemented yet.`);
      logError("The AMP manifest validated, but this language generator is still a stub.");
      if (dryRun) {
        try {
          summarizePreGenerationPlan(manifestArg, outDir);
        } catch {
          // Best-effort only: the original generator error is the actionable failure.
        }
      }
      return 1;
    }
    if (err instanceof AmpBuildError) {
      logError(`Build failed: ${err.message}`);
      return 1;
    }
    logError(`Build failed: ${err.message || err}`);
    return 1;
  }
}

function parseList(value) {
  if (value == null || value === true) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry) => String(entry).split(",").map((part) => part.trim()).filter(Boolean));
}

function loadManifestForMutation(input) {
  const loaded = loadManifest(input);
  return loaded;
}

function addTool(manifest, name, flags) {
  const ext = ensureObject(manifest, "extensions");
  const tools = ensureArray(ext, "tools");
  const description = flagString(flags, "description") || `TODO: describe ${name}`;
  const handler = flagString(flags, "handler");
  const stubFlag = flagString(flags, "stub");
  if (handler && stubFlag) throw new CliError("Use either --handler or --stub for a tool, not both.");
  const tool = {
    name,
    description,
    paramsSchema: {
      type: "object",
      properties: {},
    },
  };
  if (handler) tool.handler = handler;
  else {
    const stubKind = stubFlag === true || !stubFlag ? "static" : stubFlag;
    tool.stub = { kind: stubKind, value: flagString(flags, "value") || `${name}-OK` };
  }
  tools.push(tool);
}

function addHook(manifest, name, flags) {
  const hookKind = flagString(flags, "kind");
  const handler = flagString(flags, "handler");
  const allowed = new Set(["preToolUse", "postToolUse", "userPromptSubmitted", "sessionStart", "sessionEnd", "errorOccurred"]);
  if (!hookKind || !allowed.has(hookKind)) throw new CliError(`Hook requires --kind ${Array.from(allowed).join("|")}.`);
  if (!handler) throw new CliError("Hook entries require --handler ./path.");
  const ext = ensureObject(manifest, "extensions");
  const hooks = ensureObject(ext, "hooks");
  hooks[hookKind] = handler;
  void name;
}

function addMcp(manifest, name, flags) {
  const type = flagString(flags, "type");
  if (!type || !["stdio", "http", "sse"].includes(type)) throw new CliError("MCP entries require --type stdio|http|sse.");
  const server = { name, type };
  if (type === "stdio") {
    const command = flagString(flags, "command");
    if (!command) throw new CliError("MCP stdio entries require --command <program>.");
    server.command = command;
    const args = parseList(flagValue(flags, "args"));
    if (args.length) server.args = args;
  } else {
    const url = flagString(flags, "url");
    if (!url) throw new CliError(`MCP ${type} entries require --url <url>.`);
    server.url = url;
  }
  const ext = ensureObject(manifest, "extensions");
  ensureArray(ext, "mcpServers").push(server);
}

function addAgent(manifest, name, flags) {
  const description = flagString(flags, "description") || `TODO: describe ${name}`;
  const systemPrompt = flagString(flags, "systemPrompt", "system-prompt");
  const agent = { name, description };
  if (systemPrompt) agent.systemPrompt = systemPrompt;
  const ext = ensureObject(manifest, "extensions");
  ensureArray(ext, "customAgents").push(agent);
}

function addSkill(manifest, name, flags) {
  const description = flagString(flags, "description") || `TODO: describe ${name}`;
  const instructions = flagString(flags, "instructions");
  if (!instructions) throw new CliError("Skill entries require --instructions <text-or-path>.");
  const ext = ensureObject(manifest, "extensions");
  const skills = ensureObject(ext, "skills");
  ensureArray(skills, "inline").push({ name, description, instructions });
}

function addSessionFs(manifest, name, flags) {
  const provider = flagString(flags, "provider");
  if (!provider || !["memory", "real", "custom"].includes(provider)) throw new CliError("sessionfs requires --provider memory|real|custom.");
  const sessionFs = { provider };
  const handler = flagString(flags, "handler");
  if (handler) sessionFs.handler = handler;
  const ext = ensureObject(manifest, "extensions");
  ext.sessionFs = sessionFs;
  void name;
}

async function handleAdd(argv) {
  const valueFlags = new Set([
    "manifest",
    "description",
    "stub",
    "handler",
    "kind",
    "type",
    "command",
    "url",
    "args",
    "systemPrompt",
    "system-prompt",
    "instructions",
    "provider",
    "value",
  ]);
  const { flags, positionals } = parseArgs(argv, valueFlags);
  const kind = positionals[0];
  const name = positionals[1];
  if (!kind || !name) throw new CliError("Usage: swe_builder amp add <kind> <name> [--manifest <path>] [opts]");

  const manifestInput = flagString(flags, "manifest");
  let loaded;
  try {
    loaded = loadManifestForMutation(manifestInput);
  } catch (err) {
    if (err instanceof AmpManifestError) throw new CliError(err.message, 2);
    throw err;
  }
  const { manifest, manifestPath } = loaded;

  switch (kind) {
    case "tool": addTool(manifest, name, flags); break;
    case "hook": addHook(manifest, name, flags); break;
    case "mcp": addMcp(manifest, name, flags); break;
    case "agent": addAgent(manifest, name, flags); break;
    case "skill": addSkill(manifest, name, flags); break;
    case "sessionfs": addSessionFs(manifest, name, flags); break;
    default:
      throw new CliError("Unsupported add kind. Use one of: tool, hook, mcp, agent, skill, sessionfs.");
  }

  let validation;
  try {
    validation = validateManifest(manifest);
  } catch (err) {
    if (err instanceof AmpValidationError) {
      printValidationError(err);
      return 2;
    }
    throw err;
  }

  const backupPath = `${manifestPath}.bak`;
  fs.copyFileSync(manifestPath, backupPath);
  fs.writeFileSync(manifestPath, yaml.dump(manifest, YAML_DUMP_OPTIONS), "utf8");
  console.log(color("green", `Updated ${manifestPath}`));
  console.log(`Backup: ${backupPath}`);
  printWarnings(validation.warnings);
  return 0;
}

async function handleListExtensions() {
  printMarkdownTable(listExtensions(), [
    { key: "id", title: "id" },
    { key: "ampField", title: "ampField" },
    { key: "sdkSurface", title: "sdkSurface" },
    { key: "description", title: "description" },
  ]);
  return 0;
}

function pathExistsForManifest(manifestDir, maybePath) {
  const full = path.isAbsolute(maybePath) ? maybePath : path.resolve(manifestDir, maybePath);
  return { full, exists: fs.existsSync(full) };
}

function looksLikePath(value) {
  if (typeof value !== "string") return false;
  if (!value || value.length > 260 || /\r|\n/.test(value)) return false;
  if (/^[a-z]+:\/\//i.test(value)) return false;
  return /[\\/]/.test(value) || /^\.?\.?[\\/]/.test(value) || /\.(md|txt|prompt|json|ya?ml|js|mjs|cjs|ts|py|go)$/i.test(value);
}

function collectManifestReferences(manifest) {
  const refs = [];
  const ext = manifest.extensions || {};
  for (const tool of ext.tools || []) {
    if (tool.handler) refs.push({ label: `tool ${tool.name} handler`, path: tool.handler, handler: true });
    else if (!tool.stub) refs.push({ label: `tool ${tool.name}`, todo: "has no handler or stub; generator will emit a TODO" });
    if (typeof tool.paramsSchema === "string") refs.push({ label: `tool ${tool.name} paramsSchema`, path: tool.paramsSchema });
  }
  if (ext.permissions && ext.permissions.handler) refs.push({ label: "permissions handler", path: ext.permissions.handler, handler: true });
  for (const [kind, hookPath] of Object.entries(ext.hooks || {})) refs.push({ label: `hook ${kind}`, path: hookPath, handler: true });
  for (const agent of ext.customAgents || []) {
    if (looksLikePath(agent.systemPrompt)) refs.push({ label: `custom agent ${agent.name} systemPrompt`, path: agent.systemPrompt });
  }
  for (const dir of (ext.skills && ext.skills.directories) || []) refs.push({ label: "skill directory", path: dir, directory: true });
  for (const skill of (ext.skills && ext.skills.inline) || []) {
    if (looksLikePath(skill.instructions)) refs.push({ label: `skill ${skill.name} instructions`, path: skill.instructions });
  }
  const systemMessage = ext.systemMessage;
  if (systemMessage) {
    if (looksLikePath(systemMessage.content)) refs.push({ label: "systemMessage content", path: systemMessage.content });
    for (const [section, value] of Object.entries(systemMessage.sections || {})) {
      if (typeof value === "string" && looksLikePath(value)) refs.push({ label: `systemMessage section ${section}`, path: value });
      if (value && typeof value === "object") {
        for (const [mode, modeValue] of Object.entries(value)) {
          if (looksLikePath(modeValue)) refs.push({ label: `systemMessage section ${section}.${mode}`, path: modeValue });
        }
      }
    }
  }
  if (ext.sessionFs && ext.sessionFs.handler) refs.push({ label: "sessionFs handler", path: ext.sessionFs.handler, handler: true });
  if (ext.lifecycle && ext.lifecycle.handler) refs.push({ label: "lifecycle handler", path: ext.lifecycle.handler, handler: true });
  if (ext.userInput && ext.userInput.handler) refs.push({ label: "userInput handler", path: ext.userInput.handler, handler: true });
  for (const command of ext.commands || []) {
    if (command.handler) refs.push({ label: `command ${command.name} handler`, path: command.handler, handler: true });
    else refs.push({ label: `command ${command.name}`, todo: "has no handler; generator will emit a TODO" });
  }
  return refs;
}

function containsTodo(fullPath) {
  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile() || stat.size > 1024 * 1024) return false;
    const text = fs.readFileSync(fullPath, "utf8");
    return /\bTODO\b|not yet implemented|throw new Error\(/i.test(text);
  } catch {
    return false;
  }
}

function printSdkPins() {
  console.log("SDK pins:");
  for (const [language, pins] of Object.entries(SDK_PINS)) {
    const rendered = Object.entries(pins).map(([name, version]) => `${name}@${version}`).join(", ");
    console.log(`  - ${language}: ${rendered}`);
  }
}

async function handleDoctor(argv) {
  const { positionals } = parseArgs(argv);
  const manifestArg = positionals[0];
  let errors = 0;
  let warnings = 0;

  console.log("AMP doctor");
  console.log(`Node.js: ${process.version}`);
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) {
    warnings += 1;
    logWarning("Warning: Node.js 18 or newer is recommended.");
  }
  console.log(`AMP_VERSION: ${AMP_VERSION}`);
  console.log(`COPILOT_SDK_PROTOCOL_VERSION: ${COPILOT_SDK_PROTOCOL_VERSION}`);
  printSdkPins();

  if (manifestArg) {
    console.log(`\nManifest diagnostics: ${manifestArg}`);
    try {
      const { manifest: raw, manifestPath, manifestDir } = loadManifest(manifestArg);
      const validation = validateManifest(raw);
      printWarnings(validation.warnings);
      warnings += validation.warnings.length;
      const manifest = normalizeManifest(raw);
      const plan = createPlan({ manifest, manifestDir, outDir: path.resolve(process.cwd(), "out", manifest.agent.name) });
      console.log(color("green", `Manifest valid: ${manifestPath}`));
      console.log(`Agent: ${manifest.agent.name} (${manifest.agent.language})`);
      console.log(`Wired surfaces: ${plan.surfaces.length ? plan.surfaces.map((surface) => surface.id).join(", ") : "none"}`);

      const refs = collectManifestReferences(manifest);
      if (refs.length) console.log("Referenced files:");
      for (const ref of refs) {
        if (ref.todo) {
          warnings += 1;
          logWarning(`Warning: ${ref.label} ${ref.todo}.`);
          continue;
        }
        const checked = pathExistsForManifest(manifestDir, ref.path);
        if (!checked.exists) {
          warnings += 1;
          logWarning(`Warning: Missing ${ref.label}: ${ref.path}`);
          continue;
        }
        const stat = fs.statSync(checked.full);
        if (ref.directory && !stat.isDirectory()) {
          warnings += 1;
          logWarning(`Warning: ${ref.label} is not a directory: ${ref.path}`);
          continue;
        }
        if (!ref.directory && !stat.isFile()) {
          warnings += 1;
          logWarning(`Warning: ${ref.label} is not a file: ${ref.path}`);
          continue;
        }
        console.log(`  ok ${ref.label}: ${ref.path}`);
        if (ref.handler && containsTodo(checked.full)) {
          warnings += 1;
          logWarning(`Warning: ${ref.label} contains TODO/not-yet-implemented code: ${ref.path}`);
        }
      }
    } catch (err) {
      errors += 1;
      if (err instanceof AmpValidationError) printValidationError(err);
      else if (err instanceof AmpManifestError) logError(err.message);
      else logError(err.message || String(err));
    }
  }

  console.log(`\nDoctor summary: ${errors} error(s), ${warnings} warning(s)`);
  return errors ? 1 : 0;
}

const HELP = {
  top: `Usage: swe_builder amp <command> [options]

Commands:
  init <name>                 Create a new AMP project skeleton
  validate [manifest]         Load and validate an AMP manifest
  build [manifest]            Build an agent project from a manifest
  add <kind> <name>           Append an extension entry to a manifest
  list-extensions             Show AMP fields mapped to copilot-sdk surfaces
  doctor [manifest]           Run environment and manifest diagnostics
  version                     Print version information
  help [command]              Show help

Global flags:
  -h, --help                  Show help
  --version                   Print version information

Run 'swe_builder amp help <command>' for command-specific usage.`,

  init: `Usage: swe_builder amp init <name> [--language typescript|python|go] [--dir <path>] [--minimal | --full] [--force]

Creates <path>/<name>/swe.amp.yaml (default path: current directory).

Options:
  --language, ts|py|go        Target language (default: typescript)
  --dir <path>                Parent directory (default: cwd)
  --minimal                   Emit one stub tool and approveAll permissions (default)
  --full                      Emit a manifest exercising every AMP surface
  --force                     Allow writing into an existing directory`,

  validate: `Usage: swe_builder amp validate [<manifest>]

Loads and validates a YAML/JSON AMP manifest. If no manifest is supplied, searches the current directory for swe.amp.yaml, swe.amp.yml, swe.amp.json, amp.yaml, amp.yml, or amp.json.

Exit codes:
  0 valid
  2 validation or manifest load failed`,

  build: `Usage: swe_builder amp build [<manifest>] [--out <dir>] [--dry-run]

Builds an agent project by calling the AMP build pipeline.

Options:
  --out <dir>                 Output directory (default: ./out/<agent-name>)
  --dry-run                   Validate and plan without writing files

Exit codes:
  0 success
  1 build error
  2 validation error`,

  add: `Usage: swe_builder amp add <kind> <name> [--manifest <path>] [opts]

Mutates an existing manifest, validates the result before writing, and writes a .bak backup next to the manifest.
The manifest is re-emitted with js-yaml.dump; comments are not preserved.

Kinds and options:
  tool <name>       --description "..." [--stub static] [--value "..."]
                    OR --description "..." --handler ./path
  hook <name>       --kind preToolUse|postToolUse|userPromptSubmitted|sessionStart|sessionEnd|errorOccurred --handler ./path
  mcp <name>        --type stdio --command <program> [--args a,b]
                    OR --type http|sse --url <url>
  agent <name>      --description "..." [--systemPrompt "..."]
  skill <name>      --description "..." --instructions "..."
  sessionfs <name>  --provider memory|real|custom [--handler ./path]`,

  "list-extensions": `Usage: swe_builder amp list-extensions

Prints a markdown table of AMP extension registry entries:
  id | ampField | sdkSurface | description`,

  doctor: `Usage: swe_builder amp doctor [<manifest>]

Reports Node.js version, AMP/framework protocol versions, SDK pins, and (when a manifest is provided) validation, wired surfaces, referenced file checks, and TODO/missing handler warnings.

Exit codes:
  0 no errors
  1 one or more errors`,

  version: `Usage: swe_builder amp version
       swe_builder amp --version

Prints: ${versionText()}`,
};

function printHelp(command) {
  const key = command || "top";
  console.log(HELP[key] || HELP.top);
}

async function main(argv) {
  if (!argv.length) {
    printHelp();
    return 0;
  }

  if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
    console.log(versionText());
    return 0;
  }

  if (argv[0] === "help") {
    printHelp(argv[1]);
    return 0;
  }

  const command = argv[0];
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp(command);
    return 0;
  }

  switch (command) {
    case "init": return handleInit(argv.slice(1));
    case "validate": return handleValidate(argv.slice(1));
    case "build": return handleBuild(argv.slice(1));
    case "add": return handleAdd(argv.slice(1));
    case "list-extensions": return handleListExtensions(argv.slice(1));
    case "doctor": return handleDoctor(argv.slice(1));
    default:
      logError(`Unknown AMP command: ${command}`);
      printHelp();
      return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    if (err instanceof CliError) {
      logError(err.message);
      process.exitCode = err.code;
      return;
    }
    if (err instanceof AmpValidationError) {
      printValidationError(err);
      process.exitCode = 2;
      return;
    }
    if (err instanceof AmpManifestError) {
      logError(err.message);
      process.exitCode = manifestFailureCode(err);
      return;
    }
    logError(err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
  });
