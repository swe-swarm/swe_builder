/*---------------------------------------------------------------------------------------------
 *  Go generator.
 *  Emits a runnable copilot-sdk Go project from a normalized AMP manifest.
 *--------------------------------------------------------------------------------------------*/

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { addFile, addLog } = require("../planner");
const { COPILOT_SDK_PROTOCOL_VERSION, FRAMEWORK_VERSION, SDK_PINS } = require("../version");

const GO_SDK_IMPORT = "github.com/github/copilot-sdk/go";
const JSONSCHEMA_GO_MODULE = "github.com/google/jsonschema-go";
const JSONSCHEMA_GO_VERSION = "v0.4.2";

async function generate(plan) {
  const manifest = plan.manifest;
  const agentName = manifest.agent.name;
  const modulePath = `agents/${sanitizeModulePathSegment(agentName)}`;
  const commandName = toSnake(agentName);
  const ext = manifest.extensions || {};
  const tools = ext.tools || [];
  const hasParamsSchema = tools.some((tool) => !!tool.paramsSchema);
  const ctx = {
    plan,
    manifest,
    modulePath,
    commandName,
    assetPaths: new Map(),
    readTextNeeded: false,
  };

  addFile(plan, "go.mod", renderGoMod(modulePath, hasParamsSchema));
  addFile(plan, ".gitignore", "bin/\n*.exe\n.env\n");
  addFile(plan, ".env.example", renderEnvExample(manifest));
  addFile(plan, "README.md", renderReadme(plan, modulePath, commandName));

  emitTools(ctx);
  emitPermissions(ctx);
  emitHooks(ctx);
  emitLifecycle(ctx);
  emitUserInput(ctx);
  emitCommands(ctx);
  emitInlineSkills(ctx);
  emitSessionFs(ctx);
  emitHandoff(ctx);

  addFile(plan, path.join("cmd", commandName, "main.go"), renderMain(ctx));
  addFile(plan, "swe.amp.lock.json", renderLock(plan));

  for (const surface of plan.surfaces) {
    addLog(plan, `go: wired ${surface.id} (${surface.ampField}) to ${surface.sdkSurface}`);
  }
  addLog(plan, `go: generated ${agentName} in ${plan.outDir}`);
}

function renderGoMod(modulePath, hasParamsSchema) {
  const requires = [[GO_SDK_IMPORT, SDK_PINS.go[GO_SDK_IMPORT]]];
  if (hasParamsSchema) requires.push([JSONSCHEMA_GO_MODULE, JSONSCHEMA_GO_VERSION]);

  const lines = [`module ${modulePath}`, "", "go 1.22", "", "require ("];
  for (const [name, version] of requires) {
    lines.push(`\t${name} ${version}`);
  }
  lines.push(")", "");
  return lines.join("\n");
}

function renderEnvExample(manifest) {
  const env = (manifest.deployment && manifest.deployment.env) || {};
  const keys = Object.keys(env).sort();
  if (keys.length === 0) {
    return "# Add deployment environment variables here.\n";
  }
  return keys.map((key) => `${key}=${env[key] == null ? "" : String(env[key])}`).join("\n") + "\n";
}

function renderReadme(plan, modulePath, commandName) {
  const manifest = plan.manifest;
  const surfaces = plan.surfaces.length
    ? plan.surfaces
    : [{ id: "none", ampField: "-", sdkSurface: "-", description: "No optional AMP surfaces configured." }];
  const lines = [];
  lines.push(`# ${manifest.agent.displayName || manifest.agent.name}`);
  lines.push("");
  if (manifest.agent.description) lines.push(manifest.agent.description, "");
  lines.push("Generated Go agent for the GitHub Copilot SDK.");
  lines.push("");
  lines.push("## Quickstart");
  lines.push("");
  lines.push("```bash");
  lines.push("go mod download");
  lines.push(`go run ./cmd/${commandName} "Hello from AMP"`);
  lines.push("```");
  lines.push("");
  lines.push("If no command-line prompt is supplied, set `AMP_INITIAL_PROMPT` or leave the process running for inbox/signaled operation.");
  lines.push("");
  lines.push("## Module");
  lines.push("");
  lines.push(`- Go module: \`${modulePath}\``);
  lines.push(`- Copilot SDK: \`${GO_SDK_IMPORT} ${SDK_PINS.go[GO_SDK_IMPORT]}\``);
  lines.push("");
  lines.push("## Surfaces");
  lines.push("");
  lines.push("| Surface | AMP field | Go SDK surface | Description |");
  lines.push("| --- | --- | --- | --- |");
  for (const surface of surfaces) {
    lines.push(`| ${md(surface.id)} | ${md(surface.ampField)} | ${md(surface.sdkSurface)} | ${md(surface.description)} |`);
  }
  lines.push("");
  lines.push("## Go SDK notes");
  lines.push("");
  lines.push("- Go client options use `CLIUrl` and `SessionIdleTimeoutSeconds`.");
  lines.push("- The current Go SDK exposes model name/reasoning effort as `SessionConfig.Model` and `SessionConfig.ReasoningEffort` rather than a nested model config.");
  lines.push("- The current Go SDK exposes MCP servers as `map[string]copilot.MCPServerConfig`; `sse` manifests are emitted with the HTTP MCP config type.");
  lines.push("- The current Go SDK enables elicitation by registering `OnElicitationRequest`.");
  lines.push("");
  return lines.join("\n");
}

function md(value) {
  return String(value == null ? "" : value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderLock(plan) {
  const manifestJson = stableStringify(plan.manifest);
  const lock = {
    ampVersion: plan.manifest.ampVersion,
    frameworkVersion: FRAMEWORK_VERSION,
    copilotSdkProtocolVersion: COPILOT_SDK_PROTOCOL_VERSION,
    language: "go",
    agent: {
      name: plan.manifest.agent.name,
      version: plan.manifest.agent.version,
      language: "go",
    },
    sdkPins: SDK_PINS.go,
    manifestHash: `sha256-${crypto.createHash("sha256").update(manifestJson).digest("hex")}`,
    surfaces: plan.surfaces.map((surface) => ({
      id: surface.id,
      ampField: surface.ampField,
      sdkSurface: surface.sdkSurface,
    })),
  };
  return JSON.stringify(lock, null, 2) + "\n";
}

function emitTools(ctx) {
  const tools = ctx.manifest.extensions.tools || [];
  if (tools.length === 0) return;

  const registryEntries = [];
  const usedTypeNames = new Set();
  const usedFunctionNames = new Set();
  let needsMemoryStore = false;
  let needsMemoryHelpers = false;

  for (const tool of tools) {
    const baseName = toPascal(tool.name);
    const typeName = uniqueName(`${baseName}Params`, usedTypeNames);
    const functionName = uniqueName(`${baseName}Tool`, usedFunctionNames);
    registryEntries.push(functionName);

    const stubKind = tool.stub && tool.stub.kind;
    if (["memoryRead", "memoryWrite", "memoryList"].includes(stubKind)) {
      needsMemoryStore = true;
      needsMemoryHelpers = true;
    }

    addFile(ctx.plan, path.join("tools", `${toSnake(tool.name)}.go`), renderToolFile(ctx, tool, typeName, functionName));
  }

  if (needsMemoryHelpers) {
    addFile(ctx.plan, path.join("tools", "memory_helpers.go"), renderToolMemoryHelpers());
  }

  if (needsMemoryStore) {
    addFile(ctx.plan, path.join("internal", "memstore", "store.go"), renderMemstore());
  }

  addFile(ctx.plan, path.join("tools", "tools.go"), goFile("tools", [
    [`copilot "${GO_SDK_IMPORT}"`],
  ], `func All() []copilot.Tool {
\treturn []copilot.Tool{
${registryEntries.map((name) => `\t\t${name}(),`).join("\n")}
\t}
}`));
}

function renderToolFile(ctx, tool, typeName, functionName) {
  const stubKind = tool.stub && tool.stub.kind;
  const stdImports = [];
  const localImports = [];
  if (stubKind === "echo") stdImports.push('"encoding/json"');
  if (stubKind && stubKind.startsWith("memory")) localImports.push(`"${ctx.modulePath}/internal/memstore"`);
  if (!tool.stub && tool.handler) stdImports.push('"fmt"');
  if (!tool.stub && !tool.handler) stdImports.push('"fmt"');

  const paramsStruct = renderParamsType(ctx, tool, typeName);
  const body = `${paramsStruct}

func ${functionName}() copilot.Tool {
\ttool := copilot.DefineTool[${typeName}, any](${goString(tool.name)}, ${goString(tool.description)}, func(params ${typeName}, invocation copilot.ToolInvocation) (any, error) {
${renderToolHandlerBody(tool, stubKind)}
\t})
${tool.skipPermission ? "\ttool.SkipPermission = true\n" : ""}${tool.overridesBuiltIn ? "\ttool.OverridesBuiltInTool = true\n" : ""}\treturn tool
}`;
  return goFile("tools", [stdImports, [`copilot "${GO_SDK_IMPORT}"`], localImports], body);
}

function renderParamsType(ctx, tool, typeName) {
  const schema = loadParamsSchema(ctx, tool.paramsSchema);
  if (!schema || schema.type !== "object" || !schema.properties || Object.keys(schema.properties).length === 0) {
    return `type ${typeName} struct {\n}`;
  }

  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const usedFieldNames = new Set();
  const fields = Object.keys(schema.properties).sort().map((key) => {
    const prop = schema.properties[key] || {};
    return {
      name: uniqueName(toGoFieldName(key), usedFieldNames),
      type: schemaTypeToGo(prop),
      tag: `json:${goString(required.has(key) ? key : `${key},omitempty`)}`,
    };
  });
  const maxNameLength = fields.reduce((max, field) => Math.max(max, field.name.length), 0);
  const maxTypeLength = fields.reduce((max, field) => Math.max(max, field.type.length), 0);
  const lines = [`type ${typeName} struct {`];
  for (const field of fields) {
    lines.push(`\t${field.name}${" ".repeat(maxNameLength - field.name.length + 1)}${field.type}${" ".repeat(maxTypeLength - field.type.length + 1)}\`${field.tag}\``);
  }
  lines.push("}");
  return lines.join("\n");
}

function loadParamsSchema(ctx, paramsSchema) {
  if (!paramsSchema) return null;
  if (typeof paramsSchema === "object") return paramsSchema;
  if (typeof paramsSchema !== "string") return null;
  const resolved = path.resolve(ctx.plan.manifestDir, paramsSchema);
  if (!fs.existsSync(resolved)) return null;
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    return null;
  }
}

function schemaTypeToGo(schema) {
  if (!schema || typeof schema !== "object") return "any";
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  if (schema.enum && (!type || type === "string")) return "string";
  switch (type) {
    case "string": return "string";
    case "integer": return "int";
    case "number": return "float64";
    case "boolean": return "bool";
    case "array": return `[]${schemaTypeToGo(schema.items || {})}`;
    case "object": return "map[string]any";
    default: return "any";
  }
}

function renderToolHandlerBody(tool, stubKind) {
  if (stubKind === "static") {
    return `\t\treturn ${goAnyLiteral(tool.stub.value)}, nil`;
  }
  if (stubKind === "echo") {
    return `\t\tpayload, err := json.Marshal(params)
\t\tif err != nil {
\t\t\treturn nil, err
\t\t}
\t\treturn string(payload), nil`;
  }
  if (stubKind === "memoryRead") {
    return `\t\targs, err := paramsToMap(params)
\t\tif err != nil {
\t\t\treturn nil, err
\t\t}
\t\tkey, err := requiredString(args, "key")
\t\tif err != nil {
\t\t\treturn nil, err
\t\t}
\t\tvalue, ok := memstore.Read(key)
\t\tif !ok {
\t\t\treturn "", nil
\t\t}
\t\treturn value, nil`;
  }
  if (stubKind === "memoryWrite") {
    return `\t\targs, err := paramsToMap(params)
\t\tif err != nil {
\t\t\treturn nil, err
\t\t}
\t\tkey, err := requiredString(args, "key")
\t\tif err != nil {
\t\t\treturn nil, err
\t\t}
\t\tmemstore.Write(key, stringifyValue(args["value"]))
\t\treturn "OK", nil`;
  }
  if (stubKind === "memoryList") {
    return "\t\treturn memstore.List(), nil";
  }
  if (tool.handler) {
    return `\t\treturn nil, fmt.Errorf("TODO: implement handler from ${escapeForGoString(tool.handler)}")`;
  }
  return "\t\treturn nil, fmt.Errorf(\"TODO: implement tool handler\")";
}

function renderToolMemoryHelpers() {
  return goFile("tools", [["\"encoding/json\"", "\"fmt\""]], `func paramsToMap(params any) (map[string]any, error) {
\tpayload, err := json.Marshal(params)
\tif err != nil {
\t\treturn nil, err
\t}
\tvar out map[string]any
\tif err := json.Unmarshal(payload, &out); err != nil {
\t\treturn nil, err
\t}
\treturn out, nil
}

func requiredString(values map[string]any, key string) (string, error) {
\tvalue, ok := values[key].(string)
\tif !ok || value == "" {
\t\treturn "", fmt.Errorf("%s is required", key)
\t}
\treturn value, nil
}

func stringifyValue(value any) string {
\tif value == nil {
\t\treturn ""
\t}
\tif text, ok := value.(string); ok {
\t\treturn text
\t}
\tpayload, err := json.Marshal(value)
\tif err != nil {
\t\treturn fmt.Sprint(value)
\t}
\treturn string(payload)
}`);
}

function renderMemstore() {
  return goFile("memstore", [["\"sync\""]], `var values sync.Map

func Read(key string) (string, bool) {
\tvalue, ok := values.Load(key)
\tif !ok {
\t\treturn "", false
\t}
\ttext, ok := value.(string)
\treturn text, ok
}

func Write(key string, value string) {
\tvalues.Store(key, value)
}

func List() map[string]string {
\tout := map[string]string{}
\tvalues.Range(func(key any, value any) bool {
\t\tkeyText, keyOK := key.(string)
\t\tvalueText, valueOK := value.(string)
\t\tif keyOK && valueOK {
\t\t\tout[keyText] = valueText
\t\t}
\t\treturn true
\t})
\treturn out
}`);
}

function emitPermissions(ctx) {
  const mode = ((ctx.manifest.extensions.permissions || {}).mode || "custom");
  if (mode !== "allowList" && mode !== "custom") return;
  const permissions = ctx.manifest.extensions.permissions || {};
  const rules = permissions.autoApprove || [];
  addFile(ctx.plan, path.join("permissions", "permissions.go"), renderPermissionsFile(mode, rules, permissions.handler));
}

function renderPermissionsFile(mode, rules, handlerPath) {
  if (mode === "allowList") {
    const ruleLines = rules.map((rule) => `\t{Tool: ${goString(rule.tool)}, ArgsContains: ${goString(rule.argsContains || "")}},`).join("\n");
    return goFile("permissions", [["\"encoding/json\"", "\"strings\""], [`copilot "${GO_SDK_IMPORT}"`]], `type allowRule struct {
\tTool         string
\tArgsContains string
}

var autoApproveRules = []allowRule{
${ruleLines}
}

func Handler(request copilot.PermissionRequest, invocation copilot.PermissionInvocation) (copilot.PermissionRequestResult, error) {
\ttoolName := permissionToolName(request)
\targs := permissionArgs(request)
\tfor _, rule := range autoApproveRules {
\t\tif matchesTool(rule.Tool, toolName) && (rule.ArgsContains == "" || strings.Contains(args, rule.ArgsContains)) {
\t\t\treturn copilot.PermissionRequestResult{Kind: copilot.PermissionRequestResultKindApproved}, nil
\t\t}
\t}
\treturn copilot.PermissionRequestResult{Kind: copilot.PermissionRequestResultKindRejected}, nil
}

func permissionToolName(request copilot.PermissionRequest) string {
\tif request.ToolName != nil && *request.ToolName != "" {
\t\treturn *request.ToolName
\t}
\treturn string(request.Kind)
}

func permissionArgs(request copilot.PermissionRequest) string {
\tpayload, err := json.Marshal(request.Args)
\tif err != nil || string(payload) == "null" {
\t\tpayload, _ = json.Marshal(request.ToolArgs)
\t}
\treturn string(payload)
}

func matchesTool(pattern string, toolName string) bool {
\tif pattern == "*" || pattern == toolName {
\t\treturn true
\t}
\tif strings.HasSuffix(pattern, "*") {
\t\treturn strings.HasPrefix(toolName, strings.TrimSuffix(pattern, "*"))
\t}
\treturn false
}`);
  }

  const todo = handlerPath
    ? `// TODO: port custom permission handler from ${handlerPath}.`
    : "// TODO: implement a custom permission policy.";
  return goFile("permissions", [[`copilot "${GO_SDK_IMPORT}"`]], `${todo}
func Handler(request copilot.PermissionRequest, invocation copilot.PermissionInvocation) (copilot.PermissionRequestResult, error) {
\treturn copilot.PermissionRequestResult{Kind: copilot.PermissionRequestResultKindUserNotAvailable}, nil
}`);
}

function emitHooks(ctx) {
  const hooks = ctx.manifest.extensions.hooks || null;
  if (!hooks || Object.keys(hooks).length === 0) return;
  for (const key of Object.keys(hooks).sort()) {
    addFile(ctx.plan, path.join("hooks", `${toSnake(key)}.go`), renderHookFile(key, hooks[key]));
  }
}

function renderHookFile(key, handlerPath) {
  const meta = {
    preToolUse: ["PreToolUse", "PreToolUseHookInput", "PreToolUseHookOutput", "&copilot.PreToolUseHookOutput{PermissionDecision: \"allow\"}"],
    postToolUse: ["PostToolUse", "PostToolUseHookInput", "PostToolUseHookOutput", "nil"],
    userPromptSubmitted: ["UserPromptSubmitted", "UserPromptSubmittedHookInput", "UserPromptSubmittedHookOutput", "nil"],
    sessionStart: ["SessionStart", "SessionStartHookInput", "SessionStartHookOutput", "nil"],
    sessionEnd: ["SessionEnd", "SessionEndHookInput", "SessionEndHookOutput", "nil"],
    errorOccurred: ["ErrorOccurred", "ErrorOccurredHookInput", "ErrorOccurredHookOutput", "nil"],
  }[key];
  if (!meta) return goFile("hooks", [[`copilot "${GO_SDK_IMPORT}"`]], "");
  const [funcName, inputType, outputType, result] = meta;
  const todo = handlerPath ? `// TODO: port hook handler from ${handlerPath}.\n` : "";
  return goFile("hooks", [[`copilot "${GO_SDK_IMPORT}"`]], `${todo}func ${funcName}(input copilot.${inputType}, invocation copilot.HookInvocation) (*copilot.${outputType}, error) {
\treturn ${result}, nil
}`);
}

function emitLifecycle(ctx) {
  const lifecycle = ctx.manifest.extensions.lifecycle || null;
  if (!lifecycle) return;
  const todo = lifecycle.handler ? `// TODO: port lifecycle handler from ${lifecycle.handler}.\n` : "";
  addFile(ctx.plan, path.join("lifecycle", "handler.go"), goFile("lifecycle", [["\"log\""], [`copilot "${GO_SDK_IMPORT}"`]], `${todo}func Handle(event copilot.SessionLifecycleEvent) {
\tlog.Printf("lifecycle %s: %s", event.Type, event.SessionID)
}`));
}

function emitUserInput(ctx) {
  const userInput = ctx.manifest.extensions.userInput || null;
  if (!userInput) return;
  const todo = userInput.handler ? `// TODO: port user input handler from ${userInput.handler}.\n` : "";
  addFile(ctx.plan, path.join("userinput", "handler.go"), goFile("userinput", [[`copilot "${GO_SDK_IMPORT}"`]], `${todo}func Handle(request copilot.UserInputRequest, invocation copilot.UserInputInvocation) (copilot.UserInputResponse, error) {
\tif len(request.Choices) > 0 {
\t\treturn copilot.UserInputResponse{Answer: request.Choices[0]}, nil
\t}
\treturn copilot.UserInputResponse{Answer: "", WasFreeform: true}, nil
}`));
}

function emitCommands(ctx) {
  const commands = ctx.manifest.extensions.commands || [];
  if (commands.length === 0) return;
  const used = new Set();
  const entries = [];
  for (const command of commands) {
    const functionName = uniqueName(toPascal(command.name), used);
    entries.push({ command, functionName });
    addFile(ctx.plan, path.join("commands", `${toSnake(command.name)}.go`), renderCommandFile(command, functionName));
  }
  const defs = entries.map(({ command, functionName }) => `\t\t{Name: ${goString(command.name)}, Description: ${goString(command.description)}, Handler: ${functionName}},`).join("\n");
  addFile(ctx.plan, path.join("commands", "commands.go"), goFile("commands", [[`copilot "${GO_SDK_IMPORT}"`]], `func All() []copilot.CommandDefinition {
\treturn []copilot.CommandDefinition{
${defs}
\t}
}`));
}

function renderCommandFile(command, functionName) {
  const notes = [];
  if (command.argsHint) notes.push(`// Args hint: ${command.argsHint}`);
  if (command.handler) notes.push(`// TODO: port command handler from ${command.handler}.`);
  const prefix = notes.length ? notes.join("\n") + "\n" : "";
  return goFile("commands", [[`copilot "${GO_SDK_IMPORT}"`]], `${prefix}func ${functionName}(ctx copilot.CommandContext) error {
\treturn nil
}`);
}

function emitInlineSkills(ctx) {
  const skills = (ctx.manifest.extensions.skills && ctx.manifest.extensions.skills.inline) || [];
  for (const skill of skills) {
    const instructions = readInlineOrFile(ctx, skill.instructions);
    const contents = [
      "---",
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      "---",
      "",
      `# ${skill.name}`,
      "",
      instructions.trimEnd(),
      "",
    ].join("\n");
    addFile(ctx.plan, path.join("skills", sanitizeFileName(skill.name), "SKILL.md"), contents);
  }
}

function emitSessionFs(ctx) {
  const sessionFs = ctx.manifest.extensions.sessionFs || null;
  if (!sessionFs || sessionFs.provider !== "memory") return;
  addFile(ctx.plan, path.join("sessionfs", "memory.go"), renderMemorySessionFs());
}

function renderMemorySessionFs() {
  return goFile("sessionfs", [["\"errors\"", "\"os\"", "\"path\"", "\"sort\"", "\"strings\"", "\"sync\"", "\"time\""], [`copilot "${GO_SDK_IMPORT}"`, `"${GO_SDK_IMPORT}/rpc"`]], `type entry struct {
\tcontent string
\tisDir   bool
\tmode    os.FileMode
\tmtime   time.Time
}

type MemoryProvider struct {
\tsessionID string
\tentries   sync.Map
}

func Config() *copilot.SessionFsConfig {
\treturn &copilot.SessionFsConfig{
\t\tInitialCwd:       "/",
\t\tSessionStatePath: "/session-state",
\t\tConventions:      rpc.SessionFSSetProviderConventionsPosix,
\t}
}

func NewMemoryProvider(sessionID string) *MemoryProvider {
\tprovider := &MemoryProvider{sessionID: sessionID}
\tprovider.entries.Store("/", entry{isDir: true, mode: 0o755, mtime: time.Now().UTC()})
\treturn provider
}

func (p *MemoryProvider) ReadFile(name string) (string, error) {
\tvalue, ok := p.entries.Load(clean(name))
\tif !ok {
\t\treturn "", os.ErrNotExist
\t}
\tentry := value.(entry)
\tif entry.isDir {
\t\treturn "", errors.New("path is a directory")
\t}
\treturn entry.content, nil
}

func (p *MemoryProvider) WriteFile(name string, content string, mode *int) error {
\tfilePath := clean(name)
\tp.ensureParents(filePath)
\tp.entries.Store(filePath, entry{content: content, mode: fileMode(mode, 0o666), mtime: time.Now().UTC()})
\treturn nil
}

func (p *MemoryProvider) AppendFile(name string, content string, mode *int) error {
\texisting, err := p.ReadFile(name)
\tif err != nil && !errors.Is(err, os.ErrNotExist) {
\t\treturn err
\t}
\treturn p.WriteFile(name, existing+content, mode)
}

func (p *MemoryProvider) Exists(name string) (bool, error) {
\t_, ok := p.entries.Load(clean(name))
\treturn ok, nil
}

func (p *MemoryProvider) Stat(name string) (*copilot.SessionFsFileInfo, error) {
\tvalue, ok := p.entries.Load(clean(name))
\tif !ok {
\t\treturn nil, os.ErrNotExist
\t}
\tentry := value.(entry)
\treturn &copilot.SessionFsFileInfo{
\t\tIsFile:      !entry.isDir,
\t\tIsDirectory: entry.isDir,
\t\tSize:        int64(len(entry.content)),
\t\tMtime:       entry.mtime,
\t\tBirthtime:   entry.mtime,
\t}, nil
}

func (p *MemoryProvider) Mkdir(name string, recursive bool, mode *int) error {
\tdirPath := clean(name)
\tif recursive {
\t\tp.ensureParents(path.Join(dirPath, "child"))
\t\treturn nil
\t}
\tparent := path.Dir(dirPath)
\tif _, ok := p.entries.Load(parent); !ok {
\t\treturn os.ErrNotExist
\t}
\tp.entries.Store(dirPath, entry{isDir: true, mode: fileMode(mode, 0o777), mtime: time.Now().UTC()})
\treturn nil
}

func (p *MemoryProvider) Readdir(name string) ([]string, error) {
\tentries, err := p.ReaddirWithTypes(name)
\tif err != nil {
\t\treturn nil, err
\t}
\tnames := make([]string, 0, len(entries))
\tfor _, entry := range entries {
\t\tnames = append(names, entry.Name)
\t}
\treturn names, nil
}

func (p *MemoryProvider) ReaddirWithTypes(name string) ([]rpc.SessionFSReaddirWithTypesEntry, error) {
\tdirPath := clean(name)
\tvalue, ok := p.entries.Load(dirPath)
\tif !ok {
\t\treturn nil, os.ErrNotExist
\t}
\tif !value.(entry).isDir {
\t\treturn nil, errors.New("path is not a directory")
\t}
\tseen := map[string]rpc.SessionFSReaddirWithTypesEntry{}
\tp.entries.Range(func(key any, value any) bool {
\t\tchildPath := key.(string)
\t\tif childPath == dirPath || path.Dir(childPath) != dirPath {
\t\t\treturn true
\t\t}
\t\tchild := value.(entry)
\t\tentryType := rpc.SessionFSReaddirWithTypesEntryTypeFile
\t\tif child.isDir {
\t\t\tentryType = rpc.SessionFSReaddirWithTypesEntryTypeDirectory
\t\t}
\t\tseen[path.Base(childPath)] = rpc.SessionFSReaddirWithTypesEntry{Name: path.Base(childPath), Type: entryType}
\t\treturn true
\t})
\tnames := make([]string, 0, len(seen))
\tfor name := range seen {
\t\tnames = append(names, name)
\t}
\tsort.Strings(names)
\tresult := make([]rpc.SessionFSReaddirWithTypesEntry, 0, len(names))
\tfor _, name := range names {
\t\tresult = append(result, seen[name])
\t}
\treturn result, nil
}

func (p *MemoryProvider) Rm(name string, recursive bool, force bool) error {
\ttarget := clean(name)
\tif _, ok := p.entries.Load(target); !ok {
\t\tif force {
\t\t\treturn nil
\t\t}
\t\treturn os.ErrNotExist
\t}
\tif recursive {
\t\tp.entries.Range(func(key any, value any) bool {
\t\t\tchildPath := key.(string)
\t\t\tif childPath == target || strings.HasPrefix(childPath, target+"/") {
\t\t\t\tp.entries.Delete(childPath)
\t\t\t}
\t\t\treturn true
\t\t})
\t\treturn nil
\t}
\tp.entries.Delete(target)
\treturn nil
}

func (p *MemoryProvider) Rename(src string, dest string) error {
\tsource := clean(src)
\ttarget := clean(dest)
\tvalue, ok := p.entries.Load(source)
\tif !ok {
\t\treturn os.ErrNotExist
\t}
\tp.ensureParents(target)
\tp.entries.Store(target, value)
\tp.entries.Delete(source)
\treturn nil
}

func (p *MemoryProvider) ensureParents(name string) {
\tdirs := []string{}
\tfor dir := path.Dir(name); dir != "." && dir != "/"; dir = path.Dir(dir) {
\t\tdirs = append(dirs, dir)
\t}
\tp.entries.Store("/", entry{isDir: true, mode: 0o755, mtime: time.Now().UTC()})
\tfor i := len(dirs) - 1; i >= 0; i-- {
\t\tp.entries.Store(dirs[i], entry{isDir: true, mode: 0o755, mtime: time.Now().UTC()})
\t}
}

func clean(name string) string {
\tif name == "" {
\t\treturn "/"
\t}
\tcleaned := path.Clean("/" + strings.TrimPrefix(name, "/"))
\tif cleaned == "." {
\t\treturn "/"
\t}
\treturn cleaned
}

func fileMode(mode *int, fallback os.FileMode) os.FileMode {
\tif mode == nil {
\t\treturn fallback
\t}
\treturn os.FileMode(*mode)
}`);
}

function emitHandoff(ctx) {
  const handoff = (ctx.manifest.communication && ctx.manifest.communication.handoff) || [];
  if (handoff.length === 0) return;
  addFile(ctx.plan, path.join("comms", "handoff.go"), renderHandoff(handoff));
}

function renderHandoff(handoff) {
  const entries = handoff.map((target) => {
    const fields = [
      ["Name", goString(target.name)],
      ["Description", goString(target.description || "")],
      ["Transport", goString(target.transport || "")],
      ["Endpoint", goString(target.endpoint || "")],
    ];
    return `\t${goString(target.name)}: {\n${renderStructFields(fields, 2)}\n\t},`;
  }).join("\n");
  return goFile("comms", [["\"bytes\"", "\"encoding/json\"", "\"fmt\"", "\"net/http\"", "\"os\""]], `type HandoffTarget struct {
\tName        string
\tDescription string
\tTransport   string
\tEndpoint    string
}

var HandoffTargets = map[string]HandoffTarget{
${entries}
}

func Handoff(name string, payload any) error {
\ttarget, ok := HandoffTargets[name]
\tif !ok {
\t\treturn fmt.Errorf("unknown handoff target %q", name)
\t}
\tdata, err := json.Marshal(payload)
\tif err != nil {
\t\treturn err
\t}
\tswitch target.Transport {
\tcase "http":
\t\tresp, err := http.Post(target.Endpoint, "application/json", bytes.NewReader(data))
\t\tif err != nil {
\t\t\treturn err
\t\t}
\t\tdefer resp.Body.Close()
\t\tif resp.StatusCode >= 300 {
\t\t\treturn fmt.Errorf("handoff %s returned %s", name, resp.Status)
\t\t}
\t\treturn nil
\tcase "inbox":
\t\tfile, err := os.OpenFile(target.Endpoint, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o666)
\t\tif err != nil {
\t\t\treturn err
\t\t}
\t\tdefer file.Close()
\t\t_, err = file.Write(append(data, '\\n'))
\t\treturn err
\tcase "stdio":
\t\t_, err := os.Stdout.Write(append(data, '\\n'))
\t\treturn err
\tdefault:
\t\treturn fmt.Errorf("unsupported handoff transport %q", target.Transport)
\t}
}`);
}

function renderMain(ctx) {
  const manifest = ctx.manifest;
  const ext = manifest.extensions || {};
  const runtime = manifest.runtime || {};
  const communication = manifest.communication || null;
  const broadcastEnabled = !!(communication && communication.broadcast && communication.broadcast.transport === "stdout-jsonl");
  const inboxEnabled = !!(communication && communication.inbox && communication.inbox.enabled && communication.inbox.path);
  const imports = buildMainImports(ctx, { broadcastEnabled, inboxEnabled });
  const body = [
    renderMainFunction(ctx, { broadcastEnabled, inboxEnabled }),
    renderBuildClientOptions(ctx),
    renderBuildSessionConfig(ctx),
  ];

  if ((ext.mcpServers || []).length > 0) body.push(renderBuildMCPServers(ctx));
  if ((ext.customAgents || []).some((agent) => (agent.mcpServers || []).length > 0)) body.push(renderSelectMCPServers());
  if (ext.hooks && Object.keys(ext.hooks).length > 0) body.push(renderBuildHooks(ext.hooks));
  if (ext.systemMessage) body.push(renderBuildSystemMessage(ctx));
  if (ctx.readTextNeeded) body.push(renderReadText());
  if (runtime.ui && runtime.ui.elicitation) body.push(renderElicitationHandler());
  body.push(renderInitialPrompt());
  body.push(renderDenyAllPermissions());
  if (broadcastEnabled) body.push(renderBroadcast(communication));
  if (inboxEnabled) body.push(renderInboxPoller(communication.inbox.path));

  return goFile("main", imports, body.filter(Boolean).join("\n\n"));
}

function buildMainImports(ctx, flags) {
  const std = ["\"context\"", "\"fmt\"", "\"log\"", "\"os\"", "\"os/signal\"", "\"syscall\""];
  if (flags.broadcastEnabled || flags.inboxEnabled) std.unshift("\"encoding/json\"");
  if (flags.inboxEnabled) std.unshift("\"bufio\"", "\"io\"", "\"strings\"");
  if (flags.broadcastEnabled || flags.inboxEnabled) std.push("\"time\"");

  const local = [];
  const ext = ctx.manifest.extensions || {};
  if ((ext.tools || []).length > 0) local.push(`"${ctx.modulePath}/tools"`);
  const permissionMode = (ext.permissions && ext.permissions.mode) || "custom";
  if (permissionMode === "allowList" || permissionMode === "custom") local.push(`"${ctx.modulePath}/permissions"`);
  if (ext.hooks && Object.keys(ext.hooks).length > 0) local.push(`"${ctx.modulePath}/hooks"`);
  if (ext.lifecycle) local.push(`"${ctx.modulePath}/lifecycle"`);
  if (ext.userInput) local.push(`"${ctx.modulePath}/userinput"`);
  if ((ext.commands || []).length > 0) local.push(`"${ctx.modulePath}/commands"`);
  if (ext.sessionFs && ext.sessionFs.provider === "memory") local.push(`"${ctx.modulePath}/sessionfs"`);

  return [std, [`copilot "${GO_SDK_IMPORT}"`], local];
}

function renderMainFunction(ctx, flags) {
  const lifecycle = ctx.manifest.extensions.lifecycle;
  const inboxLine = flags.inboxEnabled ? `\n\tgo pollInbox(ctx, session, ${goString(ctx.manifest.communication.inbox.path)})` : "";
  const sendLine = `\tprompt := initialPrompt()
\tif prompt != "" {
\t\tif _, err := session.Send(ctx, copilot.MessageOptions{Prompt: prompt}); err != nil {
\t\t\tlog.Fatal(err)
\t\t}
\t}`;
  return `func main() {
\tctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
\tdefer cancel()

\topts := buildClientOptions()
\tclient := copilot.NewClient(opts)
${lifecycle ? "\tunsubscribeLifecycle := client.On(lifecycle.Handle)\n\tdefer unsubscribeLifecycle()\n" : ""}\tif err := client.Start(ctx); err != nil {
\t\tlog.Fatal(err)
\t}
\tdefer func() {
\t\tif err := client.Stop(); err != nil {
\t\t\tlog.Printf("failed to stop client: %v", err)
\t\t}
\t}()

\tsessionCfg, err := buildSessionConfig()
\tif err != nil {
\t\tlog.Fatal(err)
\t}
\tsession, err := client.CreateSession(ctx, sessionCfg)
\tif err != nil {
\t\tlog.Fatal(err)
\t}
\tdefer session.Disconnect()

\tunsubscribeEvents := session.On(func(event copilot.SessionEvent) {
\t\tswitch data := event.Data.(type) {
\t\tcase *copilot.AssistantMessageData:
\t\t\tlog.Printf("assistant.message: %s", data.Content)
${flags.broadcastEnabled ? "\t\t\tfor _, channel := range broadcastChannels {\n\t\t\t\tbroadcast(channel, \"assistant.message\", data)\n\t\t\t}\n" : ""}\t\tcase *copilot.SessionErrorData:
\t\t\tlog.Printf("session.error[%s]: %s", data.ErrorType, data.Message)
${flags.broadcastEnabled ? "\t\t\tfor _, channel := range broadcastChannels {\n\t\t\t\tbroadcast(channel, \"session.error\", data)\n\t\t\t}\n" : ""}\t\t}
\t})
\tdefer unsubscribeEvents()
${inboxLine}
${sendLine}

\t<-ctx.Done()
}`;
}

function renderBuildClientOptions(ctx) {
  const sdk = (ctx.manifest.runtime && ctx.manifest.runtime.copilotSdk) || {};
  const fields = [];
  const external = sdk.cliUrl && sdk.transport === "external";
  if (external) {
    fields.push(["CLIUrl", goString(sdk.cliUrl)]);
  } else {
    if (sdk.cliPath) fields.push(["CLIPath", goString(sdk.cliPath)]);
    if (sdk.transport === "stdio") fields.push(["UseStdio", "copilot.Bool(true)"]);
    if (sdk.transport === "tcp") fields.push(["UseStdio", "copilot.Bool(false)"]);
    if (sdk.gitHubTokenEnv) fields.push(["GitHubToken", `os.Getenv(${goString(sdk.gitHubTokenEnv)})`]);
    if (typeof sdk.useLoggedInUser === "boolean") fields.push(["UseLoggedInUser", `copilot.Bool(${sdk.useLoggedInUser})`]);
  }
  if (sdk.logLevel) fields.push(["LogLevel", goString(sdk.logLevel)]);
  if (sdk.sessionIdleTimeoutSec != null) fields.push(["SessionIdleTimeoutSeconds", String(sdk.sessionIdleTimeoutSec)]);
  const sessionFs = ctx.manifest.extensions.sessionFs || null;
  if (sessionFs && sessionFs.provider === "memory") fields.push(["SessionFs", "sessionfs.Config()"]);
  return `func buildClientOptions() *copilot.ClientOptions {
\treturn &copilot.ClientOptions{
${renderStructFields(fields, 2)}
\t}
}`;
}

function renderBuildSessionConfig(ctx) {
  const manifest = ctx.manifest;
  const ext = manifest.extensions || {};
  const runtime = manifest.runtime || {};
  const prelude = [];
  const fields = [];

  if ((ext.mcpServers || []).length > 0) prelude.push("\tmcpServers := buildMCPServers()");
  if ((ext.customAgents || []).length > 0) {
    const rendered = renderCustomAgents(ctx);
    prelude.push(...rendered.prelude);
    prelude.push(`\tcustomAgents := []copilot.CustomAgentConfig{
${rendered.entries.join("\n")}
\t}`);
  }
  if (ext.systemMessage) {
    prelude.push("\tsystemMessage, err := buildSystemMessage()");
    prelude.push("\tif err != nil {\n\t\treturn nil, err\n\t}");
  }

  fields.push(["ClientName", `fmt.Sprintf("amp/%s@%s", ${goString(manifest.agent.name)}, ${goString(manifest.agent.version || "0.1.0")})`]);
  if (runtime.model && runtime.model.name) fields.push(["Model", goString(runtime.model.name)]);
  if (runtime.model && runtime.model.reasoningEffort) fields.push(["ReasoningEffort", goString(runtime.model.reasoningEffort)]);
  if ((ext.tools || []).length > 0) fields.push(["Tools", "tools.All()"]);
  if ((ext.mcpServers || []).length > 0) fields.push(["MCPServers", "mcpServers"]);
  if ((ext.customAgents || []).length > 0) fields.push(["CustomAgents", "customAgents"]);
  if (ext.defaultAgent) fields.push(["DefaultAgent", renderDefaultAgent(ext.defaultAgent)]);
  if (ext.agent) fields.push(["Agent", goString(ext.agent)]);
  if (Array.isArray(ext.availableTools)) fields.push(["AvailableTools", stringSliceLiteral(ext.availableTools)]);
  if ((ext.excludedTools || []).length > 0) fields.push(["ExcludedTools", stringSliceLiteral(ext.excludedTools)]);
  if (ext.hooks && Object.keys(ext.hooks).length > 0) fields.push(["Hooks", "buildHooks()"]);
  fields.push(["OnPermissionRequest", renderPermissionHandlerExpr(ext.permissions || {})]);
  if (ext.userInput) fields.push(["OnUserInputRequest", "userinput.Handle"]);
  if (ext.systemMessage) fields.push(["SystemMessage", "systemMessage"]);
  const skillDirectories = renderSkillDirectories(ext.skills || {});
  if (skillDirectories.length > 0) fields.push(["SkillDirectories", stringSliceLiteral(skillDirectories)]);
  if (ext.skills && (ext.skills.disabled || []).length > 0) fields.push(["DisabledSkills", stringSliceLiteral(ext.skills.disabled)]);
  fields.push(["InfiniteSessions", `&copilot.InfiniteSessionConfig{Enabled: copilot.Bool(${!!runtime.infiniteSessions})}`]);
  if (runtime.workingDirectory) fields.push(["WorkingDirectory", goString(runtime.workingDirectory)]);
  fields.push(["Streaming", String(!!runtime.streaming)]);
  fields.push(["IncludeSubAgentStreamingEvents", `copilot.Bool(${!!runtime.includeSubAgentStreamingEvents})`]);
  if (runtime.provider) fields.push(["Provider", renderProvider(runtime.provider)]);
  if ((ext.commands || []).length > 0) fields.push(["Commands", "commands.All()"]);
  if (runtime.ui && runtime.ui.elicitation) fields.push(["OnElicitationRequest", "defaultElicitationHandler"]);
  if (ext.sessionFs && ext.sessionFs.provider === "memory") {
    fields.push(["CreateSessionFsHandler", `func(session *copilot.Session) copilot.SessionFsProvider {
\t\t\treturn sessionfs.NewMemoryProvider(session.SessionID)
\t\t}`]);
  }

  const preludeText = prelude.length > 0 ? `${prelude.join("\n")}\n` : "";
  return `func buildSessionConfig() (*copilot.SessionConfig, error) {
${preludeText}\tsessionCfg := &copilot.SessionConfig{
${renderStructFields(fields, 2)}
\t}
\treturn sessionCfg, nil
}`;
}

function renderPermissionHandlerExpr(permissions) {
  switch (permissions.mode || "custom") {
    case "approveAll":
      return "copilot.PermissionHandler.ApproveAll";
    case "denyAll":
      return "denyAllPermissions";
    case "allowList":
    case "custom":
    default:
      return "permissions.Handler";
  }
}

function renderSkillDirectories(skills) {
  const dirs = [...(skills.directories || [])];
  if ((skills.inline || []).length > 0 && !dirs.includes("skills")) dirs.push("skills");
  return dirs;
}

function renderDefaultAgent(defaultAgent) {
  const fields = [];
  if ((defaultAgent.excludedTools || []).length > 0) fields.push(["ExcludedTools", stringSliceLiteral(defaultAgent.excludedTools)]);
  return `&copilot.DefaultAgentConfig{
${renderStructFields(fields, 3)}
\t\t}`;
}

function renderProvider(provider) {
  const fields = [];
  if (provider.type) fields.push(["Type", goString(provider.type)]);
  if (provider.wireApi) fields.push(["WireApi", goString(provider.wireApi)]);
  const baseURL = provider.baseUrl || provider.baseURL || provider.BaseURL;
  if (baseURL) fields.push(["BaseURL", goString(baseURL)]);
  if (provider.apiKey) fields.push(["APIKey", goString(provider.apiKey)]);
  if (provider.bearerToken) fields.push(["BearerToken", goString(provider.bearerToken)]);
  if (provider.headers) fields.push(["Headers", stringMapLiteral(provider.headers)]);
  if (provider.azure && provider.azure.apiVersion) {
    fields.push(["Azure", `&copilot.AzureProviderOptions{APIVersion: ${goString(provider.azure.apiVersion)}}`]);
  }
  return `&copilot.ProviderConfig{
${renderStructFields(fields, 3)}
\t\t}`;
}

function renderCustomAgents(ctx) {
  const ext = ctx.manifest.extensions || {};
  const prelude = [];
  const entries = [];
  for (const [index, agent] of (ext.customAgents || []).entries()) {
    let promptExpr = goString(agent.systemPrompt || "");
    const promptPath = maybeAddAsset(ctx, agent.systemPrompt, "prompts", `${agent.name}-prompt`);
    if (promptPath) {
      const varName = `customAgentPrompt${index}`;
      prelude.push(`\t${varName}, err := readText(${goString(toSlash(promptPath))})`);
      prelude.push("\tif err != nil {\n\t\treturn nil, err\n\t}");
      promptExpr = varName;
      ctx.readTextNeeded = true;
    }
    const fields = [
      ["Name", goString(agent.name)],
      ["Description", goString(agent.description || "")],
      ["Prompt", promptExpr],
    ];
    if ((agent.tools || []).length > 0) fields.push(["Tools", stringSliceLiteral(agent.tools)]);
    if ((agent.mcpServers || []).length > 0) fields.push(["MCPServers", `selectMCPServers(mcpServers, ${stringSliceLiteral(agent.mcpServers)})`]);
    entries.push(`\t\t{
${renderStructFields(fields, 3)}
\t\t},`);
  }
  return { prelude, entries };
}

function renderBuildMCPServers(ctx) {
  const servers = ctx.manifest.extensions.mcpServers || [];
  const entries = servers.map((server) => `\t\t${goString(server.name)}: ${renderMCPServerConfig(server)},`).join("\n");
  return `func buildMCPServers() map[string]copilot.MCPServerConfig {
\treturn map[string]copilot.MCPServerConfig{
${entries}
\t}
}`;
}

function renderMCPServerConfig(server) {
  if (server.type === "stdio") {
    const fields = [["Command", goString(server.command || "")]];
    if ((server.args || []).length > 0) fields.push(["Args", stringSliceLiteral(server.args)]);
    if (server.env && Object.keys(server.env).length > 0) fields.push(["Env", stringMapLiteral(server.env)]);
    if ((server.tools || []).length > 0) fields.push(["Tools", stringSliceLiteral(server.tools)]);
    return `copilot.MCPStdioServerConfig{
${renderStructFields(fields, 3)}
\t\t}`;
  }
  const fields = [["URL", goString(server.url || "")]];
  if (server.headers && Object.keys(server.headers).length > 0) fields.push(["Headers", stringMapLiteral(server.headers)]);
  if ((server.tools || []).length > 0) fields.push(["Tools", stringSliceLiteral(server.tools)]);
  return `copilot.MCPHTTPServerConfig{
${renderStructFields(fields, 3)}
\t\t}`;
}

function renderSelectMCPServers() {
  return `func selectMCPServers(all map[string]copilot.MCPServerConfig, names []string) map[string]copilot.MCPServerConfig {
\tselected := make(map[string]copilot.MCPServerConfig, len(names))
\tfor _, name := range names {
\t\tif server, ok := all[name]; ok {
\t\t\tselected[name] = server
\t\t}
\t}
\treturn selected
}`;
}

function renderBuildHooks(hooks) {
  const map = {
    preToolUse: ["OnPreToolUse", "hooks.PreToolUse"],
    postToolUse: ["OnPostToolUse", "hooks.PostToolUse"],
    userPromptSubmitted: ["OnUserPromptSubmitted", "hooks.UserPromptSubmitted"],
    sessionStart: ["OnSessionStart", "hooks.SessionStart"],
    sessionEnd: ["OnSessionEnd", "hooks.SessionEnd"],
    errorOccurred: ["OnErrorOccurred", "hooks.ErrorOccurred"],
  };
  const fields = Object.keys(hooks).sort().filter((key) => map[key]).map((key) => map[key]);
  return `func buildHooks() *copilot.SessionHooks {
\treturn &copilot.SessionHooks{
${renderStructFields(fields, 2)}
\t}
}`;
}

function renderBuildSystemMessage(ctx) {
  const systemMessage = ctx.manifest.extensions.systemMessage;
  const prelude = [];
  const fields = [];
  if (systemMessage.mode) fields.push(["Mode", goString(systemMessage.mode)]);
  if (systemMessage.content) {
    const contentExpr = renderTextExpr(ctx, systemMessage.content, "system-message", "content", prelude);
    fields.push(["Content", contentExpr]);
  }
  if (systemMessage.sections && Object.keys(systemMessage.sections).length > 0) {
    fields.push(["Sections", renderSystemMessageSections(ctx, systemMessage.sections, prelude)]);
  }
  return `func buildSystemMessage() (*copilot.SystemMessageConfig, error) {
${prelude.join("\n")}${prelude.length ? "\n" : ""}\treturn &copilot.SystemMessageConfig{
${renderStructFields(fields, 2)}
\t}, nil
}`;
}

function renderSystemMessageSections(ctx, sections, prelude) {
  const lines = ["map[string]copilot.SectionOverride{"];
  for (const sectionName of Object.keys(sections).sort()) {
    const value = sections[sectionName];
    let action = "replace";
    let content = "";
    if (typeof value === "string") {
      content = renderTextExpr(ctx, value, "system-message", sectionName, prelude);
    } else if (value && typeof value === "object") {
      for (const candidate of ["replace", "append", "prepend"]) {
        if (value[candidate] != null) {
          action = candidate;
          content = renderTextExpr(ctx, value[candidate], "system-message", `${sectionName}-${candidate}`, prelude);
          break;
        }
      }
    }
    lines.push(`\t\t\t${goString(sectionName)}: {`);
    lines.push(`${renderStructFields([["Action", sectionAction(action)], ["Content", content || goString("")]], 4)}`);
    lines.push("\t\t\t},");
  }
  lines.push("\t\t}");
  return lines.join("\n");
}

function renderTextExpr(ctx, text, assetKind, assetName, prelude) {
  const assetPath = maybeAddAsset(ctx, text, assetKind, assetName);
  if (!assetPath) return goString(text);
  const varName = uniqueVar(`${toCamel(assetName)}Text`, prelude);
  prelude.push(`\t${varName}, err := readText(${goString(toSlash(assetPath))})`);
  prelude.push("\tif err != nil {\n\t\treturn nil, err\n\t}");
  ctx.readTextNeeded = true;
  return varName;
}

function sectionAction(action) {
  switch (action) {
    case "append": return "copilot.SectionActionAppend";
    case "prepend": return "copilot.SectionActionPrepend";
    case "remove": return "copilot.SectionActionRemove";
    case "replace":
    default:
      return "copilot.SectionActionReplace";
  }
}

function renderReadText() {
  return `func readText(name string) (string, error) {
\tcontent, err := os.ReadFile(name)
\tif err != nil {
\t\treturn "", fmt.Errorf("read %s: %w", name, err)
\t}
\treturn string(content), nil
}`;
}

function renderElicitationHandler() {
  return `func defaultElicitationHandler(ctx copilot.ElicitationContext) (copilot.ElicitationResult, error) {
\treturn copilot.ElicitationResult{Action: "cancel"}, nil
}`;
}

function renderInitialPrompt() {
  return `func initialPrompt() string {
\tif len(os.Args) > 1 {
\t\treturn os.Args[1]
\t}
\treturn os.Getenv("AMP_INITIAL_PROMPT")
}`;
}

function renderDenyAllPermissions() {
  return `func denyAllPermissions(request copilot.PermissionRequest, invocation copilot.PermissionInvocation) (copilot.PermissionRequestResult, error) {
\treturn copilot.PermissionRequestResult{Kind: copilot.PermissionRequestResultKindRejected}, nil
}`;
}

function renderBroadcast(communication) {
  const channels = (communication.broadcast.channels || []);
  const channelLiteral = stringSliceLiteral(channels.length > 0 ? channels : [communication.id || "default"]);
  const agentID = communication.id || "agent";
  return `var broadcastChannels = ${channelLiteral}

func broadcast(channel string, kind string, payload any) {
\trecord := map[string]any{
\t\t"standard":  "amp-acs-1.0",
\t\t"agentId":   ${goString(agentID)},
\t\t"channel":   channel,
\t\t"kind":      kind,
\t\t"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
\t\t"payload":   payload,
\t}
\tif err := json.NewEncoder(os.Stdout).Encode(record); err != nil {
\t\tlog.Printf("broadcast failed: %v", err)
\t}
}`;
}

function renderInboxPoller(inboxPath) {
  return `func pollInbox(ctx context.Context, session *copilot.Session, inboxPath string) {
\tticker := time.NewTicker(500 * time.Millisecond)
\tdefer ticker.Stop()
\tvar offset int64
\tfor {
\t\tselect {
\t\tcase <-ctx.Done():
\t\t\treturn
\t\tcase <-ticker.C:
\t\t}
\t\tinfo, err := os.Stat(inboxPath)
\t\tif err != nil {
\t\t\tcontinue
\t\t}
\t\tif info.Size() < offset {
\t\t\toffset = 0
\t\t}
\t\tif info.Size() == offset {
\t\t\tcontinue
\t\t}
\t\tfile, err := os.Open(inboxPath)
\t\tif err != nil {
\t\t\tlog.Printf("open inbox %s: %v", inboxPath, err)
\t\t\tcontinue
\t\t}
\t\tif _, err := file.Seek(offset, io.SeekStart); err != nil {
\t\t\tlog.Printf("seek inbox %s: %v", inboxPath, err)
\t\t\tfile.Close()
\t\t\tcontinue
\t\t}
\t\tscanner := bufio.NewScanner(file)
\t\tfor scanner.Scan() {
\t\t\tline := strings.TrimSpace(scanner.Text())
\t\t\tif line == "" {
\t\t\t\tcontinue
\t\t\t}
\t\t\tprompt := inboxPrompt(line)
\t\t\tif prompt == "" {
\t\t\t\tcontinue
\t\t\t}
\t\t\tif _, err := session.Send(ctx, copilot.MessageOptions{Prompt: prompt}); err != nil {
\t\t\t\tlog.Printf("send inbox prompt: %v", err)
\t\t\t}
\t\t}
\t\tif err := scanner.Err(); err != nil {
\t\t\tlog.Printf("read inbox %s: %v", inboxPath, err)
\t\t}
\t\toffset = info.Size()
\t\tfile.Close()
\t}
}

func inboxPrompt(line string) string {
\tvar record map[string]any
\tif err := json.Unmarshal([]byte(line), &record); err != nil {
\t\treturn line
\t}
\tfor _, key := range []string{"prompt", "message", "text"} {
\t\tif value, ok := record[key].(string); ok {
\t\t\treturn value
\t\t}
\t}
\treturn line
}

var _ = ${goString(inboxPath)}`;
}

function renderStructFields(fields, indentLevel) {
  const indent = "\t".repeat(indentLevel);
  const lines = [];
  let group = [];
  const flush = () => {
    if (group.length === 0) return;
    const maxKeyLength = group.reduce((max, [key]) => Math.max(max, key.length), 0);
    for (const [key, value] of group) {
      lines.push(`${indent}${key}:${" ".repeat(maxKeyLength - key.length + 1)}${value},`);
    }
    group = [];
  };
  for (const [key, value] of fields) {
    if (String(value).includes("\n")) {
      flush();
      lines.push(`${indent}${key}: ${value},`);
    } else {
      group.push([key, value]);
    }
  }
  flush();
  return lines.join("\n");
}

function goFile(packageName, importGroups, body) {
  const groups = importGroups
    .map((group) => Array.from(new Set(group.filter(Boolean))).sort(compareImportSpecs))
    .filter((group) => group.length > 0);
  let out = `package ${packageName}\n\n`;
  if (groups.length > 0) {
    out += "import (\n";
    groups.forEach((group, index) => {
      if (index > 0) out += "\n";
      for (const spec of group) out += `\t${spec}\n`;
    });
    out += ")\n\n";
  }
  out += body.trimEnd() + "\n";
  return out;
}

function compareImportSpecs(a, b) {
  const pathA = importPathFromSpec(a);
  const pathB = importPathFromSpec(b);
  if (pathA !== pathB) return pathA.localeCompare(pathB);
  return a.localeCompare(b);
}

function importPathFromSpec(spec) {
  const match = String(spec).match(/"([^"]+)"/);
  return match ? match[1] : String(spec);
}

function readInlineOrFile(ctx, value) {
  if (typeof value !== "string") return "";
  const resolved = path.resolve(ctx.plan.manifestDir, value);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return fs.readFileSync(resolved, "utf8");
  }
  return value;
}

function maybeAddAsset(ctx, value, kind, nameHint) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const resolved = path.resolve(ctx.plan.manifestDir, value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  if (ctx.assetPaths.has(resolved)) return ctx.assetPaths.get(resolved);
  const content = fs.readFileSync(resolved, "utf8");
  const ext = path.extname(resolved) || ".txt";
  const stem = sanitizeFileName(nameHint || path.basename(resolved, ext));
  const hash = crypto.createHash("sha256").update(`${value}\n${content}`).digest("hex").slice(0, 8);
  const relPath = path.join("assets", sanitizeFileName(kind), `${stem}-${hash}${ext}`);
  ctx.assetPaths.set(resolved, relPath);
  addFile(ctx.plan, relPath, content.endsWith("\n") ? content : content + "\n");
  return relPath;
}

function uniqueName(base, used) {
  let name = base || "Generated";
  let index = 2;
  while (used.has(name)) {
    name = `${base}${index}`;
    index += 1;
  }
  used.add(name);
  return name;
}

function uniqueVar(base, prelude) {
  const used = new Set();
  for (const line of prelude) {
    const match = line.match(/^\t([A-Za-z_][A-Za-z0-9_]*)\s*:=/);
    if (match) used.add(match[1]);
  }
  let name = base || "contentText";
  let index = 2;
  while (used.has(name)) {
    name = `${base}${index}`;
    index += 1;
  }
  return name;
}

function stringSliceLiteral(values) {
  return `[]string{${(values || []).map(goString).join(", ")}}`;
}

function stringMapLiteral(values) {
  const keys = Object.keys(values || {}).sort();
  if (keys.length === 0) return "map[string]string{}";
  return `map[string]string{${keys.map((key) => `${goString(key)}: ${goString(values[key])}`).join(", ")}}`;
}

function goAnyLiteral(value) {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "string") return goString(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[]any{${value.map(goAnyLiteral).join(", ")}}`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `map[string]any{${keys.map((key) => `${goString(key)}: ${goAnyLiteral(value[key])}`).join(", ")}}`;
  }
  return goString(String(value));
}

function goString(value) {
  return JSON.stringify(String(value == null ? "" : value));
}

function escapeForGoString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sanitizeModulePathSegment(value) {
  const text = String(value || "agent").toLowerCase().replace(/[^a-z0-9._~-]+/g, "-").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  return text || "agent";
}

function sanitizeFileName(value) {
  return String(value || "item").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function toSnake(value) {
  return sanitizeFileName(value).replace(/-/g, "_").replace(/_+/g, "_");
}

function toPascal(value) {
  const words = String(value || "generated").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const result = words.map((word) => {
    const upper = word.toUpperCase();
    if (["ID", "URL", "HTTP", "MCP", "SDK", "API", "JSON", "CLI", "UI", "FS"].includes(upper)) return upper;
    return upper.slice(0, 1) + word.slice(1);
  }).join("");
  return /^[A-Za-z_]/.test(result) ? result : `Value${result}`;
}

function toCamel(value) {
  const pascal = toPascal(value);
  return pascal.slice(0, 1).toLowerCase() + pascal.slice(1);
}

function toGoFieldName(value) {
  const name = toPascal(value);
  return name || "Value";
}

function toSlash(value) {
  return String(value).replace(/\\/g, "/");
}

module.exports = { generate, language: "go" };
