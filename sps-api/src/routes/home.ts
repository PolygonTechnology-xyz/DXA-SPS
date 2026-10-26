import Anthropic from "@anthropic-ai/sdk"
import { client } from "../services/ai"
import { ANTHROPIC_MODEL } from "../config"
import { streamSse } from "../utils/sse"
import { json } from "../utils/cors"
import { homeToolDefinitions, executeHomeTool } from "../tools/home.tools"
import { log, startTimer } from "../utils/log"

// ── Home-page agent: chat normally, create a project only on clear intent ────

export async function handleHome(req: Request, url: URL): Promise<Response> {
  const method = req.method.toUpperCase()

  if (method === "POST" && url.pathname === "/api/home/chat") {
    const body = await req.json() as { messages: Array<{ role: "user" | "assistant"; content: string }> }
    const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({ role: m.role, content: m.content }))

    return streamSse(async (emit) => {
      log.chat(`home start  history=${messages.length}`)

      let iteration = 0
      while (iteration < 4) {
        iteration++
        const callTimer = startTimer(`home iter=${iteration}`)
        const stream = client.messages.stream({
          model: ANTHROPIC_MODEL,
          max_tokens: 1024,
          system: HOME_SYSTEM,
          tools: homeToolDefinitions,
          messages,
        })
        stream.on("text", (text) => { callTimer.firstToken(); emit({ type: "text", text }) })
        const response = await stream.finalMessage()
        callTimer.done(response.usage, `stop=${response.stop_reason}  model=${ANTHROPIC_MODEL}`)

        log.chat(`home iter=${iteration}  stop_reason=${response.stop_reason}  usage=in:${response.usage.input_tokens} out:${response.usage.output_tokens}`)

        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")

        if (response.stop_reason === "tool_use") {
          const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
          for (const call of calls) {
            const input = call.input as Record<string, unknown>
            emit({ type: "tool_started", name: call.name, input })
            const result = executeHomeTool(call.name, input)
            for (const event of result.sseEvents) emit(event)
          }
          // The frontend shows the Yes / No card — no follow-up turn needed
          emit({ type: "done", text })
          return
        }

        if (response.stop_reason === "max_tokens") {
          const partial = response.content.filter((b) => b.type === "text")
          if (partial.length) messages.push({ role: "assistant", content: partial })
          messages.push({ role: "user", content: "Your reply was cut off. Finish it briefly." })
          continue
        }

        emit({ type: "done", text })
        return
      }

      emit({ type: "error", message: "The assistant did not finish. Please try again." })
    })
  }

  return json({ error: "not_found" }, 404)
}

const HOME_SYSTEM = `You are DXA, the assistant on the home page of the SPS (Service Process Simplification) tool. SPS helps Bangladesh government officials map a public service as it works today (AS-IS), then redesign it into a simpler TO-BE process, following the Cabinet Division SPS guideline.

Decide what the user wants:
1. ANY sign that they may want to start a project → call create_project right away. The app shows the user a card with the project name and Yes / No buttons, so the card IS the confirmation question.
   This covers clear requests ("create a passport project", "new project: trade licence renewal", "I want to make BKKB service simplification", "I want to simplify the passport service…") AND unclear ones (just a service name like "passport" or "BKKB", or a goal without the word "project").
   NEVER ask "Do you want to start a project…?", "Shall I create it?" or any other yes/no question about creating a project in text — call create_project instead, and write no text before the call.
2. Greeting, small talk, or a question (about SPS, the methodology, how the tool works, a government service in general) → answer briefly and helpfully in 2–5 sentences. Do NOT create a project.
3. If the history shows the user pressed No on a proposed project, do not propose it again unless they ask; if they say what to change (e.g. a different name), call create_project again with the change.

Reply style: plain text only — no markdown, no **bold**, no headings, no emoji. Short paragraphs; a simple "- " list only if really needed.

When creating: name =short Title Case title (e.g. "Passport Service Simplification"); description = all details the user gave about the process, in full (empty if none); goal = what the simplification should achieve, one sentence of at most 20 words, from what the user said (e.g. "Issue death certificates online within 3 working days, with no office visit"); no numbers the user did not give. Do not invent details. Do not start any AS-IS analysis — the user will upload documents or ask for that inside the project.`
