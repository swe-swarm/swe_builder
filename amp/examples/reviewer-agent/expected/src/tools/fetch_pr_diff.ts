import { defineTool } from "@github/copilot-sdk";
import type { ToolInvocation } from "@github/copilot-sdk";

const parameters = {
  "type": "object",
  "required": [
    "prNumber"
  ],
  "properties": {
    "prNumber": {
      "type": "integer"
    }
  }
} as const;

export const tool_fetch_pr_diff = defineTool("fetch_pr_diff", {
  description: "Fetch a pull request diff for review.",
  parameters,
  handler: async () => "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,3 +1,3 @@\n-console.log(\"old behavior\");\n+console.log(\"new behavior\");\n",
});

export default tool_fetch_pr_diff;
