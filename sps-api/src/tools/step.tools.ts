import type Anthropic from "@anthropic-ai/sdk"
import { db } from "../db/index"
import type { ToolContext, ToolResult } from "../types"
import { nanoid } from "../utils/id"
import { normalizeDigital, REVIEW_FIELDS } from "../services/asis-state"

export const stepToolDefinitions: Anthropic.Tool[] = [
  {
    name: "update_step",
    description: "Update a specific field in an AS-IS or TO-BE step.",
    input_schema: {
      type: "object",
      properties: {
        step_type: { type: "string", enum: ["asis", "tobe"] },
        step_number: { type: "number" },
        field: {
          type: "string",
          description:
            "AS-IS fields: step_name, actor (performer P), action, input, output, time_days (T, working days), pain_points, digital_status (manual | partly | online), digital_note (system name), legal_basis, step_type (activity | decision | document | message), visit (true when the citizen comes in person), fee (taka), no_goto (decision: step a No returns to), notes. " +
            "TO-BE fields: step_name, actor, action, channel, time_days, citizen_touchpoints, simplification_rationale, legal_basis, digital_how (how a digital step is digitalized: system, automation, notifications), if_rejected (for a decision: who tells the applicant, how, what to fix, where the flow returns, appeal)",
        },
        value: { type: "string" },
        confirmed: { type: "boolean", description: "Set to true only after the user explicitly confirms clearing a legal_basis field." },
      },
      required: ["step_type", "step_number", "field", "value"],
    },
  },
  {
    name: "add_step",
    description: "Add a new step to AS-IS or TO-BE. Inserted after after_step_number (omit to append at end).",
    input_schema: {
      type: "object",
      properties: {
        step_type: { type: "string", enum: ["asis", "tobe"] },
        after_step_number: { type: "number", description: "Insert after this step number. Omit to append." },
        step_name: { type: "string" },
        actor: { type: "string" },
        action: { type: "string" },
        input: { type: "string" },
        output: { type: "string" },
        time_days: { type: "number" },
        pain_points: { type: "string" },
        notes: { type: "string" },
        channel: { type: "string", description: "TO-BE only: digital, in_person, or hybrid" },
        citizen_touchpoints: { type: "number" },
        simplification_rationale: { type: "string" },
        legal_basis: { type: "string" },
        digital_how: { type: "string", description: "TO-BE digital/hybrid step: how it is digitalized (system, automation, notifications)" },
        if_rejected: { type: "string", description: "TO-BE decision: what happens on a No (who tells the applicant, how, what to fix, where the flow returns, appeal)" },
      },
      required: ["step_type", "step_name", "actor", "action"],
    },
  },
  {
    name: "remove_step",
    description: "Remove a step. Remaining steps are renumbered. TO-BE steps with legal_basis are warned first — set confirmed=true only after the user explicitly acknowledges the legal risk.",
    input_schema: {
      type: "object",
      properties: {
        step_type: { type: "string", enum: ["asis", "tobe"] },
        step_number: { type: "number" },
        confirmed: { type: "boolean", description: "Set to true only after the user has explicitly confirmed they understand the legal risk of removing this step." },
      },
      required: ["step_type", "step_number"],
    },
  },
  {
    name: "move_step",
    description: "Move an existing step to a different position. Use when the user asks to reorder, move, or shift a step. Provide after_step_number=0 to move to the very beginning.",
    input_schema: {
      type: "object",
      properties: {
        step_type: { type: "string", enum: ["asis", "tobe"] },
        step_number: { type: "number", description: "The step to move" },
        after_step_number: { type: "number", description: "Place the step after this number. Use 0 to move to the beginning." },
      },
      required: ["step_type", "step_number", "after_step_number"],
    },
  },
  {
    name: "merge_steps",
    description: "Merge two or more steps into a single step. Use when the user asks to combine, consolidate, or merge steps. The merged step lands at the position of the first step_number. TO-BE: at least one merged step must not have a legal_basis conflict.",
    input_schema: {
      type: "object",
      properties: {
        step_type: { type: "string", enum: ["asis", "tobe"] },
        step_numbers: {
          type: "array",
          items: { type: "number" },
          description: "Array of step numbers to merge (minimum 2). Order does not matter.",
        },
        step_name: { type: "string", description: "Name for the merged step" },
        actor: { type: "string" },
        action: { type: "string", description: "Combined action description" },
        input: { type: "string" },
        output: { type: "string" },
        time_days: { type: "number", description: "Total time for the merged step" },
        pain_points: { type: "string", description: "AS-IS: combined pain points" },
        notes: { type: "string" },
        channel: { type: "string", description: "TO-BE only: digital, in_person, or hybrid" },
        citizen_touchpoints: { type: "number" },
        simplification_rationale: { type: "string", description: "TO-BE: explain why merging simplifies the process" },
        legal_basis: { type: "string" },
        digital_how: { type: "string", description: "TO-BE digital/hybrid step: how it is digitalized (system, automation, notifications)" },
        if_rejected: { type: "string", description: "TO-BE decision: what happens on a No (who tells the applicant, how, what to fix, where the flow returns, appeal)" },
      },
      required: ["step_type", "step_numbers", "step_name", "actor", "action"],
    },
  },
]

export function executeStepTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): ToolResult {
  const { projectId } = ctx
  let { asisSteps, tobeSteps } = ctx

  // ── update_step ────────────────────────────────────────────────────────────
  if (name === "update_step") {
    const { step_type, step_number, field, value } = input

    if (step_type === "asis") {
      // pain point / digital status / law set in chat are the user's word: mark them so
      const reviewField = (REVIEW_FIELDS as readonly string[]).includes(field as string) ? field as string : null
      asisSteps = asisSteps.map((s) => {
        if (s.step_number !== step_number) return s
        // typed fields: visit is a yes/no, fee / time / no_goto are numbers
        const typed = field === "digital_status" ? (normalizeDigital(String(value)) || value)
          : field === "visit" ? /^(1|true|yes|y|হ্যাঁ)$/i.test(String(value).trim())
          : ["fee", "time_days", "no_goto"].includes(field as string) ? Number(String(value).replace(/[^\d.]/g, "")) || 0
          : value
        const next = { ...s, [field as string]: typed }
        if (field === "digital_status" && !normalizeDigital(String(value))) next.digital_note = String(value)
        if (reviewField) {
          next.field_sources = { ...s.field_sources, [reviewField]: "user" }
          next.unknown_fields = (s.unknown_fields ?? []).filter((f) => f !== reviewField)
        }
        return next
      })
      db.query("UPDATE projects SET asis_steps = ?, updated_at = unixepoch() WHERE id = ?")
        .run(JSON.stringify(asisSteps), projectId)
      return {
        summary: `Updated AS-IS step ${step_number} "${field}" → "${value}".`,
        updatedAsisSteps: asisSteps,
        sseEvents: [{ type: "step_updated", step_type: "asis", steps: asisSteps }],
      }
    }

    // TO-BE: warn before clearing legal_basis — require explicit confirmation
    const existing = tobeSteps.find((s) => s.step_number === step_number)
    if (existing?.legal_basis && field === "legal_basis" && !value && !input.confirmed) {
      return { summary: `Step ${step_number} has legal protection (${existing.legal_basis}). To clear it, call update_step again with confirmed=true after the user acknowledges the legal risk.` }
    }
    tobeSteps = tobeSteps.map((s) =>
      s.step_number === step_number ? { ...s, [field as string]: value } : s
    )
    db.query("UPDATE projects SET tobe_steps = ?, updated_at = unixepoch() WHERE id = ?")
      .run(JSON.stringify(tobeSteps), projectId)
    return {
      summary: `Updated TO-BE step ${step_number} "${field}" → "${value}".`,
      updatedTobeSteps: tobeSteps,
      sseEvents: [{ type: "step_updated", step_type: "tobe", steps: tobeSteps }],
    }
  }

  // ── add_step ───────────────────────────────────────────────────────────────
  if (name === "add_step") {
    const { step_type, after_step_number, ...fields } = input
    const insertAfter = after_step_number != null ? Number(after_step_number) : Infinity

    if (step_type === "asis") {
      const newStep = {
        uid: nanoid().slice(0, 10),
        step_number: insertAfter + 0.5,
        step_name: String(fields.step_name ?? ""),
        actor: String(fields.actor ?? ""),
        action: String(fields.action ?? ""),
        step_source: "user",
        input: fields.input as string | undefined,
        output: fields.output as string | undefined,
        time_days: fields.time_days as number | undefined,
        pain_points: fields.pain_points as string | undefined,
        notes: fields.notes as string | undefined,
      }
      asisSteps = [...asisSteps, newStep]
        .sort((a, b) => a.step_number - b.step_number)
        .map((s, i) => ({ ...s, step_number: i + 1 }))
      db.query("UPDATE projects SET asis_steps = ?, updated_at = unixepoch() WHERE id = ?")
        .run(JSON.stringify(asisSteps), projectId)
      return {
        summary: `Added AS-IS step "${fields.step_name}".`,
        updatedAsisSteps: asisSteps,
        sseEvents: [{ type: "step_updated", step_type: "asis", steps: asisSteps }],
      }
    }

    const newStep = {
      step_number: insertAfter + 0.5,
      step_name: String(fields.step_name ?? ""),
      actor: String(fields.actor ?? ""),
      action: String(fields.action ?? ""),
      channel: (fields.channel as string) || "hybrid",
      time_days: fields.time_days as number | undefined,
      citizen_touchpoints: fields.citizen_touchpoints as number | undefined,
      simplification_rationale: String(fields.simplification_rationale ?? ""),
      legal_basis: fields.legal_basis as string | undefined,
      digital_how: fields.digital_how as string | undefined,
      if_rejected: fields.if_rejected as string | undefined,
    }
    tobeSteps = [...tobeSteps, newStep]
      .sort((a, b) => a.step_number - b.step_number)
      .map((s, i) => ({ ...s, step_number: i + 1 }))
    db.query("UPDATE projects SET tobe_steps = ?, updated_at = unixepoch() WHERE id = ?")
      .run(JSON.stringify(tobeSteps), projectId)
    return {
      summary: `Added TO-BE step "${fields.step_name}".`,
      updatedTobeSteps: tobeSteps,
      sseEvents: [{ type: "step_updated", step_type: "tobe", steps: tobeSteps }],
    }
  }

  // ── remove_step ────────────────────────────────────────────────────────────
  if (name === "remove_step") {
    const { step_type, step_number } = input

    if (step_type === "asis") {
      asisSteps = asisSteps
        .filter((s) => s.step_number !== step_number)
        .map((s, i) => ({ ...s, step_number: i + 1 }))
      db.query("UPDATE projects SET asis_steps = ?, updated_at = unixepoch() WHERE id = ?")
        .run(JSON.stringify(asisSteps), projectId)
      return {
        summary: `Removed AS-IS step ${step_number}. Steps renumbered.`,
        updatedAsisSteps: asisSteps,
        sseEvents: [{ type: "step_updated", step_type: "asis", steps: asisSteps }],
      }
    }

    const step = tobeSteps.find((s) => s.step_number === step_number)
    if (step?.legal_basis && !input.confirmed) {
      return {
        summary: `Step ${step_number} ("${step.step_name}") has legal protection: ${step.legal_basis}. Warn the user of the legal risk and ask for explicit confirmation. Then call remove_step again with confirmed=true.`,
      }
    }
    tobeSteps = tobeSteps
      .filter((s) => s.step_number !== step_number)
      .map((s, i) => ({ ...s, step_number: i + 1 }))
    db.query("UPDATE projects SET tobe_steps = ?, updated_at = unixepoch() WHERE id = ?")
      .run(JSON.stringify(tobeSteps), projectId)
    return {
      summary: `Removed TO-BE step ${step_number}. Steps renumbered.`,
      updatedTobeSteps: tobeSteps,
      sseEvents: [{ type: "step_updated", step_type: "tobe", steps: tobeSteps }],
    }
  }

  // ── move_step ──────────────────────────────────────────────────────────────
  if (name === "move_step") {
    const { step_type, step_number, after_step_number } = input
    const afterNum = Number(after_step_number)

    if (step_type === "asis") {
      const step = asisSteps.find((s) => s.step_number === step_number)
      if (!step) return { summary: `AS-IS step ${step_number} not found.` }
      // Assign fractional position: afterNum=0 → -0.5 (before everything)
      asisSteps = [...asisSteps.filter((s) => s.step_number !== step_number), { ...step, step_number: afterNum + 0.5 }]
        .sort((a, b) => a.step_number - b.step_number)
        .map((s, i) => ({ ...s, step_number: i + 1 }))
      db.query("UPDATE projects SET asis_steps = ?, updated_at = unixepoch() WHERE id = ?")
        .run(JSON.stringify(asisSteps), projectId)
      const newPos = asisSteps.findIndex((s) => s.step_name === step.step_name) + 1
      return {
        summary: `Moved AS-IS step "${step.step_name}" to position ${newPos}.`,
        updatedAsisSteps: asisSteps,
        sseEvents: [{ type: "step_updated", step_type: "asis", steps: asisSteps }],
      }
    }

    const step = tobeSteps.find((s) => s.step_number === step_number)
    if (!step) return { summary: `TO-BE step ${step_number} not found.` }
    tobeSteps = [...tobeSteps.filter((s) => s.step_number !== step_number), { ...step, step_number: afterNum + 0.5 }]
      .sort((a, b) => a.step_number - b.step_number)
      .map((s, i) => ({ ...s, step_number: i + 1 }))
    db.query("UPDATE projects SET tobe_steps = ?, updated_at = unixepoch() WHERE id = ?")
      .run(JSON.stringify(tobeSteps), projectId)
    const newPos = tobeSteps.findIndex((s) => s.step_name === step.step_name) + 1
    return {
      summary: `Moved TO-BE step "${step.step_name}" to position ${newPos}.`,
      updatedTobeSteps: tobeSteps,
      sseEvents: [{ type: "step_updated", step_type: "tobe", steps: tobeSteps }],
    }
  }

  // ── merge_steps ────────────────────────────────────────────────────────────
  if (name === "merge_steps") {
    const { step_type, step_numbers, ...fields } = input
    const nums = (step_numbers as number[]).map(Number)

    if (step_type === "asis") {
      const toMerge = asisSteps.filter((s) => nums.includes(s.step_number))
      if (toMerge.length < 2) return { summary: `Need at least 2 existing AS-IS steps to merge. Found: ${toMerge.length}.` }
      const insertAt = Math.min(...toMerge.map((s) => s.step_number)) - 0.5
      const merged = {
        step_number: insertAt,
        step_name: String(fields.step_name ?? ""),
        actor: String(fields.actor ?? ""),
        action: String(fields.action ?? ""),
        input: fields.input as string | undefined,
        output: fields.output as string | undefined,
        time_days: fields.time_days as number | undefined,
        pain_points: fields.pain_points as string | undefined,
        notes: fields.notes as string | undefined,
      }
      asisSteps = [...asisSteps.filter((s) => !nums.includes(s.step_number)), merged]
        .sort((a, b) => a.step_number - b.step_number)
        .map((s, i) => ({ ...s, step_number: i + 1 }))
      db.query("UPDATE projects SET asis_steps = ?, updated_at = unixepoch() WHERE id = ?")
        .run(JSON.stringify(asisSteps), projectId)
      return {
        summary: `Merged AS-IS steps [${nums.join(", ")}] into "${fields.step_name}". ${asisSteps.length} steps remaining.`,
        updatedAsisSteps: asisSteps,
        sseEvents: [{ type: "step_updated", step_type: "asis", steps: asisSteps }],
      }
    }

    const toMerge = tobeSteps.filter((s) => nums.includes(s.step_number))
    if (toMerge.length < 2) return { summary: `Need at least 2 existing TO-BE steps to merge. Found: ${toMerge.length}.` }
    // Block if ALL steps being merged are legally protected
    const allProtected = toMerge.every((s) => s.legal_basis)
    if (allProtected) {
      return {
        summary: `Cannot merge — all selected steps have legal_basis protection: ${toMerge.map((s) => `step ${s.step_number} (${s.legal_basis})`).join(", ")}. Clear legal_basis on at least one before merging.`,
      }
    }
    const insertAt = Math.min(...toMerge.map((s) => s.step_number)) - 0.5
    const merged = {
      step_number: insertAt,
      step_name: String(fields.step_name ?? ""),
      actor: String(fields.actor ?? ""),
      action: String(fields.action ?? ""),
      channel: (fields.channel as string) || "hybrid",
      time_days: fields.time_days as number | undefined,
      citizen_touchpoints: fields.citizen_touchpoints as number | undefined,
      simplification_rationale: String(fields.simplification_rationale ?? ""),
      legal_basis: fields.legal_basis as string | undefined,
      digital_how: fields.digital_how as string | undefined,
      if_rejected: fields.if_rejected as string | undefined,
    }
    tobeSteps = [...tobeSteps.filter((s) => !nums.includes(s.step_number)), merged]
      .sort((a, b) => a.step_number - b.step_number)
      .map((s, i) => ({ ...s, step_number: i + 1 }))
    db.query("UPDATE projects SET tobe_steps = ?, updated_at = unixepoch() WHERE id = ?")
      .run(JSON.stringify(tobeSteps), projectId)
    return {
      summary: `Merged TO-BE steps [${nums.join(", ")}] into "${fields.step_name}". ${tobeSteps.length} steps remaining.`,
      updatedTobeSteps: tobeSteps,
      sseEvents: [{ type: "step_updated", step_type: "tobe", steps: tobeSteps }],
    }
  }

  return { summary: "Unknown step tool." }
}
