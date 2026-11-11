import type { ToolContext, ToolResult } from "../types"
import { stepToolDefinitions, executeStepTool } from "./step.tools"
import { projectToolDefinitions, executeProjectTool } from "./project.tools"
import { generationToolDefinitions, executeGenerationTool } from "./generation.tools"
import { navigationToolDefinitions, executeNavigationTool } from "./navigation.tools"
import { reviewToolDefinitions, executeReviewTool } from "./review.tools"
import { log } from "../utils/log"
import { activeInfo } from "../services/versions"

// All tool definitions sent to Claude
export const allToolDefinitions = [
  ...stepToolDefinitions,
  ...projectToolDefinitions,
  ...generationToolDefinitions,
  ...navigationToolDefinitions,
  ...reviewToolDefinitions,
]

// Routes a tool call to the right executor
export function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): ToolResult {
  // An approved AS-IS / TO-BE is never changed: the user is asked (card in the chat rail)
  // whether to make a new version, and the change is made there once they say yes
  const lock = activeInfo(ctx.projectId)
  const STEP_TOOLS = ["update_step", "add_step", "remove_step", "move_step", "merge_steps"]
  const target: "asis" | "tobe" | null =
    STEP_TOOLS.includes(name) ? (input.step_type === "tobe" ? "tobe" : "asis")
    : name === "generate_asis" || name === "decide_findings" || name === "mark_unknown" ? "asis"
    : name === "generate_tobe" ? "tobe"
    : null
  if (lock && target && (target === "asis" ? lock.asis_locked : lock.tobe_locked)) {
    const what = target === "asis" ? "AS-IS" : "TO-BE"
    log.tool(`${name}: blocked — ${what} v${lock.version} is approved`)
    return {
      summary: `NOT DONE: ${what} version ${lock.version} is approved and locked, so it was not changed. ` +
        `The app now shows the user a card asking whether to create a new version for this change. ` +
        `Tell the user in one short sentence that this ${what} is approved and that they can create a new version with the button below; ` +
        `do not call any other tool that changes the ${what} in this turn.`,
      sseEvents: [{ type: "version_locked", what: target, version: lock.version }],
    }
  }

  if (["update_step", "add_step", "remove_step", "move_step", "merge_steps"].includes(name)) {
    return executeStepTool(name, input, ctx)
  }
  if (name === "update_project") {
    return executeProjectTool(name, input, ctx)
  }
  if (["generate_asis", "generate_tobe"].includes(name)) {
    return executeGenerationTool(name, input, ctx)
  }
  if (name === "decide_findings" || name === "mark_unknown") {
    return executeReviewTool(name, input, ctx)
  }
  if (name === "navigate") {
    return executeNavigationTool(name, input, ctx)
  }
  log.error(`executeTool: unknown tool "${name}" — input=${JSON.stringify(input).slice(0, 80)}`)
  return { summary: `Unknown tool: ${name}` }
}
