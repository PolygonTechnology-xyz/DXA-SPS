import { PORT } from "./src/config";
import { cors } from "./src/utils/cors";
import { handleProjects } from "./src/routes/projects";
import { handleFiles } from "./src/routes/files";
import { handleAnalyze } from "./src/routes/analyze";
import { handleChat } from "./src/routes/chat";
import { handleSearch } from "./src/routes/search";
import { handleHome } from "./src/routes/home";
import { handleWebPage } from "./src/routes/webpage";
import { log } from "./src/utils/log";
import { json } from "./src/utils/cors";
import { SPS_ASPECTS, SPS_PROFILE, SPS_PRIORITY, SPS_FEEDBACK } from "./src/services/sps-guide";
import { ingestPending } from "./src/services/ingest";

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    if (url.pathname === "/health") return new Response(JSON.stringify({ ok: true }), { status: 200 });

    log.route(`${method} ${url.pathname}`);

    // The guideline's fixed lists (aspects, profile items, matrices) for the UI
    if (url.pathname === "/api/sps/meta") return json({ aspects: SPS_ASPECTS, profile: SPS_PROFILE, priority: SPS_PRIORITY, feedback: SPS_FEEDBACK });
    if (url.pathname.startsWith("/api/analyze")) return handleAnalyze(req, url);
    if (url.pathname.startsWith("/api/adjust")) return handleChat(req, url);
    if (url.pathname.startsWith("/api/chat")) return handleChat(req, url);
    if (url.pathname.startsWith("/api/web-search")) return handleSearch(req, url);
    if (url.pathname.startsWith("/api/home")) return handleHome(req, url);
    if (url.pathname === "/api/web-page") return handleWebPage(req, url);
    if (url.pathname.startsWith("/api/projects")) {
      if (url.pathname.match(/\/files/)) return handleFiles(req, url);
      if (url.pathname.match(/\/((interview-)?chat|chat-messages)$/)) return handleChat(req, url);
      return handleProjects(req, url);
    }

    log.error(`404 ${method} ${url.pathname}`);
    return new Response("Not found", { status: 404 });
  },
});

log.info(`SPS API running on http://localhost:${PORT}`);

// Index documents uploaded before ingestion existed (or interrupted by a restart)
ingestPending().catch((err) => log.error(`ingestPending: ${String(err)}`));
