import type Anthropic from "@anthropic-ai/sdk"

// Word documents of an approved TO-BE (run in routes/chat.ts: writing the file is async)
export const documentToolDefinitions: Anthropic.Tool[] = [
  {
    name: "create_document",
    description: "Create a Word (.docx) document from an approved TO-BE: the TO-BE process, its architecture diagram (the systems from the Digitalization Analysis), or both. It is saved under Outputs → the version → TO-BE Impact Analysis → Documents, where the user downloads it. Use when the user asks for a Word document, report or file of the TO-BE, or for an architecture diagram.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", enum: ["tobe", "architecture", "both"], description: "tobe: the TO-BE process · architecture: the architecture diagram · both: one document with both" },
        version: { type: "integer", description: "Version number, only when the user names one; otherwise the open (or latest) approved version is used" },
      },
      required: ["content"],
    },
  },
]
