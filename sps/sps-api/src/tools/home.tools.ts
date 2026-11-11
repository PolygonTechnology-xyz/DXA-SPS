import type Anthropic from "@anthropic-ai/sdk"
import { log } from "../utils/log"

// Tools available to the home-page agent (no project exists yet)
export const homeToolDefinitions: Anthropic.Tool[] = [
  {
    name: "create_project",
    description:
      "Propose a new SPS project. The app shows the user a card with the details below (which they can edit) and Yes / No buttons; " +
      "the project is created only if they press Yes — so this card is how you ask whether to create a project: call it whenever the user may want one " +
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
          description:
            "What the simplification should achieve, in detail: 2–4 sentences covering the target outcome for citizens, " +
            "what should change in the process (fewer visits, documents, steps, days, cost), and who benefits. " +
            "Do not invent numbers the user did not give; describe the direction instead.",
        },
        description: {
          type: "string",
          description:
            "Service summary: what the service is, who applies for it, how it is delivered today and the known problems — " +
            "everything the user said, in full detail, written as a clear paragraph (or two). " +
            "Add only widely known general facts about the service; never invent specifics. Empty string if nothing is known beyond the name.",
        },
        country: {
          type: "string",
          description: "Country whose public service this is. 'Bangladesh' unless the user says otherwise.",
        },
        ministry: {
          type: "string",
          description: "Ministry responsible for the service, e.g. 'Ministry of Home Affairs'. The user's words, or the well-known owner of this service; empty string if not sure.",
        },
        department: {
          type: "string",
          description: "Department / directorate / division under the ministry that delivers the service, e.g. 'Department of Immigration and Passports'. Empty string if not sure.",
        },
      },
      required: ["name", "goal", "description", "country", "ministry", "department"],
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
    const text = (k: string) => String(input[k] ?? "").trim()
    const projectName = text("name") || "Untitled Project"
    log.tool(`create_project  proposed name="${projectName}"`)
    return {
      summary: `Project "${projectName}" proposed; waiting for the user's Yes / No.`,
      sseEvents: [{
        type: "project_proposed", name: projectName,
        description: text("description"), goal: text("goal"),
        country: text("country") || "Bangladesh", ministry: text("ministry"), department: text("department"),
      }],
    }
  }

  log.error(`executeHomeTool: unknown tool "${name}"`)
  return { summary: `Unknown tool: ${name}`, sseEvents: [] }
}
