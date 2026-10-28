import { json } from "../utils/cors";
import { streamSse } from "../utils/sse";
import { listWebSources, decideWebSource, searchWebSources, defaultQuery, addWebLink, type WebSourceStatus } from "../services/web-sources";

// Knowledge page: web sources found for the project, and the user's accept / reject
export async function handleWebSources(req: Request, url: URL): Promise<Response> {
  const method = req.method.toUpperCase();

  const listMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/web-sources$/);
  if (listMatch && method === "GET") {
    return json({ sources: listWebSources(listMatch[1]), default_query: defaultQuery(listMatch[1]) });
  }
  // "Add a web page": a link the user gives, with an optional note of what to take from it
  if (listMatch && method === "POST") {
    const body = await req.json().catch(() => ({})) as { url?: string; note?: string };
    if (!body.url?.trim()) return json({ error: "no_url" }, 400);
    const r = await addWebLink(listMatch[1], body.url, body.note ?? "");
    return r.source ? json(r.source, 201) : json({ error: r.error }, 400);
  }

  const searchMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/web-sources\/search$/);
  if (searchMatch && method === "POST") {
    const projectId = searchMatch[1];
    const body = await req.json().catch(() => ({})) as { query?: string };
    const query = body.query?.trim() || defaultQuery(projectId);
    return streamSse(async (emit) => {
      emit({ type: "progress", text: `Searching the web for: ${query}` });
      const added = await searchWebSources(projectId, query, emit);
      emit({ type: "done", text: "", added: added.length });
    });
  }

  const oneMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/web-sources\/([^/]+)$/);
  if (oneMatch && method === "PATCH") {
    const body = await req.json() as { status?: string };
    if (!["pending", "accepted", "rejected"].includes(body.status ?? "")) return json({ error: "bad_status" }, 400);
    const row = decideWebSource(oneMatch[1], oneMatch[2], body.status as WebSourceStatus);
    return row ? json(row) : json({ error: "not_found" }, 404);
  }

  return json({ error: "not_found" }, 404);
}
