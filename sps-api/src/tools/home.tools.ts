import type Anthropic from "@anthropic-ai/sdk"
import { log } from "../utils/log"

// Tools available to the home-page agent (no project exists yet)
export const homeToolDefinitions: Anthropic.Tool[] = [
  {
    name: "create_project",
    description:
      "Propose a new SPS project. The app shows the user a card with Yes / No buttons; the project is created only " +
      "if they press Yes — so this card is how you ask whether to create a project: call it whenever the user may want one " +
      "(a clear request, or just a service name / a goal like 'I want to make BKKB service simplification'), never ask in text. " +
      "Do not call it for greetings or general questions about SPS.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Short project title, 2–6 words, Title Case, e.g. 'Passport Service Simplification'",
        },
        goal: {
          type: "string",
          description: "What the simplification should achieve — one sentence, max 20 words, e.g. 'Issue death certificates online within 3 working days, with no office visit.' Do not invent numbers the user did not give; describe the direction instead.",
        },
        description: {
          type: "string",
          description: "Everything the user said about the service/process, kept in full detail. Empty string if nothing beyond the name.",
        },
      },
      required: ["name", "goal"],
    },
  },
]

export interface HomeToolResult {
  summary: string
  sseEvents: object[]
}

export function executeHomeTool(name: string, input: Record<string, unknown>): HomeToolResult {
  if (name === "create_project") {
    // Nothing is written here: the user confirms on the Yes / No card, and the
    // frontend then creates the project through POST /api/projects
    const projectName = String(input.name ?? "").trim() || "Untitled Project"
    const description = String(input.description ?? "").trim()
    const goal = String(input.goal ?? "").trim()
    log.tool(`create_project  proposed name="${projectName}"`)
    return {
      summary: `Project "${projectName}" proposed; waiting for the user's Yes / No.`,
      sseEvents: [{ type: "project_proposed", name: projectName, description, goal }],
    }
  }

  log.error(`executeHomeTool: unknown tool "${name}"`)
  return { summary: `Unknown tool: ${name}`, sseEvents: [] }
}
