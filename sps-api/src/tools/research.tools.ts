import type Anthropic from "@anthropic-ai/sdk"
import { addTextDocument } from "../services/ingest"

// Web research from the chat rail, kept for the AS-IS: the chat searches the web
// (web_search), shows the user what it found, and saves it as a "Web research" document
// in the project's files — the AS-IS then reads it like any uploaded document.

export const researchToolDefinitions: Anthropic.Tool[] = [{
  name: "save_web_research",
  description: "Save what you found with web_search as a \"Web research\" document in the project's files, so the AS-IS (and later steps) can read and cite it. Call it when the user asked you to research / search the web for the AS-IS or the service (or agrees to save it). Only sources you actually got from web_search in this conversation are kept.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title, e.g. \"Monthly welfare grant procedure\"" },
      findings: { type: "string", description: "The findings as short Markdown: the procedure steps, actors, documents, fees, times, laws, systems — each point ending with the number of its source, e.g. [1]" },
      sources: {
        type: "array",
        items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } }, required: ["url"] },
        description: "The web pages the findings come from, in the order of their numbers",
      },
    },
    required: ["title", "findings", "sources"],
  },
}]

const norm = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/#.*$/, "").replace(/\/+$/, "")

/** Saves the research; `retrieved` = URLs that really came back from web_search in this chat request */
export function saveWebResearch(projectId: string, input: Record<string, unknown>, retrieved: Map<string, { url: string; title: string }>) {
  const title = String(input.title ?? "Web research").trim().slice(0, 80) || "Web research"
  const findings = String(input.findings ?? "").trim()
  const declared = (Array.isArray(input.sources) ? input.sources : []) as Array<{ title?: string; url?: string }>
  const sources = declared.flatMap((s, i) => {
    const hit = s.url ? retrieved.get(norm(s.url)) : undefined
    return hit ? [{ n: i + 1, title: s.title || hit.title, url: hit.url }] : []
  })
  if (!findings) return { summary: "Nothing saved: the findings are empty.", saved: false }
  if (!sources.length) return { summary: "Nothing saved: none of the sources came from web_search in this conversation. Search first, then save with the URLs you got.", saved: false }

  const date = new Date().toISOString().slice(0, 10)
  const text = [
    `# Web research — ${title}`,
    `Saved from the assistant chat on ${date}. Found with web search at the user's request (not from the uploaded documents).`,
    "",
    findings,
    "",
    "## Sources",
    ...sources.map((s) => `[${s.n}] ${s.title} — ${s.url}`),
  ].join("\n")
  const dropped = declared.length - sources.length
  addTextDocument(projectId, `Web research - ${title} (${date}).md`, text)
  return {
    summary: `Saved "Web research - ${title}" to the project's files with ${sources.length} source(s)${dropped ? ` (${dropped} not found in the search results were left out)` : ""}. The AS-IS will use it.`,
    saved: true,
  }
}
