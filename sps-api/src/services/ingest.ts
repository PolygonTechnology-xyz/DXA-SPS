import { join, basename, extname } from "path";
import { mkdirSync, rmSync, readdirSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { db } from "../db/index";
import { DATA_DIR } from "../config";
import { nanoid } from "../utils/id";
import { log } from "../utils/log";

// ── Document ingestion ────────────────────────────────────────────────────────
//
// An uploaded file is kept as-is and split into pages the AS-IS agent can search and read:
//   PDF            → its own pages
//   Office files   → converted to PDF with LibreOffice (real pages, tables kept)
//   Spreadsheets   → one page per sheet (or per ~3000 chars of a large sheet)
//   Text / images  → ~3000-char sections / one page
// Page text goes into file_pages and the full-text index. Pages whose text is missing
// (scanned) or garbled (legacy Bangla fonts such as SutonnyMJ) are kept out of the index:
// the agent reads those as page images instead.

const DERIVED_DIR = join(DATA_DIR, "derived");
const TMP_DIR = join(DATA_DIR, "tmp");
for (const d of [DERIVED_DIR, TMP_DIR]) mkdirSync(d, { recursive: true });

const OFFICE_EXT = ["doc", "docx", "odt", "rtf", "ppt", "pptx", "odp"];
const SHEET_EXT = ["xlsx", "xlsm", "xls", "ods"];
const TEXT_EXT = ["txt", "md", "csv", "json", "html", "htm"];
export const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

const SECTION_CHARS = 3000;
/** Files of the Global Knowledge library live under this project id */
export const GLOBAL_PROJECT = "__global__";

type Quality = "good" | "empty" | "garbled";
interface Page { text: string; quality: Quality }

export interface FileRow {
  id: string; project_id: string; name: string; path: string;
  kind: string | null; pdf_path: string | null; pages: number; status: string | null;
}

const extOf = (name: string) => extname(name).slice(1).toLowerCase();

/**
 * Runs a command with a hard time limit. On timeout the process is killed and we stop
 * waiting at once — a child it started (LibreOffice's soffice.bin) can keep the output
 * pipes open forever, so never wait for them after the limit.
 */
async function run(cmd: string[], timeoutMs = 120_000, onTimeout?: () => void): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const out = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
  const result = await Promise.race([out, limit]);
  clearTimeout(timer);
  if (result === "timeout") {
    proc.kill(9);
    onTimeout?.();
    return { code: -1, stdout: "", stderr: "timed out", timedOut: true };
  }
  const [stdout, stderr, code] = result;
  return { code, stdout, stderr, timedOut: false };
}

// LibreOffice conversions: each gets its own throw-away profile (a shared profile's lock
// makes conversions hang behind each other or behind a desktop LibreOffice), at most two
// run at once, 60 s each, one retry.
const SOFFICE_SLOTS = 2;
const SOFFICE_TIMEOUT = 60_000;
let sofficeRunning = 0;
const sofficeWaiting: Array<() => void> = [];

async function withSofficeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (sofficeRunning >= SOFFICE_SLOTS) await new Promise<void>((resolve) => sofficeWaiting.push(resolve));
  sofficeRunning++;
  try { return await fn(); } finally {
    sofficeRunning--;
    sofficeWaiting.shift()?.();
  }
}

async function sofficeOnce(src: string, format: string, outDir: string): Promise<string | null> {
  // The profile lives in the system temp folder and is passed as a proper file URL:
  // a raw path with a space (e.g. ".../SPS Project/...") is not a valid URL to
  // LibreOffice, which then hangs instead of converting.
  const profile = join(tmpdir(), `sps-lo-${nanoid()}`);
  try {
    const r = await run(
      ["soffice", "--headless", "--norestore", "--nologo", "--nodefault", "--nolockcheck",
        `-env:UserInstallation=${pathToFileURL(profile).href}`, "--convert-to", format, "--outdir", outDir, src],
      SOFFICE_TIMEOUT,
      // kill the whole LibreOffice instance of this job (its profile path is unique)
      () => { Bun.spawnSync(["pkill", "-9", "-f", profile]); },
    );
    const out = join(outDir, `${basename(src, extname(src))}.${format}`);
    return !r.timedOut && r.code === 0 && await Bun.file(out).exists() ? out : null;
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

/** Converts with LibreOffice (two at a time, one retry); throws when it still fails */
function soffice(src: string, format: string, outDir: string, onStart?: () => void): Promise<string> {
  return withSofficeSlot(async () => {
    onStart?.();
    mkdirSync(outDir, { recursive: true });
    const out = await sofficeOnce(src, format, outDir) ?? await sofficeOnce(src, format, outDir);
    if (!out) throw new Error(`conversion to ${format} failed`);
    return out;
  });
}

// ── Text straight from Office files (fallback when the PDF conversion fails) ────

/** Paragraphs and tables of a .docx / .odt, or one section per slide of a .pptx / .odp */
async function officeText(path: string, ext: string): Promise<string[]> {
  const unzip = async (member: string) => (await run(["unzip", "-p", path, member], 30_000)).stdout;
  const decode = (xml: string) => xml
    .replace(/<\/(w:p|a:p|text:p|text:h)>/g, "\n")
    .replace(/<\/(w:tc|table:table-cell)>/g, " | ")
    .replace(/<\/(w:tr|table:table-row)>/g, "\n")
    .replace(/<(w:tab|text:tab)\/>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (ext === "docx") return sections(decode(await unzip("word/document.xml")));
  if (ext === "odt" || ext === "odp") return sections(decode(await unzip("content.xml")));
  if (ext === "pptx") {
    const list = (await run(["unzip", "-Z1", path], 30_000)).stdout.split("\n").filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const slides: string[] = [];
    for (const f of list) slides.push(`Slide ${f.match(/\d+/)![0]}\n${decode(await unzip(f))}`);
    return slides;
  }
  return [];   // .doc / .ppt / .rtf: no text fallback
}

/** good = usable text; empty = (nearly) no text, e.g. a scan; garbled = legacy-font Bangla or broken encoding (PDFs only) */
function pageQuality(text: string, fromPdf = false): Quality {
  const chars = text.replace(/\s/g, "");
  if (chars.length < (fromPdf ? 25 : 1)) return "empty";
  if (!fromPdf) return "good";
  const count = (re: RegExp) => (chars.match(re) ?? []).length;
  if (count(/�/g) / chars.length > 0.05) return "garbled";
  // Bijoy/SutonnyMJ Bangla comes out as Latin letters mixed with symbols like ‡ † ˆ © ¨ ` ~
  const bangla = count(/[ঀ-৿]/g);
  const legacy = count(/[¡-ÿŒœŠšŸƒˆ˜†‡…‰`~^|]/g);
  if (bangla < chars.length * 0.05 && legacy / chars.length > 0.04) return "garbled";
  return "good";
}

function sections(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const para of text.split(/\n{2,}/)) {
    if (cur && cur.length + para.length > SECTION_CHARS) { out.push(cur); cur = ""; }
    // a single huge paragraph is cut hard
    for (let i = 0; i < para.length; i += SECTION_CHARS) {
      const piece = para.slice(i, i + SECTION_CHARS);
      if (cur && cur.length + piece.length > SECTION_CHARS) { out.push(cur); cur = ""; }
      cur += (cur ? "\n\n" : "") + piece;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

async function pdfPages(pdfPath: string): Promise<Page[]> {
  const info = await run(["pdfinfo", pdfPath]);
  const count = Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
  if (!count) throw new Error("not a readable PDF");
  const txt = await run(["pdftotext", "-layout", "-enc", "UTF-8", pdfPath, "-"]);
  const texts = txt.stdout.split("\f");
  return Array.from({ length: count }, (_, i) => {
    const text = (texts[i] ?? "").replace(/[ \t]+\n/g, "\n").trim();
    return { text, quality: pageQuality(text, true) };
  });
}

const SHEET_SCRIPT = `
import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
out = []
for ws in wb.worksheets:
    rows = []
    for row in ws.iter_rows(values_only=True):
        cells = ["" if v is None else str(v).strip() for v in row]
        while cells and not cells[-1]: cells.pop()
        if any(cells): rows.append(" | ".join(cells))
        if len(rows) >= 3000: break
    out.append({"sheet": ws.title, "text": "\\n".join(rows)})
print(json.dumps(out))
`;

async function sheetPages(path: string, fileId: string): Promise<Page[]> {
  let xlsx = path;
  if (!["xlsx", "xlsm"].includes(extOf(path))) xlsx = await soffice(path, "xlsx", join(DERIVED_DIR, fileId));
  const r = await run(["python3", "-P", "-c", SHEET_SCRIPT, xlsx]);
  if (r.code !== 0) throw new Error("could not read the spreadsheet");
  const sheets = JSON.parse(r.stdout) as { sheet: string; text: string }[];
  return sheets.flatMap((s) => {
    // split on whole rows; later parts repeat the top rows so column headers stay readable
    const rows = s.text.split("\n");
    const header = rows.slice(0, 4).join("\n");
    const parts: string[] = [];
    let cur: string[] = [];
    let len = 0;
    for (const row of rows) {
      if (cur.length && len + row.length > SECTION_CHARS) { parts.push(cur.join("\n")); cur = []; len = 0; }
      cur.push(row);
      len += row.length + 1;
    }
    if (cur.length) parts.push(cur.join("\n"));
    return parts.map((part, i) => {
      const top = i > 0 ? `Top rows of the sheet (repeated):\n${header}\n…\n` : "";
      return { text: `Sheet "${s.sheet}"${parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : ""}\n${top}${part}`, quality: pageQuality(part) };
    });
  });
}

/** Converts, splits and indexes one file. Never throws: failures are recorded on the file. */
async function ingest(file: FileRow): Promise<void> {
  const ext = extOf(file.name);
  const started = Date.now();
  let kind: "pdf" | "text" | "image" | null = null;
  let pdfPath: string | null = null;
  let pages: Page[] = [];
  let status = "ready";
  let note = "";
  let textOnly = false;   // an Office file read as text because the PDF conversion failed

  try {
    const bytes = await Bun.file(file.path).arrayBuffer();
    const sha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    db.query("UPDATE files SET sha256 = ? WHERE id = ?").run(sha, file.id);

    if (ext === "pdf") {
      kind = "pdf";
      pdfPath = file.path;
      pages = await pdfPages(pdfPath);
    } else if (OFFICE_EXT.includes(ext)) {
      setNote(file.id, "Waiting to convert…");
      try {
        pdfPath = await soffice(file.path, "pdf", join(DERIVED_DIR, file.id), () => setNote(file.id, "Converting to PDF…"));
        kind = "pdf";
        pages = await pdfPages(pdfPath);
      } catch (err) {
        // LibreOffice failed even after a retry: use the text straight from the file
        const text = await officeText(file.path, ext);
        if (!text.length) throw err;
        log.error(`ingest  ${file.name}: ${String(err)} — using the text inside the file instead`);
        pdfPath = null;
        kind = "text";
        pages = text.map((t) => ({ text: t, quality: pageQuality(t) }));
        textOnly = true;
      }
    } else if (SHEET_EXT.includes(ext)) {
      kind = "text";
      pages = await sheetPages(file.path, file.id);
    } else if (TEXT_EXT.includes(ext)) {
      kind = "text";
      pages = sections(new TextDecoder().decode(bytes)).map((text) => ({ text, quality: pageQuality(text) }));
    } else if (IMAGE_TYPES[ext]) {
      kind = "image";
      pages = [{ text: "", quality: "empty" }];
    } else {
      status = "unsupported";
      note = "This file type can't be read — upload PDF, Word, Excel, PowerPoint, text or an image";
    }

    if (kind) {
      const good = pages.filter((p) => p.quality === "good").length;
      const unit = kind === "pdf" ? "page" : "section";
      const n = `${pages.length} ${unit}${pages.length === 1 ? "" : "s"}`;
      if (kind === "image") { status = "visual"; note = "Image — the AI looks at it directly; keyword search can't see it"; }
      else if (!pages.length) { status = "failed"; note = "No content found in this file"; }
      else if (good === pages.length) note = `${n} · searchable`;
      else if (kind === "pdf" && good === 0) { status = "visual"; note = `${n} · scanned or legacy-font text — the AI reads the page images; keyword search can't see it`; }
      else if (kind === "pdf") note = `${n} · ${pages.length - good} scanned/unreadable — the AI reads those as images`;
      else if (good === 0) { status = "failed"; note = "No readable text found"; }
      else note = `${n} · searchable`;
      if (textOnly && status === "ready") note = `${n} · text only (PDF conversion failed, so no page images) · searchable`;
    }
  } catch (err) {
    status = "failed";
    note = `Could not process this file (${err instanceof Error ? err.message : String(err)})`;
    pages = [];
  }

  db.transaction(() => {
    db.query("DELETE FROM file_pages WHERE file_id = ?").run(file.id);
    db.query("DELETE FROM file_pages_fts WHERE file_id = ?").run(file.id);
    const insPage = db.query("INSERT INTO file_pages (file_id, page, text, quality) VALUES (?, ?, ?, ?)");
    const insFts = db.query("INSERT INTO file_pages_fts (text, file_id, project_id, page) VALUES (?, ?, ?, ?)");
    pages.forEach((p, i) => {
      insPage.run(file.id, i + 1, p.text, p.quality);
      if (p.quality === "good") insFts.run(p.text, file.id, file.project_id, i + 1);
    });
    // Plain text of the readable pages (kept on the file row for reference)
    const content = pages.filter((p) => p.quality === "good").map((p) => p.text).join("\n\n");
    db.query("UPDATE files SET kind = ?, pdf_path = ?, pages = ?, status = ?, status_note = ?, content = ? WHERE id = ?")
      .run(kind, pdfPath, pages.length, status, note, content, file.id);
  })();
  log.info(`ingest  ${file.name}  kind=${kind ?? "-"}  pages=${pages.length}  status=${status}  ${Date.now() - started}ms`);
}

/** Progress shown on the file while it is processed */
function setNote(fileId: string, note: string) {
  db.query("UPDATE files SET status_note = ? WHERE id = ? AND status = 'processing'").run(note, fileId);
}

const inFlight = new Map<string, Promise<void>>();

export function ingestFile(fileId: string): Promise<void> {
  const running = inFlight.get(fileId);
  if (running) return running;
  const file = db.query("SELECT * FROM files WHERE id = ?").get(fileId) as FileRow | null;
  if (!file) return Promise.resolve();
  db.query("UPDATE files SET status = 'processing', status_note = 'Reading the document…' WHERE id = ?").run(fileId);
  const job = ingest(file).finally(() => inFlight.delete(fileId));
  inFlight.set(fileId, job);
  return job;
}

/** Adds a text document to a project's files (e.g. web research saved from the chat) and processes it */
export function addTextDocument(projectId: string, name: string, text: string): string {
  const id = `file_${nanoid()}`;
  const path = join(DATA_DIR, `${id}_${name.replace(/[^\p{L}\p{N} ._()-]+/gu, "-")}`);
  writeFileSync(path, text, "utf8");
  db.query(
    "INSERT INTO files (id, project_id, name, size, path, content, status, status_note) VALUES (?, ?, ?, ?, ?, '', 'processing', 'Reading the document…')"
  ).run(id, projectId, name, Buffer.byteLength(text), path);
  ingestFile(id).catch((err) => log.error(`ingest ${name}: ${String(err)}`));
  return id;
}

/** Waits until every file in the project has been processed (used before AS-IS) */
export async function ensureProjectIngested(projectId: string): Promise<void> {
  const rows = db.query("SELECT id FROM files WHERE project_id IN (?, ?) AND (status IS NULL OR status = 'processing')").all(projectId, GLOBAL_PROJECT) as { id: string }[];
  await Promise.all(rows.map((r) => ingestFile(r.id)));
}

/**
 * Files are stored with absolute paths. When the project folder is moved, re-point paths
 * that no longer exist to the same file under the current data folder.
 */
function relinkMovedFiles(): void {
  const rows = db.query("SELECT id, path, pdf_path FROM files").all() as { id: string; path: string | null; pdf_path: string | null }[];
  const relink = (p: string | null) => {
    if (!p || existsSync(p)) return p;
    const rel = p.split("/sps-data/")[1];
    const moved = rel ? join(DATA_DIR, rel) : null;
    return moved && existsSync(moved) ? moved : p;
  };
  let n = 0;
  for (const r of rows) {
    const path = relink(r.path);
    const pdf = relink(r.pdf_path);
    if (path !== r.path || pdf !== r.pdf_path) {
      db.query("UPDATE files SET path = ?, pdf_path = ? WHERE id = ?").run(path, pdf, r.id);
      n++;
    }
  }
  if (n) log.info(`ingest  re-linked ${n} file path(s) to ${DATA_DIR}`);
}

/** At startup: process files uploaded before ingestion existed, or interrupted by a restart */
export async function ingestPending(): Promise<void> {
  relinkMovedFiles();
  const rows = db.query("SELECT id FROM files WHERE status IS NULL OR status = 'processing'").all() as { id: string }[];
  if (rows.length) log.info(`ingest  ${rows.length} file(s) pending`);
  for (const r of rows) await ingestFile(r.id);
}

export function removeFileData(fileId: string): void {
  db.query("DELETE FROM file_pages WHERE file_id = ?").run(fileId);
  db.query("DELETE FROM file_pages_fts WHERE file_id = ?").run(fileId);
  rmSync(join(DERIVED_DIR, fileId), { recursive: true, force: true });
}

// ── Reading ───────────────────────────────────────────────────────────────────

export interface SearchHit { file_id: string; page: number; snippet: string }

/** Full-text search (BM25) over a project's readable pages; at most `perFile` hits per file */
export function searchPages(projectId: string, query: string, fileIds?: string[], limit = 12, perFile = 4): SearchHit[] {
  const words = [...new Set(query.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [])].filter((w) => w.length > 1).slice(0, 12);
  if (!words.length) return [];
  // prefix match, so "নিবন্ধন" also finds "নিবন্ধনের" and "fee" finds "fees"
  const match = words.map((w) => `"${w.replace(/"/g, "")}"*`).join(" OR ");
  const rows = db.query(
    `SELECT file_id, page, snippet(file_pages_fts, 0, '«', '»', '…', 24) AS snippet
     FROM file_pages_fts WHERE file_pages_fts MATCH ? AND project_id IN (?, ?) ORDER BY bm25(file_pages_fts) LIMIT 80`
  ).all(match, projectId, GLOBAL_PROJECT) as SearchHit[];
  const perFileCount = new Map<string, number>();
  const hits: SearchHit[] = [];
  for (const r of rows) {
    if (fileIds && !fileIds.includes(r.file_id)) continue;
    const n = perFileCount.get(r.file_id) ?? 0;
    if (n >= perFile) continue;
    perFileCount.set(r.file_id, n + 1);
    hits.push({ ...r, page: Number(r.page), snippet: r.snippet.replace(/\s+/g, " ") });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function getPages(fileId: string, from: number, to: number): { page: number; text: string; quality: Quality }[] {
  return db.query("SELECT page, text, quality FROM file_pages WHERE file_id = ? AND page BETWEEN ? AND ? ORDER BY page")
    .all(fileId, from, to) as { page: number; text: string; quality: Quality }[];
}

// The spreadsheet as a grid (for the reference popup): every sheet with its cells and merged ranges
const GRID_SCRIPT = `
import sys, json, csv, datetime, openpyxl
path = sys.argv[1]
MAX_ROWS, MAX_COLS = 2000, 60
def fmt(v):
    if v is None: return ""
    if isinstance(v, bool): return "TRUE" if v else "FALSE"
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    if isinstance(v, datetime.datetime):
        return v.strftime("%d-%m-%Y") if v.time() == datetime.time(0) else v.strftime("%d-%m-%Y %H:%M")
    if isinstance(v, datetime.date): return v.strftime("%d-%m-%Y")
    return str(v)
out = []
if path.lower().endswith(".csv"):
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        rows = [r[:MAX_COLS] for _, r in zip(range(MAX_ROWS), csv.reader(f))]
    out.append({"name": "Sheet1", "rows": rows, "merges": []})
else:
    wb = openpyxl.load_workbook(path, data_only=True)
    for ws in wb.worksheets:
        rows = []
        for r in ws.iter_rows(min_row=1, max_row=min(ws.max_row, MAX_ROWS), max_col=min(ws.max_column, MAX_COLS), values_only=True):
            rows.append([fmt(v) for v in r])
        while rows and not any(rows[-1]): rows.pop()
        width = max([max([i + 1 for i, c in enumerate(r) if c] or [0]) for r in rows] or [0])
        rows = [r[:width] for r in rows]
        merges = []
        for m in ws.merged_cells.ranges:
            if m.min_row <= len(rows) and m.min_col <= width:
                merges.append([m.min_row - 1, m.min_col - 1, min(m.max_row, len(rows)) - 1, min(m.max_col, width) - 1])
        out.append({"name": ws.title, "rows": rows, "merges": merges})
print(json.dumps(out, ensure_ascii=False))
`;

/** A spreadsheet (xlsx / xls / ods / csv) as sheets of cells — cached next to the file's other derived data */
export async function sheetGrid(fileId: string, path: string): Promise<unknown> {
  const dir = join(DERIVED_DIR, fileId);
  const cached = join(dir, "grid.json");
  if (existsSync(cached)) return JSON.parse(await Bun.file(cached).text());
  mkdirSync(dir, { recursive: true });
  const ext = extOf(path);
  const src = ["xlsx", "xlsm", "csv"].includes(ext) ? path : await soffice(path, "xlsx", dir);
  const r = await run(["python3", "-P", "-c", GRID_SCRIPT, src], 60_000);
  if (r.code !== 0) throw new Error("could not read the spreadsheet");
  writeFileSync(cached, r.stdout);
  return JSON.parse(r.stdout);
}

/** One page of a PDF as a PNG (for the reference popup when the page has no readable text) */
export async function renderPage(pdfPath: string, page: number): Promise<Uint8Array | null> {
  const dir = join(TMP_DIR, nanoid());
  mkdirSync(dir, { recursive: true });
  try {
    const out = join(dir, "page");
    const r = await run(["pdftoppm", "-f", String(page), "-l", String(page), "-r", "110", "-png", "-singlefile", pdfPath, out], 30_000);
    if (r.code !== 0 || !existsSync(`${out}.png`)) return null;
    return new Uint8Array(await Bun.file(`${out}.png`).arrayBuffer());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A PDF of pages from..to (1-based) of the given PDF */
export async function slicePdf(pdfPath: string, from: number, to: number, totalPages: number): Promise<Uint8Array> {
  if (from === 1 && to >= totalPages) return new Uint8Array(await Bun.file(pdfPath).arrayBuffer());
  const dir = join(TMP_DIR, nanoid());
  mkdirSync(dir, { recursive: true });
  try {
    const sep = await run(["pdfseparate", "-f", String(from), "-l", String(to), pdfPath, join(dir, "p-%d.pdf")]);
    if (sep.code !== 0) throw new Error(`could not cut pages ${from}–${to}`);
    const parts = readdirSync(dir).filter((f) => f.startsWith("p-"))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0])).map((f) => join(dir, f));
    let out = parts[0];
    if (parts.length > 1) {
      out = join(dir, "out.pdf");
      const unite = await run(["pdfunite", ...parts, out]);
      if (unite.code !== 0) throw new Error(`could not join pages ${from}–${to}`);
    }
    return new Uint8Array(await Bun.file(out).arrayBuffer());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
