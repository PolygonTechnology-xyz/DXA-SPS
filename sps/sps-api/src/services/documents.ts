import { Resvg } from "@resvg/resvg-js";
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import { db } from "../db/index";
import { log } from "../utils/log";
import { listVersions, type Version } from "./outputs";
import { ensureDigitalPlan, type DigitalComponent, type DigitalPlan } from "./digital-plan";

// ── Documents: Word files written from an approved TO-BE ──────────────────────
//
// The chat makes them on request (create_document): the TO-BE process, its architecture
// diagram (the systems of the Digitalization Analysis), or both. Each is saved with its
// version and listed under Outputs → TO-BE Impact Analysis → Documents for download.
// Written from the saved version only — no AI call.

export type DocContent = "tobe" | "architecture" | "both";

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    version_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
`);

export interface DocumentInfo { id: number; version_id: number; content: DocContent; title: string; file_name: string; size: number; created_at: number }

export function listDocuments(projectId: string, versionId: number): DocumentInfo[] {
  return db.query("SELECT id, version_id, content, title, file_name, length(data) AS size, created_at FROM documents WHERE project_id = ? AND version_id = ? ORDER BY created_at DESC, id DESC")
    .all(projectId, versionId) as DocumentInfo[];
}

export function getDocument(projectId: string, id: number): { file_name: string; data: Uint8Array } | null {
  return db.query("SELECT file_name, data FROM documents WHERE project_id = ? AND id = ?").get(projectId, id) as { file_name: string; data: Uint8Array } | null;
}

export function deleteDocument(projectId: string, id: number): boolean {
  return db.query("DELETE FROM documents WHERE project_id = ? AND id = ?").run(projectId, id).changes > 0;
}

const TITLES: Record<DocContent, string> = { tobe: "TO-BE process", architecture: "TO-BE architecture", both: "TO-BE process and architecture" };
const clean = (t: unknown) => String(t ?? "").replace(/\s*\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim();
const fileSafe = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
const day = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** What the chat tool does: pick the version, write the file, save it */
export async function createDocumentTool(projectId: string, input: Record<string, unknown>) {
  const content: DocContent = input.content === "architecture" || input.content === "both" ? input.content : "tobe";
  // an approved TO-BE: the one asked for, else the version open in the project, else the latest
  const approved = listVersions(projectId).filter((v) => v.tobe_steps.length);
  if (!approved.length) return { summary: "NOT DONE: no approved TO-BE yet. A document can be made once a TO-BE is approved — tell the user." };
  const active = (db.query("SELECT active_version FROM projects WHERE id = ?").get(projectId) as { active_version: number | null } | null)?.active_version;
  const v = approved.find((x) => x.version === Number(input.version)) ?? approved.find((x) => x.id === active) ?? approved[0];

  const plan = v.digital_plan as DigitalPlan | null;
  if (content !== "tobe" && !plan?.components?.length) {
    ensureDigitalPlan(projectId, v.id);
    return { summary: `NOT DONE: the architecture of version ${v.version} comes from its Digitalization Analysis, which is still being prepared. Tell the user to ask again in a minute or two.` };
  }

  const title = `${v.project_name} — ${TITLES[content]}`;
  const bytes = await writeDocx(v, content, plan);
  const fileName = `${fileSafe(v.project_name)}-${fileSafe(TITLES[content])}-v${v.version}.docx`;
  const res = db.query("INSERT INTO documents (project_id, version_id, content, title, file_name, data) VALUES (?, ?, ?, ?, ?, ?)")
    .run(projectId, v.id, content, title, fileName, bytes);
  log.tool(`document ${projectId} v${v.version}: ${content} (${bytes.length} bytes, id=${res.lastInsertRowid})`);
  return {
    summary: `Created the Word document "${fileName}" (${TITLES[content]}) for version ${v.version}. The user downloads it from Outputs → Version ${v.version} → TO-BE Impact Analysis → Documents.`,
    sseEvents: [{ type: "documents_updated", version_id: v.id }],
  };
}

// ── The Word file ─────────────────────────────────────────────────────────────

const NAVY = "13243B", TEAL = "0E7C7B", MUTED = "4B5563";

async function writeDocx(v: Version, content: DocContent, plan: DigitalPlan | null): Promise<Uint8Array> {
  const body: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: v.project_name, color: NAVY })] }),
    new Paragraph({ children: [new TextRun({ text: `${TITLES[content]} · Version ${v.version} · approved ${day(v.approved_at)}`, color: MUTED, size: 24 })] }),
    new Paragraph({ text: "" }),
  ];
  if (content !== "architecture") body.push(...tobeSection(v));
  if (content !== "tobe" && plan) body.push(...architectureSection(plan.components));

  const doc = new Document({
    creator: "DXA Platform",
    title: `${v.project_name} — ${TITLES[content]}`,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ children: body }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) =>
  new Paragraph({ heading: level, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, color: NAVY })] });
const labelled = (label: string, text: string) =>
  new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(text)] });

/** "Label: what the step does [1]" → "what the step does" */
const detail = (action: unknown) => {
  const text = clean(action);
  const i = text.indexOf(":");
  return i > 0 && i <= 40 ? text.slice(i + 1).trim() : text;
};

function tobeSection(v: Version): Paragraph[] {
  const asis = v.asis_steps.length, tobe = v.tobe_steps.length;
  const out = [
    heading("Summary"),
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun(
      `The current (AS-IS) process has ${asis} step${asis === 1 ? "" : "s"}. The simplified (TO-BE) process has ${tobe} step${tobe === 1 ? "" : "s"}` +
      (asis > tobe ? `, ${asis - tobe} fewer.` : "."),
    )] }),
    heading("TO-BE process"),
  ];
  for (const s of v.tobe_steps) {
    out.push(heading(`Step ${s.step_number} · ${clean(s.step_name)}`, HeadingLevel.HEADING_2));
    const what = detail(s.action);
    if (what) out.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun(what)] }));
    if (clean(s.digital_how)) out.push(labelled("How it is digitalized", clean(s.digital_how)));
    if (clean(s.best_practice)) out.push(labelled("World best practice", clean(s.best_practice)));
    if (clean(s.if_rejected)) out.push(labelled(`If rejected${s.no_goto ? ` (back to step ${s.no_goto})` : ""}`, clean(s.if_rejected)));
    if (clean(s.legal_basis)) out.push(labelled("Legal basis", clean(s.legal_basis)));
    if (clean(s.simplification_rationale)) out.push(labelled("Why", clean(s.simplification_rationale)));
  }
  return out;
}

const STATUS: Record<DigitalComponent["status"], { label: string; fill: string; line: string; text: string }> = {
  existing: { label: "Already have", fill: "#E7F4EC", line: "#15803D", text: "#14532D" },
  upgrade: { label: "Needs upgrade", fill: "#FBEFE3", line: "#B45309", text: "#7C2D12" },
  new: { label: "New to build", fill: "#E6EEFB", line: "#1D4ED8", text: "#1E3A8A" },
};

function architectureSection(items: DigitalComponent[]): Array<Paragraph | Table> {
  const count = (st: DigitalComponent["status"]) => items.filter((c) => c.status === st).length;
  const { png, width, height } = architecturePng(items);
  const w = 620;
  // System · Status · What it does · TO-BE steps (percent of the page width)
  const WIDTHS = [26, 15, 47, 12];
  const cell = (text: string, opts: { bold?: boolean; fill?: string; color?: string } = {}, col = 0) => new TableCell({
    width: { size: WIDTHS[col], type: WidthType.PERCENTAGE },
    shading: opts.fill ? { type: ShadingType.CLEAR, color: "auto", fill: opts.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold, color: opts.color, size: 20 })] })],
  });
  const line = { style: BorderStyle.SINGLE, size: 4, color: "D5DEE7" };
  return [
    heading("TO-BE architecture"),
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun(
      `${items.length} systems support the TO-BE process: ${count("existing")} already in use, ${count("upgrade")} to upgrade and ${count("new")} to build. ` +
      "People reach the service through its channels; the channels work on the office systems, which exchange data with other offices' systems.",
    )] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "png", data: png, transformation: { width: w, height: Math.round(height * w / width) } })] }),
    heading("Systems", HeadingLevel.HEADING_2),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: WIDTHS.map((p) => Math.round(9000 * p / 100)),
      borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
      rows: [
        new TableRow({ tableHeader: true, children: ["System", "Status", "What it does", "TO-BE steps"].map((t, i) => cell(t, { bold: true, fill: "EEF3F6", color: NAVY }, i)) }),
        ...(["existing", "upgrade", "new"] as const).flatMap((st) => items.filter((c) => c.status === st).map((c) => new TableRow({ children: [
          cell(c.name, { bold: true }, 0),
          cell(STATUS[st].label, { color: STATUS[st].line.slice(1) }, 1),
          cell(clean(c.purpose), {}, 2),
          cell(c.steps.join(", ") || "—", {}, 3),
        ] }))),
      ],
    }),
    new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: "Colours in the diagram: green = already have, amber = needs upgrade, blue = new to build.", color: MUTED, size: 18 })] }),
  ];
}

// ── The diagram (SVG drawn here, turned into a PNG for Word) ──────────────────

const LAYERS: Array<{ title: string; kinds: DigitalComponent["kind"][] }> = [
  { title: "Service channels", kinds: ["website", "portal_module", "mobile_app"] },
  { title: "Office systems", kinds: ["system", "hardware", "other"] },
  { title: "Data links to other offices", kinds: ["integration"] },
];

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Words into lines of about `max` characters, at most `rows` lines */
function wrap(text: string, max: number, rows: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if ((cur + " " + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > rows) { lines.length = rows; lines[rows - 1] = lines[rows - 1].replace(/\s*\S*$/, "") + "…"; }
  return lines;
}

function architecturePng(items: DigitalComponent[]) {
  const W = 1200, PAD = 40, COLS = 4, GAP = 20, BOX_H = 74, LABEL_H = 34, BAND_GAP = 46;
  const boxW = (W - 2 * PAD - 40 - (COLS - 1) * GAP) / COLS;
  const parts: string[] = [];
  let y = PAD;

  // people at the top
  const people = ["Applicants", "Office officials"];
  const pw = 240, px = (W - (people.length * pw + (people.length - 1) * GAP)) / 2;
  people.forEach((p, i) => {
    parts.push(`<rect x="${px + i * (pw + GAP)}" y="${y}" width="${pw}" height="48" rx="24" fill="#13243B"/>`,
      `<text x="${px + i * (pw + GAP) + pw / 2}" y="${y + 30}" text-anchor="middle" font-size="17" font-weight="700" fill="#FFFFFF">${p}</text>`);
  });
  y += 48;

  const layers = LAYERS.map((l) => ({ ...l, list: items.filter((c) => l.kinds.includes(c.kind)) })).filter((l) => l.list.length);
  for (const l of layers) {
    // the connection from the band above
    parts.push(`<line x1="${W / 2}" y1="${y + 6}" x2="${W / 2}" y2="${y + BAND_GAP - 8}" stroke="#94A3B8" stroke-width="3"/>`,
      `<path d="M ${W / 2 - 8} ${y + BAND_GAP - 14} L ${W / 2} ${y + BAND_GAP - 4} L ${W / 2 + 8} ${y + BAND_GAP - 14}" fill="none" stroke="#94A3B8" stroke-width="3"/>`);
    y += BAND_GAP;
    const rows = Math.ceil(l.list.length / COLS);
    const bandH = LABEL_H + rows * BOX_H + (rows - 1) * GAP + 20;
    parts.push(`<rect x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="${bandH}" rx="14" fill="#F4F7FA" stroke="#D5DEE7"/>`,
      `<text x="${PAD + 20}" y="${y + 24}" font-size="15" font-weight="700" fill="#0E7C7B">${esc(l.title.toUpperCase())}</text>`);
    l.list.forEach((c, i) => {
      const r = Math.floor(i / COLS), col = i % COLS;
      const inRow = Math.min(COLS, l.list.length - r * COLS);
      // a short last row is centred
      const x0 = PAD + 20 + ((COLS - inRow) * (boxW + GAP)) / 2;
      const bx = x0 + col * (boxW + GAP), by = y + LABEL_H + r * (BOX_H + GAP);
      const S = STATUS[c.status];
      const lines = wrap(c.name, 26, 3);
      const ty = by + BOX_H / 2 - ((lines.length - 1) * 19) / 2 + 6;
      parts.push(`<rect x="${bx}" y="${by}" width="${boxW}" height="${BOX_H}" rx="10" fill="${S.fill}" stroke="${S.line}" stroke-width="2"/>`,
        ...lines.map((t, k) => `<text x="${bx + boxW / 2}" y="${ty + k * 19}" text-anchor="middle" font-size="15" font-weight="600" fill="${S.text}">${esc(t)}</text>`));
    });
    y += bandH;
  }

  // legend
  y += 28;
  let lx = PAD;
  for (const st of ["existing", "upgrade", "new"] as const) {
    const S = STATUS[st];
    parts.push(`<rect x="${lx}" y="${y - 14}" width="18" height="18" rx="4" fill="${S.fill}" stroke="${S.line}" stroke-width="2"/>`,
      `<text x="${lx + 26}" y="${y}" font-size="15" fill="#334155">${S.label}</text>`);
    lx += 190;
  }
  const H = y + PAD - 10;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Noto Sans, DejaVu Sans, sans-serif">` +
    `<rect width="${W}" height="${H}" fill="#FFFFFF"/>${parts.join("")}</svg>`;
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W * 2 }, font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" } }).render().asPng();
  return { png: new Uint8Array(png), width: W, height: H };
}
