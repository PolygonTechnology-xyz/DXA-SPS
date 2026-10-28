import Anthropic from "@anthropic-ai/sdk"
import { client } from "../services/ai"
import { ANTHROPIC_MODEL } from "../config"
import { db, parseProject, type Row } from "../db/index"
import { streamSse } from "../utils/sse"
import { json } from "../utils/cors"
import { allToolDefinitions, executeTool } from "../tools/index"
import { activeInfo } from "../services/versions"
import { log, startTimer } from "../utils/log"
import { ensureProjectIngested } from "../services/ingest"
import { DocSession, DOC_TOOLS } from "../services/doc-agent"
import { loadAsis, saveAsis, ensureUids, syncFindings, coverage, describeFinding, FIELD_LABEL, REVIEW_FIELDS, type Step, type Finding, type Review } from "../services/asis-state"
import { projectCountry } from "../services/review"
import { SPS_GUIDE } from "../services/sps-guide"
import { spsPromptBlock } from "../services/sps"
import { WEB_SEARCH } from "../services/web-tools"
import { collectWebResults } from "../services/sources"
import { researchToolDefinitions, saveWebResearch } from "../tools/research.tools"
import { choicesToolDefinitions, cleanChoices } from "../tools/choices.tools"
import { getMemory, memoryToolDefinitions, executeMemoryTool, loadChatContext, compactChat, resetChatSummary } from "../services/memory"

// Chat rail history is stored per project (the server saves both sides as they happen)
function saveMessage(projectId: string, role: "user" | "assistant", content: string, mode: "chat" | "interview", pane?: string, payload?: object | null) {
  if (!content.trim()) return
  db.query("INSERT INTO chat_messages (project_id, role, content, mode, pane, payload) VALUES (?, ?, ?, ?, ?, ?)")
    .run(projectId, role, content, mode, pane ?? null, payload ? JSON.stringify(payload) : null)
}

// The newest message the client sent, when it is the user's (the earlier ones are already saved)
function saveLatestUser(projectId: string, messages: Array<{ role: string; content: string }>, mode: "chat" | "interview", pane?: string) {
  const last = messages[messages.length - 1]
  if (last?.role === "user") saveMessage(projectId, "user", last.content, mode, pane)
}

export async function handleChat(req: Request, url: URL): Promise<Response> {
  const method = req.method.toUpperCase()

  // ── Stored chat rail history ───────────────────────────────────────────────

  const historyMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/chat-messages$/)
  if (historyMatch) {
    const projectId = historyMatch[1]
    if (method === "GET") {
      const rows = db.query("SELECT id, role, content, mode, pane, kind, payload, created_at FROM chat_messages WHERE project_id = ? ORDER BY id").all(projectId) as Array<Record<string, unknown>>
      return json(rows.map((r) => ({ ...r, kind: r.kind ?? "text", payload: r.payload ? JSON.parse(String(r.payload)) : null })))
    }
    if (method === "DELETE") {
      db.query("DELETE FROM chat_messages WHERE project_id = ?").run(projectId)
      resetChatSummary(projectId)
      return json({ ok: true })
    }
  }

  // ── Simple chat (no tools) ─────────────────────────────────────────────────

  if (method === "POST" && url.pathname === "/api/chat") {
    const body = await req.json() as { messages: Anthropic.MessageParam[]; context?: string }
    return streamSse(async (emit) => {
      const stream = await client.messages.stream({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: `You are DXA, an AI analyst helping simplify government service processes using the SPS methodology.\n\n${body.context ?? ""}`,
        messages: body.messages,
      })
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          emit({ type: "text", text: chunk.delta.text })
        }
      }
      const full = await stream.finalMessage()
      const text = full.content[0].type === "text" ? full.content[0].text : ""
      emit({ type: "done", text })
    })
  }

  // ── TO-BE adjust (legacy) ──────────────────────────────────────────────────

  if (method === "POST" && url.pathname === "/api/adjust/tobe") {
    const body = await req.json() as { tobe_steps: unknown[]; request: string; context?: string }
    return streamSse(async (emit) => {
      const stream = await client.messages.stream({
        model: ANTHROPIC_MODEL,
        max_tokens: 8192,
        system: TOBE_ADJUST_SYSTEM,
        messages: [{
          role: "user",
          content: `Current TO-BE steps:\n${JSON.stringify(body.tobe_steps, null, 2)}\n\nUser request: ${body.request}\n\n${body.context ? `Project context: ${body.context}` : ""}`,
        }],
      })
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          emit({ type: "text", text: chunk.delta.text })
        }
      }
      const full = await stream.finalMessage()
      const text = full.content[0].type === "text" ? full.content[0].text : ""
      emit({ type: "done", text })
    })
  }

  // ── Agentic project chat ───────────────────────────────────────────────────

  const projectChatMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/chat$/)
  if (method === "POST" && projectChatMatch) {
    const projectId = projectChatMatch[1]
    const body = await req.json() as {
      messages: Array<{ role: "user" | "assistant"; content: string }>
      pane: string
    }

    const row = db.query("SELECT * FROM projects WHERE id = ?").get(projectId) as Row | null
    if (!row) return json({ error: "not_found" }, 404)
    const project = parseProject(row)

    return streamSse(async (emit) => {
      const ctx = {
        projectId,
        asisSteps: ensureUids([...(project.asis_steps ?? [])] as Step[]) as unknown as typeof project.asis_steps,
        tobeSteps: [...(project.tobe_steps ?? [])],
      }

      // The server owns the conversation: save the new message, then rebuild the history
      // (summary of older messages + recent ones) from what is stored
      saveLatestUser(projectId, body.messages, "chat", body.pane)
      const history = loadChatContext(projectId)
      log.chat(`start  project=${projectId}  pane=${body.pane}  asis=${ctx.asisSteps.length}  tobe=${ctx.tobeSteps.length}  history=${history.messages.length}  summary=${history.summary.length > 0}`)

      await ensureProjectIngested(projectId)
      const docs = new DocSession(projectId, emit)
      // web_search runs on Anthropic's side; save_web_research keeps what it found for the AS-IS
      const tools = [{ ...WEB_SEARCH, max_uses: 5 }, ...allToolDefinitions, ...memoryToolDefinitions, ...researchToolDefinitions, ...choicesToolDefinitions, ...(docs.docs.length ? DOC_TOOLS : [])]
      // quick replies offered this turn (saved with the reply, shown as buttons)
      let choices: string[] = []
      // the reply's text from every round of the turn — text written before a tool call too
      let replyText = ""
      // cache the stable prefix: tools + system prompt
      const cachedTools = tools.map((t, i) => i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : t) as Anthropic.ToolUnion[]
      // URLs that really came back from web_search in this request (only these can be saved)
      const retrieved = new Map<string, { url: string; title: string }>()
      const system: Anthropic.TextBlockParam[] = [{ type: "text", text: CHAT_SYSTEM, cache_control: { type: "ephemeral" } }]
      const messages = buildMessages(history.messages, turnContext(row, body.pane, ctx, history.summary, docs))

      let iteration = 0
      let streamedText = ""
      while (iteration < 8) {
        iteration++
        log.chat(`iter=${iteration}  calling Claude (${ANTHROPIC_MODEL})`)
        const callTimer = startTimer(`chat iter=${iteration}`)

        // streamed: the reply appears word by word in the chat rail
        const stream = client.messages.stream({
          model: ANTHROPIC_MODEL,
          // room for a full explanation (tables, lists) — a cut-off reply looked unfinished
          max_tokens: 8192,
          system,
          tools: cachedTools,
          messages,
        })
        let textStarted = false
        for await (const chunk of stream) {
          if (chunk.type === "content_block_start" && chunk.content_block.type === "server_tool_use") {
            emit({ type: "tool_started", name: "web_search", input: {} })
          }
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            // text from an earlier round (before a tool) is kept apart from this one
            if (!textStarted && streamedText) emit({ type: "text", text: "\n\n" })
            textStarted = true
            streamedText += chunk.delta.text
            emit({ type: "text", text: chunk.delta.text })
          }
        }
        const response = await stream.finalMessage()

        callTimer.done(response.usage, `stop=${response.stop_reason}  pane=${body.pane}  model=${ANTHROPIC_MODEL}`)
        log.chat(`iter=${iteration}  stop_reason=${response.stop_reason}  usage=in:${response.usage.input_tokens} out:${response.usage.output_tokens}  cache_read=${response.usage.cache_read_input_tokens ?? 0}`)

        // Web search: remember the pages that really came back, and drop a search that was
        // asked for in the same turn as one of our tools but not run (it has no result, and
        // the next request would be rejected) — the model simply searches again.
        for (const [k, v] of collectWebResults(response.content)) retrieved.set(k, v)
        const answered = new Set(response.content
          .filter((b) => b.type === "web_search_tool_result")
          .map((b) => (b as Anthropic.WebSearchToolResultBlock).tool_use_id))
        response.content = response.content.filter((b) => b.type !== "server_tool_use" || answered.has((b as Anthropic.ServerToolUseBlock).id))

        // A long web search pauses the turn; send it back and the API continues
        if (response.stop_reason === "pause_turn") {
          messages.push({ role: "assistant", content: response.content })
          continue
        }

        if (response.stop_reason === "end_turn") {
          const text = response.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("")
          const reply = (replyText && text ? `${replyText}\n\n${text}` : replyText || text).trim()
          log.chat(`done — text=${reply.length} chars`)
          saveMessage(projectId, "assistant", reply, "chat", body.pane, choices.length ? { choices } : null)
          // the text was already streamed; done carries the final reply (what is saved)
          emit({ type: "done", text: reply })
          // fold older messages into the summary once enough have piled up
          compactChat(projectId).catch(() => undefined)
          return
        }

        if (response.stop_reason === "tool_use") {
          replyText += response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("")
          const toolCalls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
          const toolResults: Anthropic.ContentBlockParam[] = []
          const attachments: Anthropic.ContentBlockParam[] = []

          for (const call of toolCalls) {
            const input = call.input as Record<string, unknown>
            log.tool(`call  name=${call.name}  input=${JSON.stringify(input).slice(0, 120)}`)
            emit({ type: "tool_started", name: call.name, input })

            if (call.name === "offer_choices") {
              choices = cleanChoices(input)
              if (choices.length) emit({ type: "choices", options: choices })
              toolResults.push({ type: "tool_result", tool_use_id: call.id, content: choices.length
                ? "Shown to the user as buttons. End your turn now without repeating the options — wait for their reply."
                : "Not shown: give 2-5 short, different options." })
              continue
            }

            // document tools return pages to show the model
            if (call.name === "search_documents" || call.name === "read_pages") {
              const out = await docs.execute(call.name, input)
              toolResults.push({ type: "tool_result", tool_use_id: call.id, content: out.text, ...(out.isError ? { is_error: true } : {}) })
              attachments.push(...out.attachments)
              continue
            }

            const result = call.name === "update_memory"
              ? (() => { const r = executeMemoryTool(projectId, input); return { summary: r.summary, sseEvents: r.changed ? [{ type: "memory_updated" }] : [] } })()
              : call.name === "save_web_research"
              ? (() => { const r = saveWebResearch(projectId, input, retrieved); return { summary: r.summary, sseEvents: r.saved ? [{ type: "files_updated" }] : [] } })()
              : executeTool(call.name, input, ctx)
            log.tool(`result  name=${call.name}  summary="${result.summary}"`)

            if ("updatedAsisSteps" in result && result.updatedAsisSteps) {
              ctx.asisSteps = result.updatedAsisSteps
              // a dropped step takes its pending findings with it
              const { findings } = loadAsis(projectId)
              const synced = syncFindings(ctx.asisSteps as unknown as Step[], findings)
              if (synced.some((f, i) => f.status !== findings[i].status)) {
                saveAsis(projectId, { findings: synced })
                emit({ type: "findings_updated" })
              }
            }
            if ("updatedTobeSteps" in result && result.updatedTobeSteps) ctx.tobeSteps = result.updatedTobeSteps

            for (const event of result.sseEvents ?? []) emit(event)

            toolResults.push({ type: "tool_result", tool_use_id: call.id, content: result.summary })
          }

          messages.push({ role: "assistant", content: response.content })
          messages.push({ role: "user", content: [...toolResults, ...attachments] })
          continue
        }

        if (response.stop_reason === "max_tokens") {
          log.error(`chat: max_tokens at iter=${iteration} — asking to finish`)
          const partial = response.content.filter((b) => b.type === "text")
          if (partial.length) messages.push({ role: "assistant", content: partial })
          messages.push({ role: "user", content: "Your reply was cut off. Finish it briefly." })
          continue
        }

        log.error(`chat: unexpected stop_reason=${response.stop_reason} at iter=${iteration}`)
        emit({ type: "error", message: "Unexpected AI response. Please try again." })
        return
      }
      emit({ type: "done", text: "" })
    })
  }

  return json({ error: "not_found" }, 404)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Stable instructions — identical on every call, so they are served from the prompt cache.
// Everything that changes (project state, memory, documents) goes in turnContext().
const CHAT_SYSTEM = `${SPS_GUIDE}

You are DXA, an AI analyst for the SPS (Service Process Simplification) methodology, working inside one project.
Each user message starts with a <project_context> block holding the project's current state: details, the tab the user is on, PROJECT MEMORY, a summary of the earlier conversation, the uploaded documents, and the AS-IS / TO-BE steps. It is always up to date — trust it over older messages.

Project memory (like a team notebook — every later step reads it: AS-IS, review, TO-BE, future chats):
- Read it first and follow it.
- When the user decides, confirms or states a preference about this project or service (e.g. "the fee is paid online", "keep the police verification step", "keep the fee step"), record it with update_memory — briefly, in the right section. Also record open questions you could not resolve.
- Keep it short and current: replace notes that change, remove ones that are wrong or done, merge rather than append. Do not copy steps or documents into it.
- Do not mention memory updates at length — a short "(noted)" is enough.

Uploaded documents:
- Use search_documents and read_pages to answer questions about them; cite as "(document name, p. N)". Do not guess what a document says.

Web research:
- When the user asks you to search / research the web (for the AS-IS or anything about this service), use web_search on official sources first (run several specific searches at once). Then reply with a short summary of what you found, with the source links.
- Save it with save_web_research when the user asked for research for the AS-IS or agrees to keep it — it becomes a "Web research" document in the project's files, which the AS-IS reads like any uploaded document. Tell the user it is saved and that they can start the AS-IS when ready.
- A research request is NOT a request to start the AS-IS: do not call generate_asis for it. Start the AS-IS only when the user asks to start / generate / map it.

AS-IS review (pain point, digital status, law / regulation for every step):
- The AS-IS holds only confirmed information. Information found only on the web, or suggested without a source, is a PENDING FINDING (F-id) shown to the user as a consent card with Use / Don't use buttons. Never treat a pending finding as fact, and never accept one the user did not agree to.
- When the user answers about findings in words ("1 আর 3 ব্যবহার করো", "use all", "F2 বাদ দাও", "use F4 but say partly online"), call decide_findings. Refer to findings by their number as shown to the user.
- OPEN QUESTIONS are values nobody found. When the user answers one, fill it with update_step (field pain_points, digital_status or legal_basis); when they say they don't know, call mark_unknown.
- The user must decide every pending finding before the AS-IS can be approved; missing values only give a warning. Tell them what is left when they ask about approval or the TO-BE.

Asking questions:
- Ask ONE question at a time, in one short sentence (max ~20 words). No preamble, no list of several questions — ask the next one after the user answers. A short lead-in like "Got it. Next question:" is fine.
- Always call offer_choices with 2-4 likely answers (1-5 words each) so they appear as buttons — e.g. "No, nothing" / "SMS only" / "Yes, but unreliable". For yes/no questions: "Yes" / "No" / "Not sure". The user can still type their own answer. Do not repeat the options as text.

Dropping AS-IS steps:
- When the user asks to drop / remove / বাদ a step, first confirm it by number and name ("Drop step 6 'Exception loop'?"), unless they already named that exact step and clearly confirmed. Then call remove_step, and note the reason in project memory when they gave one.

Language:
- Always reply in English, also when the user writes in Bangla or Banglish — understand it, answer in English. Quick-reply options are in English too.

Starting the AS-IS:
- When the user says they have given all information / asks to start, run, generate or map the AS-IS, call generate_asis
- generate_asis.input = the project name, the description, and every process detail or link the user gave in this chat. Uploaded documents and project memory are read automatically — do not paste them
- If there is no description, no documents and no details, still call it — the AS-IS will be researched from the service name

Rules:
- Use tools for any data change — never describe a change without making it
- Only change exactly what the user asked for
- TO-BE steps with legal_basis cannot have that field removed without explicit user confirmation
- After a tool call, confirm what changed in 1-2 sentences
- For questions or explanations only, reply without using tools`

const plain = (t: unknown) => String(t ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim()

/** AS-IS steps without citation lists — what the model needs to talk about them */
function compactAsis(steps: Step[]) {
  return steps.map((s) => ({
    n: s.step_number, name: s.step_name, actor: s.actor, action: plain(s.action),
    type: s.step_type ?? "activity", ...(s.visit ? { visit: true } : {}), ...(s.fee ? { fee: s.fee } : {}),
    ...(s.input ? { input: plain(s.input) } : {}), ...(s.time_days ? { days: s.time_days } : {}),
    pain: plain(s.pain_points) || null, digital: s.digital_status ? `${s.digital_status}${plain(s.digital_note) ? ` (${plain(s.digital_note)})` : ""}` : null,
    law: plain(s.legal_basis) || null,
    ...(s.unknown_fields?.length ? { unknown: s.unknown_fields } : {}),
  }))
}

/** Review state: pending findings, open questions, coverage */
function reviewContext(steps: Step[], findings: Finding[], review: Review | null): string {
  if (!steps.length) return ""
  if (!review && !findings.some((f) => f.status === "pending")) return "AS-IS review: not run yet (the user can start it with \"Review now\" on the AS-IS page)."
  const pending = findings.filter((f) => f.status === "pending")
  const cov = coverage(steps, findings)
  const open = (review?.questions ?? []).filter((q) => {
    const s = steps.find((x) => x.uid === q.step_uid)
    return s && !plain(s[q.field]) && !s.unknown_fields?.includes(q.field)
  })
  const lines = [
    `AS-IS review — ${REVIEW_FIELDS.map((f) => `${FIELD_LABEL[f]}: ${cov.fields[f].confirmed}/${cov.steps} confirmed`).join(" · ")}. Pending findings: ${cov.pending}. Missing values: ${cov.missing}.`,
    pending.length ? `PENDING FINDINGS (need the user's consent):\n${pending.map((f) => `- ${f.id} — ${describeFinding(f, steps)}: ${plain(f.kind === "step" ? `${f.step?.step_name}: ${f.step?.action}` : f.field === "digital_status" ? `${f.value} ${f.digital_note ?? ""}` : f.value)} (${f.origin === "web" ? "web: " + f.sources.map((x) => x.title).join(", ") : "no source"})`).join("\n")}` : "",
    open.length ? `OPEN QUESTIONS:\n${open.map((q) => `- step ${steps.find((x) => x.uid === q.step_uid)?.step_number} · ${FIELD_LABEL[q.field]}: ${q.question}`).join("\n")}` : "",
  ]
  return lines.filter(Boolean).join("\n")
}

/** The per-turn state block (dxa-work's "turn state"), placed in the newest user message */
// Which version the user has open, and what in it is approved (locked)
function versionLine(projectId: string): string {
  const v = activeInfo(projectId)
  if (!v?.version) return ""
  const locked = [v.asis_locked && "AS-IS", v.tobe_locked && "TO-BE"].filter(Boolean)
  return `Open version: v${v.version}${locked.length ? ` — ${locked.join(" and ")} approved and LOCKED (a change to it needs a new version; the app asks the user when you try)` : " — nothing approved yet, can be changed"}`
}

function turnContext(
  project: { name?: unknown; description?: unknown; goal?: unknown },
  pane: string,
  ctx: { projectId: string; asisSteps: unknown[]; tobeSteps: unknown[] },
  summary: string,
  docs: DocSession,
): string {
  const memory = getMemory(ctx.projectId)
  const { findings, review } = loadAsis(ctx.projectId)
  const asis = ctx.asisSteps as Step[]
  const parts = [
    `Project: "${String(project.name ?? "")}"${project.description ? ` — ${String(project.description)}` : ""} · Country: ${projectCountry(ctx.projectId)}`,
    project.goal ? `Goal of the simplification: ${String(project.goal)}` : "",
    `Current tab: ${pane}`,
    versionLine(ctx.projectId),
    `PROJECT MEMORY:\n${memory || "(empty)"}`,
    summary ? `Earlier conversation (summary):\n${summary}` : "",
    docs.docs.length ? docs.catalogue() : "Uploaded documents: none",
    asis.length ? `AS-IS steps (${asis.length}):\n${JSON.stringify(compactAsis(asis))}` : "AS-IS steps: none yet",
    reviewContext(asis, findings, review),
    spsPromptBlock(ctx.projectId).trim(),
    ctx.tobeSteps.length ? `TO-BE steps (${ctx.tobeSteps.length}):\n${JSON.stringify(ctx.tobeSteps.map((t) => { const { sources: _s, ...rest } = t as Record<string, unknown>; return rest }))}` : "TO-BE steps: none yet",
  ].filter(Boolean)
  return `<project_context>\n${parts.join("\n\n")}\n</project_context>`
}

// Stored history + the turn context in front of the newest user message. The cache
// breakpoint sits at the end of the history, so earlier turns are read from cache.
function buildMessages(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  context: string,
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: [{ type: "text" as const, text: m.content }] }))
  const last = messages[messages.length - 1]
  if (!last || last.role !== "user") {
    messages.push({ role: "user", content: [{ type: "text", text: context }] })
    return messages
  }
  const blocks = last.content as Anthropic.TextBlockParam[]
  last.content = [{ type: "text", text: context }, ...blocks]
  const prev = messages[messages.length - 2]
  if (prev) {
    const prevBlocks = prev.content as Anthropic.TextBlockParam[]
    prevBlocks[prevBlocks.length - 1].cache_control = { type: "ephemeral" }
  }
  return messages
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const TOBE_ADJUST_SYSTEM = `You are a government service reform expert adjusting an existing TO-BE process based on user feedback.

Given the current TO-BE steps and a user request, make the requested changes while respecting these rules:
1. Steps with "legal_basis" set must be preserved (they are legally required)
2. Keep step_number sequential and logical
3. Every change must have a clear simplification_rationale
4. Preserve fields that are not being changed

Respond in two parts:
1. A brief plain-text explanation of exactly what you changed and why (2-4 sentences)
2. The COMPLETE updated tobe_steps array as a JSON block

Return the JSON at the end in this exact format:
\`\`\`json
{"tobe_steps": [...complete updated array...]}
\`\`\``
