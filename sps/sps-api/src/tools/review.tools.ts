import type Anthropic from "@anthropic-ai/sdk"
import type { ToolContext, ToolResult } from "../types"
import { applyDecisions, saveAsis, REVIEW_FIELDS, FIELD_LABEL, type Decision, type ReviewField, type Step } from "../services/asis-state"

// Tools for the AS-IS review: the user's consent on web/AI findings, given in words,
// and "I don't know" answers to review questions.

export const reviewToolDefinitions: Anthropic.Tool[] = [
  {
    name: "decide_findings",
    description: "Apply the user's consent on pending findings (the F-ids under PENDING FINDINGS: information found only on the web or without a source). Call it only when the user has said which ones to use or not — e.g. \"use 1 and 3\", \"F2 বাদ দাও\", \"use all\", \"none\". accept = use it (with the user's corrected text in value if they changed it); reject = do not use it. Never accept a finding the user did not agree to.",
    input_schema: {
      type: "object",
      properties: {
        decisions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Finding id, e.g. F3" },
              decision: { type: "string", enum: ["accept", "reject"] },
              value: { type: "string", description: "Only when the user corrected the value: their version" },
            },
            required: ["id", "decision"],
          },
        },
      },
      required: ["decisions"],
    },
  },
  {
    name: "mark_unknown",
    description: "Record that the user does not know a value of an AS-IS step (they said \"don't know\", \"জানি না\", \"not sure\"), so it is no longer an open question.",
    input_schema: {
      type: "object",
      properties: {
        step_number: { type: "number" },
        field: { type: "string", enum: [...REVIEW_FIELDS] },
      },
      required: ["step_number", "field"],
    },
  },
]

export function executeReviewTool(name: string, input: Record<string, unknown>, ctx: ToolContext): ToolResult {
  if (name === "decide_findings") {
    const decisions = (Array.isArray(input.decisions) ? input.decisions : []) as Decision[]
    if (!decisions.length) return { summary: "No decisions given." }
    const { steps, results } = applyDecisions(ctx.projectId, decisions, "chat")
    return {
      summary: results.join("; "),
      updatedAsisSteps: steps as unknown as ToolContext["asisSteps"],
      sseEvents: [{ type: "step_updated", step_type: "asis", steps }, { type: "findings_updated" }],
    }
  }

  if (name === "mark_unknown") {
    const field = String(input.field) as ReviewField
    if (!REVIEW_FIELDS.includes(field)) return { summary: `Unknown field "${input.field}".` }
    const steps = (ctx.asisSteps as unknown as Step[]).map((s) => (s.step_number === Number(input.step_number)
      ? { ...s, unknown_fields: [...new Set([...(s.unknown_fields ?? []), field])] }
      : s))
    if (!steps.some((s) => s.step_number === Number(input.step_number))) return { summary: `No AS-IS step ${input.step_number}.` }
    saveAsis(ctx.projectId, { steps })
    return {
      summary: `Step ${input.step_number} · ${FIELD_LABEL[field]} marked as unknown.`,
      updatedAsisSteps: steps as unknown as ToolContext["asisSteps"],
      sseEvents: [{ type: "step_updated", step_type: "asis", steps }],
    }
  }

  return { summary: `Unknown tool: ${name}` }
}
