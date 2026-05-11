import { defineTool } from "@github/copilot-sdk";
import type { ToolInvocation } from "@github/copilot-sdk";

const parameters = {
  "type": "object",
  "required": [
    "prNumber",
    "body"
  ],
  "properties": {
    "prNumber": {
      "type": "integer"
    },
    "body": {
      "type": "string"
    }
  }
} as const;

export const tool_post_review_comment = defineTool("post_review_comment", {
  description: "Post a review comment back to the pull request.",
  parameters,
  handler: async (args: Record<string, unknown>) => args,
});

export default tool_post_review_comment;
