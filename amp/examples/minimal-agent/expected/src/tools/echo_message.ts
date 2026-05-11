import { defineTool } from "@github/copilot-sdk";
import type { ToolInvocation } from "@github/copilot-sdk";

const parameters = {
  "type": "object",
  "properties": {
    "message": {
      "type": "string"
    }
  }
} as const;

export const tool_echo_message = defineTool("echo_message", {
  description: "Echo the provided message.",
  parameters,
  handler: async (args: Record<string, unknown>) => args,
});

export default tool_echo_message;
