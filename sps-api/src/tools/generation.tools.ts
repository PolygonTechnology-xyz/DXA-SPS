import type Anthropic from "@anthropic-ai/sdk"
import type { ToolContext, ToolResult } from "../types"

export const generationToolDefinitions: Anthropic.Tool[] = [
  {
    name: "generate_asis",
    description: "Start the AS-IS process analysis and generation from uploaded documents (including saved web research) or a description. Only when the user asks to start, generate or map the AS-IS — never for a request to research or search the web.",
    input_schema: {
      type: "object",
      properties: {
        input: { type: "string", description: "What to analyze — topic or process description" },
      },
      required: ["input"],
    },
  },
  {
    name: "generate_tobe",
    description: "Start the TO-BE process redesign from the approved AS-IS. Only works after the user has approved the AS-IS (all web findings decided).",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
]

export function executeGenerationTool(
  name: string,
  input: Record<string, unknown>,
  _ctx: ToolContext,
): ToolResult {
  if (name === "generate_asis") {
    return {
      summary: "AS-IS generation started.",
      sseEvents: [{ type: "action", name: "generate_asis", payload: { input: input.input } }],
    }
  }

  if (name === "generate_tobe") {
    return {
      summary: "TO-BE generation started.",
      sseEvents: [{ type: "action", name: "generate_tobe", payload: {} }],
    }
  }

  return { summary: "Unknown generation tool." }
}
