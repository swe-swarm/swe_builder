import { approveAll } from "@github/copilot-sdk";
import type { PermissionHandler } from "@github/copilot-sdk";

const AUTO_APPROVE_RULES: ReadonlyArray<{ tool: string; argsContains?: string }> = [
  {
    "tool": "lint_*"
  },
  {
    "tool": "fetch_*"
  }
];

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
