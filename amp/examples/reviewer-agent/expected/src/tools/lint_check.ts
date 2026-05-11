import { defineTool } from "@github/copilot-sdk";
import type { ToolInvocation } from "@github/copilot-sdk";

const parameters = {
  "type": "object",
  "required": [
    "path"
  ],
  "properties": {
    "path": {
      "type": "string"
    }
  }
} as const;

export const tool_lint_check = defineTool("lint_check", {
  description: "Run lint checks for a path.",
  parameters,
  handler: async () => "no issues",
});

export default tool_lint_check;
