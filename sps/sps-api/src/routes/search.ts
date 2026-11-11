import { client } from "../services/ai";
import { ANTHROPIC_MODEL } from "../config";
import { streamSse } from "../utils/sse";
import { json } from "../utils/cors";
import { startTimer } from "../utils/log";

export async function handleSearch(req: Request, url: URL): Promise<Response> {
  const method = req.method.toUpperCase();

  if (method === "POST" && url.pathname === "/api/web-search") {
    const body = await req.json() as { query: string; project_id?: string };
    return streamSse(async (emit, _hb) => {
      emit({ type: "progress", text: `Searching for: ${body.query}` });
      const timer = startTimer("web-search");
      const stream = await client.messages.stream({
        model: ANTHROPIC_MODEL,
        max_tokens: 8192,
        system: WEB_SEARCH_SYSTEM,
        messages: [{
          role: "user",
          content: `Search query: ${body.query}\n\nSummarize what you know about this topic for AS-IS process analysis. Include any relevant laws, regulations, or official procedures. Provide citations where possible.`,
        }],
      });
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          timer.firstToken();
          emit({ type: "text", text: chunk.delta.text });
        }
      }
      const full = await stream.finalMessage();
      timer.done(full.usage, `stop=${full.stop_reason}  model=${ANTHROPIC_MODEL}`);
      const text = full.content[0].type === "text" ? full.content[0].text : "";
      emit({ type: "done", text });
    });
  }

  return json({ error: "not_found" }, 404);
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const WEB_SEARCH_SYSTEM = `You are a research assistant helping analyze government service processes in Bangladesh and similar contexts.

Based on your training knowledge, provide detailed information about the topic including:
- Relevant laws and regulations (with article numbers where known)
- Standard procedures and requirements
- Common pain points and inefficiencies
- Digital transformation possibilities
- Best practices from similar countries

Be honest about the limits of your knowledge. If you're uncertain about specific details, say so. Always provide context and references where possible.`;
