import Anthropic from "@anthropic-ai/sdk";
import { client } from "./ai";
import { startTimer, log } from "../utils/log";

type Emit = (data: object) => void;

interface RunOptions {
  label: string;                 // for [TIME] logs
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  tools?: unknown[];             // server tools (web_search / web_fetch)
  betas?: string[];
  /** extra request fields, e.g. thinking / output_config for the newer models */
  params?: Record<string, unknown>;
  emit: Emit;
  onText?: (delta: string) => void;
}

// One streamed model turn that may use server-side tools. Emits live
// "searching" / "search_result" events, resumes pause_turn, and returns all
// content blocks of the final assistant turn plus total usage.
export async function runStreamed(opts: RunOptions): Promise<{ content: Anthropic.ContentBlock[]; stop: string | null; usage: { input_tokens: number; output_tokens: number } }> {
  const messages = [...opts.messages];
  const content: Anthropic.ContentBlock[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const timer = startTimer(opts.label);
  let stop: string | null = null;
  let searches = 0;

  let retried = false;
  for (let turn = 0; turn < 3; turn++) {
    let gotOutput = false;
    const stream = client.messages.stream(
      {
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages,
        ...(opts.tools?.length ? { tools: opts.tools as Anthropic.ToolUnion[] } : {}),
        ...(opts.params ?? {}),
      } as Anthropic.MessageCreateParamsStreaming,
      opts.betas?.length ? { headers: { "anthropic-beta": opts.betas.join(",") } } : undefined,
    );

    stream.on("text", (delta) => { gotOutput = true; timer.firstToken(); opts.onText?.(delta); });
    stream.on("contentBlock", (block) => {
      const b = block as unknown as Record<string, unknown>;
      if (b.type === "server_tool_use") {
        searches++;
        const input = (b.input ?? {}) as { query?: string; url?: string };
        opts.emit({ type: "searching", query: input.query ?? input.url ?? "web" });
      }
      if (b.type === "web_search_tool_result") {
        const results = Array.isArray(b.content) ? (b.content as Array<{ title?: string }>) : [];
        opts.emit({
          type: "search_result",
          summary: results.length
            ? `${results.length} results — ${results.slice(0, 3).map((r) => r.title).filter(Boolean).join(" · ")}`
            : "no results",
        });
      }
      if (b.type === "web_fetch_tool_result") {
        const c = b.content as { type?: string; url?: string; error_code?: string } | undefined;
        opts.emit(c?.error_code
          ? { type: "progress", text: `That page does not allow automatic reading (${c.error_code}) — searching the same site instead…` }
          : { type: "search_result", summary: `Read ${c?.url ?? "page"}` });
      }
    });

    let msg: Anthropic.Message;
    try {
      msg = await stream.finalMessage();
    } catch (err) {
      // A network blip before any output: retry the same turn once instead of failing the run
      const transient = err instanceof Anthropic.APIConnectionError || (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500);
      if (transient && !gotOutput && !retried) {
        retried = true;
        log.error(`${opts.label}: ${String(err)} — retrying once`);
        opts.emit({ type: "progress", text: "Connection hiccup — retrying…" });
        turn--;
        continue;
      }
      throw err;
    }
    usage.input_tokens += msg.usage.input_tokens;
    usage.output_tokens += msg.usage.output_tokens;
    content.push(...msg.content);
    stop = msg.stop_reason;

    // Server-side tool loop hit its iteration cap — resend and the API resumes
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    break;
  }

  timer.done(usage, `searches=${searches}  stop=${stop}  model=${opts.model}`);
  return { content, stop, usage };
}
