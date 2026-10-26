import type Anthropic from "@anthropic-ai/sdk"

// Quick replies: when the assistant asks the user to pick between a few answers, they are
// shown as buttons under its message; a click sends that answer as the user's reply.

export const choicesToolDefinitions: Anthropic.Tool[] = [
  {
    name: "offer_choices",
    description:
      "Show the user 2-5 short answers as buttons under your message, whenever you ask them to choose " +
      "(e.g. \"Use all\" / \"Reject all\" / \"One by one\", \"Yes\" / \"No\", which step to drop). A click sends that text as their reply. " +
      "Write the question itself in your message, but do not also list the options as text. Call it at most once, as your last action of the turn.",
    input_schema: {
      type: "object",
      properties: {
        options: {
          type: "array",
          items: { type: "string", description: "A short reply in the user's words, 1-5 words, in the user's language" },
          minItems: 2,
          maxItems: 5,
        },
      },
      required: ["options"],
    },
  },
]

/** The options as given, cleaned (short, distinct, 2-5 of them); empty when unusable */
export function cleanChoices(input: Record<string, unknown>): string[] {
  const list = Array.isArray(input.options) ? input.options : []
  const out = [...new Set(list.map((o) => String(o ?? "").trim()).filter((o) => o && o.length <= 60))].slice(0, 5)
  return out.length >= 2 ? out : []
}
