/*---------------------------------------------------------------------------------------------
 *  Python generator.
 *  Emits a runnable copilot-sdk Python project from a normalized AMP manifest.
 *--------------------------------------------------------------------------------------------*/
"use strict";

const fs = require("fs");
const path = require("path");
const { addFile, addLog } = require("../planner");
const {
  AMP_VERSION,
  COPILOT_SDK_PROTOCOL_VERSION,
  FRAMEWORK_VERSION,
  SDK_PINS,
} = require("../version");

const PY_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class",
  "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
  "return", "try", "while", "with", "yield",
]);

const HOOKS = [
  ["preToolUse", "on_pre_tool_use", "PreToolUseHookInput", "PreToolUseHookOutput"],
  ["postToolUse", "on_post_tool_use", "PostToolUseHookInput", "PostToolUseHookOutput"],
  ["userPromptSubmitted", "on_user_prompt_submitted", "UserPromptSubmittedHookInput", "UserPromptSubmittedHookOutput"],
  ["sessionStart", "on_session_start", "SessionStartHookInput", "SessionStartHookOutput"],
  ["sessionEnd", "on_session_end", "SessionEndHookInput", "SessionEndHookOutput"],
  ["errorOccurred", "on_error_occurred", "ErrorOccurredHookInput", "ErrorOccurredHookOutput"],
];

function rel(...parts) {
  return path.posix.join(...parts);
}

function ensureNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function snakeCase(value, fallback = "item") {
  const raw = String(value || fallback)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  let out = raw || fallback;
  if (!/^[A-Za-z_]/.test(out)) out = `_${out}`;
  if (PY_KEYWORDS.has(out)) out = `${out}_`;
  return out;
}

function uniqueIdentifier(base, used) {
  let out = snakeCase(base);
  let i = 2;
  while (used.has(out)) {
    out = `${snakeCase(base)}_${i}`;
    i += 1;
  }
  used.add(out);
  return out;
}

function pascalCase(value, fallback = "Generated") {
  const parts = String(value || fallback)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const out = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("");
  return out || fallback;
}

function pyString(value) {
  return JSON.stringify(String(value));
}

function pyLiteral(value) {
  if (value === undefined || value === null) return "None";
  if (typeof value === "string") return pyString(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return `[${value.map((v) => pyLiteral(v)).join(", ")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return "{}";
    return `{${keys.map((k) => `${pyLiteral(k)}: ${pyLiteral(value[k])}`).join(", ")}}`;
  }
  return "None";
}

function stable(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stable);
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
  return out;
}

function stableJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function addPyFile(plan, relPath, contents) {
  addFile(plan, relPath, ensureNewline(contents));
}

function dependencyList(manifest, usesYaml) {
  const deps = [
    `github-copilot-sdk${SDK_PINS.python["github-copilot-sdk"]}`,
    "pydantic>=2",
  ];
  if (usesYaml) deps.push("pyyaml>=6");
  return deps;
}

function readJsonSchema(plan, schemaRef, toolName) {
  if (!schemaRef) return { type: "object", properties: {} };
  if (typeof schemaRef === "string") {
    const full = path.resolve(plan.manifestDir, schemaRef);
    try {
      return JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (err) {
      throw new Error(`Failed to read paramsSchema for tool '${toolName}' from ${schemaRef}: ${err.message}`);
    }
  }
  return JSON.parse(JSON.stringify(schemaRef));
}

function readIfExistingFile(plan, maybePath) {
  if (typeof maybePath !== "string") return maybePath;
  const full = path.resolve(plan.manifestDir, maybePath);
  if (!fs.existsSync(full)) return maybePath;
  const stat = fs.statSync(full);
  if (!stat.isFile()) return maybePath;
  return fs.readFileSync(full, "utf8");
}

function runtimeTextExpr(plan, value) {
  if (typeof value !== "string") return pyLiteral(value);
  const full = path.resolve(plan.manifestDir, value);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) {
    return `_read_text(Path(${pyString(full)}))`;
  }
  return pyLiteral(value);
}

function schemaType(schema) {
  if (!schema || typeof schema !== "object") return "Any";
  if (Array.isArray(schema.type)) {
    const nonNull = schema.type.filter((t) => t !== "null");
    return schemaType({ ...schema, type: nonNull[0] });
  }
  if (schema.enum) return "str";
  switch (schema.type) {
    case "string": return "str";
    case "integer": return "int";
    case "number": return "float";
    case "boolean": return "bool";
    case "array": return `list[${schemaType(schema.items || {})}]`;
    case "object": return "dict[str, Any]";
    default: return "Any";
  }
}

function renderParamsModel(tool, schema) {
  const className = `${pascalCase(tool.name, "Tool")}Params`;
  const props = schema && schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const required = new Set(Array.isArray(schema && schema.required) ? schema.required : []);
  const used = new Set();
  const aliases = new Map();
  const lines = [`class ${className}(BaseModel):`, "    model_config = ConfigDict(populate_by_name=True)"];

  const propNames = Object.keys(props).sort();
  if (propNames.length === 0) {
    lines.push("    pass");
    return { className, source: lines.join("\n") };
  }

  for (const propName of propNames) {
    const prop = props[propName] || {};
    const fieldName = uniqueIdentifier(propName, used);
    aliases.set(propName, fieldName);
    const isRequired = required.has(propName);
    const typeExpr = isRequired ? schemaType(prop) : `${schemaType(prop)} | None`;
    const fieldArgs = [`default=${isRequired ? "..." : (Object.prototype.hasOwnProperty.call(prop, "default") ? pyLiteral(prop.default) : "None")}`];
    if (fieldName !== propName) fieldArgs.push(`alias=${pyString(propName)}`);
    if (typeof prop.description === "string") fieldArgs.push(`description=${pyString(prop.description)}`);
    if (typeof prop.title === "string") fieldArgs.push(`title=${pyString(prop.title)}`);
    lines.push(`    ${fieldName}: ${typeExpr} = Field(${fieldArgs.join(", ")})`);
  }
  return { className, source: lines.join("\n") };
}

function renderTool(plan, pkg, tool) {
  const schema = readJsonSchema(plan, tool.paramsSchema, tool.name);
  const { className, source: modelSource } = renderParamsModel(tool, schema);
  const stub = tool.stub || null;
  const handlerPath = tool.handler || null;
  const body = [];
  body.push("    data = params.model_dump(by_alias=True, exclude_none=True)");

  if (stub && stub.kind === "static") {
    body.push(`    return ${pyLiteral(Object.prototype.hasOwnProperty.call(stub, "value") ? stub.value : null)}`);
  } else if (stub && stub.kind === "echo") {
    body.push("    return json.dumps(data, sort_keys=True)");
  } else if (stub && stub.kind === "memoryRead") {
    body.push("    key = str(data.get(\"key\") or data.get(\"name\") or data.get(\"id\") or \"\")");
    body.push("    if not key:");
    body.push("        return {\"error\": \"memory key required\"}");
    body.push("    return MEMORY_STORE.get(key)");
  } else if (stub && stub.kind === "memoryWrite") {
    body.push("    key = str(data.get(\"key\") or data.get(\"name\") or data.get(\"id\") or \"\")");
    body.push("    if not key:");
    body.push("        return {\"error\": \"memory key required\"}");
    body.push("    value = data.get(\"value\", data)");
    body.push("    MEMORY_STORE[key] = value");
    body.push("    return {\"key\": key, \"value\": value}");
  } else if (stub && stub.kind === "memoryList") {
    body.push("    return dict(sorted(MEMORY_STORE.items()))");
  } else if (handlerPath) {
    body.push(`    # TODO: Wire manifest handler ${pyString(handlerPath)} here.`);
    body.push(`    raise NotImplementedError(${pyString(`Tool '${tool.name}' is generated as a TODO stub. Wire ${handlerPath}.`)})`);
  } else {
    body.push(`    # TODO: Implement tool '${tool.name}'.`);
    body.push("    return {\"todo\": \"implement tool handler\", \"input\": data}");
  }

  const imports = [
    "from __future__ import annotations",
    "",
    "import json",
    "from typing import Any",
    "",
    "from copilot import define_tool",
    "from copilot.tools import ToolInvocation",
    "from pydantic import BaseModel, ConfigDict, Field",
  ];
  if (stub && ["memoryRead", "memoryWrite", "memoryList"].includes(stub.kind)) {
    imports.push("", "from ..memory_store import MEMORY_STORE");
  }

  return `${imports.join("\n")}\n\n\n${modelSource}\n\n\nasync def _handler(params: ${className}, invocation: ToolInvocation) -> Any:\n${body.join("\n")}\n\n\ntool = define_tool(\n    ${pyString(tool.name)},\n    description=${pyString(tool.description || "")},\n    handler=_handler,\n    params_type=${className},\n    overrides_built_in_tool=${tool.overridesBuiltIn ? "True" : "False"},\n    skip_permission=${tool.skipPermission ? "True" : "False"},\n)\n`;
}

function renderMemoryStore() {
  return `from __future__ import annotations

from typing import Any

MEMORY_STORE: dict[str, Any] = {}
`;
}

function renderHookFile(hookName, inputType, outputType, sourcePath) {
  const sourceComment = sourcePath ? `\n    # TODO: Port logic from manifest handler ${pyString(sourcePath)}.` : "";
  return `from __future__ import annotations

from copilot.session import ${inputType}, ${outputType}


async def handler(input: ${inputType}, context: dict[str, str] | None = None) -> ${outputType}:
    _ = (input, context)${sourceComment}
    return {}
`;
}

function renderPermissions(mode, autoApprove, handlerPath) {
  if (mode === "allowList") {
    return `from __future__ import annotations

import json
from typing import Any

try:
    from copilot import PermissionRequestResult
except ImportError:  # pragma: no cover - compatibility with older SDK exports
    from copilot.session import PermissionRequestResult

AUTO_APPROVE: list[dict[str, str]] = ${pyLiteral(autoApprove || [])}


def _tool_name(request: Any, invocation: dict[str, str]) -> str:
    return str(
        getattr(request, "tool_name", "")
        or getattr(request, "toolName", "")
        or invocation.get("toolName", "")
        or invocation.get("tool_name", "")
    )


def _matches_tool(pattern: str, tool: str) -> bool:
    if pattern in ("*", tool):
        return True
    if pattern.endswith("*"):
        return tool.startswith(pattern[:-1])
    return False


def on_permission_request(request: Any, invocation: dict[str, str]) -> PermissionRequestResult:
    tool = _tool_name(request, invocation)
    args_text = json.dumps(invocation, sort_keys=True)
    for rule in AUTO_APPROVE:
        if not _matches_tool(str(rule.get("tool", "")), tool):
            continue
        required = rule.get("argsContains")
        if required and required not in args_text:
            continue
        return PermissionRequestResult(kind="approve-once")
    return PermissionRequestResult(kind="no-result")
`;
  }

  return `from __future__ import annotations

from typing import Any

try:
    from copilot import PermissionRequestResult
except ImportError:  # pragma: no cover - compatibility with older SDK exports
    from copilot.session import PermissionRequestResult


async def on_permission_request(request: Any, invocation: dict[str, str]) -> PermissionRequestResult:
    _ = (request, invocation)
    # TODO: Wire custom permission handler${handlerPath ? ` from ${handlerPath}` : ""}.
    return PermissionRequestResult(kind="no-result")
`;
}

function renderLifecycle(handlerPath) {
  return `from __future__ import annotations

from typing import Any


def on_lifecycle(event: Any) -> None:
    _ = event
    # TODO: Wire lifecycle handler from ${handlerPath}.
`;
}

function renderUserInput(handlerPath) {
  return `from __future__ import annotations

from copilot.session import UserInputRequest, UserInputResponse


async def on_user_input_request(request: UserInputRequest, context: dict[str, str] | None = None) -> UserInputResponse:
    _ = (request, context)
    # TODO: Wire user input handler from ${handlerPath}.
    return {"answer": "", "wasFreeform": True}
`;
}

function renderCommands(commands) {
  const lines = [
    "from __future__ import annotations",
    "",
    "from copilot import CommandDefinition",
    "from copilot.session import CommandContext",
    "",
  ];
  const handlerNames = [];
  const used = new Set();
  for (const command of commands) {
    const handlerName = uniqueIdentifier(`handle_${command.name}`, used);
    handlerNames.push(handlerName);
    lines.push(`async def ${handlerName}(context: CommandContext) -> None:`);
    lines.push("    _ = context");
    if (command.handler) lines.push(`    # TODO: Wire command handler from ${command.handler}.`);
    if (command.argsHint) lines.push(`    # Args hint: ${command.argsHint}`);
    lines.push("    return None", "");
  }
  lines.push("commands = [");
  commands.forEach((command, i) => {
    lines.push(`    CommandDefinition(name=${pyString(command.name)}, description=${pyString(command.description || "")}, handler=${handlerNames[i]}),`);
  });
  lines.push("]");
  return lines.join("\n");
}

function renderSessionFsMemory() {
  return `from __future__ import annotations

from datetime import UTC, datetime

from copilot import SessionFsFileInfo, SessionFsProvider
from copilot.generated.rpc import SessionFSReaddirWithTypesEntry, SessionFSReaddirWithTypesEntryType


def _norm(path: str) -> str:
    clean = (path or "/").replace("\\\\", "/")
    if not clean.startswith("/"):
        clean = "/" + clean
    parts: list[str] = []
    for part in clean.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/" + "/".join(parts)


class MemoryProvider(SessionFsProvider):
    def __init__(self) -> None:
        self._files: dict[str, str] = {}
        self._dirs: set[str] = {"/"}

    def _parents(self, path: str) -> list[str]:
        current = _norm(path).rsplit("/", 1)[0] or "/"
        parents = ["/"]
        if current != "/":
            acc = ""
            for part in current.strip("/").split("/"):
                acc += "/" + part
                parents.append(acc)
        return parents

    def _ensure_parent(self, path: str) -> None:
        for parent in self._parents(path):
            self._dirs.add(parent)

    async def read_file(self, path: str) -> str:
        key = _norm(path)
        if key not in self._files:
            raise FileNotFoundError(path)
        return self._files[key]

    async def write_file(self, path: str, content: str, mode: int | None = None) -> None:
        _ = mode
        key = _norm(path)
        self._ensure_parent(key)
        self._files[key] = content

    async def append_file(self, path: str, content: str, mode: int | None = None) -> None:
        _ = mode
        key = _norm(path)
        self._ensure_parent(key)
        self._files[key] = self._files.get(key, "") + content

    async def exists(self, path: str) -> bool:
        key = _norm(path)
        return key in self._files or key in self._dirs

    async def stat(self, path: str) -> SessionFsFileInfo:
        key = _norm(path)
        now = datetime.now(UTC)
        if key in self._files:
            return SessionFsFileInfo(is_file=True, is_directory=False, size=len(self._files[key]), mtime=now, birthtime=now)
        if key in self._dirs:
            return SessionFsFileInfo(is_file=False, is_directory=True, size=0, mtime=now, birthtime=now)
        raise FileNotFoundError(path)

    async def mkdir(self, path: str, recursive: bool, mode: int | None = None) -> None:
        _ = mode
        key = _norm(path)
        if recursive:
            for parent in self._parents(key + "/child"):
                self._dirs.add(parent)
        else:
            self._ensure_parent(key)
            self._dirs.add(key)

    async def readdir(self, path: str) -> list[str]:
        base = _norm(path)
        if base not in self._dirs:
            raise FileNotFoundError(path)
        prefix = "/" if base == "/" else base.rstrip("/") + "/"
        entries: set[str] = set()
        for candidate in list(self._dirs) + list(self._files):
            if candidate == base or not candidate.startswith(prefix):
                continue
            rest = candidate[len(prefix):].strip("/")
            if rest:
                entries.add(rest.split("/", 1)[0])
        return sorted(entries)

    async def readdir_with_types(self, path: str) -> list[SessionFSReaddirWithTypesEntry]:
        base = _norm(path)
        entries = []
        for name in await self.readdir(path):
            child = _norm(base.rstrip("/") + "/" + name)
            entry_type = SessionFSReaddirWithTypesEntryType.DIRECTORY if child in self._dirs else SessionFSReaddirWithTypesEntryType.FILE
            entries.append(SessionFSReaddirWithTypesEntry(name=name, type=entry_type))
        return entries

    async def rm(self, path: str, recursive: bool, force: bool) -> None:
        key = _norm(path)
        if key in self._files:
            del self._files[key]
            return
        if key not in self._dirs:
            if force:
                return
            raise FileNotFoundError(path)
        children = [p for p in list(self._files) + list(self._dirs) if p != key and p.startswith(key.rstrip("/") + "/")]
        if children and not recursive:
            raise OSError(f"directory not empty: {path}")
        for child in children:
            self._files.pop(child, None)
            self._dirs.discard(child)
        if key != "/":
            self._dirs.discard(key)

    async def rename(self, src: str, dest: str) -> None:
        source = _norm(src)
        target = _norm(dest)
        if source in self._files:
            self._ensure_parent(target)
            self._files[target] = self._files.pop(source)
            return
        if source not in self._dirs:
            raise FileNotFoundError(src)
        self._ensure_parent(target)
        for directory in sorted([d for d in self._dirs if d == source or d.startswith(source.rstrip("/") + "/")]):
            self._dirs.discard(directory)
            self._dirs.add(target + directory[len(source):])
        for file_path in sorted([f for f in self._files if f.startswith(source.rstrip("/") + "/")]):
            self._files[target + file_path[len(source):]] = self._files.pop(file_path)


def create_session_fs_handler(session: object) -> MemoryProvider:
    _ = session
    return MemoryProvider()
`;
}

function renderSessionFsCustom(handlerPath) {
  return `from __future__ import annotations

from typing import Any


def create_session_fs_handler(session: Any) -> Any:
    _ = session
    # TODO: Wire custom session filesystem provider from ${handlerPath}.
    raise NotImplementedError("Custom session filesystem provider is not wired yet.")
`;
}

function renderHandoff(peers) {
  const lines = ["from __future__ import annotations", "", "from typing import Any", ""];
  for (const peer of peers) {
    const fn = uniqueIdentifier(`handoff_to_${peer.name}`, new Set());
    lines.push("", `def ${fn}(payload: dict[str, Any]) -> dict[str, Any]:`);
    lines.push("    return {");
    lines.push(`        "name": ${pyString(peer.name)},`);
    lines.push(`        "description": ${pyString(peer.description || "")},`);
    lines.push(`        "transport": ${pyString(peer.transport || "inbox")},`);
    lines.push(`        "endpoint": ${pyLiteral(peer.endpoint || null)},`);
    lines.push("        \"payload\": payload,");
    lines.push("    }");
  }
  return lines.join("\n");
}

function mcpServersConfig(servers) {
  const out = {};
  for (const server of servers || []) {
    const cfg = {};
    if (server.type === "stdio") {
      cfg.type = "stdio";
      if (server.command) cfg.command = server.command;
      if (server.args) cfg.args = server.args;
      if (server.env) cfg.env = server.env;
      if (server.tools) cfg.tools = server.tools;
    } else {
      cfg.type = server.type;
      if (server.url) cfg.url = server.url;
      if (server.headers) cfg.headers = server.headers;
      if (server.tools) cfg.tools = server.tools;
    }
    out[server.name] = cfg;
  }
  return out;
}

function customAgentsConfig(plan, agents) {
  return (agents || []).map((agent) => {
    const cfg = {
      name: agent.name,
      description: agent.description || "",
      prompt: readIfExistingFile(plan, agent.systemPrompt || ""),
    };
    if (agent.model) cfg.model = agent.model;
    if (agent.reasoningEffort) cfg.reasoning_effort = agent.reasoningEffort;
    if (agent.tools) cfg.tools = agent.tools;
    if (agent.excludedTools) cfg.excluded_tools = agent.excludedTools;
    if (agent.mcpServers) cfg.mcp_servers = agent.mcpServers;
    return cfg;
  });
}

function defaultAgentConfig(defaultAgent) {
  if (!defaultAgent) return null;
  const cfg = {};
  if (defaultAgent.name) cfg.name = defaultAgent.name;
  if (defaultAgent.tools) cfg.tools = defaultAgent.tools;
  if (defaultAgent.excludedTools) cfg.excluded_tools = defaultAgent.excludedTools;
  return cfg;
}

function systemMessageExpr(plan, systemMessage) {
  if (!systemMessage) return null;
  const mode = systemMessage.mode || "customize";
  const lines = ["{"];
  lines.push(`        "mode": ${pyString(mode)},`);
  if (systemMessage.content) lines.push(`        "content": ${runtimeTextExpr(plan, systemMessage.content)},`);
  if (systemMessage.sections && typeof systemMessage.sections === "object") {
    lines.push("        \"sections\": {");
    for (const section of Object.keys(systemMessage.sections).sort()) {
      const value = systemMessage.sections[section];
      if (typeof value === "string") {
        lines.push(`            ${pyString(section)}: {"action": "replace", "content": ${runtimeTextExpr(plan, value)}},`);
      } else if (value && typeof value === "object") {
        for (const action of ["replace", "append", "prepend"]) {
          if (Object.prototype.hasOwnProperty.call(value, action)) {
            lines.push(`            ${pyString(section)}: {"action": ${pyString(action)}, "content": ${runtimeTextExpr(plan, value[action])}},`);
            break;
          }
        }
      }
    }
    lines.push("        },");
  }
  lines.push("    }");
  return lines.join("\n");
}

function providerConfig(provider) {
  if (!provider || typeof provider !== "object") return null;
  const out = {};
  for (const key of Object.keys(provider).sort()) out[snakeCase(key)] = provider[key];
  return out;
}

function renderMain(plan, pkg, context) {
  const manifest = plan.manifest;
  const ext = manifest.extensions || {};
  const runtime = manifest.runtime || {};
  const sdk = runtime.copilotSdk || {};
  const communication = manifest.communication || null;
  const broadcast = communication && communication.broadcast && communication.broadcast.transport === "stdout-jsonl";
  const inbox = communication && communication.inbox && communication.inbox.enabled;
  const sessionFs = ext.sessionFs || null;
  const permissions = ext.permissions || { mode: "custom" };

  const imports = [
    "from __future__ import annotations",
    "",
    "import asyncio",
    "import os",
    "import sys",
    "import json",
    "from pathlib import Path",
  ];
  if (broadcast) imports.push("import time");
  imports.push("from typing import Any", "", "import copilot", "from copilot import CopilotClient");
  imports.push(
    "try:",
    "    from copilot import ExternalServerConfig, SubprocessConfig",
    "except ImportError:  # pragma: no cover - compatibility with older SDK exports",
    "    from copilot.client import ExternalServerConfig, SubprocessConfig",
  );
  if (permissions.mode === "approveAll") {
    imports.push(
      "try:",
      "    from copilot import PermissionHandler",
      "except ImportError:  # pragma: no cover - compatibility with older SDK exports",
      "    from copilot.session import PermissionHandler",
    );
  } else if (permissions.mode === "denyAll") {
    imports.push(
      "try:",
      "    from copilot import PermissionRequestResult",
      "except ImportError:  # pragma: no cover - compatibility with older SDK exports",
      "    from copilot.session import PermissionRequestResult",
    );
  } else {
    imports.push("from .permissions import on_permission_request");
  }

  for (const mod of context.toolModules) imports.push(`from .tools import ${mod}`);
  if (ext.lifecycle && ext.lifecycle.handler) imports.push("from .lifecycle import on_lifecycle");
  if (ext.userInput && ext.userInput.handler) imports.push("from .user_input import on_user_input_request");
  if ((ext.commands || []).length > 0) imports.push("from .commands import commands");
  for (const hook of context.hookImports) imports.push(`from .hooks.${hook.module} import handler as ${hook.name}`);
  if (sessionFs && sessionFs.provider && sessionFs.provider !== "real") imports.push("from .session_fs import create_session_fs_handler");

  const lines = [...imports, "", "", `AGENT_ID = ${pyString(communication && communication.id ? communication.id : manifest.agent.name)}`, `PACKAGE_ROOT = Path(__file__).resolve().parent`];
  if (broadcast) {
    lines.push(`BROADCAST_CHANNELS = ${pyLiteral((communication.broadcast && communication.broadcast.channels) || [])}`);
    lines.push("DEFAULT_BROADCAST_CHANNEL = BROADCAST_CHANNELS[0] if BROADCAST_CHANNELS else \"default\"");
  }
  if (inbox) lines.push(`INBOX_PATH = Path(${pyString(communication.inbox.path || `${manifest.agent.name}.inbox.jsonl`)})`);

  lines.push(
    "",
    "",
    "def _read_text(path: Path) -> str:",
    "    return path.read_text(encoding=\"utf-8\")",
    "",
    "",
    "def _make_session_config(config: dict[str, Any]) -> dict[str, Any]:",
    "    try:",
    "        return copilot.SessionConfig(**config)",
    "    except AttributeError:",
    "        return dict(config)",
    "    except TypeError:",
    "        return dict(config)",
    "",
    "",
    "def _as_create_session_kwargs(config: dict[str, Any]) -> dict[str, Any]:",
    "    allowed = {",
    "        \"agent\", \"available_tools\", \"client_name\", \"commands\", \"config_dir\",",
    "        \"create_session_fs_handler\", \"custom_agents\", \"default_agent\", \"disabled_skills\",",
    "        \"enable_config_discovery\", \"excluded_tools\", \"github_token\", \"hooks\",",
    "        \"include_sub_agent_streaming_events\", \"infinite_sessions\", \"mcp_servers\",",
    "        \"model\", \"model_capabilities\", \"on_elicitation_request\", \"on_event\",",
    "        \"on_permission_request\", \"on_user_input_request\", \"provider\", \"reasoning_effort\",",
    "        \"session_id\", \"skill_directories\", \"streaming\", \"system_message\", \"tools\",",
    "        \"working_directory\",",
    "    }",
    "    kwargs = {key: value for key, value in dict(config).items() if key in allowed}",
    "    model = kwargs.get(\"model\")",
    "    if isinstance(model, dict):",
    "        model_name = model.get(\"name\")",
    "        if model_name:",
    "            kwargs[\"model\"] = model_name",
    "        else:",
    "            kwargs.pop(\"model\", None)",
    "        if model.get(\"reasoning_effort\"):",
    "            kwargs[\"reasoning_effort\"] = model[\"reasoning_effort\"]",
    "    return kwargs",
  );

  if (permissions.mode === "denyAll") {
    lines.push(
      "",
      "",
      "def _deny_all(request: Any, invocation: dict[str, str]) -> PermissionRequestResult:",
      "    _ = (request, invocation)",
      "    return PermissionRequestResult(kind=\"deny\")",
    );
  }

  if (broadcast) {
    lines.push(
      "",
      "",
      "def broadcast(channel: str, event_type: str, payload: dict[str, Any]) -> None:",
      "    record = {",
      "        \"ts\": time.time(),",
      "        \"agentId\": AGENT_ID,",
      "        \"channel\": channel,",
      "        \"type\": event_type,",
      "        \"payload\": payload,",
      "    }",
      "    print(json.dumps(record, sort_keys=True), flush=True)",
    );
  }

  if (inbox) {
    lines.push(
      "",
      "",
      "async def poll_inbox(path: Path) -> None:",
      "    path.parent.mkdir(parents=True, exist_ok=True)",
      "    path.touch(exist_ok=True)",
      "    position = 0",
      "    while True:",
      "        with path.open(\"r\", encoding=\"utf-8\") as stream:",
      "            stream.seek(position)",
      "            for line in stream:",
      "                try:",
      "                    payload = json.loads(line)",
      "                except json.JSONDecodeError:",
      "                    print(f\"Invalid inbox JSONL: {line.rstrip()}\", file=sys.stderr)",
      "                    continue",
      "                print(json.dumps({\"inbox\": payload}, sort_keys=True), file=sys.stderr)",
      "            position = stream.tell()",
      "        await asyncio.sleep(1.0)",
    );
  }

  lines.push(
    "",
    "",
    "def _build_client() -> CopilotClient:",
  );
  const tokenEnv = sdk.gitHubTokenEnv || null;
  lines.push(tokenEnv ? `    github_token = os.environ.get(${pyLiteral(tokenEnv)})` : "    github_token = None");
  const cliUrl = sdk.transport === "external" ? (sdk.cliUrl || "") : (sdk.cliUrl || "");
  lines.push("    options_kwargs: dict[str, Any] = {");
  lines.push(`        "cli_url": ${pyLiteral(cliUrl || null)},`);
  lines.push(`        "cli_path": ${pyLiteral(sdk.cliPath || null)},`);
  lines.push(`        "use_stdio": ${sdk.transport === "tcp" || sdk.transport === "external" ? "False" : "True"},`);
  lines.push("        \"github_token\": github_token,");
  lines.push(`        "use_logged_in_user": ${sdk.useLoggedInUser === false ? "False" : "True"},`);
  lines.push(`        "log_level": ${pyLiteral(sdk.logLevel || "warning")},`);
  const idleTimeout = Object.prototype.hasOwnProperty.call(sdk, "sessionIdleTimeoutSec") ? sdk.sessionIdleTimeoutSec : null;
  lines.push(`        "session_idle_timeout": ${pyLiteral(idleTimeout)},`);
  if (sessionFs && sessionFs.provider && sessionFs.provider !== "real") {
    lines.push("        \"session_fs\": {");
    lines.push("            \"initial_cwd\": str(Path.cwd()),");
    lines.push("            \"session_state_path\": str(Path.cwd() / \".session-state\"),");
    lines.push("            \"conventions\": \"windows\" if os.name == \"nt\" else \"posix\",");
    lines.push("        },");
  }
  lines.push("    }");
  lines.push("    options_type = getattr(copilot, \"CopilotClientOptions\", None) or getattr(copilot, \"ClientOptions\", None)");
  lines.push("    if options_type is not None:");
  lines.push("        return CopilotClient(options_type(**{key: value for key, value in options_kwargs.items() if value is not None}))");
  lines.push("    if options_kwargs.get(\"cli_url\"):");
  if (sessionFs && sessionFs.provider && sessionFs.provider !== "real") {
    lines.push("        return CopilotClient(ExternalServerConfig(url=options_kwargs[\"cli_url\"], session_fs=options_kwargs.get(\"session_fs\")))");
  } else {
    lines.push("        return CopilotClient(ExternalServerConfig(url=options_kwargs[\"cli_url\"]))");
  }
  lines.push("    return CopilotClient(");
  lines.push("        SubprocessConfig(");
  lines.push("            cli_path=options_kwargs.get(\"cli_path\"),");
  lines.push("            use_stdio=bool(options_kwargs.get(\"use_stdio\", True)),");
  lines.push("            github_token=options_kwargs.get(\"github_token\"),");
  lines.push("            use_logged_in_user=options_kwargs.get(\"use_logged_in_user\"),");
  lines.push("            log_level=options_kwargs.get(\"log_level\", \"warning\"),");
  lines.push("            session_idle_timeout_seconds=options_kwargs.get(\"session_idle_timeout\"),");
  if (sessionFs && sessionFs.provider && sessionFs.provider !== "real") lines.push("            session_fs=options_kwargs.get(\"session_fs\"),");
  lines.push("        )");
  lines.push("    )");

  lines.push("", "", "def _build_session_config() -> dict[str, Any]:", "    config: dict[str, Any] = {}");

  if (permissions.mode === "approveAll") lines.push("    config[\"on_permission_request\"] = PermissionHandler.approve_all");
  else if (permissions.mode === "denyAll") lines.push("    config[\"on_permission_request\"] = _deny_all");
  else lines.push("    config[\"on_permission_request\"] = on_permission_request");

  const model = runtime.model || {};
  const modelConfig = { name: model.name || "claude-sonnet-4.5" };
  if (model.reasoningEffort) modelConfig.reasoning_effort = model.reasoningEffort;
  lines.push(`    config["model"] = ${pyLiteral(modelConfig)}`);

  if (model.capabilitiesOverride) lines.push(`    config["model_capabilities"] = ${pyLiteral(model.capabilitiesOverride)}`);
  if (context.toolModules.length > 0) {
    lines.push(`    config["tools"] = [${context.toolModules.map((m) => `${m}.tool`).join(", ")}]`);
  }
  const sysExpr = systemMessageExpr(plan, ext.systemMessage);
  if (sysExpr) lines.push(`    config["system_message"] = ${sysExpr}`);
  if (Array.isArray(ext.availableTools)) lines.push(`    config["available_tools"] = ${pyLiteral(ext.availableTools)}`);
  if ((ext.excludedTools || []).length > 0) lines.push(`    config["excluded_tools"] = ${pyLiteral(ext.excludedTools)}`);
  if ((ext.mcpServers || []).length > 0) lines.push(`    config["mcp_servers"] = ${pyLiteral(mcpServersConfig(ext.mcpServers))}`);
  if ((ext.customAgents || []).length > 0) lines.push(`    config["custom_agents"] = ${pyLiteral(customAgentsConfig(plan, ext.customAgents))}`);
  const defaultAgent = defaultAgentConfig(ext.defaultAgent);
  if (defaultAgent) lines.push(`    config["default_agent"] = ${pyLiteral(defaultAgent)}`);
  if (ext.agent) lines.push(`    config["agent"] = ${pyLiteral(ext.agent)}`);
  if (context.hookImports.length > 0) {
    lines.push("    config[\"hooks\"] = {");
    for (const hook of context.hookImports) lines.push(`        ${pyString(hook.name)}: ${hook.name},`);
    lines.push("    }");
  }
  if (ext.userInput && ext.userInput.handler) lines.push("    config[\"on_user_input_request\"] = on_user_input_request");
  if ((ext.commands || []).length > 0) lines.push("    config[\"commands\"] = commands");
  const provider = providerConfig(runtime.provider);
  if (provider) lines.push(`    config["provider"] = ${pyLiteral(provider)}`);
  if (runtime.workingDirectory) lines.push(`    config["working_directory"] = ${pyLiteral(runtime.workingDirectory)}`);
  if (Object.prototype.hasOwnProperty.call(runtime, "streaming")) lines.push(`    config["streaming"] = ${runtime.streaming ? "True" : "False"}`);
  if (Object.prototype.hasOwnProperty.call(runtime, "includeSubAgentStreamingEvents")) lines.push(`    config["include_sub_agent_streaming_events"] = ${runtime.includeSubAgentStreamingEvents ? "True" : "False"}`);
  if (Object.prototype.hasOwnProperty.call(runtime, "infiniteSessions")) lines.push(`    config["infinite_sessions"] = {"enabled": ${runtime.infiniteSessions ? "True" : "False"}}`);
  if (runtime.ui && runtime.ui.elicitation) lines.push("    config[\"capabilities\"] = {\"ui\": {\"elicitation\": True}}");

  const skillDirs = [];
  for (const dir of ((ext.skills && ext.skills.directories) || [])) skillDirs.push(dir);
  for (const skill of context.inlineSkills) skillDirs.push(`str(PACKAGE_ROOT / "skills" / ${pyString(skill.dir)})`);
  if (skillDirs.length > 0) {
    const exprs = skillDirs.map((d) => d.startsWith("str(") ? d : pyLiteral(d));
    lines.push(`    config["skill_directories"] = [${exprs.join(", ")}]`);
  }
  if (ext.skills && (ext.skills.disabled || []).length > 0) lines.push(`    config["disabled_skills"] = ${pyLiteral(ext.skills.disabled)}`);
  if (sessionFs && sessionFs.provider && sessionFs.provider !== "real") lines.push("    config[\"create_session_fs_handler\"] = create_session_fs_handler");
  lines.push("    return _make_session_config(config)");

  lines.push(
    "",
    "",
    "def _event_type(event: Any) -> str:",
    "    event_type = getattr(event, \"type\", \"\")",
    "    return str(getattr(event_type, \"value\", event_type))",
    "",
    "",
    "def _event_data(event: Any) -> Any:",
    "    return getattr(event, \"data\", None)",
    "",
    "",
    "def _handle_session_event(event: Any) -> None:",
    "    event_type = _event_type(event)",
    "    data = _event_data(event)",
    "    if event_type == \"assistant.message\":",
    "        print(getattr(data, \"content\", \"\"), file=sys.stderr)",
  );
  if (broadcast) lines.push("        broadcast(DEFAULT_BROADCAST_CHANNEL, event_type, {\"content\": getattr(data, \"content\", \"\")})");
  lines.push(
    "    elif event_type == \"session.error\":",
    "        print(f\"Session error: {getattr(data, 'message', data)}\", file=sys.stderr)",
  );
  if (broadcast) lines.push("        broadcast(DEFAULT_BROADCAST_CHANNEL, event_type, {\"message\": str(getattr(data, \"message\", data))})");

  lines.push(
    "",
    "",
    "async def _create_session(client: CopilotClient, session_config: dict[str, Any]) -> Any:",
    "    try:",
    "        return await client.create_session(session_config)  # type: ignore[arg-type]",
    "    except TypeError:",
    "        return await client.create_session(**_as_create_session_kwargs(session_config))",
    "",
    "",
    "async def _run() -> None:",
    "    client = _build_client()",
  );
  if (ext.lifecycle && ext.lifecycle.handler) lines.push("    client.on(on_lifecycle)");
  lines.push(
    "    session = None",
    "    inbox_task = None",
    "    try:",
    "        session_config = _build_session_config()",
    "        session = await _create_session(client, session_config)",
    "        session.on(_handle_session_event)",
  );
  if (broadcast) lines.push("        broadcast(DEFAULT_BROADCAST_CHANNEL, \"session.created\", {\"sessionId\": session.session_id})");
  if (inbox) lines.push("        inbox_task = asyncio.create_task(poll_inbox(INBOX_PATH))");
  lines.push(
    "        initial_prompt = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(\"AMP_INITIAL_PROMPT\")",
    "        if initial_prompt:",
    "            await session.send_and_wait(initial_prompt)",
    "        elif inbox_task is not None:",
    "            await inbox_task",
    "        else:",
    "            print(\"No initial prompt provided. Set AMP_INITIAL_PROMPT or pass argv[1].\", file=sys.stderr)",
    "    finally:",
    "        if inbox_task is not None:",
    "            inbox_task.cancel()",
    "            try:",
    "                await inbox_task",
    "            except asyncio.CancelledError:",
    "                pass",
    "        if session is not None:",
    "            disconnect = getattr(session, \"disconnect\", None)",
    "            if disconnect is not None:",
    "                await disconnect()",
    "        stop = getattr(client, \"stop\", None)",
    "        if stop is not None:",
    "            await stop()",
    "",
    "",
    "def main() -> None:",
    "    asyncio.run(_run())",
    "",
    "",
    "if __name__ == \"__main__\":",
    "    try:",
    "        main()",
    "    except KeyboardInterrupt:",
    "        print(\"Interrupted. Shutting down.\", file=sys.stderr)",
  );

  return lines.join("\n");
}

function renderPyproject(manifest, pkg, deps) {
  const depLines = deps.map((dep) => `  ${pyString(dep)},`).join("\n");
  const description = manifest.agent.description || `${manifest.agent.name} generated Copilot SDK agent`;
  return `[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = ${pyString(manifest.agent.name)}
version = ${pyString(manifest.agent.version || "0.1.0")}
description = ${pyString(description)}
readme = "README.md"
requires-python = ">=3.11"
license = { text = ${pyString(manifest.agent.license || "MIT")} }
dependencies = [
${depLines}
]

[project.scripts]
${pkg} = "${pkg}.main:main"

[tool.setuptools.packages.find]
where = ["src"]

[tool.uv]
package = true
`;
}

function renderReadme(plan, pkg, deps, context) {
  const manifest = plan.manifest;
  const surfaces = (plan.surfaces || []).map((s) => `- ${s.id}: ${s.description || s.sdkSurface || s.ampField || "wired"}`).join("\n") || "- none";
  const todos = [];
  for (const tool of manifest.extensions.tools || []) if (tool.handler) todos.push(`- Tool ${tool.name}: wire handler ${tool.handler}.`);
  const permissions = manifest.extensions.permissions || {};
  if (permissions.mode === "custom") todos.push(`- Permissions: wire custom handler${permissions.handler ? ` ${permissions.handler}` : ""}.`);
  if (manifest.extensions.lifecycle && manifest.extensions.lifecycle.handler) todos.push(`- Lifecycle: wire ${manifest.extensions.lifecycle.handler}.`);
  if (manifest.extensions.userInput && manifest.extensions.userInput.handler) todos.push(`- User input: wire ${manifest.extensions.userInput.handler}.`);
  for (const [key, value] of Object.entries(manifest.extensions.hooks || {})) if (value) todos.push(`- Hook ${key}: port ${value}.`);
  const todoText = todos.length ? todos.join("\n") : "- none";
  return `# ${manifest.agent.displayName || manifest.agent.name}

${manifest.agent.description || "Generated Copilot SDK Python agent."}

## Quickstart

\`\`\`bash
uv pip install -e .
python -m ${pkg}.main "Hello from AMP"
\`\`\`

Non-uv users can install the same dependencies with:

\`\`\`bash
python -m pip install -r requirements.txt
python -m pip install -e .
\`\`\`

## Dependencies

${deps.map((dep) => `- ${dep}`).join("\n")}

## Wired AMP surfaces

${surfaces}

## Generated TODO stubs

${todoText}

Initial prompts come from argv[1] or the \`AMP_INITIAL_PROMPT\` environment variable.
`;
}

function renderEnvExample(env) {
  const keys = Object.keys(env || {}).sort();
  if (keys.length === 0) return "# Add deployment environment variables here.\n";
  return keys.map((key) => `${key}=${env[key] || ""}`).join("\n") + "\n";
}

function renderSkill(skill) {
  return `# ${skill.name}

${skill.description}

${skill.instructions}
`;
}

async function generate(plan) {
  const manifest = plan.manifest;
  if (!manifest || !manifest.agent || manifest.agent.language !== "python") {
    throw new Error("python generator requires manifest.agent.language='python'");
  }

  const pkg = snakeCase(manifest.agent.name);
  const ext = manifest.extensions || {};
  const deps = dependencyList(manifest, false);
  const context = {
    toolModules: [],
    hookImports: [],
    inlineSkills: [],
  };

  addFile(plan, "pyproject.toml", renderPyproject(manifest, pkg, deps));
  addFile(plan, "requirements.txt", `${deps.join("\n")}\n`);
  addFile(plan, ".gitignore", "__pycache__/\n.venv/\ndist/\n*.egg-info/\n.env\n");
  addFile(plan, ".env.example", renderEnvExample((manifest.deployment && manifest.deployment.env) || {}));

  addPyFile(plan, rel("src", pkg, "__init__.py"), "from .main import main\n");
  addPyFile(plan, rel("src", pkg, "tools", "__init__.py"), "");

  let usesMemoryStore = false;
  for (const tool of ext.tools || []) {
    const moduleName = snakeCase(tool.name, "tool");
    context.toolModules.push(moduleName);
    if (tool.stub && ["memoryRead", "memoryWrite", "memoryList"].includes(tool.stub.kind)) usesMemoryStore = true;
    addPyFile(plan, rel("src", pkg, "tools", `${moduleName}.py`), renderTool(plan, pkg, tool));
  }
  if (usesMemoryStore) addPyFile(plan, rel("src", pkg, "memory_store.py"), renderMemoryStore());

  const hooks = ext.hooks || {};
  const activeHooks = HOOKS.filter(([ampKey]) => hooks[ampKey]);
  if (activeHooks.length > 0) {
    addPyFile(plan, rel("src", pkg, "hooks", "__init__.py"), "");
    for (const [ampKey, snake, inputType, outputType] of activeHooks) {
      context.hookImports.push({ module: snake, name: snake });
      addPyFile(plan, rel("src", pkg, "hooks", `${snake}.py`), renderHookFile(snake, inputType, outputType, hooks[ampKey]));
    }
  }

  const permissions = ext.permissions || { mode: "custom" };
  if (permissions.mode === "allowList" || permissions.mode === "custom") {
    addPyFile(plan, rel("src", pkg, "permissions.py"), renderPermissions(permissions.mode, permissions.autoApprove || [], permissions.handler));
  }

  if (ext.lifecycle && ext.lifecycle.handler) addPyFile(plan, rel("src", pkg, "lifecycle.py"), renderLifecycle(ext.lifecycle.handler));
  if (ext.userInput && ext.userInput.handler) addPyFile(plan, rel("src", pkg, "user_input.py"), renderUserInput(ext.userInput.handler));
  if ((ext.commands || []).length > 0) addPyFile(plan, rel("src", pkg, "commands.py"), renderCommands(ext.commands));

  if (ext.sessionFs && ext.sessionFs.provider === "memory") addPyFile(plan, rel("src", pkg, "session_fs.py"), renderSessionFsMemory());
  if (ext.sessionFs && ext.sessionFs.provider === "custom") addPyFile(plan, rel("src", pkg, "session_fs.py"), renderSessionFsCustom(ext.sessionFs.handler || "<custom handler>"));

  for (const skill of ((ext.skills && ext.skills.inline) || [])) {
    const dir = snakeCase(skill.name, "skill");
    const rendered = renderSkill({
      name: skill.name,
      description: skill.description,
      instructions: readIfExistingFile(plan, skill.instructions),
    });
    context.inlineSkills.push({ dir });
    addFile(plan, rel("src", pkg, "skills", dir, "SKILL.md"), rendered);
  }

  if (manifest.communication && (manifest.communication.handoff || []).length > 0) {
    addPyFile(plan, rel("src", pkg, "comms", "__init__.py"), "");
    addPyFile(plan, rel("src", pkg, "comms", "handoff.py"), renderHandoff(manifest.communication.handoff));
  }

  addPyFile(plan, rel("src", pkg, "main.py"), renderMain(plan, pkg, context));
  addFile(plan, "README.md", renderReadme(plan, pkg, deps, context));
  addFile(plan, "swe.amp.lock.json", stableJson({
    ampVersion: AMP_VERSION,
    frameworkVersion: FRAMEWORK_VERSION,
    sdkProtocolVersion: COPILOT_SDK_PROTOCOL_VERSION,
    generatedAt: "1970-01-01T00:00:00.000Z",
    sourceManifest: manifest,
    language: "python",
  }));

  addLog(plan, `Generated Python project '${manifest.agent.name}' as package '${pkg}'`);
  if ((ext.tools || []).length > 0) addLog(plan, `Wired ${ext.tools.length} Python tool(s)`);
  if ((ext.mcpServers || []).length > 0) addLog(plan, `Wired ${ext.mcpServers.length} MCP server(s)`);
  if ((ext.customAgents || []).length > 0) addLog(plan, `Wired ${ext.customAgents.length} custom agent(s)`);
  if (activeHooks.length > 0) addLog(plan, `Wired ${activeHooks.length} session hook(s)`);
  if (permissions.mode) addLog(plan, `Wired ${permissions.mode} permissions`);
  if (ext.skills && ((ext.skills.directories || []).length > 0 || (ext.skills.inline || []).length > 0 || (ext.skills.disabled || []).length > 0)) addLog(plan, "Wired skills configuration");
  if (ext.systemMessage) addLog(plan, "Wired system message configuration");
  if (ext.sessionFs) addLog(plan, `Wired ${ext.sessionFs.provider} session filesystem`);
  if (ext.lifecycle && ext.lifecycle.handler) addLog(plan, "Wired lifecycle handler stub");
  if (ext.userInput && ext.userInput.handler) addLog(plan, "Wired user input handler stub");
  if ((ext.commands || []).length > 0) addLog(plan, `Wired ${ext.commands.length} command(s)`);
  if (manifest.communication) addLog(plan, "Wired communication configuration");
}

module.exports = { generate, language: "python" };
