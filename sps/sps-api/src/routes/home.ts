import Anthropic from "@anthropic-ai/sdk"
import { client } from "../services/ai"
import { ANTHROPIC_MODEL, CHAT_MODELS } from "../config"
import { streamSse } from "../utils/sse"
import { json } from "../utils/cors"
import { homeToolDefinitions, executeHomeTool } from "../tools/home.tools"
import { log, startTimer } from "../utils/log"

// ── Home-page agent: chat normally, create a project only on clear intent ────

export async function handleHome(req: Request, url: URL): Promise<Response> {
  const method = req.method.toUpperCase()

  // The model picker under the chat box
  if (method === "GET" && url.pathname === "/api/home/models") {
    return json({ models: CHAT_MODELS, default: ANTHROPIC_MODEL })
  }

  if (method === "POST" && url.pathname === "/api/home/chat") {
    const body = await req.json() as { messages: Array<{ role: "user" | "assistant"; content: string }>; model?: string }
    const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({ role: m.role, content: m.content }))
    // only a model from the list — anything else falls back to the default
    const model = CHAT_MODELS.some((m) => m.id === body.model) ? body.model! : ANTHROPIC_MODEL
    // Haiku 4.5 does not think; the newer models always think, and thinking counts
    // toward max_tokens — so they get room, and low effort keeps chat replies quick
    const legacy = model.startsWith("claude-haiku-4-5")
    const modelParams = legacy ? { max_tokens: 2048 } : { max_tokens: 16000, output_config: { effort: "low" } }

    return streamSse(async (emit) => {
      log.chat(`home start  history=${messages.length}  model=${model}`)

      let iteration = 0
      while (iteration < 4) {
        iteration++
        const callTimer = startTimer(`home iter=${iteration}`)
        const stream = client.messages.stream({
          model,
          ...modelParams,
          system: HOME_SYSTEM,
          tools: homeToolDefinitions,
          messages,
        } as Anthropic.MessageStreamParams)
        stream.on("text", (text) => { callTimer.firstToken(); emit({ type: "text", text }) })
        const response = await stream.finalMessage()
        callTimer.done(response.usage, `stop=${response.stop_reason}  model=${model}`)

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

        if ((response.stop_reason as string) === "refusal") {
          emit({ type: "error", message: "The assistant could not answer this. Please rephrase." })
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

When creating (the user can edit every field on the card before pressing Yes):
- name = short Title Case title (e.g. "Passport Service Simplification").
- goal = a detailed goal in 2–4 sentences: the target outcome for citizens, what should change in the process (fewer office visits, documents, steps, days or cost), and who benefits (e.g. "Let citizens apply for a death certificate fully online and receive it within 3 working days. Remove the office visit and the separate attestation step, and reduce the documents asked for. Families, especially in rural areas, save travel time and cost."). No numbers the user did not give.
- description = the service summary: what the service is, who applies, how it is delivered today and the known problems — everything the user said in full, as a clear paragraph; only widely known general facts beyond that.
- country = "Bangladesh" unless the user says otherwise.
- ministry and department = the user's words, or the well-known owner of the service (e.g. passport → "Ministry of Home Affairs" / "Department of Immigration and Passports"); leave empty if you are not sure — the user fills it in on the card.
Do not invent details. Do not start any AS-IS analysis — the user will upload documents or ask for that inside the project.

A message may end with "[Attached files: …]": the user attached documents about the service. You cannot read them here — they are added to the project when it is created. Treat an attachment as a sign they want a project (use the file names and their words for the name), and do not claim to know what the files say.`
