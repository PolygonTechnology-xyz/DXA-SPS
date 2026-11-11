import { db } from "../db/index";
import { ANTHROPIC_MODEL, ANTHROPIC_MODEL_FAST } from "../config";
import { client } from "./ai";
import { fetchPageText } from "../routes/webpage";
import { nanoid } from "../utils/id";
import { log } from "../utils/log";
import { runStreamed } from "./stream-call";
import { WEB_SEARCH } from "./web-tools";
import { collectWebResults, validateWebSources, extractJsonObject } from "./sources";

// Web sources on the Knowledge page: the assistant searches the web for the project's
// service, the user accepts or rejects each site, and only accepted sites reach the AS-IS.

export type WebSourceStatus = "pending" | "accepted" | "rejected";
export interface WebSource {
  id: string; project_id: string; url: string; title: string; summary: string; extract: string;
  query: string; status: WebSourceStatus; created_at: number; decided_at: number | null;
}

export const listWebSources = (projectId: string) =>
  db.query("SELECT * FROM web_sources WHERE project_id = ? ORDER BY created_at DESC, rowid").all(projectId) as WebSource[];

export const acceptedWebSources = (projectId: string) =>
  listWebSources(projectId).filter((s) => s.status === "accepted");

export function decideWebSource(projectId: string, id: string, status: WebSourceStatus): WebSource | null {
  db.query("UPDATE web_sources SET status = ?, decided_at = ? WHERE id = ? AND project_id = ?")
    .run(status, status === "pending" ? null : Math.floor(Date.now() / 1000), id, projectId);
  return db.query("SELECT * FROM web_sources WHERE id = ?").get(id) as WebSource | null;
}

/** The project's service, as a search query ("Passport … Ministry of Home Affairs Bangladesh") */
export function defaultQuery(projectId: string): string {
  const p = db.query("SELECT name, ministry, department, country FROM projects WHERE id = ?").get(projectId) as
    { name: string; ministry: string | null; department: string | null; country: string | null } | null;
  if (!p) return "";
  const service = p.name.replace(/\b(service\s+)?simplification\b/i, "").trim() || p.name;
  return [service, "application process", p.department || p.ministry, p.country || "Bangladesh"].filter(Boolean).join(" ");
}

/** Search the web, keep only pages that really came back, and save new ones as pending */
export async function searchWebSources(projectId: string, query: string, emit: (d: object) => void): Promise<WebSource[]> {
  const p = db.query("SELECT name, description, ministry, department, country FROM projects WHERE id = ?").get(projectId) as
    { name: string; description: string; ministry: string; department: string; country: string } | null;
  const known = new Set(listWebSources(projectId).map((s) => s.url));

  const prompt = [
    `Service: ${p?.name ?? ""}`,
    p?.ministry ? `Ministry: ${p.ministry}` : "",
    p?.department ? `Department: ${p.department}` : "",
    p?.description ? `Service summary: ${p.description}` : "",
    `Country: ${p?.country || "Bangladesh"}`,
    `Search for: ${query}`,
    known.size ? `Already listed (do not return these again):\n${[...known].join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const result = await runStreamed({
    label: "web-sources",
    model: ANTHROPIC_MODEL,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 6000,
    tools: [{ ...WEB_SEARCH, max_uses: 3 }],
    emit,
  });

  const raw = extractJsonObject(result.content) as { sources?: Array<{ url?: string; title?: string; summary?: string; extract?: string }> } | null;
  const declared = (raw?.sources ?? []).map((s, i) => ({ ...s, id: `W${i + 1}` }));
  // a URL the model wrote but the search did not return is dropped — never shown, never used
  const real = validateWebSources(declared, collectWebResults(result.content));

  const insert = db.query(
    "INSERT OR IGNORE INTO web_sources (id, project_id, url, title, summary, extract, query) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const added: WebSource[] = [];
  for (const d of declared) {
    const hit = real.get(d.id);
    if (!hit || known.has(hit.url) || !String(d.summary ?? "").trim()) continue;
    const id = `web_${nanoid()}`;
    insert.run(id, projectId, hit.url, (d.title || hit.title).slice(0, 300), String(d.summary).trim().slice(0, 600), String(d.extract ?? "").trim().slice(0, 3000), query);
    known.add(hit.url);
    added.push(db.query("SELECT * FROM web_sources WHERE id = ?").get(id) as WebSource);
  }
  log.analyze(`web-sources  project=${projectId}  query="${query}"  declared=${declared.length}  added=${added.length}`);
  return added;
}

/**
 * A link the user gives ("Share a web page"): read it, say in two lines what the AS-IS takes
 * from it, and keep it as accepted — the user chose it. Their own note wins over the AI's.
 */
export async function addWebLink(projectId: string, address: string, note: string): Promise<{ source?: WebSource; error?: string }> {
  let url: string;
  try { url = new URL(address.trim()).href; } catch { return { error: "That is not a web address." }; }
  const existing = db.query("SELECT * FROM web_sources WHERE project_id = ? AND url = ?").get(projectId, url) as WebSource | null;
  if (existing) return { source: decideWebSource(projectId, existing.id, "accepted") ?? existing };

  const page = await fetchPageText(url);
  let title = page.data?.title || new URL(url).hostname.replace(/^www\./, "");
  let summary = note.trim();
  let extract = "";
  if (page.data?.text) {
    try {
      const res = await client.messages.create({
        model: ANTHROPIC_MODEL_FAST,
        max_tokens: 1200,
        system: LINK_SYSTEM,
        messages: [{ role: "user", content: `Page: ${url}\nTitle: ${page.data.title}${note.trim() ? `\nThe user's note: ${note.trim()}` : ""}\n\nPage text:\n${page.data.text.slice(0, 24_000)}` }],
      });
      const raw = extractJsonObject(res.content) as { title?: string; summary?: string; extract?: string } | null;
      if (raw?.title && !page.data.title) title = raw.title;
      if (!summary) summary = String(raw?.summary ?? "").trim();
      extract = String(raw?.extract ?? "").trim();
    } catch (err) {
      log.error(`web-sources link ${url}: ${String(err)}`);
    }
  }
  // a site that blocks readers (many government sites do) is still kept: the AS-IS reads it itself
  if (!summary) summary = page.data ? "Added by you." : "Added by you — this page could not be read here; the AS-IS will read it directly.";

  const id = `web_${nanoid()}`;
  db.query("INSERT INTO web_sources (id, project_id, url, title, summary, extract, query, status, decided_at) VALUES (?, ?, ?, ?, ?, ?, 'added by user', 'accepted', unixepoch())")
    .run(id, projectId, url, title.slice(0, 300), summary.slice(0, 600), extract.slice(0, 3000));
  log.analyze(`web-sources  project=${projectId}  link added  ${url}  read=${!!page.data}`);
  return { source: db.query("SELECT * FROM web_sources WHERE id = ?").get(id) as WebSource };
}

/** The accepted sites for the AS-IS prompt: the user approved them, so they may be cited directly */
export function acceptedSourcesBlock(projectId: string): string {
  const accepted = acceptedWebSources(projectId);
  if (!accepted.length) return "";
  const rejected = listWebSources(projectId).filter((s) => s.status === "rejected");
  return [
    "\n\nWEB SOURCES THE USER HAS ACCEPTED — use them as sources for the steps (you do not need to search for them). When you cite one, list it in \"sources\" with a W id and this exact URL (these do not count toward any limit on web pages):",
    ...accepted.map((s, i) => `${i + 1}. ${s.title} — ${s.url}\n   What it gives: ${s.summary.replace(/\n/g, " ")}${s.extract ? `\n   Facts: ${s.extract.replace(/\n/g, " ")}` : "\n   (No facts saved yet — read this page with web_fetch when that tool is offered.)"}`),
    rejected.length ? `\nThe user REJECTED these sites — never use or cite them:\n${rejected.map((s) => `- ${s.url}`).join("\n")}` : "",
  ].join("\n");
}

const SYSTEM = `You find official web sources for mapping a government service as it works today (the AS-IS process).

Use web_search (at most 3 searches, run them together) for official pages: the service portal, the ministry / department site, citizen charters, gazettes, circulars, forms, fee schedules. Prefer government (.gov.bd and similar) and other authoritative sites; skip forums, ads and unrelated pages.

Then answer with ONLY this JSON, no other text:
{"sources":[{"url":"…","title":"…","summary":"…","extract":"…"}]}

- 3 to 8 sources. "url" copied exactly, character for character, from your search results — never a URL you did not receive.
- "summary": exactly two short lines (separated by \\n), max 25 words each, saying what the AS-IS would take from this site — e.g. "Lists the 6 application steps and required documents.\\nGives fees and delivery time per category."
- "extract": the concrete facts from the page that the process map needs (steps, documents, fees, time, offices, legal basis), max 120 words. Only what the search results show — never guess.`;

const LINK_SYSTEM = `You read one web page for mapping a government service as it works today (the AS-IS process). Answer with ONLY this JSON:
{"title":"…","summary":"…","extract":"…"}
- "title": the page's title, short.
- "summary": exactly two short lines (separated by \\n), max 25 words each, saying what the AS-IS would take from this page (steps, documents, fees, time, offices, legal basis). If the page has nothing about the process, say so.
- "extract": the concrete facts on the page that the process map needs, max 150 words, in English. Only what the page says — never guess.`;
