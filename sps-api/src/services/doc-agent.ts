import Anthropic from "@anthropic-ai/sdk";
import { extname } from "path";
import { db } from "../db/index";
import { runStreamed } from "./stream-call";
import { searchPages, getPages, slicePdf, IMAGE_TYPES, GLOBAL_PROJECT } from "./ingest";
import type { KnownSource } from "./sources";
import { log } from "../utils/log";

// ── Document agent ────────────────────────────────────────────────────────────
//
// Instead of pasting every document into the prompt, the model gets a catalogue
// (D1, D2… with page counts) and two tools: search_documents (full-text search that
// points at pages) and read_pages (the actual pages — PDF pages are sent as PDFs, so
// the model also sees scans, tables and legacy-font Bangla). It loops until it can
// answer. Only pages it really read can be cited, as [D1:4].

type Emit = (data: object) => void;

const MAX_PAGES_PER_READ = 5;
const MAX_ATTACHED_PAGES = 40;           // PDF/image pages sent to the model in one run
const MAX_ATTACHED_BYTES = 20 * 1024 * 1024;

export const DOC_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_documents",
    description: "Full-text search over the uploaded documents. Returns the best-matching pages with a short snippet (matches marked «like this»). Use it to find where something is described, then read those pages. Search in English and in Bangla when documents may be in Bangla. Documents marked NOT searchable never appear in results — read them directly.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords or a short question, e.g. 'application fee' or 'আবেদন ফি'" },
        documents: { type: "array", items: { type: "string" }, description: "Optional: limit to these documents, e.g. [\"D1\"]" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_pages",
    description: `Read pages of one uploaded document (at most ${MAX_PAGES_PER_READ} pages per call). PDF pages arrive as the real pages, so scans and tables are readable. Read the pages your searches point to, plus neighbouring pages when a procedure continues.`,
    input_schema: {
      type: "object",
      properties: {
        document: { type: "string", description: "Document id, e.g. \"D1\"" },
        from: { type: "integer", description: "First page (1-based)" },
        to: { type: "integer", description: "Last page (inclusive)" },
      },
      required: ["document", "from", "to"],
    },
  },
];

interface Doc {
  ref: string;          // D1
  id: string;
  name: string;
  kind: "pdf" | "text" | "image";
  pages: number;
  status: string;       // ready | visual
  note: string;
  path: string;
  pdfPath: string | null;
}

interface ToolOutput { text: string; isError?: boolean; attachments: Anthropic.ContentBlockParam[] }

export class DocSession {
  readonly docs: Doc[];
  readonly unreadable: { name: string; note: string }[];
  private read = new Set<string>();     // "D1:4" — pages the model has read (read_pages)
  private found = new Set<string>();    // "D1:4" — pages shown to the model as search results (with their text)
  private attachedPages = 0;
  private attachedBytes = 0;

  /** Documents uploaded to this project (D1, D2…); the rest are Global Knowledge (K1, K2…) */
  readonly projectDocCount: number;

  constructor(readonly projectId: string, private emit: Emit) {
    type Row = { id: string; name: string; kind: Doc["kind"]; pages: number; status: string; status_note: string; path: string; pdf_path: string | null };
    const load = (pid: string) => db.query(
      "SELECT id, name, kind, pages, status, status_note, path, pdf_path FROM files WHERE project_id = ? ORDER BY created_at ASC, id ASC"
    ).all(pid) as Row[];
    const usable = (r: Row) => (r.status === "ready" || r.status === "visual") && r.pages > 0;
    const toDoc = (prefix: string) => (r: Row, i: number): Doc => ({
      ref: `${prefix}${i + 1}`, id: r.id, name: r.name, kind: r.kind, pages: r.pages, status: r.status,
      note: r.status_note ?? "", path: r.path, pdfPath: r.pdf_path,
    });
    const own = load(projectId);
    // the shared library (laws, rules, circulars) is available to every project
    const library = projectId === GLOBAL_PROJECT ? [] : load(GLOBAL_PROJECT);
    this.docs = [...own.filter(usable).map(toDoc("D")), ...library.filter(usable).map(toDoc("K"))];
    this.projectDocCount = own.filter(usable).length;
    this.unreadable = own.filter((r) => !usable(r)).map((r) => ({ name: r.name, note: r.status_note ?? r.status }));
  }

  /** The document list given to the model */
  catalogue(): string {
    const line = (d: Doc) => {
      const size = d.kind === "image" ? "image (1 page)" : `${d.pages} ${d.kind === "pdf" ? "page" : "section"}${d.pages === 1 ? "" : "s"}`;
      const search = d.status === "visual" ? "NOT searchable (scanned, image or legacy-font text) — read its pages directly" : "searchable";
      return `${d.ref} — "${d.name}" — ${size}, ${search}`;
    };
    const own = this.docs.filter((d) => d.ref.startsWith("D")).map(line);
    const library = this.docs.filter((d) => d.ref.startsWith("K")).map(line);
    const skipped = this.unreadable.length
      ? `\n\nCould not be read (ignore): ${this.unreadable.map((u) => `"${u.name}" (${u.note})`).join("; ")}`
      : "";
    return [
      own.length ? `UPLOADED DOCUMENTS (this service — your primary source; use search_documents and read_pages):\n${own.join("\n")}${skipped}` : "",
      library.length ? `GLOBAL KNOWLEDGE (shared laws, rules, circulars and guidelines — search them for the legal basis and SPS rules; cite as [K1:4]):\n${library.join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
  }

  private doc(ref: unknown): Doc | undefined {
    return this.docs.find((d) => d.ref === String(ref ?? "").toUpperCase().trim());
  }

  async execute(name: string, input: Record<string, unknown>): Promise<ToolOutput> {
    try {
      if (name === "search_documents") return this.search(String(input.query ?? ""), input.documents);
      if (name === "read_pages") return await this.readPages(input.document, Number(input.from), Number(input.to));
      return { text: `Unknown tool: ${name}`, isError: true, attachments: [] };
    } catch (err) {
      log.error(`doc-agent ${name}: ${String(err)}`);
      return { text: `Tool failed: ${err instanceof Error ? err.message : String(err)}`, isError: true, attachments: [] };
    }
  }

  private search(query: string, documents: unknown): ToolOutput {
    this.emit({ type: "progress", text: `Searching documents: ${query}` });
    const only = Array.isArray(documents) ? documents.map((r) => this.doc(r)?.id).filter((x): x is string => !!x) : undefined;
    const hits = searchPages(this.projectId, query, only?.length ? only : undefined);
    log.tool(`search_documents  "${query}"  hits=${hits.length}`);
    if (!hits.length) {
      return { text: "No matches. Try other words (English and Bangla, synonyms), or read pages directly. Documents marked NOT searchable must be read directly.", attachments: [] };
    }
    const byId = new Map(this.docs.map((d) => [d.id, d]));
    // a page shown in the results (with its text) is a real source the model may cite
    for (const h of hits) { const ref = byId.get(h.file_id)?.ref; if (ref) this.found.add(`${ref}:${h.page}`); }
    return {
      text: hits.map((h) => `[${byId.get(h.file_id)?.ref}:${h.page}] ${byId.get(h.file_id)?.name}, page ${h.page}: ${h.snippet}`).join("\n"),
      attachments: [],
    };
  }

  private async readPages(ref: unknown, fromIn: number, toIn: number): Promise<ToolOutput> {
    const d = this.doc(ref);
    if (!d) return { text: `No document "${ref}". Use one of: ${this.docs.map((x) => x.ref).join(", ")}`, isError: true, attachments: [] };
    let from = Number.isFinite(fromIn) ? Math.max(1, Math.floor(fromIn)) : 1;
    let to = Number.isFinite(toIn) ? Math.floor(toIn) : from;
    if (from > d.pages) return { text: `${d.ref} has only ${d.pages} page(s).`, isError: true, attachments: [] };
    to = Math.min(Math.max(to, from), d.pages, from + MAX_PAGES_PER_READ - 1);

    // skip pages already read at either end of the range
    while (from <= to && this.read.has(`${d.ref}:${from}`)) from++;
    while (to >= from && this.read.has(`${d.ref}:${to}`)) to--;
    if (from > to) return { text: `Those pages of ${d.ref} were already read above.`, attachments: [] };

    const range = from === to ? `page ${from}` : `pages ${from}–${to}`;
    this.emit({ type: "progress", text: `Reading ${d.name}, ${range}` });
    const mark = () => { for (let p = from; p <= to; p++) this.read.add(`${d.ref}:${p}`); };
    const count = to - from + 1;
    const withinBudget = this.attachedPages + count <= MAX_ATTACHED_PAGES;

    if (d.kind === "pdf" && d.pdfPath && withinBudget) {
      const bytes = await slicePdf(d.pdfPath, from, to, d.pages);
      if (this.attachedBytes + bytes.length <= MAX_ATTACHED_BYTES) {
        this.attachedPages += count;
        this.attachedBytes += bytes.length;
        mark();
        log.tool(`read_pages  ${d.ref} ${range}  pdf=${Math.round(bytes.length / 1024)}KB  total=${this.attachedPages}p`);
        return {
          text: `${d.ref} "${d.name}" ${range} attached below (attachment page 1 = document page ${from}). Cite as [${d.ref}:<page>].`,
          attachments: [{
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") },
            title: `${d.ref} ${d.name} — ${range}`,
          } as Anthropic.ContentBlockParam],
        };
      }
    }

    if (d.kind === "image") {
      if (!withinBudget) return { text: "Page budget for this run is used up — answer with what you have.", isError: true, attachments: [] };
      const bytes = new Uint8Array(await Bun.file(d.path).arrayBuffer());
      this.attachedPages += 1;
      this.attachedBytes += bytes.length;
      mark();
      const media = IMAGE_TYPES[extname(d.path).slice(1).toLowerCase()] as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      return {
        text: `${d.ref} "${d.name}" (image) attached below. Cite as [${d.ref}:1].`,
        attachments: [{ type: "image", source: { type: "base64", media_type: media, data: Buffer.from(bytes).toString("base64") } }],
      };
    }

    // Text pages (spreadsheets, text files — or a PDF once the page budget is spent)
    const pages = getPages(d.id, from, to);
    const readable = pages.filter((p) => p.quality === "good");
    if (!readable.length) return { text: "Page budget for this run is used up and these pages have no readable text — answer with what you have.", isError: true, attachments: [] };
    for (const p of readable) this.read.add(`${d.ref}:${p.page}`);
    log.tool(`read_pages  ${d.ref} ${range}  text`);
    return {
      text: readable.map((p) => `=== ${d.ref} "${d.name}" ${d.kind === "pdf" ? "page" : "section"} ${p.page} (cite as [${d.ref}:${p.page}]) ===\n${p.text}`).join("\n\n"),
      attachments: [],
    };
  }

  /** Citable sources: each page read or shown in search results (D1:4), and each such document (D1) */
  known(viewUrl: (fileId: string) => string): Map<string, KnownSource> {
    const out = new Map<string, KnownSource>();
    for (const key of new Set([...this.read, ...this.found])) {
      const [ref, page] = key.split(":");
      const d = this.doc(ref)!;
      const unit = d.kind === "pdf" ? "p." : d.kind === "image" ? "" : "section";
      out.set(key, { title: d.kind === "image" ? d.name : `${d.name}, ${unit} ${page}`, url: `${viewUrl(d.id)}${d.kind === "pdf" ? `#page=${page}` : ""}`, kind: "doc" });
      if (!out.has(ref)) out.set(ref, { title: d.name, url: viewUrl(d.id), kind: "doc" });
    }
    return out;
  }

  get pagesRead(): number { return this.read.size; }
}

// Moves the single prompt-cache breakpoint to the newest message, so each loop
// iteration re-reads the earlier pages from cache instead of paying for them again.
function markCache(messages: Anthropic.MessageParam[]) {
  for (const m of messages) {
    if (Array.isArray(m.content)) for (const b of m.content) delete (b as { cache_control?: unknown }).cache_control;
  }
  const last = messages[messages.length - 1];
  if (typeof last.content === "string") last.content = [{ type: "text", text: last.content }];
  const blocks = last.content as Array<{ cache_control?: unknown }>;
  blocks[blocks.length - 1].cache_control = { type: "ephemeral" };
}

/**
 * Runs the model with the document tools (plus web_search for gaps) until it answers.
 * Returns the final turn's content (holding the answer) and every block of the run
 * (to collect web results for citation checks).
 */
export async function runDocAgent(opts: {
  label: string;
  model: string;
  system: string;
  prompt: string;
  session: DocSession;
  webSearch: Record<string, unknown>;
  webSearchBudget: number;
  maxIterations?: number;
  maxTokens?: number;
  /** more server tools, e.g. web_fetch limited to the accepted sites (with its beta) */
  extraTools?: unknown[];
  betas?: string[];
  params?: Record<string, unknown>;
  emit: Emit;
  onText?: (t: string) => void;
}): Promise<{ content: Anthropic.ContentBlock[]; all: Anthropic.ContentBlock[]; stop: string | null }> {
  const maxIterations = opts.maxIterations ?? 14;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.prompt }];
  const all: Anthropic.ContentBlock[] = [];
  let webUsed = 0;

  for (let i = 1; i <= maxIterations; i++) {
    const last = i === maxIterations;
    if (last) {
      const tail = messages[messages.length - 1];
      (tail.content as Anthropic.ContentBlockParam[]).push({ type: "text", text: "Research budget used up. Answer now with the JSON only, using what you have read." });
    }
    const webLeft = opts.webSearchBudget - webUsed;
    const tools = last ? [] : [...DOC_TOOLS, ...(webLeft > 0 ? [{ ...opts.webSearch, max_uses: webLeft }] : []), ...(opts.extraTools ?? [])];
    markCache(messages);

    const result = await runStreamed({
      label: `${opts.label} iter=${i}`,
      model: opts.model,
      system: opts.system,
      messages,
      maxTokens: opts.maxTokens ?? 6000,
      tools,
      betas: opts.betas,
      params: opts.params,
      emit: opts.emit,
      onText: opts.onText,
    });
    // A web_search asked for in the same turn as a document tool is not run (the turn stops
    // for our tools) and has no result — drop it, or the next request is rejected. The
    // model simply searches again later; only searches that ran count against the budget.
    const answered = new Set(result.content
      .filter((b) => b.type === "web_search_tool_result" || b.type === ("web_fetch_tool_result" as string))
      .map((b) => (b as unknown as { tool_use_id: string }).tool_use_id));
    result.content = result.content.filter((b) => b.type !== "server_tool_use" || answered.has((b as Anthropic.ServerToolUseBlock).id));
    all.push(...result.content);
    webUsed += result.content.filter((b) => b.type === "server_tool_use").length;

    const calls = result.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (result.stop !== "tool_use" || !calls.length) {
      log.analyze(`${opts.label} finished  iterations=${i}  pagesRead=${opts.session.pagesRead}  web=${webUsed}  stop=${result.stop}`);
      return { content: result.content, all, stop: result.stop };
    }

    const results: Anthropic.ContentBlockParam[] = [];
    const attachments: Anthropic.ContentBlockParam[] = [];
    for (const call of calls) {
      const out = await opts.session.execute(call.name, (call.input ?? {}) as Record<string, unknown>);
      results.push({ type: "tool_result", tool_use_id: call.id, content: out.text, ...(out.isError ? { is_error: true } : {}) });
      attachments.push(...out.attachments);
    }
    messages.push({ role: "assistant", content: result.content as Anthropic.ContentBlockParam[] });
    // tool results first, then the pages they refer to
    messages.push({ role: "user", content: [...results, ...attachments] });
  }
  return { content: [], all, stop: null };
}
