import type Anthropic from "@anthropic-ai/sdk"
import type { ToolContext, ToolResult } from "../types"

export const navigationToolDefinitions: Anthropic.Tool[] = [
  {
    name: "navigate",
    description: "Navigate the UI to a different project pane.",
    input_schema: {
      type: "object",
      properties: {
        pane: { type: "string", enum: ["overview", "asis", "tobe", "files"] },
      },
      required: ["pane"],
    },
  },
]

export function executeNavigationTool(
  name: string,
  input: Record<string, unknown>,
  _ctx: ToolContext,
): ToolResult {
  if (name === "navigate") {
    return {
      summary: `Navigated to ${input.pane}.`,
      sseEvents: [{ type: "action", name: "navigate", payload: { pane: input.pane } }],
    }
  }

  return { summary: "Unknown navigation tool." }
}
