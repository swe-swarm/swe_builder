import * as fs from "node:fs";

import { createRequire } from "node:module";

import * as path from "node:path";

import { fileURLToPath, pathToFileURL } from "node:url";

import { CopilotClient, approveAll } from "@github/copilot-sdk";

import type { CommandDefinition, CopilotClientOptions, ElicitationHandler, MCPServerConfig, PermissionHandler, SessionConfig, SessionEvent, UserInputHandler } from "@github/copilot-sdk";

import { tool_echo_message } from "./tools/echo_message.js";

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, "..");

const manifestRoot = path.resolve(projectRoot, "..");

const requireFromHere = createRequire(import.meta.url);

const AGENT_ID = "minimal-agent";

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

function handleSessionEvent(event: SessionEvent): void {
  if (event.type === "assistant.message") {
    const data = (event as any).data;
    console.error(typeof data?.content === "string" ? data.content : JSON.stringify(data));
  }
  if (event.type === "session.error") {
    console.error("[session.error]", JSON.stringify((event as any).data ?? event));
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
    clientName: "minimal-agent",
    model: "claude-sonnet-4.5",
    tools: [tool_echo_message],
    onPermissionRequest: approveAll,
    infiniteSessions: { enabled: false },
    streaming: true,
    includeSubAgentStreamingEvents: false,
    workingDirectory: path.resolve(manifestRoot, "."),
  };

  const session = await client.createSession(sessionConfig);
  session.on(handleSessionEvent);

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
  await client.stop();
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
