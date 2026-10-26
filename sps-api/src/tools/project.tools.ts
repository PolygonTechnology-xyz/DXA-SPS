import type Anthropic from "@anthropic-ai/sdk"
import { db } from "../db/index"
import type { ToolContext, ToolResult } from "../types"

export const projectToolDefinitions: Anthropic.Tool[] = [
  {
    name: "update_project",
    description: "Update the project name, description, or goal (what the simplification should achieve). Change the goal only when the user asks.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "New project name" },
        description: { type: "string", description: "New project description" },
        goal: { type: "string", description: "New goal — one sentence, max 20 words, as the user stated it" },
      },
    },
  },
]

export function executeProjectTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): ToolResult {
  if (name === "update_project") {
    const cols: string[] = []
    const vals: unknown[] = []
    if (input.name) { cols.push("name = ?"); vals.push(input.name) }
    if (input.description) { cols.push("description = ?"); vals.push(input.description) }
    // a goal the user asked for in the chat is theirs
    if (input.goal) { cols.push("goal = ?", "goal_by = 'user'"); vals.push(input.goal) }
    if (cols.length) {
      cols.push("updated_at = unixepoch()")
      vals.push(ctx.projectId)
      db.query(`UPDATE projects SET ${cols.join(", ")} WHERE id = ?`).run(...vals)
    }
    return {
      summary: "Project details updated.",
      projectUpdate: {
        name: input.name as string | undefined,
        description: input.description as string | undefined,
      },
      sseEvents: [{
        type: "project_updated",
        name: input.name,
        description: input.description,
        goal: input.goal,
      }],
    }
  }

  return { summary: "Unknown project tool." }
}
