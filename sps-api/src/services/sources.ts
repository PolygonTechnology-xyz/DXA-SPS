import type Anthropic from "@anthropic-ai/sdk";

// ── Citations / references ────────────────────────────────────────────────────
//
// The model cites with short ids: [D1:4] = page 4 of uploaded document 1, [W1] = a web page it
// searched or fetched. After generation we keep only ids that point at something
// real (a stored file, or a URL that actually came back from web_search/web_fetch),
// renumber them [1], [2]… in order of first use, and attach to every step the list
// of sources it cites — so the UI can render wiki-style clickable [n] links.

// quotes: short exact sentences taken from the source — highlighted in the reference popup
export interface KnownSource { title: string; url: string; kind: "web" | "doc"; quotes?: string[] }
export interface StepSource { n: number; title: string; url: string; kind: "web" | "doc"; quotes?: string[] }

const MAX_QUOTES = 4;
const mergeQuotes = (a: string[] = [], b: string[] = []) => [...new Set([...a, ...b])].slice(0, MAX_QUOTES);

/**
 * The model's "quotes": [["D1:4","exact sentence"],["W1","…"]] → added to the matching known
 * source (a page, else its document). Unknown ids are ignored.
 */
export function attachQuotes(known: Map<string, KnownSource>, quotes: unknown): void {
  if (!Array.isArray(quotes)) return;
  for (const q of quotes) {
    const [rawId, rawText] = Array.isArray(q) ? q : [(q as { id?: unknown })?.id, (q as { text?: unknown })?.text];
    const text = String(rawText ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!text || typeof rawId !== "string") continue;
    let key = rawId.toUpperCase().replace(/[\[\]\s]/g, "").replace(/-\d+$/, "");
    if (!known.has(key)) key = key.split(":")[0];
    const src = known.get(key);
    if (src) known.set(key, { ...src, quotes: mergeQuotes(src.quotes, [text]) });
  }
}

/** The prompt rule asking for quotes */
export const QUOTE_RULE = `"quotes": for each source you cite, 1-2 short passages (max 25 words each) copied WORD FOR WORD from that page, in its original language and spelling — the exact text that supports your statement. They are highlighted for the user, so never paraphrase or translate. Format: [["D1:4","exact text"],["W1","exact text"]].`;

const normUrl = (u: string) =>
  u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/#.*$/, "").replace(/\/+$/, "");

// URLs (with titles) that really came back from server-side web tools in a response
export function collectWebResults(content: Anthropic.ContentBlock[] | unknown[]): Map<string, { url: string; title: string }> {
  const found = new Map<string, { url: string; title: string }>();
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content as Array<{ url?: string; title?: string }>) {
        if (r.url) found.set(normUrl(r.url), { url: r.url, title: r.title ?? r.url });
      }
    }
    if (block.type === "web_fetch_tool_result") {
      const c = block.content as { url?: string; content?: { title?: string } } | undefined;
      if (c?.url) found.set(normUrl(c.url), { url: c.url, title: c.content?.title ?? c.url });
    }
    // pages the answer itself cites (the API's own citations) were retrieved too
    if (block.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations as Array<{ type?: string; url?: string; title?: string }>) {
        if (c.type === "web_search_result_location" && c.url && !found.has(normUrl(c.url))) found.set(normUrl(c.url), { url: c.url, title: c.title ?? c.url });
      }
    }
  }
  return found;
}

// The same page written a little differently: no query string, no index file
const pageKey = (u: string) => normUrl(u).replace(/\?.*$/, "").replace(/\/(index|default)\.(html?|php|aspx?)$/, "").replace(/\/+$/, "");
const hostOf = (u: string) => normUrl(u).split("/")[0];
const plainTitle = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The retrieved page a model-declared source refers to. The model often writes a URL a little
 * differently from the search result (query string, index page, a parent or child path), so
 * after an exact match this also accepts: the same page without those, a path on the same
 * site that one contains, the same title, and finally the only result from that site.
 * Whatever matches is always a page the search really returned.
 */
function matchRetrieved(url: string, title: string | undefined, allowed: Map<string, { url: string; title: string }>): { url: string; title: string } | null {
  const exact = allowed.get(normUrl(url));
  if (exact) return exact;
  const list = [...allowed.values()];
  const key = pageKey(url);
  const same = list.find((r) => pageKey(r.url) === key);
  if (same) return same;
  const host = hostOf(url);
  const onHost = list.filter((r) => hostOf(r.url) === host);
  const nested = onHost.find((r) => { const k = pageKey(r.url); return k.startsWith(key + "/") || key.startsWith(k + "/"); });
  if (nested) return nested;
  const t = title ? plainTitle(title) : "";
  if (t.length >= 12) {
    const byTitle = list.find((r) => { const rt = plainTitle(r.title); return rt === t || (rt.length >= 12 && (rt.includes(t) || t.includes(rt))); });
    if (byTitle) return byTitle;
  }
  return onHost.length === 1 ? onHost[0] : null;
}

// Model-declared web sources [{id:"W1", url, title}] → keep only those whose URL was really retrieved
export function validateWebSources(
  declared: Array<{ id?: string; url?: string; title?: string }> | undefined,
  retrieved: Map<string, { url: string; title: string }>,
  extraAllowed: string[] = [],
  /** a declared source that matches no retrieved page (for the log) */
  onMiss?: (what: string) => void,
): Map<string, KnownSource> {
  const allowed = new Map(retrieved);
  for (const u of extraAllowed) allowed.set(normUrl(u), { url: u, title: u });
  const out = new Map<string, KnownSource>();
  for (const s of declared ?? []) {
    if (!s.id || !s.url) continue;
    const hit = matchRetrieved(s.url, s.title, allowed);
    if (hit) out.set(s.id.toUpperCase(), { title: s.title || hit.title, url: hit.url, kind: "web" });
    else onMiss?.(`${s.id} ${s.url}`);
  }
  return out;
}

// [D1], [W2], [D1:4] (document 1, page 4), [D1:4-5], or several separated by commas
const ID = String.raw`[A-Za-z]\d+(?::\d+(?:-\d+)?)?`;
const MARKER = new RegExp(String.raw`\[\s*(${ID}(?:\s*,\s*${ID})*)\s*\]`, "g");
// Variants the model sometimes writes instead: [D1 p.4], [D1, page 4]
const PAGE_VARIANT = /\[\s*([A-Za-z]\d+)\s*,?\s*p(?:age|\.)?\s*(\d+)\s*\]/gi;

// Rewrites [D1]/[W2]/[D1:4] markers in the given text fields to [1]/[2] (dropping unknown ids)
// and sets item.sources to the sources that item cites. A page citation ([D1:4]) uses that
// page's source when known, else falls back to the document's ([D1]) when that is known.
export function finalizeCitations<T extends Record<string, unknown>>(
  items: T[],
  fields: string[],
  known: Map<string, KnownSource>,
): { items: (T & { sources: StepSource[] })[]; sources: StepSource[] } {
  const numbering = new Map<string, number>();
  const list: StepSource[] = [];
  const numberFor = (id: string) => {
    let key = id.toUpperCase().replace(/-\d+$/, "");
    if (!known.has(key)) key = key.split(":")[0];
    const src = known.get(key);
    if (!src) return null;
    // one number per source, even when it arrives under different ids (D1:4 and S2)
    const same = src.url || key;
    if (!numbering.has(same)) {
      numbering.set(same, list.length + 1);
      list.push({ n: list.length + 1, ...src });
    } else if (src.quotes?.length) {
      const entry = list[numbering.get(same)! - 1];
      entry.quotes = mergeQuotes(entry.quotes, src.quotes);
    }
    return numbering.get(same)!;
  };

  const out = items.map((item) => {
    const used = new Set<number>();
    const next: Record<string, unknown> = { ...item };
    for (const f of fields) {
      const v = next[f];
      if (typeof v !== "string") continue;
      next[f] = v
        .replace(PAGE_VARIANT, "[$1:$2]")
        .replace(MARKER, (_m, ids: string) => {
          const ns = ids.split(",").map((s) => numberFor(s.trim())).filter((n): n is number => n !== null);
          ns.forEach((n) => used.add(n));
          return [...new Set(ns)].map((n) => `[${n}]`).join("");
        })
        .replace(/\s+([.,;])/g, "$1")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
    next.sources = [...used].sort((a, b) => a - b).map((n) => list[n - 1]);
    return next as T & { sources: StepSource[] };
  });
  return { items: out, sources: list };
}

// Joins the text of the final answer (after the last server-tool result) and parses the JSON object in it
export function extractJsonObject(content: Anthropic.ContentBlock[]): Record<string, unknown> | null {
  const text = content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const candidates = [text, text.replace(/```(?:json)?/g, "")];
  for (const t of candidates) {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try { return JSON.parse(t.slice(start, end + 1)); } catch { /* try next */ }
  }
  return null;
}
