import { json } from "../utils/cors";
import { log } from "../utils/log";

// Reference popup: the readable text of a cited web page, so the text the AI took from it
// can be marked in yellow. (Most government sites refuse to be shown inside another app.)

const cache = new Map<string, { at: number; data: { url: string; title: string; text: string } }>();
const CACHE_MS = 30 * 60_000;

// only public web pages — never this machine or the local network
function allowed(u: URL): boolean {
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return false;
  return true;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (t: string) => t
  .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);

function htmlToText(html: string): { title: string; text: string } {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim());
  const body = html
    .replace(/<(script|style|noscript|svg|head|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|table|ul|ol|blockquote)>/gi, "\n")
    .replace(/<(td|th)[^>]*>/gi, " | ")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  const text = decode(body)
    .split("\n").map((l) => l.replace(/[ \t ]+/g, " ").replace(/^\s*\|\s*/, "").trim()).filter(Boolean)
    .join("\n").replace(/\n{3,}/g, "\n\n");
  return { title, text: text.slice(0, 60_000) };
}

export async function handleWebPage(req: Request, url: URL): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return json({ error: "not_found" }, 404);
  let target: URL;
  try { target = new URL(url.searchParams.get("url") ?? ""); } catch { return json({ error: "bad_url" }, 400); }
  if (!allowed(target)) return json({ error: "not_allowed" }, 400);

  const key = target.href;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.data);

  try {
    const res = await fetch(key, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Mozilla/5.0 (SPS reference viewer)", "Accept": "text/html,application/xhtml+xml,text/plain" },
    });
    if (!res.ok) return json({ error: `The website answered ${res.status}` }, 502);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|xhtml|text\/plain/i.test(type)) return json({ error: "This link is not a web page (it may be a PDF or a file) — open it on the website." }, 415);
    const raw = await res.text();
    const page = /text\/plain/i.test(type) ? { title: "", text: raw.slice(0, 60_000) } : htmlToText(raw);
    const data = { url: res.url || key, ...page };
    cache.set(key, { at: Date.now(), data });
    return json(data);
  } catch (err) {
    log.error(`web-page ${key}: ${String(err)}`);
    return json({ error: "The website could not be reached." }, 502);
  }
}
