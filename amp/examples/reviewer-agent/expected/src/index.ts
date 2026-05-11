import * as fs from "node:fs";

import { createRequire } from "node:module";

import * as path from "node:path";

import { fileURLToPath, pathToFileURL } from "node:url";

import { CopilotClient } from "@github/copilot-sdk";

import type { CommandDefinition, CopilotClientOptions, ElicitationHandler, MCPServerConfig, PermissionHandler, SessionConfig, SessionEvent, UserInputHandler } from "@github/copilot-sdk";

import { tool_fetch_pr_diff } from "./tools/fetch_pr_diff.js";

import { tool_lint_check } from "./tools/lint_check.js";

import { tool_post_review_comment } from "./tools/post_review_comment.js";

import * as hooks_preToolUse from "./hooks/preToolUse.js";

import * as hooks_sessionStart from "./hooks/sessionStart.js";

import { handler as permissionHandler } from "./permissions.js";

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, "..");

const manifestRoot = path.resolve(projectRoot, "..");

const requireFromHere = createRequire(import.meta.url);

const AGENT_ID = "reviewer-agent";

async function importManifestModule(relativeToManifest: string): Promise<any> {
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
}

const customAgents = [
  {
    name: "code-reviewer",
    description: "Senior engineer persona for pull request review.",
    prompt: "You are a senior software engineer reviewing PRs. Focus on correctness, tests, security, and maintainability. Cite file and line references.",
    tools: [
      "fetch_pr_diff",
      "lint_check",
      "post_review_comment"
    ],
  } as any,
  {
    name: "test-author",
    description: "Test engineer persona for writing focused tests.",
    prompt: "You write small, targeted tests for the changed behavior. Prefer clear assertions and minimal fixtures.",
    tools: [
      "fetch_pr_diff",
      "lint_check"
    ],
  } as any,
];

const hooks = {
  onPreToolUse: hooks_preToolUse.handler,
  onSessionStart: hooks_sessionStart.handler,
};

const BROADCAST_CHANNELS = [
  "reviews"
];

function broadcast(message: { channel: string; type: string; payload?: unknown }): void {
  const envelope = { ts: new Date().toISOString(), agentId: AGENT_ID, ...message };
  process.stdout.write(JSON.stringify(envelope) + "\n");
}

function broadcastToAll(type: string, payload: unknown): void {
  for (const channel of BROADCAST_CHANNELS) broadcast({ channel, type, payload });
}

function handleSessionEvent(event: SessionEvent): void {
  if (event.type === "assistant.message") {
    const data = (event as any).data;
    console.error(typeof data?.content === "string" ? data.content : JSON.stringify(data));
  }
  if (event.type === "session.error") {
    console.error("[session.error]", JSON.stringify((event as any).data ?? event));
  }
  if (event.type.startsWith("session.")) {
    broadcastToAll(event.type, (event as any).data ?? event);
  }
}

let shuttingDown = false;

async function main(): Promise<void> {
  const clientOptions: CopilotClientOptions = {
    useStdio: true,
    useLoggedInUser: true,
    logLevel: "warning",
  };

  const client = new CopilotClient(clientOptions);
  process.on("SIGINT", () => { void shutdown(client); });
  await client.start();

  const sessionConfig: SessionConfig & { capabilities?: { ui?: { elicitation?: boolean } } } = {
    clientName: "reviewer-agent",
    model: "claude-sonnet-4.5",
    tools: [tool_fetch_pr_diff, tool_lint_check, tool_post_review_comment],
    customAgents,
    defaultAgent: {
      "name": "code-reviewer"
    } as any,
    hooks,
    onPermissionRequest: permissionHandler,
    systemMessage: {
    mode: "customize",
    sections: {
      "persona": { action: "replace", content: "Be terse, surgical, and cite line numbers." },
    },
  },
    infiniteSessions: { enabled: false },
    streaming: true,
    includeSubAgentStreamingEvents: false,
    workingDirectory: path.resolve(manifestRoot, "."),
  };

  const session = await client.createSession(sessionConfig);
  session.on(handleSessionEvent);
  broadcastToAll("session.created", { sessionId: session.sessionId });

  const initialPrompt = process.argv[2] ?? process.env.AMP_INITIAL_PROMPT;
  if (initialPrompt) {
    await session.send({ prompt: initialPrompt });
  } else {
    console.error("No initial prompt provided. Pass one as argv[2] or set AMP_INITIAL_PROMPT; keeping the session open.");
  }

  await new Promise<void>(() => {});
}

async function shutdown(client: CopilotClient): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  broadcastToAll("session.stopping", {});
  await client.stop();
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
