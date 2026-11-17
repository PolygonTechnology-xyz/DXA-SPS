import { Resvg } from "@resvg/resvg-js";
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, Packer, PageBreak, PageNumber, Paragraph, ShadingType,
  LineRuleType, TabStopType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import { SPS_ASPECTS, SPS_PROFILE } from "./sps-guide";
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
  const meta = db.query("SELECT ministry, department FROM projects WHERE id = ?").get(projectId) as DocMeta | null;
  const bytes = await writeDocx(v, content, plan, meta ?? {});
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
//
// An SPS report in the guideline's order: summary with the TCVQ figures (ছক-৭), the service
// profile (ছক-১), the AS-IS baseline with its pain points, the problem analysis (ছক-৫), the
// TO-BE (overview table + every step in detail), what happened to each AS-IS step (ছক-৬),
// the citizen's documents (ছক-৩), the legal basis and the references the TO-BE cites.

const NAVY = "13243B", TEAL = "0E7C7B", MUTED = "4B5563", HEAD_FILL = "EEF3F6", ZEBRA = "F8FAFC";
// Bangla is a complex script: Word needs a font for it, or it falls back to boxes on some machines
const FONT = { ascii: "Calibri", hAnsi: "Calibri", cs: "Nirmala UI", eastAsia: "Calibri" };

export interface DocMeta { ministry?: string; department?: string }

type Block = Paragraph | Table;
type Step = Record<string, unknown>;

const DIGITAL: Record<string, string> = { manual: "Manual", partly: "Partly digital", online: "Fully online" };
const CHANNEL: Record<string, string> = { digital: "Digital", in_person: "In person", hybrid: "Hybrid" };
const DISPOSITION: Record<string, string> = { kept: "Kept", merged: "Merged", removed: "Removed" };
const DOC_SOURCE: Record<string, string> = { citizen_own: "Citizen already has it", other_office: "From another office" };
const DOC_TOBE: Record<string, string> = { submit: "Still submitted", auto: "Fetched / verified automatically", removed: "No longer needed" };
const taka = (n: number) => `৳${Math.round(n).toLocaleString("en-IN")}`;
const days = (n: number) => `${Math.round(n * 10) / 10} working day${n === 1 ? "" : "s"}`;
/** Keeps the TO-BE's [n] markers — they point to the References at the end */
const cited = (t: unknown) => String(t ?? "").replace(/\s*\[([A-Za-z][^\]]*)\]/g, "").replace(/\s{2,}/g, " ").trim();

/** Numbered chapter headings (1., 2. …), remembered for the contents page */
type Sec = (title: string, newPage?: boolean) => Paragraph;
function sections(): { sec: Sec; titles: string[] } {
  const titles: string[] = [];
  const sec: Sec = (title, newPage = false) => {
    titles.push(title);
    return new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: newPage, children: [new TextRun({ text: `${titles.length}.  ${title}` })] });
  };
  return { sec, titles };
}

function contents(titles: string[]): Block[] {
  return [
    new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: "Contents", bold: true, color: NAVY, size: 30 })] }),
    ...titles.map((t, i) => new Paragraph({
      spacing: { after: 100 }, border: { bottom: { style: BorderStyle.DOTTED, size: 4, color: "C7D0DA", space: 4 } },
      children: [new TextRun({ text: `${i + 1}.`, bold: true, color: TEAL }), new TextRun({ text: `\t${t}`, color: NAVY })],
      tabStops: [{ type: TabStopType.LEFT, position: 567 }],
    })),
    pageBreak(),
  ];
}

async function writeDocx(v: Version, content: DocContent, plan: DigitalPlan | null, meta: DocMeta): Promise<Uint8Array> {
  const owner = [meta.department || v.sps?.office?.department, meta.ministry || v.sps?.office?.ministry].filter(Boolean).join(", ");
  const { sec, titles } = sections();
  const main: Block[] = [];
  if (content !== "architecture") main.push(...tobeReport(v, sec));
  if (content !== "tobe" && plan) main.push(...architectureSection(plan.components, sec, content === "both"));
  if (content !== "architecture") main.push(...references(v, sec));
  const body: Block[] = [...cover(v, content, owner), ...(titles.length > 2 ? contents(titles) : []), ...main];

  const doc = new Document({
    creator: "DXA Platform",
    title: `${v.project_name} — ${TITLES[content]}`,
    description: `SPS ${TITLES[content]}, version ${v.version}`,
    styles: {
      default: { document: { run: { font: FONT, size: 21 }, paragraph: { spacing: { line: 276, lineRule: LineRuleType.AUTO } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 30, bold: true, color: NAVY }, paragraph: { spacing: { before: 360, after: 140 }, keepNext: true } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 24, bold: true, color: TEAL }, paragraph: { spacing: { before: 240, after: 100 }, keepNext: true } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },   // 2 cm
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${v.project_name} · ${TITLES[content]} · v${v.version}`, color: MUTED, size: 16 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], color: MUTED, size: 16 })] })] }) },
      children: body,
    }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

// ── Building blocks ──

/** "Label: what the step does [1]" → "what the step does" */
const detail = (action: unknown) => {
  const text = String(action ?? "").trim();
  const i = text.indexOf(":");
  return clean(i > 0 && i <= 40 ? text.slice(i + 1).trim() : text);
};

const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) =>
  new Paragraph({ heading: level, children: [new TextRun({ text })] });
const para = (text: string, opts: { color?: string; size?: number; italics?: boolean; after?: number } = {}) =>
  new Paragraph({ spacing: { after: opts.after ?? 120 }, children: [new TextRun({ text, color: opts.color, size: opts.size, italics: opts.italics })] });
const labelled = (label: string, text: string) =>
  new Paragraph({ spacing: { after: 60 }, indent: { left: 240 }, children: [new TextRun({ text: `${label}: `, bold: true, color: NAVY }), new TextRun(text)] });
const bullet = (text: string) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun(text)] });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });
const note = (text: string) => para(text, { color: MUTED, size: 18, italics: true });

const LINE = { style: BorderStyle.SINGLE, size: 4, color: "D5DEE7" };

/** A table with a shaded header row, zebra rows and widths in percent of the page */
function table(allColumns: Array<{ title: string; width: number }>, allRows: Array<Array<string | { text: string; bold?: boolean; color?: string }>>): Table {
  // a column with nothing in any row (e.g. no law found for any step) is left out
  const text = (v: string | { text: string }) => (typeof v === "string" ? v : v.text).trim();
  const keep = allColumns.map((_, i) => i === 0 || allRows.some((r) => !["", "—"].includes(text(r[i] ?? ""))));
  const total = allColumns.filter((_, i) => keep[i]).reduce((n, c) => n + c.width, 0);
  const columns = allColumns.filter((_, i) => keep[i]).map((c) => ({ ...c, width: c.width * 100 / total }));
  const rows = allRows.map((r) => r.filter((_, i) => keep[i]));
  const cell = (value: string | { text: string; bold?: boolean; color?: string }, col: number, fill?: string, header = false) => {
    const c = typeof value === "string" ? { text: value } : value;
    return new TableCell({
      width: { size: columns[col].width, type: WidthType.PERCENTAGE },
      shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
      margins: { top: 50, bottom: 50, left: 90, right: 90 },
      children: String(c.text || "—").split("\n").map((line, li) => new Paragraph({ children: [new TextRun({ text: line, bold: header || c.bold || (li === 0 && String(c.text).includes("\n")), color: header ? NAVY : c.color, size: 18 })] })),
    });
  };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: columns.map((c) => Math.round(9638 * c.width / 100)),
    borders: { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: columns.map((c, i) => cell(c.title, i, HEAD_FILL, true)) }),
      ...rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((v, i) => cell(v, i, ri % 2 ? ZEBRA : undefined)) })),
    ],
  });
}
/** A two-column label / value table without a header (cover, profile) */
function keyValues(rows: string[][]): Table {
  const cell = (text: string, label: boolean) => new TableCell({
    width: { size: label ? 30 : 70, type: WidthType.PERCENTAGE },
    shading: label ? { type: ShadingType.CLEAR, color: "auto", fill: HEAD_FILL } : undefined,
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: label, color: label ? NAVY : undefined, size: 19 })] })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [2891, 6747],
    borders: { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE },
    rows: rows.map(([k, val]) => new TableRow({ cantSplit: true, children: [cell(k, true), cell(val, false)] })),
  });
}

// ── Cover ──

function cover(v: Version, content: DocContent, owner: string): Block[] {
  return [
    new Paragraph({ spacing: { before: 2400, after: 120 }, children: [new TextRun({ text: "SERVICE PROCESS SIMPLIFICATION (SPS)", color: TEAL, bold: true, size: 22 })] }),
    new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: v.project_name, color: NAVY, bold: true, size: 52 })] }),
    new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: TITLES[content], color: MUTED, size: 30 })] }),
    new Paragraph({ spacing: { after: 1600 }, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: TEAL, space: 1 } }, children: [] }),
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "Document control", bold: true, color: NAVY, size: 20 })] }),
    keyValues([
      ...(owner ? [["Office", owner]] : []),
      ["Country", v.country || "Bangladesh"],
      ["Version", `v${v.version}`],
      ["Status", "Approved"],
      ["Date of approval", v.approved_at ? day(v.approved_at) : "—"],
      ["Method", "Service Process Simplification — Service Simplification Guideline 2026, Cabinet Division"],
      ["Prepared with", "DXA Platform"],
    ]),
    pageBreak(),
  ];
}

// ── The report ──

function tobeReport(v: Version, sec: Sec): Block[] {
  const out: Block[] = [];
  const sps = v.sps ?? {};
  const t = v.tcvq;
  const asis = v.asis_steps, tobe = v.tobe_steps;

  // 1. Summary
  out.push(sec("Executive summary"));
  const removed = (sps.mapping ?? []).filter((m) => m.disposition === "removed").length;
  const merged = (sps.mapping ?? []).filter((m) => m.disposition === "merged").length;
  const digital = tobe.filter((s) => s.channel === "digital" || s.channel === "hybrid").length;
  const sentences = [
    `This report sets out the simplified (TO-BE) process for “${v.project_name}”, designed from the approved current (AS-IS) process under the SPS method of the Cabinet Division.`,
    `The AS-IS has ${asis.length} step${asis.length === 1 ? "" : "s"}; the TO-BE has ${tobe.length}${asis.length > tobe.length ? ` — ${asis.length - tobe.length} fewer` : ""}.` +
      (merged || removed ? ` ${merged ? `${merged} AS-IS step${merged === 1 ? " was" : "s were"} merged` : ""}${merged && removed ? " and " : ""}${removed ? `${removed} removed` : ""}.` : ""),
    digital ? `${digital} of the ${tobe.length} TO-BE steps run digitally or with a digital channel.` : "",
    t?.tobe && t.diff ? [
      t.diff.time_days ? `Time to get the service falls from ${days(t.asis.time_days)} to ${days(t.tobe.time_days)}.` : "",
      t.diff.visits ? `Office visits fall from ${t.asis.visits} to ${t.tobe.visits}.` : "",
      t.diff.citizen_cost ? `The citizen's cost per application falls from ${taka(t.asis.citizen_cost)} to ${taka(t.tobe.citizen_cost)}.` : "",
    ].join(" ") : "",
  ].filter(Boolean);
  out.push(para(sentences.join(" ")));

  if (t?.tobe) {
    out.push(heading("Time, cost and visits (TCVQ)", HeadingLevel.HEADING_2));
    const change = (a: number | null, b: number | null, fmt: (n: number) => string = String) =>
      a == null || b == null ? "—" : a === b ? "No change" : `${a > b ? "−" : "+"}${fmt(Math.abs(a - b))}${a > 0 ? ` (${Math.round(Math.abs(a - b) / a * 100)}%)` : ""}`;
    const rows: Array<[string, number | null, number | null, (n: number) => string]> = [
      ["Time (working days)", t.asis.time_days, t.tobe.time_days, (n) => String(Math.round(n * 10) / 10)],
      ["Office visits by the citizen", t.asis.visits, t.tobe.visits, String],
      ["Citizen cost per application", t.asis.citizen_cost, t.tobe.citizen_cost, taka],
      ["Fees", t.asis.fees, t.tobe.fees, taka],
      ["Documents the citizen submits", t.asis.documents, t.tobe.documents, String],
      ["Process steps", t.asis.steps, t.tobe.steps, String],
      ["Officers / staff involved", t.asis.staff, t.tobe.staff, String],
      ["Decision points", t.asis.decisions, t.tobe.decisions, String],
      ...(t.asis.office_cost != null || t.tobe.office_cost != null ? [["Office cost per application", t.asis.office_cost, t.tobe.office_cost, taka] as [string, number | null, number | null, (n: number) => string]] : []),
    ];
    out.push(table(
      [{ title: "Indicator", width: 40 }, { title: "AS-IS", width: 18 }, { title: "TO-BE", width: 18 }, { title: "Change", width: 24 }],
      rows.map(([label, a, b, fmt]) => [label, a == null ? "—" : fmt(a), b == null ? "—" : fmt(b), { text: change(a, b, fmt), bold: a != null && b != null && b < a, color: a != null && b != null && b < a ? "15803D" : undefined }]),
    ));
    out.push(note(`Citizen cost = visits × ${taka(t.per_visit)} (fare, food and lost wage per visit) + fees + unexpected cost.`));
    if (t.annual) out.push(para(`With about ${t.annual.users.toLocaleString("en-IN")} applications a year, the TO-BE saves citizens about ${t.annual.days.toLocaleString("en-IN")} working days, ${t.annual.visits.toLocaleString("en-IN")} office visits and ${taka(t.annual.taka)} a year.`));
  }

  // 2. Service profile
  const profile = Object.entries(sps.profile ?? {}).filter(([, p]) => String(p?.value ?? "").trim());
  if (profile.length) {
    out.push(sec("Current service profile"));
    out.push(para("How the service is delivered today, as found in the documents and the review."));
    out.push(keyValues(SPS_PROFILE.filter((p) => sps.profile?.[p.key]?.value).map((p) => [p.en, String(sps.profile![p.key].value)])));
  }

  // 3. AS-IS
  out.push(sec("Current process (AS-IS)", true));
  out.push(para(`The current process as approved, with what goes wrong at each step, how far it is digital and the rule behind it.`));
  out.push(table(
    [{ title: "#", width: 5 }, { title: "Step", width: 24 }, { title: "Actor", width: 14 }, { title: "Time", width: 9 }, { title: "Pain point", width: 20 }, { title: "Digital", width: 12 }, { title: "Law / rule", width: 16 }],
    asis.map((s) => [
      String(s.step_number), `${clean(s.step_name)}${clean(s.action) ? `\n${detail(s.action)}` : ""}`, clean(s.actor),
      [s.time_days != null && s.time_days !== "" ? `${s.time_days}d` : "", s.visit ? "visit" : "", Number(s.fee) > 0 ? taka(Number(s.fee)) : ""].filter(Boolean).join(", ") || "—",
      clean(s.pain_points) || "—", DIGITAL[String(s.digital_status ?? "")] ?? "—", clean(s.legal_basis) || "—",
    ]),
  ));

  // 4. Problems and proposals (ছক-৫)
  const problems = (sps.problems ?? []).filter((p) => clean(p.problem) || clean(p.proposal));
  if (problems.length) {
    out.push(sec("Problems and proposals"));
    out.push(para("The guideline's aspects of the service where the AS-IS falls short, and what the TO-BE does about each."));
    const label = new Map(SPS_ASPECTS.map((a) => [a.key, a.en]));
    out.push(table(
      [{ title: "Aspect", width: 18 }, { title: "Problem today", width: 27 }, { title: "Proposal", width: 30 }, { title: "Why", width: 25 }],
      problems.map((p) => [{ text: label.get(p.aspect) ?? p.aspect, bold: true }, clean(p.problem), clean(p.proposal), clean(p.rationale)]),
    ));
  }

  // 5. TO-BE
  out.push(sec("Simplified process (TO-BE)", true));
  out.push(para(`The ${tobe.length} steps of the simplified process at a glance, followed by each step in detail.`));
  out.push(table(
    [{ title: "#", width: 5 }, { title: "Step", width: 30 }, { title: "Actor", width: 18 }, { title: "Channel", width: 12 }, { title: "Time", width: 10 }, { title: "From AS-IS", width: 11 }, { title: "Type", width: 14 }],
    tobe.map((s) => [
      String(s.step_number), clean(s.step_name), clean(s.actor), CHANNEL[String(s.channel ?? "")] ?? clean(s.channel),
      s.time_days != null && s.time_days !== "" ? `${s.time_days}d` : "—",
      Array.isArray(s.merged_from) && s.merged_from.length ? (s.merged_from as number[]).join(", ") : "New",
      String(s.step_type ?? "activity").replace(/^./, (c) => c.toUpperCase()),
    ]),
  ));
  out.push(heading("Step by step", HeadingLevel.HEADING_2));
  for (const s of tobe) out.push(...tobeStep(s));

  // 6. Mapping (ছক-৬)
  const mapping = sps.mapping ?? [];
  if (mapping.length) {
    out.push(sec("What happened to each AS-IS step", true));
    out.push(para("Every AS-IS step is kept, merged into a TO-BE step or removed — with the reason."));
    const name = (list: Step[], num: number | null) => { const st = list.find((x) => Number(x.step_number) === num); return st ? `${num}. ${clean(st.step_name)}` : num == null ? "—" : String(num); };
    out.push(table(
      [{ title: "AS-IS step", width: 30 }, { title: "Result", width: 12 }, { title: "TO-BE step", width: 25 }, { title: "Reason", width: 33 }],
      mapping.map((m) => [name(asis, m.asis), { text: DISPOSITION[m.disposition] ?? m.disposition, bold: true, color: m.disposition === "removed" ? "B45309" : undefined }, m.disposition === "removed" ? "—" : name(tobe, m.tobe), clean(m.reason)]),
    ));
  }

  // 7. Documents (ছক-৩)
  const docs = sps.documents ?? [];
  if (docs.length) {
    out.push(sec("Documents the citizen submits"));
    out.push(para("The papers the citizen gives today, and what happens to each in the TO-BE."));
    out.push(table(
      [{ title: "Document", width: 34 }, { title: "Where it comes from", width: 30 }, { title: "In the TO-BE", width: 36 }],
      docs.map((d) => [d.name, DOC_SOURCE[d.source] ?? d.source, { text: DOC_TOBE[d.tobe ?? "submit"], bold: (d.tobe ?? "submit") !== "submit", color: (d.tobe ?? "submit") !== "submit" ? "15803D" : undefined }]),
    ));
  }

  // 8. Legal basis
  const laws = new Map<string, number[]>();
  for (const s of tobe) {
    const law = clean(s.legal_basis);
    if (law) laws.set(law, [...(laws.get(law) ?? []), Number(s.step_number)]);
  }
  if (laws.size) {
    out.push(sec("Legal basis"));
    out.push(para("The rules the TO-BE steps rest on. A step that a rule requires is kept — made digital and faster, not removed."));
    for (const [law, steps] of laws) out.push(bullet(`${law} — step${steps.length > 1 ? "s" : ""} ${steps.join(", ")}`));
  }

  // 9. Implementation
  const impl = tobe.filter((s) => s.implementation && typeof s.implementation === "object");
  if (impl.length) {
    out.push(sec("Implementation", true));
    out.push(para("What must be in place before each TO-BE step can run, who owns it, and the fallback when the system is not available."));
    out.push(table(
      [{ title: "Step", width: 17 }, { title: "What must be in place", width: 36 }, { title: "Owner", width: 17 }, { title: "Effort", width: 12 }, { title: "Fallback", width: 18 }],
      impl.map((s) => {
        const im = s.implementation as Record<string, unknown>;
        return [`${s.step_number}. ${clean(s.step_name)}`, clean(im.prerequisites), clean(im.owner), clean(im.effort).replace(/^./, (c) => c.toUpperCase()), clean(im.fallback)];
      }),
    ));
  }
  return out;
}

function tobeStep(s: Step): Block[] {
  const out: Block[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: `Step ${s.step_number} · ${clean(s.step_name)}`, size: 22 })] }),
  ];
  const facts = [
    clean(s.actor) && `Actor: ${clean(s.actor)}`,
    s.channel && `Channel: ${CHANNEL[String(s.channel)] ?? s.channel}`,
    s.time_days != null && s.time_days !== "" && `Time: ${s.time_days} working day${Number(s.time_days) === 1 ? "" : "s"}`,
    s.visit ? "Office visit needed" : "",
    Number(s.fee) > 0 && `Fee: ${taka(Number(s.fee))}`,
  ].filter(Boolean).join("  ·  ");
  if (facts) out.push(para(facts, { color: MUTED, size: 18, after: 60 }));
  const what = cited(detail(s.action));
  if (what) out.push(para(what, { after: 80 }));
  if (cited(s.digital_how)) out.push(labelled("How it is digitalized", cited(s.digital_how)));
  if (cited(s.if_rejected)) out.push(labelled(`If rejected${s.no_goto ? ` (back to step ${s.no_goto})` : ""}`, cited(s.if_rejected)));
  if (cited(s.simplification_rationale)) out.push(labelled("Why it is simpler", cited(s.simplification_rationale)));
  if (cited(s.legal_basis)) out.push(labelled("Legal basis", cited(s.legal_basis)));
  if (cited(s.best_practice)) out.push(labelled("Good practice elsewhere", cited(s.best_practice)));
  const checks = Array.isArray(s.checks) ? (s.checks as Array<Record<string, unknown> | string>).map((c) => clean(typeof c === "string" ? c : c.issue ?? c.text ?? c.note)).filter(Boolean) : [];
  if (checks.length) out.push(labelled("To check before rollout", checks.join("; ")));
  return out;
}

/** The sources the TO-BE cites ([1], [2]… are numbered across all its steps) */
function references(v: Version, sec: Sec): Block[] {
  const refs = new Map<number, { title: string; url: string; kind: string }>();
  for (const s of v.tobe_steps) for (const src of (s.sources as Array<{ n: number; title: string; url: string; kind: string }> | undefined) ?? []) if (!refs.has(src.n)) refs.set(src.n, src);
  if (!refs.size) return [];
  return [
    sec("References", true),
    para("The documents and web pages the TO-BE cites; the numbers match the [n] markers in the text."),
    ...[...refs.entries()].sort((a, b) => a[0] - b[0]).map(([n, r]) => new Paragraph({ spacing: { after: 60 }, children: [
      new TextRun({ text: `[${n}] `, bold: true, color: NAVY }),
      new TextRun(r.title),
      ...(r.kind === "web" && /^https?:/.test(r.url) ? [new TextRun({ text: ` — ${r.url}`, color: MUTED, size: 18 })] : r.kind === "doc" ? [new TextRun({ text: " (uploaded document)", color: MUTED, size: 18 })] : []),
    ] })),
  ];
}

const STATUS: Record<DigitalComponent["status"], { label: string; fill: string; line: string; text: string }> = {
  existing: { label: "Already have", fill: "#E7F4EC", line: "#15803D", text: "#14532D" },
  upgrade: { label: "Needs upgrade", fill: "#FBEFE3", line: "#B45309", text: "#7C2D12" },
  new: { label: "New to build", fill: "#E6EEFB", line: "#1D4ED8", text: "#1E3A8A" },
};

function architectureSection(items: DigitalComponent[], sec: Sec, newPage: boolean): Array<Paragraph | Table> {
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
    sec("TO-BE architecture", newPage),
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
