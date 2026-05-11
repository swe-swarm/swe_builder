/*---------------------------------------------------------------------------------------------
 *  TypeScript generator for AMP manifests.
 *
 *  Assumptions documented for generated projects:
 *  - The generator targets @github/copilot-sdk ^0.5.x from src/version.js. Where the AMP
 *    contract uses a future-friendly shape (for example model objects or custom-agent
 *    systemPrompt), generated code maps to the current Node SDK runtime fields so the
 *    project remains runnable.
 *  - User-provided handlers are resolved relative to the source manifest directory at
 *    runtime. Generated stubs try dynamic import first and fall back to createRequire so
 *    both ESM and CommonJS handlers are practical.
 *  - allowList permissions auto-approve matching rules and fall back to approveAll. This
 *    keeps non-interactive agents from deadlocking while preserving an auditable policy
 *    entry point in src/permissions.ts.
 *--------------------------------------------------------------------------------------------*/

"use strict";

const fs = require("fs");
const path = require("path");
const { addFile, addLog } = require("../planner");
const { renderString } = require("../render");
const {
  AMP_VERSION,
  SDK_PINS,
  COPILOT_SDK_PROTOCOL_VERSION,
  FRAMEWORK_VERSION,
} = require("../version");

const TEMPLATE_DIR = path.join(__dirname, "..", "..", "templates", "typescript");

const DEV_DEPENDENCIES = Object.freeze({
  "@types/node": "^22.0.0",
  "tsx": "^4.19.0",
  "typescript": "^5.5.0",
});

const HOOKS = Object.freeze({
  preToolUse: { sdkName: "onPreToolUse", typeName: "PreToolUseHandler" },
  postToolUse: { sdkName: "onPostToolUse", typeName: "PostToolUseHandler" },
  userPromptSubmitted: { sdkName: "onUserPromptSubmitted", typeName: "UserPromptSubmittedHandler" },
  sessionStart: { sdkName: "onSessionStart", typeName: "SessionStartHandler" },
  sessionEnd: { sdkName: "onSessionEnd", typeName: "SessionEndHandler" },
  errorOccurred: { sdkName: "onErrorOccurred", typeName: "ErrorOccurredHandler" },
});

async function generate(plan) {
  if (!plan || !plan.manifest) throw new Error("TypeScript generator requires a build plan with a manifest");
  const manifest = plan.manifest;
  if (manifest.agent.language !== "typescript") {
    throw new Error(`TypeScript generator received language '${manifest.agent.language}'`);
  }

  const ext = manifest.extensions || {};
  const comm = manifest.communication || null;
  const templateContext = createTemplateContext(plan);
  const toolExportNames = createIdentifierMap(ext.tools || [], "tool");
  const commandExportNames = createIdentifierMap(ext.commands || [], "command");

  emitTemplate(plan, "package.json.tmpl", "package.json", templateContext);
  emitTemplate(plan, "tsconfig.json.tmpl", "tsconfig.json", templateContext);
  emitTemplate(plan, "gitignore.tmpl", ".gitignore", templateContext);
  emitTemplate(plan, "env.example.tmpl", ".env.example", templateContext);
  emitTemplate(plan, "README.md.tmpl", "README.md", templateContext);

  const usesMemoryStore = (ext.tools || []).some((tool) => tool.stub && /^memory/.test(tool.stub.kind));
  if (usesMemoryStore) emitMemoryStore(plan);

  for (const tool of ext.tools || []) {
    emitTool(plan, tool, toolExportNames.get(tool.name));
  }

  const hooks = Object.entries(ext.hooks || {}).filter(([, value]) => !!value);
  for (const [hookKey, handlerPath] of hooks) {
    emitHook(plan, hookKey, handlerPath);
  }

  if (ext.permissions && ext.permissions.mode === "allowList") {
    emitAllowListPermissions(plan, ext.permissions.autoApprove || []);
  }

  for (const command of ext.commands || []) {
    emitCommand(plan, command, commandExportNames.get(command.name));
  }

  if (ext.sessionFs && ext.sessionFs.provider === "memory") {
    emitMemorySessionFs(plan);
  }

  if (comm && Array.isArray(comm.handoff) && comm.handoff.length > 0) {
    emitHandoff(plan, comm);
  }

  for (const skill of (ext.skills && ext.skills.inline) || []) {
    emitInlineSkill(plan, skill);
  }

  emitFile(plan, "src/index.ts", buildIndexTs(plan, { toolExportNames, commandExportNames }));
  emitLockfile(plan);
  addSurfaceLogs(plan);
}

function emitTemplate(plan, templateName, relPath, context) {
  const templatePath = path.join(TEMPLATE_DIR, templateName);
  const template = fs.readFileSync(templatePath, "utf8");
  emitFile(plan, relPath, renderString(template, context));
}

function createTemplateContext(plan) {
  const manifest = plan.manifest;
  const dependenciesJson = formatInlineJson(SDK_PINS.typescript, 2);
  const devDependenciesJson = formatInlineJson(DEV_DEPENDENCIES, 2);
  const envNames = Object.keys((manifest.deployment && manifest.deployment.env) || {}).sort();
  const notes = createReadmeNotes(plan);
  return {
    packageName: manifest.agent.name,
    version: manifest.agent.version || "0.1.0",
    description: manifest.agent.description || `Generated AMP agent ${manifest.agent.name}`,
    license: manifest.agent.license || "MIT",
    displayName: manifest.agent.displayName || manifest.agent.name,
    packageManager: manifest.build.packageManager || "npm",
    dependenciesJson,
    devDependenciesJson,
    envLines: envNames.length ? envNames.map((name) => `${name}=`).join("\n") : "",
    surfacesTable: createSurfacesTable(plan.surfaces || []),
    notes,
  };
}

function createSurfacesTable(surfaces) {
  if (!surfaces.length) return "No AMP extensibility surfaces were enabled.";
  const rows = surfaces.map((surface) => (
    `| ${escapeMarkdown(surface.id)} | ${escapeMarkdown(surface.sdkSurface)} |`
  ));
  return ["| id | sdkSurface |", "| --- | --- |", ...rows].join("\n");
}

function createReadmeNotes(plan) {
  const manifest = plan.manifest;
  const ext = manifest.extensions || {};
  const comm = manifest.communication || null;
  const notes = [];

  if ((ext.tools || []).length) {
    notes.push(`- Tools: ${(ext.tools || []).map((tool) => `\`${tool.name}\``).join(", ")} are registered in \`SessionConfig.tools\`.`);
    for (const tool of ext.tools || []) {
      if (tool.handler) notes.push(`  - \`${tool.name}\` delegates to user handler \`${tool.handler}\` relative to the source manifest.`);
      else if (tool.stub) notes.push(`  - \`${tool.name}\` uses generated \`${tool.stub.kind}\` stub logic.`);
      else notes.push(`  - \`${tool.name}\` is a TODO stub and should be implemented before production use.`);
    }
  }

  const permissions = ext.permissions || { mode: "custom" };
  notes.push(`- Permissions: mode \`${permissions.mode}\` is wired as \`SessionConfig.onPermissionRequest\`.`);
  if (permissions.mode === "allowList") {
    notes.push("  - allowList rules auto-approve matching tool requests, then fall back to approveAll to avoid deadlock.");
  }

  if ((ext.mcpServers || []).length) notes.push(`- MCP: ${(ext.mcpServers || []).length} server(s) are mapped into \`SessionConfig.mcpServers\`.`);
  if ((ext.customAgents || []).length) notes.push(`- Custom agents: ${(ext.customAgents || []).length} agent persona(s) are generated.`);
  if (ext.hooks && Object.keys(ext.hooks).length) notes.push("- Hooks: generated starters live under `src/hooks/` and are attached to `SessionConfig.hooks`.");
  if (ext.sessionFs && ext.sessionFs.provider !== "real") notes.push(`- Session FS: provider \`${ext.sessionFs.provider}\` is wired with \`createSessionFsHandler\`.`);
  if (ext.userInput && ext.userInput.handler) notes.push(`- User input: requests delegate to \`${ext.userInput.handler}\`.`);
  if ((ext.commands || []).length) notes.push(`- Commands: ${(ext.commands || []).length} slash command(s) are registered.`);
  if (ext.skills && ((ext.skills.directories || []).length || (ext.skills.inline || []).length || (ext.skills.disabled || []).length)) notes.push("- Skills: directories and inline skills are supplied through `skillDirectories` / `disabledSkills`.");
  if (ext.systemMessage) notes.push("- System message: AMP systemMessage configuration is marshalled at startup.");
  if (manifest.runtime.ui && manifest.runtime.ui.elicitation) notes.push("- UI elicitation: a conservative default elicitation handler is enabled; replace it with app UI as needed.");
  if (manifest.runtime.infiniteSessions) notes.push("- Infinite sessions: enabled through `SessionConfig.infiniteSessions`.");
  if (comm && comm.broadcast && comm.broadcast.transport === "stdout-jsonl") notes.push("- Broadcast: session lifecycle events are emitted to stdout as JSONL envelopes.");
  if (comm && comm.inbox && comm.inbox.enabled) notes.push("- Inbox: JSONL inbox polling forwards records with `text` or `prompt` into the session.");
  if (comm && Array.isArray(comm.handoff) && comm.handoff.length) notes.push("- Handoff: helper functions are generated in `src/comms/handoff.ts`.");

  notes.push("- Initial prompt: pass it as the first CLI argument or set `AMP_INITIAL_PROMPT`.");
  return notes.join("\n");
}

function emitTool(plan, tool, exportName) {
  const parameters = resolveParamsSchema(plan, tool);
  const lines = [];
  lines.push(`import { defineTool } from "@github/copilot-sdk";`);
  lines.push(`import type { ToolInvocation } from "@github/copilot-sdk";`);

  const needsHandlerLoader = !!tool.handler;
  const memoryKind = tool.stub && /^memory/.test(tool.stub.kind) ? tool.stub.kind : null;
  if (needsHandlerLoader) {
    lines.push(`import { createRequire } from "node:module";`);
    lines.push(`import * as path from "node:path";`);
    lines.push(`import { fileURLToPath, pathToFileURL } from "node:url";`);
  }
  if (memoryKind) {
    const imports = memoryKind === "memoryList" ? "listMemory" : memoryKind === "memoryRead" ? "readMemory" : "writeMemory";
    lines.push(`import { ${imports} } from "../lib/memoryStore.js";`);
  }
  lines.push("");

  if (needsHandlerLoader) {
    lines.push(...moduleLoaderBlock(2, slash(path.relative(plan.outDir, plan.manifestDir) || ".")));
    lines.push(`const modulePath = path.resolve(manifestRoot, ${jsString(tool.handler)});`);
    lines.push("");
  }

  lines.push(`const parameters = ${indentBlock(JSON.stringify(parameters, null, 2), 0)} as const;`);
  lines.push("");

  if (memoryKind === "memoryRead" || memoryKind === "memoryWrite") {
    lines.push(`function memoryKey(args: unknown): string {`);
    lines.push(`  const value = args as Record<string, unknown> | null;`);
    lines.push(`  return String(value?.key ?? value?.name ?? value?.id ?? "default");`);
    lines.push(`}`);
    lines.push("");
  }

  const configLines = [];
  configLines.push(`description: ${jsString(tool.description)},`);
  configLines.push(`parameters,`);
  if (tool.overridesBuiltIn) configLines.push(`overridesBuiltInTool: true,`);
  if (tool.skipPermission) configLines.push(`skipPermission: true,`);
  configLines.push(`handler: ${buildToolHandler(tool)},`);

  lines.push(`export const ${exportName} = defineTool(${jsString(tool.name)}, {`);
  lines.push(indentBlock(configLines.join("\n"), 2));
  lines.push(`});`);
  lines.push("");
  lines.push(`export default ${exportName};`);

  emitFile(plan, `src/tools/${tool.name}.ts`, lines.join("\n"));
}

function buildToolHandler(tool) {
  if (tool.handler) {
    return [
      `async (args: Record<string, unknown>, invocation: ToolInvocation) => {`,
      `  const mod = await importUserModule(modulePath);`,
      `  const handler = pickHandler(mod, ${jsString(`tool ${tool.name}`)});`,
      `  return await handler(args, invocation);`,
      `}`,
    ].join("\n");
  }

  if (tool.stub) {
    switch (tool.stub.kind) {
      case "echo":
        return `async (args: Record<string, unknown>) => args`;
      case "static":
        return `async () => ${JSON.stringify(tool.stub.value !== undefined ? tool.stub.value : "static stub invoked", null, 2)}`;
      case "memoryRead":
        return [
          `async (args: Record<string, unknown>) => {`,
          `  return readMemory(memoryKey(args)) ?? null;`,
          `}`,
        ].join("\n");
      case "memoryWrite":
        return [
          `async (args: Record<string, unknown>) => {`,
          `  const value = (args as Record<string, unknown>).value ?? args;`,
          `  const key = memoryKey(args);`,
          `  writeMemory(key, value);`,
          `  return { key, value, ok: true };`,
          `}`,
        ].join("\n");
      case "memoryList":
        return `async () => listMemory()`;
      default:
        break;
    }
  }

  return [
    `async () => {`,
    `  console.warn(${jsString(`TODO: implement AMP tool ${tool.name}`)});`,
    `  return ${jsString(`TODO: implement tool ${tool.name}`)};`,
    `}`,
  ].join("\n");
}

function resolveParamsSchema(plan, tool) {
  if (!tool.paramsSchema) return { type: "object", properties: {} };
  if (typeof tool.paramsSchema === "object") return tool.paramsSchema;
  const schemaPath = path.resolve(plan.manifestDir, tool.paramsSchema);
  const raw = fs.readFileSync(schemaPath, "utf8");
  return JSON.parse(raw);
}

function emitMemoryStore(plan) {
  emitFile(plan, "src/lib/memoryStore.ts", `const store = new Map<string, unknown>();

export function readMemory(key: string): unknown {
  return store.get(key);
}

export function writeMemory(key: string, value: unknown): void {
  store.set(key, value);
}

export function listMemory(): Array<{ key: string; value: unknown }> {
  return Array.from(store.entries()).map(([key, value]) => ({ key, value }));
}
`);
}

function emitHook(plan, hookKey, handlerPath) {
  const hook = HOOKS[hookKey];
  if (!hook) return;
  const lines = [];
  lines.push(`import type { ${hook.typeName} } from "@github/copilot-sdk";`);
  lines.push(`import { createRequire } from "node:module";`);
  lines.push(`import * as path from "node:path";`);
  lines.push(`import { fileURLToPath, pathToFileURL } from "node:url";`);
  lines.push("");
  lines.push(...moduleLoaderBlock(2, slash(path.relative(plan.outDir, plan.manifestDir) || ".")));
  lines.push(`const modulePath = path.resolve(manifestRoot, ${jsString(handlerPath)});`);
  lines.push("");
  lines.push(`export const handler: ${hook.typeName} = async (input, invocation) => {`);
  lines.push(`  console.log(${jsString(`[amp hook:${hookKey}]`)}, { sessionId: invocation.sessionId });`);
  lines.push(`  const mod = await importUserModule(modulePath);`);
  lines.push(`  const userHandler = pickHandler(mod, ${jsString(`hook ${hookKey}`)});`);
  lines.push(`  return await userHandler(input, invocation);`);
  lines.push(`};`);

  emitFile(plan, `src/hooks/${hookKey}.ts`, lines.join("\n"));
}

function emitAllowListPermissions(plan, rules) {
  emitFile(plan, "src/permissions.ts", `import { approveAll } from "@github/copilot-sdk";
import type { PermissionHandler } from "@github/copilot-sdk";

const AUTO_APPROVE_RULES: ReadonlyArray<{ tool: string; argsContains?: string }> = ${JSON.stringify(rules || [], null, 2)};

function matchesTool(pattern: string, toolName: string): boolean {
  if (pattern === "*" || pattern === toolName) return true;
  if (pattern.endsWith("*")) return toolName.startsWith(pattern.slice(0, -1));
  return false;
}

export const handler: PermissionHandler = async (request, invocation) => {
  const raw = request as unknown as Record<string, unknown>;
  const toolName = String(raw.toolName ?? raw.tool ?? raw.name ?? raw.kind ?? "");
  const argsText = JSON.stringify(raw.arguments ?? raw.args ?? raw.input ?? {});
  const matched = AUTO_APPROVE_RULES.some((rule) => {
    if (!matchesTool(rule.tool, toolName)) return false;
    return !rule.argsContains || argsText.includes(rule.argsContains);
  });

  if (matched) return { kind: "approve-once" };

  console.warn("AMP allowList permissions: no autoApprove rule matched; falling back to approveAll.");
  return approveAll(request, invocation);
};
`);
}

function emitCommand(plan, command) {
  const lines = [];
  lines.push(`import type { CommandHandler } from "@github/copilot-sdk";`);
  if (command.handler) {
    lines.push(`import { createRequire } from "node:module";`);
    lines.push(`import * as path from "node:path";`);
    lines.push(`import { fileURLToPath, pathToFileURL } from "node:url";`);
    lines.push("");
    lines.push(...moduleLoaderBlock(2, slash(path.relative(plan.outDir, plan.manifestDir) || ".")));
    lines.push(`const modulePath = path.resolve(manifestRoot, ${jsString(command.handler)});`);
    lines.push("");
    lines.push(`export const handler: CommandHandler = async (context) => {`);
    lines.push(`  const mod = await importUserModule(modulePath);`);
    lines.push(`  const userHandler = pickHandler(mod, ${jsString(`command ${command.name}`)});`);
    lines.push(`  return await userHandler(context);`);
    lines.push(`};`);
  } else {
    lines.push("");
    lines.push(`export const handler: CommandHandler = async (context) => {`);
    lines.push(`  console.log(${jsString(`[amp command:${command.name}]`)}, context.args);`);
    lines.push(`};`);
  }
  emitFile(plan, `src/commands/${command.name}.ts`, lines.join("\n"));
}

function emitMemorySessionFs(plan) {
  emitFile(plan, "src/sessionFs.ts", `import * as path from "node:path";
import type { SessionFsFileInfo, SessionFsProvider } from "@github/copilot-sdk";

type Entry =
  | { kind: "file"; content: string; mode?: number; birthtime: string; mtime: string }
  | { kind: "dir"; mode?: number; birthtime: string; mtime: string };

function now(): string {
  return new Date().toISOString();
}

function missing(filePath: string): NodeJS.ErrnoException {
  const error = new Error("ENOENT: no such file or directory, " + filePath) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

export function createMemorySessionFsProvider(): SessionFsProvider {
  return new MemorySessionFsProvider();
}

class MemorySessionFsProvider implements SessionFsProvider {
  private readonly entries = new Map<string, Entry>([["/", { kind: "dir", birthtime: now(), mtime: now() }]]);

  async readFile(filePath: string): Promise<string> {
    const entry = this.get(filePath);
    if (entry.kind !== "file") throw missing(filePath);
    return entry.content;
  }

  async writeFile(filePath: string, content: string, mode?: number): Promise<void> {
    const normalized = this.normalize(filePath);
    await this.mkdir(path.posix.dirname(normalized), true);
    const existing = this.entries.get(normalized);
    const timestamp = now();
    this.entries.set(normalized, {
      kind: "file",
      content,
      mode,
      birthtime: existing?.birthtime ?? timestamp,
      mtime: timestamp,
    });
  }

  async appendFile(filePath: string, content: string, mode?: number): Promise<void> {
    const current = await this.exists(filePath) ? await this.readFile(filePath) : "";
    await this.writeFile(filePath, current + content, mode);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.entries.has(this.normalize(filePath));
  }

  async stat(filePath: string): Promise<SessionFsFileInfo> {
    const entry = this.get(filePath);
    return {
      isFile: entry.kind === "file",
      isDirectory: entry.kind === "dir",
      size: entry.kind === "file" ? Buffer.byteLength(entry.content, "utf8") : 0,
      mtime: entry.mtime,
      birthtime: entry.birthtime,
    };
  }

  async mkdir(filePath: string, recursive: boolean): Promise<void> {
    const normalized = this.normalize(filePath);
    if (this.entries.has(normalized)) return;
    const parent = path.posix.dirname(normalized);
    if (parent !== normalized && !this.entries.has(parent)) {
      if (!recursive) throw missing(parent);
      await this.mkdir(parent, true);
    }
    const timestamp = now();
    this.entries.set(normalized, { kind: "dir", birthtime: timestamp, mtime: timestamp });
  }

  async readdir(filePath: string): Promise<string[]> {
    const normalized = this.normalize(filePath);
    const entry = this.get(normalized);
    if (entry.kind !== "dir") throw missing(filePath);
    const prefix = normalized === "/" ? "/" : normalized + "/";
    const names = new Set<string>();
    for (const key of this.entries.keys()) {
      if (key === normalized || !key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest && !rest.includes("/")) names.add(rest);
    }
    return Array.from(names).sort();
  }

  async readdirWithTypes(filePath: string): Promise<Array<{ name: string; isFile: boolean; isDirectory: boolean }>> {
    const normalized = this.normalize(filePath);
    const names = await this.readdir(normalized);
    return names.map((name) => {
      const child = this.entries.get(path.posix.join(normalized, name));
      return { name, isFile: child?.kind === "file", isDirectory: child?.kind === "dir" };
    });
  }

  async rm(filePath: string, recursive: boolean, force: boolean): Promise<void> {
    const normalized = this.normalize(filePath);
    if (!this.entries.has(normalized)) {
      if (force) return;
      throw missing(filePath);
    }
    const prefix = normalized === "/" ? "/" : normalized + "/";
    const descendants = Array.from(this.entries.keys()).filter((key) => key.startsWith(prefix) && key !== normalized);
    if (descendants.length && !recursive) throw new Error("ENOTEMPTY: directory not empty, " + filePath);
    for (const key of descendants) this.entries.delete(key);
    if (normalized !== "/") this.entries.delete(normalized);
  }

  async rename(src: string, dest: string): Promise<void> {
    const normalizedSrc = this.normalize(src);
    const normalizedDest = this.normalize(dest);
    const entry = this.entries.get(normalizedSrc);
    if (!entry) throw missing(src);
    await this.mkdir(path.posix.dirname(normalizedDest), true);
    const moves = Array.from(this.entries.entries()).filter(([key]) => key === normalizedSrc || key.startsWith(normalizedSrc + "/"));
    for (const [key] of moves) this.entries.delete(key);
    for (const [key, value] of moves) this.entries.set(normalizedDest + key.slice(normalizedSrc.length), { ...value, mtime: now() });
  }

  private get(filePath: string): Entry {
    const entry = this.entries.get(this.normalize(filePath));
    if (!entry) throw missing(filePath);
    return entry;
  }

  private normalize(filePath: string): string {
    const normalized = path.posix.normalize("/" + filePath.replace(/\\/g, "/"));
    return normalized === "." ? "/" : normalized;
  }
}
`);
}

function emitHandoff(plan, communication) {
  const peers = communication.handoff || [];
  const lines = [];
  lines.push(`import * as fs from "node:fs";`);
  lines.push("");
  lines.push(`const AGENT_ID = ${jsString(communication.id || plan.manifest.agent.name)};`);
  lines.push("");
  lines.push(`export interface HandoffOptions {`);
  lines.push(`  text?: string;`);
  lines.push(`  channel?: string;`);
  lines.push(`}`);
  lines.push("");
  lines.push(`function envelope(peer: string, payload: unknown, options: HandoffOptions = {}) {`);
  lines.push(`  return { ts: new Date().toISOString(), agentId: AGENT_ID, peer, channel: options.channel ?? "handoff", type: "handoff", text: options.text, payload };`);
  lines.push(`}`);
  lines.push("");

  for (const peer of peers) {
    const fn = toIdentifier(`handoffTo_${peer.name}`);
    lines.push(`export async function ${fn}(payload: unknown, options: HandoffOptions = {}): Promise<void> {`);
    lines.push(`  const message = envelope(${jsString(peer.name)}, payload, options);`);
    if (peer.transport === "http") {
      lines.push(`  const endpoint = ${jsString(peer.endpoint || "")};`);
      lines.push(`  if (!endpoint) throw new Error(${jsString(`No HTTP endpoint configured for handoff peer ${peer.name}`)});`);
      lines.push(`  await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(message) });`);
    } else if (peer.transport === "inbox") {
      lines.push(`  const endpoint = ${jsString(peer.endpoint || `${peer.name}.jsonl`)};`);
      lines.push(`  fs.appendFileSync(endpoint, JSON.stringify(message) + "\\n");`);
    } else {
      lines.push(`  process.stdout.write(JSON.stringify(message) + "\\n");`);
    }
    lines.push(`}`);
    lines.push("");
  }

  emitFile(plan, "src/comms/handoff.ts", lines.join("\n"));
}

function emitInlineSkill(plan, skill) {
  const dir = sanitizePathSegment(skill.name);
  let instructions = skill.instructions || "";
  if (isPathLike(instructions)) {
    const full = path.resolve(plan.manifestDir, instructions);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) instructions = fs.readFileSync(full, "utf8");
  }
  const content = [`# ${skill.name}`, "", skill.description || "", "", instructions].join("\n");
  emitFile(plan, `skills/${dir}/SKILL.md`, content);
}

function buildIndexTs(plan, ids) {
  const manifest = plan.manifest;
  const ext = manifest.extensions || {};
  const runtime = manifest.runtime || {};
  const copilotSdk = runtime.copilotSdk || {};
  const comm = manifest.communication || null;
  const manifestRel = slash(path.relative(plan.outDir, plan.manifestDir) || ".");
  const toolImports = (ext.tools || []).map((tool) => `import { ${ids.toolExportNames.get(tool.name)} } from "./tools/${tool.name}.js";`);
  const hookImports = Object.entries(ext.hooks || {})
    .filter(([key, value]) => !!value && HOOKS[key])
    .map(([key]) => `import * as hooks_${toIdentifier(key)} from "./hooks/${key}.js";`);
  const commandImports = (ext.commands || []).map((command) => `import { handler as ${ids.commandExportNames.get(command.name)} } from "./commands/${command.name}.js";`);
  const permissionImport = ext.permissions && ext.permissions.mode === "allowList"
    ? [`import { handler as permissionHandler } from "./permissions.js";`]
    : [];
  const sessionFsImport = ext.sessionFs && ext.sessionFs.provider === "memory"
    ? [`import { createMemorySessionFsProvider } from "./sessionFs.js";`]
    : [];

  const sdkImports = ["CopilotClient"];
  if (!ext.permissions || ext.permissions.mode === "approveAll") sdkImports.push("approveAll");

  const typeImports = [
    "CommandDefinition",
    "CopilotClientOptions",
    "ElicitationHandler",
    "MCPServerConfig",
    "PermissionHandler",
    "SessionConfig",
    "SessionEvent",
    "UserInputHandler",
  ];

  const sections = [];
  sections.push(`import * as fs from "node:fs";`);
  sections.push(`import { createRequire } from "node:module";`);
  sections.push(`import * as path from "node:path";`);
  sections.push(`import { fileURLToPath, pathToFileURL } from "node:url";`);
  sections.push(`import { ${sdkImports.join(", ")} } from "@github/copilot-sdk";`);
  sections.push(`import type { ${typeImports.join(", ")} } from "@github/copilot-sdk";`);
  sections.push(...toolImports);
  sections.push(...hookImports);
  sections.push(...commandImports);
  sections.push(...permissionImport);
  sections.push(...sessionFsImport);
  sections.push("");
  sections.push(`const __filename = fileURLToPath(import.meta.url);`);
  sections.push(`const __dirname = path.dirname(__filename);`);
  sections.push(`const projectRoot = path.resolve(__dirname, "..");`);
  sections.push(`const manifestRoot = path.resolve(projectRoot, ${jsString(manifestRel)});`);
  sections.push(`const requireFromHere = createRequire(import.meta.url);`);
  sections.push(`const AGENT_ID = ${jsString(comm && comm.id ? comm.id : manifest.agent.name)};`);
  sections.push("");
  sections.push(indexHelperBlock());

  const mcpDecl = buildMcpServersDeclaration(ext.mcpServers || []);
  if (mcpDecl) sections.push(mcpDecl);

  const customAgentsDecl = buildCustomAgentsDeclaration(ext.customAgents || []);
  if (customAgentsDecl) sections.push(customAgentsDecl);

  const commandsDecl = buildCommandsDeclaration(ext.commands || [], ids.commandExportNames);
  if (commandsDecl) sections.push(commandsDecl);

  const hooksDecl = buildHooksDeclaration(ext.hooks || {});
  if (hooksDecl) sections.push(hooksDecl);

  const permissionDecl = buildPermissionDeclaration(ext.permissions || { mode: "custom" });
  if (permissionDecl) sections.push(permissionDecl);

  const userInputDecl = buildUserInputDeclaration(ext.userInput);
  if (userInputDecl) sections.push(userInputDecl);

  if (runtime.ui && runtime.ui.elicitation) {
    sections.push(`const defaultElicitationHandler: ElicitationHandler = async (context) => {
  console.warn("AMP UI elicitation requested, but no UI adapter is configured.", context.message);
  return { action: "cancel" };
};`);
  }

  const lifecycleDecl = buildLifecycleDeclaration(ext.lifecycle);
  if (lifecycleDecl) sections.push(lifecycleDecl);

  if (comm && comm.broadcast && comm.broadcast.transport === "stdout-jsonl") {
    sections.push(buildBroadcastBlock(comm, manifest.agent.name));
  }

  if (comm && comm.inbox && comm.inbox.enabled) {
    sections.push(buildInboxBlock(comm.inbox));
  }

  sections.push(buildEventHandlerBlock(comm));

  const mainLines = [];
  mainLines.push(`let shuttingDown = false;`);
  mainLines.push("");
  mainLines.push(`async function main(): Promise<void> {`);
  if (copilotSdk.gitHubTokenEnv && copilotSdk.transport !== "external") {
    mainLines.push(`  const gitHubToken = process.env[${jsString(copilotSdk.gitHubTokenEnv)}];`);
  }
  mainLines.push(indentBlock(buildClientOptions(copilotSdk, ext.sessionFs), 2));
  mainLines.push("");
  mainLines.push(`  const client = new CopilotClient(clientOptions);`);
  mainLines.push(`  process.on("SIGINT", () => { void shutdown(client); });`);
  if (ext.lifecycle && ext.lifecycle.handler) mainLines.push(`  await registerLifecycleHandler(client);`);
  mainLines.push(`  await client.start();`);
  mainLines.push("");
  mainLines.push(indentBlock(buildSessionConfig(manifest, ids), 2));
  mainLines.push("");
  mainLines.push(`  const session = await client.createSession(sessionConfig);`);
  mainLines.push(`  session.on(handleSessionEvent);`);
  if (comm && comm.broadcast && comm.broadcast.transport === "stdout-jsonl") {
    mainLines.push(`  broadcastToAll("session.created", { sessionId: session.sessionId });`);
  }
  if (comm && comm.inbox && comm.inbox.enabled) {
    const inboxPath = comm.inbox.path || `${manifest.agent.name}.inbox.jsonl`;
    mainLines.push(`  startInboxPolling(path.resolve(projectRoot, ${jsString(inboxPath)}), session);`);
  }
  mainLines.push("");
  mainLines.push(`  const initialPrompt = process.argv[2] ?? process.env.AMP_INITIAL_PROMPT;`);
  mainLines.push(`  if (initialPrompt) {`);
  mainLines.push(`    await session.send({ prompt: initialPrompt });`);
  mainLines.push(`  } else {`);
  mainLines.push(`    console.error("No initial prompt provided. Pass one as argv[2] or set AMP_INITIAL_PROMPT; keeping the session open.");`);
  mainLines.push(`  }`);
  mainLines.push("");
  mainLines.push(`  await new Promise<void>(() => {});`);
  mainLines.push(`}`);
  mainLines.push("");
  mainLines.push(`async function shutdown(client: CopilotClient): Promise<void> {`);
  mainLines.push(`  if (shuttingDown) return;`);
  mainLines.push(`  shuttingDown = true;`);
  if (comm && comm.broadcast && comm.broadcast.transport === "stdout-jsonl") {
    mainLines.push(`  broadcastToAll("session.stopping", {});`);
  }
  if (comm && comm.inbox && comm.inbox.enabled) {
    const inboxPath = comm.inbox.path || `${manifest.agent.name}.inbox.jsonl`;
    mainLines.push(`  fs.unwatchFile(path.resolve(projectRoot, ${jsString(inboxPath)}));`);
  }
  mainLines.push(`  await client.stop();`);
  mainLines.push(`  process.exit(0);`);
  mainLines.push(`}`);
  mainLines.push("");
  mainLines.push(`void main().catch((error) => {`);
  mainLines.push(`  console.error(error);`);
  mainLines.push(`  process.exitCode = 1;`);
  mainLines.push(`});`);
  sections.push(mainLines.join("\n"));

  return sections.filter(Boolean).join("\n\n");
}

function indexHelperBlock() {
  return `async function importManifestModule(relativeToManifest: string): Promise<any> {
  const modulePath = path.resolve(manifestRoot, relativeToManifest);
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (importError) {
    try {
      return requireFromHere(modulePath);
    } catch {
      throw importError;
    }
  }
}

function requireManifestModule(relativeToManifest: string): any {
  return requireFromHere(path.resolve(manifestRoot, relativeToManifest));
}

function pickHandler(mod: any, label: string): (...args: any[]) => any {
  const handler = mod.default ?? mod.handler;
  if (typeof handler !== "function") throw new Error("AMP " + label + " module must export default or handler function.");
  return handler;
}

function readManifestFile(relativeToManifest: string): string {
  return fs.readFileSync(path.resolve(manifestRoot, relativeToManifest), "utf8");
}`;
}

function buildClientOptions(copilotSdk, sessionFs) {
  const transport = copilotSdk.transport || "stdio";
  const lines = [];
  lines.push(`const clientOptions: CopilotClientOptions = {`);
  if (transport === "external") {
    lines.push(`  cliUrl: ${jsString(copilotSdk.cliUrl || "http://localhost:8080")},`);
  } else {
    lines.push(`  useStdio: ${transport === "tcp" ? "false" : "true"},`);
    if (copilotSdk.cliPath) lines.push(`  cliPath: ${jsString(copilotSdk.cliPath)},`);
    if (copilotSdk.gitHubTokenEnv) lines.push(`  ...(gitHubToken ? { gitHubToken } : {}),`);
    if (transport === "stdio" && typeof copilotSdk.useLoggedInUser === "boolean") {
      lines.push(`  useLoggedInUser: ${copilotSdk.useLoggedInUser ? "true" : "false"},`);
    }
  }
  if (copilotSdk.logLevel) lines.push(`  logLevel: ${jsString(copilotSdk.logLevel)},`);
  if (Number.isInteger(copilotSdk.sessionIdleTimeoutSec)) {
    lines.push(`  sessionIdleTimeoutSeconds: ${copilotSdk.sessionIdleTimeoutSec},`);
  }
  if (sessionFs && sessionFs.provider !== "real") {
    lines.push(`  sessionFs: {`);
    lines.push(`    initialCwd: process.cwd(),`);
    lines.push(`    sessionStatePath: ".amp-session-state",`);
    lines.push(`    conventions: process.platform === "win32" ? "windows" : "posix",`);
    lines.push(`  },`);
  }
  lines.push(`};`);
  return lines.join("\n");
}

function buildSessionConfig(manifest, ids) {
  const ext = manifest.extensions || {};
  const runtime = manifest.runtime || {};
  const tools = ext.tools || [];
  const commands = ext.commands || [];
  const permissions = ext.permissions || { mode: "custom" };
  const lines = [];
  lines.push(`const sessionConfig: SessionConfig & { capabilities?: { ui?: { elicitation?: boolean } } } = {`);
  lines.push(`  clientName: ${jsString(manifest.agent.name)},`);
  if (runtime.model && runtime.model.name) lines.push(`  model: ${jsString(runtime.model.name)},`);
  if (runtime.model && runtime.model.reasoningEffort) lines.push(`  reasoningEffort: ${jsString(runtime.model.reasoningEffort)} as any,`);
  if (runtime.model && runtime.model.capabilitiesOverride) lines.push(`  modelCapabilities: ${inlineCode(runtime.model.capabilitiesOverride, 2)},`);
  if (tools.length) lines.push(`  tools: [${tools.map((tool) => ids.toolExportNames.get(tool.name)).join(", ")}],`);
  if ((ext.mcpServers || []).length) lines.push(`  mcpServers,`);
  if ((ext.customAgents || []).length) lines.push(`  customAgents,`);
  if (ext.defaultAgent) lines.push(`  defaultAgent: ${inlineCode(ext.defaultAgent, 2)} as any,`);
  if (ext.agent) lines.push(`  agent: ${jsString(ext.agent)},`);
  if (Array.isArray(ext.availableTools)) lines.push(`  availableTools: ${inlineCode(ext.availableTools, 2)},`);
  if (Array.isArray(ext.excludedTools) && ext.excludedTools.length) lines.push(`  excludedTools: ${inlineCode(ext.excludedTools, 2)},`);
  if (Object.entries(ext.hooks || {}).some(([key, value]) => !!value && HOOKS[key])) lines.push(`  hooks,`);
  lines.push(`  onPermissionRequest: ${permissionHandlerExpression(permissions)},`);
  if (ext.userInput && ext.userInput.handler) lines.push(`  onUserInputRequest: userInputHandler,`);
  if (runtime.ui && runtime.ui.elicitation) {
    lines.push(`  onElicitationRequest: defaultElicitationHandler,`);
    lines.push(`  capabilities: { ui: { elicitation: true } },`);
  }
  if (commands.length) lines.push(`  commands,`);
  const skillDirectories = skillDirectoriesExpression(ext.skills || {});
  if (skillDirectories) lines.push(`  skillDirectories: ${skillDirectories},`);
  if (ext.skills && ext.skills.disabled && ext.skills.disabled.length) lines.push(`  disabledSkills: ${inlineCode(ext.skills.disabled, 2)},`);
  if (ext.systemMessage) lines.push(`  systemMessage: ${systemMessageExpression(ext.systemMessage)},`);
  if (ext.sessionFs && ext.sessionFs.provider === "memory") lines.push(`  createSessionFsHandler: () => createMemorySessionFsProvider(),`);
  if (ext.sessionFs && ext.sessionFs.provider === "custom" && ext.sessionFs.handler) {
    lines.push(`  createSessionFsHandler: (session) => {`);
    lines.push(`    const mod = requireManifestModule(${jsString(ext.sessionFs.handler)});`);
    lines.push(`    const factory = mod.default ?? mod.createSessionFsProvider ?? mod.createProvider ?? mod.handler;`);
    lines.push(`    if (typeof factory !== "function") throw new Error("Custom sessionFs module must export a provider factory.");`);
    lines.push(`    return factory(session);`);
    lines.push(`  },`);
  }
  lines.push(`  infiniteSessions: { enabled: ${runtime.infiniteSessions ? "true" : "false"} },`);
  lines.push(`  streaming: ${runtime.streaming !== false ? "true" : "false"},`);
  lines.push(`  includeSubAgentStreamingEvents: ${runtime.includeSubAgentStreamingEvents ? "true" : "false"},`);
  lines.push(`  workingDirectory: path.resolve(manifestRoot, ${jsString(runtime.workingDirectory || ".")}),`);
  if (runtime.provider) lines.push(`  provider: ${inlineCode(runtime.provider, 2)},`);
  lines.push(`};`);
  return lines.join("\n");
}

function permissionHandlerExpression(permissions) {
  switch (permissions.mode) {
    case "approveAll":
      return "approveAll";
    case "denyAll":
      return "denyAllPermissions";
    case "allowList":
      return "permissionHandler";
    case "custom":
    default:
      return permissions.handler ? "customPermissionHandler" : "denyAllPermissions";
  }
}

function buildPermissionDeclaration(permissions) {
  if (permissions.mode === "denyAll" || (permissions.mode === "custom" && !permissions.handler)) {
    return `const denyAllPermissions: PermissionHandler = async () => ({ kind: "reject", feedback: "Denied by AMP permissions policy." });`;
  }
  if (permissions.mode === "custom" && permissions.handler) {
    return `const customPermissionHandler: PermissionHandler = async (request, invocation) => {
  const mod = await importManifestModule(${jsString(permissions.handler)});
  const handler = pickHandler(mod, "permission handler");
  return await handler(request, invocation);
};`;
  }
  return "";
}

function buildUserInputDeclaration(userInput) {
  if (!userInput || !userInput.handler) return "";
  return `const userInputHandler: UserInputHandler = async (request, invocation) => {
  const mod = await importManifestModule(${jsString(userInput.handler)});
  const handler = pickHandler(mod, "user input handler");
  return await handler(request, invocation);
};`;
}

function buildLifecycleDeclaration(lifecycle) {
  if (!lifecycle || !lifecycle.handler) return "";
  return `async function registerLifecycleHandler(client: CopilotClient): Promise<void> {
  const mod = await importManifestModule(${jsString(lifecycle.handler)});
  const handler = pickHandler(mod, "lifecycle handler");
  client.on(handler);
}`;
}

function buildMcpServersDeclaration(servers) {
  if (!servers.length) return "";
  const lines = [];
  lines.push(`const mcpServers: Record<string, MCPServerConfig> = {`);
  for (const server of servers) {
    lines.push(`  ${jsString(server.name)}: {`);
    lines.push(`    type: ${jsString(server.type)},`);
    if (server.command) lines.push(`    command: ${jsString(server.command)},`);
    if (Array.isArray(server.args)) lines.push(`    args: ${inlineCode(server.args, 4)},`);
    if (server.env) lines.push(`    env: ${inlineCode(server.env, 4)},`);
    if (server.url) lines.push(`    url: ${jsString(server.url)},`);
    if (server.headers) lines.push(`    headers: ${inlineCode(server.headers, 4)},`);
    lines.push(`    tools: ${inlineCode(server.tools && server.tools.length ? server.tools : ["*"], 4)},`);
    lines.push(`  } as MCPServerConfig,`);
  }
  lines.push(`};`);
  return lines.join("\n");
}

function buildCustomAgentsDeclaration(agents) {
  if (!agents.length) return "";
  const lines = [];
  lines.push(`const customAgents = [`);
  for (const agent of agents) {
    const prompt = agent.systemPrompt || agent.description || "";
    const promptExpr = isPromptPath(prompt) ? `readManifestFile(${jsString(prompt)})` : jsString(prompt);
    lines.push(`  {`);
    lines.push(`    name: ${jsString(agent.name)},`);
    lines.push(`    description: ${jsString(agent.description || agent.name)},`);
    lines.push(`    prompt: ${promptExpr},`);
    if (agent.tools) lines.push(`    tools: ${inlineCode(agent.tools, 4)},`);
    if (agent.excludedTools) lines.push(`    excludedTools: ${inlineCode(agent.excludedTools, 4)},`);
    if (agent.model) lines.push(`    model: ${jsString(agent.model)},`);
    if (agent.reasoningEffort) lines.push(`    reasoningEffort: ${jsString(agent.reasoningEffort)},`);
    if (agent.mcpServers) lines.push(`    mcpServers: ${inlineCode(agent.mcpServers, 4)},`);
    lines.push(`  } as any,`);
  }
  lines.push(`];`);
  return lines.join("\n");
}

function buildCommandsDeclaration(commands, commandExportNames) {
  if (!commands.length) return "";
  const lines = [];
  lines.push(`const commands: Array<CommandDefinition & { argsHint?: string }> = [`);
  for (const command of commands) {
    lines.push(`  {`);
    lines.push(`    name: ${jsString(command.name)},`);
    lines.push(`    description: ${jsString(command.description || "")},`);
    if (command.argsHint) lines.push(`    argsHint: ${jsString(command.argsHint)},`);
    lines.push(`    handler: ${commandExportNames.get(command.name)},`);
    lines.push(`  },`);
  }
  lines.push(`];`);
  return lines.join("\n");
}

function buildHooksDeclaration(hooksManifest) {
  const entries = Object.entries(hooksManifest || {}).filter(([key, value]) => !!value && HOOKS[key]);
  if (!entries.length) return "";
  const lines = [];
  lines.push(`const hooks = {`);
  for (const [key] of entries) {
    lines.push(`  ${HOOKS[key].sdkName}: hooks_${toIdentifier(key)}.handler,`);
  }
  lines.push(`};`);
  return lines.join("\n");
}

function skillDirectoriesExpression(skills) {
  const directories = [];
  for (const dir of skills.directories || []) directories.push(`path.resolve(manifestRoot, ${jsString(dir)})`);
  if (skills.inline && skills.inline.length) directories.push(`path.resolve(projectRoot, "skills")`);
  return directories.length ? `[${directories.join(", ")}]` : "";
}

function systemMessageExpression(systemMessage) {
  const mode = systemMessage.mode || "customize";
  const lines = [];
  lines.push(`{`);
  lines.push(`  mode: ${jsString(mode)},`);
  if (mode === "customize") {
    if (systemMessage.content) lines.push(`  content: ${contentExpression(systemMessage.content)},`);
    const sectionEntries = Object.entries(systemMessage.sections || {});
    if (sectionEntries.length) {
      lines.push(`  sections: {`);
      for (const [section, value] of sectionEntries) {
        if (typeof value === "string") {
          lines.push(`    ${jsString(section)}: { action: "replace", content: ${contentExpression(value)} },`);
        } else if (value && typeof value === "object") {
          const action = value.replace !== undefined ? "replace" : value.prepend !== undefined ? "prepend" : "append";
          const content = value.replace !== undefined ? value.replace : value.prepend !== undefined ? value.prepend : value.append;
          lines.push(`    ${jsString(section)}: { action: ${jsString(action)}, content: ${contentExpression(content || "")} },`);
        }
      }
      lines.push(`  },`);
    }
  } else if (systemMessage.content) {
    lines.push(`  content: ${contentExpression(systemMessage.content)},`);
  }
  lines.push(`}`);
  return lines.join("\n");
}

function contentExpression(value) {
  return isPathLike(value) ? `readManifestFile(${jsString(value)})` : jsString(value || "");
}

function buildBroadcastBlock(communication) {
  const channels = communication.broadcast.channels && communication.broadcast.channels.length
    ? communication.broadcast.channels
    : ["session"];
  return `const BROADCAST_CHANNELS = ${JSON.stringify(channels, null, 2)};

function broadcast(message: { channel: string; type: string; payload?: unknown }): void {
  const envelope = { ts: new Date().toISOString(), agentId: AGENT_ID, ...message };
  process.stdout.write(JSON.stringify(envelope) + "\\n");
}

function broadcastToAll(type: string, payload: unknown): void {
  for (const channel of BROADCAST_CHANNELS) broadcast({ channel, type, payload });
}`;
}

function buildInboxBlock() {
  return `function startInboxPolling(inboxPath: string, session: { send(message: { prompt: string }): Promise<unknown> }): void {
  let offset = 0;
  if (fs.existsSync(inboxPath)) offset = fs.statSync(inboxPath).size;

  fs.watchFile(inboxPath, { interval: 500 }, async () => {
    if (!fs.existsSync(inboxPath)) return;
    const content = fs.readFileSync(inboxPath, "utf8");
    const chunk = content.slice(offset);
    offset = content.length;
    for (const line of chunk.split(/\\r?\\n/)) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        const prompt = message.text ?? message.prompt ?? message.payload?.text;
        if (prompt) await session.send({ prompt: String(prompt) });
      } catch (error) {
        console.error("Failed to process AMP inbox line", error);
      }
    }
  });
}`;
}

function buildEventHandlerBlock(communication) {
  const shouldBroadcast = communication && communication.broadcast && communication.broadcast.transport === "stdout-jsonl";
  const lines = [];
  lines.push(`function handleSessionEvent(event: SessionEvent): void {`);
  lines.push(`  if (event.type === "assistant.message") {`);
  lines.push(`    const data = (event as any).data;`);
  lines.push(`    console.error(typeof data?.content === "string" ? data.content : JSON.stringify(data));`);
  lines.push(`  }`);
  lines.push(`  if (event.type === "session.error") {`);
  lines.push(`    console.error("[session.error]", JSON.stringify((event as any).data ?? event));`);
  lines.push(`  }`);
  if (shouldBroadcast) {
    lines.push(`  if (event.type.startsWith("session.")) {`);
    lines.push(`    broadcastToAll(event.type, (event as any).data ?? event);`);
    lines.push(`  }`);
  }
  lines.push(`}`);
  return lines.join("\n");
}

function moduleLoaderBlock(projectRootDepth, manifestRel) {
  const ups = Array(projectRootDepth).fill('".."').join(", ");
  return [
    `const __filename = fileURLToPath(import.meta.url);`,
    `const __dirname = path.dirname(__filename);`,
    `const projectRoot = path.resolve(__dirname, ${ups});`,
    `const manifestRoot = path.resolve(projectRoot, ${jsString(manifestRel || ".")});`,
    `const requireFromHere = createRequire(import.meta.url);`,
    ``,
    `async function importUserModule(modulePath: string): Promise<any> {`,
    `  try {`,
    `    return await import(pathToFileURL(modulePath).href);`,
    `  } catch (importError) {`,
    `    try {`,
    `      return requireFromHere(modulePath);`,
    `    } catch {`,
    `      throw importError;`,
    `    }`,
    `  }`,
    `}`,
    ``,
    `function pickHandler(mod: any, label: string): (...args: any[]) => any {`,
    `  const handler = mod.default ?? mod.handler;`,
    `  if (typeof handler !== "function") throw new Error(\`AMP \${label} module must export default or handler function.\`);`,
    `  return handler;`,
    `}`,
    ``,
  ];
}

function emitLockfile(plan) {
  const lock = {
    ampVersion: plan.manifest.ampVersion || AMP_VERSION,
    frameworkVersion: FRAMEWORK_VERSION,
    sdkProtocolVersion: COPILOT_SDK_PROTOCOL_VERSION,
    generatedAt: new Date().toISOString(),
    sourceManifest: inferSourceManifest(plan),
    language: "typescript",
  };
  emitFile(plan, "swe.amp.lock.json", JSON.stringify(lock, null, 2));
}

function inferSourceManifest(plan) {
  if (plan.manifestPath) return slash(path.relative(plan.outDir, plan.manifestPath));
  try {
    const candidates = fs.readdirSync(plan.manifestDir)
      .filter((name) => /(^|\.)(swe\.)?amp\.(ya?ml|json)$/i.test(name))
      .sort();
    if (candidates.length) return slash(path.relative(plan.outDir, path.join(plan.manifestDir, candidates[0])));
  } catch {
    // Fall through to manifest directory fallback.
  }
  return slash(path.relative(plan.outDir, plan.manifestDir) || ".");
}

function addSurfaceLogs(plan) {
  for (const surface of plan.surfaces || []) {
    addLogOnce(plan, `TypeScript generator wired ${surface.id} -> ${surface.sdkSurface}`);
  }
  addLogOnce(plan, `TypeScript generator emitted ${plan.files.length} file(s).`);
}

function emitFile(plan, relPath, contents, opts = {}) {
  const normalized = slash(relPath);
  const finalContents = contents.endsWith("\n") ? contents : `${contents}\n`;
  const existing = plan.files.find((file) => slash(file.relPath) === normalized);
  if (existing) {
    existing.contents = finalContents;
    Object.assign(existing, opts);
    return;
  }
  addFile(plan, normalized, finalContents, opts);
}

function addLogOnce(plan, message) {
  if (!plan.postActions.some((action) => action.kind === "log" && action.message === message)) addLog(plan, message);
}

function createIdentifierMap(items, prefix) {
  const used = new Set();
  const map = new Map();
  for (const item of items) {
    const raw = item.name || String(item);
    const base = toIdentifier(`${prefix}_${raw}`);
    let candidate = base;
    let counter = 2;
    while (used.has(candidate)) candidate = `${base}_${counter++}`;
    used.add(candidate);
    map.set(raw, candidate);
  }
  return map;
}

function toIdentifier(value) {
  let out = String(value).replace(/[^A-Za-z0-9_$]/g, "_");
  if (!/^[A-Za-z_$]/.test(out)) out = `_${out}`;
  return out;
}

function sanitizePathSegment(value) {
  return String(value).trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
}

function jsString(value) {
  return JSON.stringify(String(value));
}

function inlineCode(value, indent) {
  return JSON.stringify(value, null, 2).replace(/\n/g, `\n${" ".repeat(indent)}`);
}

function formatInlineJson(value, indent) {
  return inlineCode(value, indent);
}

function indentBlock(text, spaces) {
  const prefix = " ".repeat(spaces);
  return String(text).split("\n").map((line) => (line ? prefix + line : line)).join("\n");
}

function slash(value) {
  return String(value).replace(/\\/g, "/");
}

function escapeMarkdown(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function isPromptPath(value) {
  return typeof value === "string" && (/^\.{1,2}[\\/]/.test(value) || value.endsWith(".md"));
}

function isPathLike(value) {
  return typeof value === "string" && (/^\.{1,2}[\\/]/.test(value) || /[\\/]/.test(value) || /\.(md|txt)$/i.test(value));
}

module.exports = { generate, language: "typescript" };