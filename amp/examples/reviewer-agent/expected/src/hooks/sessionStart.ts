import type { SessionStartHandler } from "@github/copilot-sdk";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const manifestRoot = path.resolve(projectRoot, "..");
const requireFromHere = createRequire(import.meta.url);

async function importUserModule(modulePath: string): Promise<any> {
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

function pickHandler(mod: any, label: string): (...args: any[]) => any {
  const handler = mod.default ?? mod.handler;
  if (typeof handler !== "function") throw new Error(`AMP ${label} module must export default or handler function.`);
  return handler;
}

const modulePath = path.resolve(manifestRoot, "./src/hooks/sessionStart.ts");

export const handler: SessionStartHandler = async (input, invocation) => {
  console.log("[amp hook:sessionStart]", { sessionId: invocation.sessionId });
  const mod = await importUserModule(modulePath);
  const userHandler = pickHandler(mod, "hook sessionStart");
  return await userHandler(input, invocation);
};
