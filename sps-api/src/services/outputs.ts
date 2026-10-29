import { db } from "../db/index";
import { compareTcvq, runChecks, DEFAULT_SETTINGS, type SpsData } from "./sps-calc";
import { SPS_ASPECTS, SPS_PROFILE, SPS_PRIORITY, SPS_FEEDBACK, feedbackClass } from "./sps-guide";

// ── Outputs: approved TO-BE versions and their Excel exports ───────────────────
//
// Approving a TO-BE saves a version: a snapshot of the approved AS-IS and the TO-BE
// designed from it. The Outputs tab lists them; each can be downloaded as Excel
// (here, via openpyxl) and as BPMN (drawn in the browser).

export interface Version {
  id: number;
  version: number;
  project_name: string;
  country: string;
  approved_at: number;
  asis_steps: Array<Record<string, unknown>>;
  tobe_steps: Array<Record<string, unknown>>;
  sps: SpsData;
  /** TCV analysis (ছক-৭) of this version's AS-IS vs TO-BE — computed, never stored */
  tcvq?: ReturnType<typeof compareTcvq>;
  /** the digital infrastructure of its approved TO-BE: have / upgrade / build, with cost heads (drafted on request) */
  digital_plan: unknown | null;
}

interface VersionRow { id: number; version: number; project_name: string; country: string; approved_at: number; asis_steps: string; tobe_steps: string; sps: string | null; status: string | null; digital_plan: string | null }

// Outputs shows approved work only: versions whose AS-IS is approved, and a version's TO-BE
// only once that is approved too (drafts are on the AS-IS / TO-BE pages)
const APPROVED = "status IN ('asis_approved', 'tobe_complete', 'tobe_approved')";

const parse = (r: VersionRow): Version => {
  const tobeApproved = r.status === "tobe_approved";
  const v: Version = { ...r, asis_steps: JSON.parse(r.asis_steps), tobe_steps: tobeApproved ? JSON.parse(r.tobe_steps) : [], sps: r.sps ? JSON.parse(r.sps) : {},
    digital_plan: tobeApproved && r.digital_plan ? JSON.parse(r.digital_plan) : null };
  // only an approved TO-BE has something to compare
  return v.tobe_steps.length ? { ...v, tcvq: compareTcvq(v.asis_steps, v.tobe_steps, v.sps) } : v;
};

export function listVersions(projectId: string): Version[] {
  return (db.query(`SELECT * FROM tobe_versions WHERE project_id = ? AND ${APPROVED} ORDER BY version DESC`).all(projectId) as VersionRow[]).map(parse);
}

export function getVersion(projectId: string, id: number): Version | null {
  const r = db.query(`SELECT * FROM tobe_versions WHERE project_id = ? AND id = ? AND ${APPROVED}`).get(projectId, id) as VersionRow | null;
  return r ? parse(r) : null;
}

// ── Excel ─────────────────────────────────────────────────────────────────────

const DIGITAL: Record<string, string> = { manual: "Manual", partly: "Partly digital", online: "Fully online" };
const text = (v: unknown) => String(v ?? "").trim();

interface Sheet { name: string; columns: Array<{ title: string; width: number }>; rows: unknown[][] }

/** Rows for one process; citation markers [n] are kept and listed on a References sheet */
function processSheets(kind: "asis" | "tobe", v: Version, origin: string): Sheet[] {
  const steps = kind === "asis" ? v.asis_steps : v.tobe_steps;
  const sheet: Sheet = kind === "asis"
    ? {
        name: "AS-IS process",
        columns: [
          { title: "Step", width: 6 }, { title: "Step name", width: 24 }, { title: "Actor", width: 24 }, { title: "Action", width: 50 },
          { title: "Input", width: 22 }, { title: "Time (days)", width: 10 }, { title: "Pain point", width: 34 },
          { title: "Digital status", width: 16 }, { title: "System / portal", width: 26 }, { title: "Law / regulation", width: 34 },
          { title: "Type", width: 11 }, { title: "Visit", width: 7 }, { title: "Fee (৳)", width: 9 },
        ],
        rows: steps.map((s) => [
          s.step_number, text(s.step_name), text(s.actor), text(s.action), text(s.input), s.time_days ?? "",
          text(s.pain_points), DIGITAL[text(s.digital_status)] ?? text(s.digital_status), text(s.digital_note), text(s.legal_basis),
          text(s.step_type) || "activity", s.visit ? "Yes" : "", s.fee ?? "",
        ]),
      }
    : {
        name: "TO-BE process",
        columns: [
          { title: "Step", width: 6 }, { title: "Step name", width: 24 }, { title: "Actor", width: 24 }, { title: "Action", width: 50 },
          { title: "Channel", width: 12 }, { title: "Time (days)", width: 10 }, { title: "Merged from AS-IS steps", width: 16 },
          { title: "Simplification rationale", width: 40 }, { title: "Legal basis", width: 30 },
          { title: "How it is digitalized", width: 45 }, { title: "If rejected / returned", width: 45 },
          { title: "World best practice", width: 45 }, { title: "Prerequisites", width: 40 }, { title: "Allowed under (current law)", width: 30 }, { title: "Owner", width: 22 },
          { title: "Effort", width: 12 }, { title: "Fallback", width: 30 }, { title: "Open checks", width: 40 },
          { title: "Type", width: 11 }, { title: "Visit", width: 7 }, { title: "Fee (৳)", width: 9 },
        ],
        rows: steps.map((s) => [
          s.step_number, text(s.step_name), text(s.actor), text(s.action), text(s.channel), s.time_days ?? "",
          Array.isArray(s.merged_from) ? (s.merged_from as unknown[]).join(", ") : text(s.merged_from),
          text(s.simplification_rationale), text(s.legal_basis),
          text(s.digital_how), text(s.if_rejected),
          ...(() => {
            const im = (s.implementation ?? {}) as Record<string, unknown>;
            const effort: Record<string, string> = { quick: "Quick win (< 3 months)", medium: "3-12 months", long: "Over a year" };
            const checks = (Array.isArray(s.checks) ? s.checks : []) as Array<{ severity?: string; issue?: string }>;
            return [text(s.best_practice), text(im.prerequisites), text(im.legal_fit ?? im.law_change), text(im.owner), effort[text(im.effort)] ?? text(im.effort), text(im.fallback),
              checks.map((c) => `${c.severity === "high" ? "⚠ " : ""}${text(c.issue)}`).join("\n")];
          })(),
          text(s.step_type) || "activity", s.visit ? "Yes" : "", s.fee ?? "",
        ]),
      };
  const refs = new Map<number, { title: string; url: string }>();
  for (const s of steps) for (const r of (s.sources ?? []) as Array<{ n: number; title: string; url: string }>) refs.set(r.n, r);
  const references: Sheet = {
    name: "References",
    columns: [{ title: "#", width: 6 }, { title: "Source", width: 50 }, { title: "Link", width: 70 }],
    rows: [...refs.entries()].sort((a, b) => a[0] - b[0]).map(([n, r]) => [n, r.title, r.url.startsWith("/") ? origin + r.url : r.url]),
  };
  return refs.size ? [sheet, references] : [sheet];
}

const stripRefs = (t: unknown) => String(t ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim();
const MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const taka = (n: number | null | undefined) => (n == null ? "" : `৳${Math.round(n).toLocaleString("en-IN")}`);

/** The whole SPS proposal in the guideline's worksheet format, one sheet each */
function reportSheets(v: Version, origin: string): Sheet[] {
  const sps = v.sps ?? {};
  const asis = v.asis_steps;
  const tobe = v.tobe_steps;
  const sheets: Sheet[] = [];
  const two = (t: string, w = 40) => [{ title: t, width: 34 }, { title: "", width: w }];

  // ম্যাট্রিক্স ১–৩
  const office = sps.office ?? {};
  const pr = sps.priority ?? {};
  const fb = sps.feedback;
  sheets.push({
    name: "Matrix 1-3",
    columns: [{ title: "Item / বিষয়", width: 46 }, { title: "Value / বিস্তারিত", width: 50 }],
    rows: [
      ["Matrix-1 · Office profile / দপ্তর প্রোফাইল", ""],
      ["Ministry / Division · মন্ত্রণালয়/বিভাগ", office.ministry ?? ""],
      ["Department / Agency · অধিদপ্তর/সংস্থা", office.department ?? ""],
      ["Office · দপ্তর", office.office ?? ""],
      ["Citizen services · নাগরিক সেবার তালিকা", office.services ?? v.project_name],
      ["", ""],
      ["Matrix-2 · Service priority / সেবার অগ্রাধিকার", ""],
      ...SPS_PRIORITY.map((c) => [`${c.en} · ${c.bn}`, pr[c.key] != null ? `${pr[c.key]} (${c.scale.find(([n]) => n === pr[c.key])?.[1] ?? ""})` : ""]),
      ["Total · মোট নম্বর", Object.keys(pr).length ? String(Object.values(pr).reduce((a, b) => a + Number(b), 0)) : ""],
      ["", ""],
      ["Matrix-3 · Citizen feedback / সেবাগ্রহীতার মতামত", fb ? `${fb.respondents} respondents` : "Not collected"],
      ...(fb ? SPS_FEEDBACK.map((q) => [`${q.en} · ${q.bn}`, `${fb.averages[q.key] ?? ""} / 5`]) : []),
      ...(fb ? [["Total (14–70) · মোট", `${fb.total} — ${feedbackClass(fb.total).en} · ${feedbackClass(fb.total).bn}`]] : []),
    ],
  });

  // ছক-১
  sheets.push({
    name: "Sheet-1 Profile",
    columns: [{ title: "Item / মূল্যায়ন যোগ্যতা", width: 50 }, { title: "Value / বিবরণ", width: 30 }, { title: "Source", width: 14 }],
    rows: SPS_PROFILE.map((p) => [`${p.en} · ${p.bn}`, sps.profile?.[p.key]?.value ?? "", sps.profile?.[p.key]?.source ?? ""]),
  });

  // ছক-২
  sheets.push({
    name: "Sheet-2 Steps",
    columns: [{ title: "Step / ধাপ", width: 8 }, { title: "Activity / সেবা সংশ্লিষ্ট কার্যাবলি", width: 60 }, { title: "Performer (P) / সম্পৃক্ত কর্মকর্তা", width: 30 }, { title: "Time (T) / ব্যয়িত সময় (days)", width: 14 }, { title: "Visit", width: 8 }, { title: "Fee (৳)", width: 10 }],
    rows: asis.map((s) => [s.step_number, stripRefs(s.action), text(s.actor), s.time_days ?? "", s.visit ? "Yes" : "", s.fee ?? ""]),
  });

  // ছক-৩
  const docs = sps.documents ?? [];
  sheets.push({
    name: "Sheet-3 Documents",
    columns: [{ title: "Document / কাগজপত্র", width: 34 }, { title: "Citizen submits: has it / from another office", width: 26 }, { title: "Office checks: own / another office", width: 26 }, { title: "TO-BE", width: 22 }],
    rows: docs.map((d) => [d.name, d.source === "other_office" ? "From another office · অন্য দপ্তর থেকে" : "Has it · নিজের কাছে বিদ্যমান", d.verify === "other_office" ? "Verify with another office" : d.verify === "own" ? "Own records" : "—",
      d.tobe === "auto" ? "Fetched / verified automatically" : d.tobe === "removed" ? "Not needed · প্রয়োজন নাই" : "Still submitted"]),
  });

  // ছক-৫
  sheets.push({
    name: "Sheet-5 Problems",
    columns: [{ title: "Aspect / সেবার ধাপ/বিষয়", width: 32 }, { title: "Problem / সমস্যার বর্ণনা", width: 36 }, { title: "Citizen demand / নাগরিক চাহিদা", width: 30 }, { title: "Proposal / প্রস্তাবনা", width: 40 }, { title: "Rationale / যৌক্তিকতা", width: 30 }],
    rows: (sps.problems ?? []).map((p) => {
      const a = SPS_ASPECTS.find((x) => x.key === p.aspect);
      return [a ? `${a.en} · ${a.bn}` : p.aspect, p.problem, p.demand, p.proposal, p.rationale];
    }),
  });

  // ছক-৬
  const mapping = sps.mapping ?? [];
  sheets.push({
    name: "Sheet-6 Comparison",
    columns: [{ title: "AS-IS step", width: 8 }, { title: "AS-IS description / বিদ্যমান পদ্ধতি", width: 50 }, { title: "TO-BE step", width: 8 }, { title: "TO-BE description / প্রস্তাবিত পদ্ধতি", width: 50 }, { title: "Change", width: 12 }, { title: "Reason", width: 34 }],
    rows: asis.map((s) => {
      const m = mapping.find((x) => x.asis === Number(s.step_number));
      const t = m?.tobe ? tobe.find((x) => Number(x.step_number) === m.tobe) : undefined;
      return [s.step_number, stripRefs(s.action), m?.tobe ?? "", t ? stripRefs(t.action) : m?.disposition === "removed" ? "প্রয়োজন নাই (not needed)" : "", m?.disposition ?? "", m?.reason ?? ""];
    }),
  });

  // ছক-৭
  const c = compareTcvq(asis, tobe, sps);
  const s0 = { ...DEFAULT_SETTINGS, ...sps.settings };
  const t = c.tobe;
  const row = (label: string, a: string | number, ac: string, b: string | number, bc: string, d: string | number) => [label, a, ac, b, bc, d];
  sheets.push({
    name: "Sheet-7 TCVQ",
    columns: [{ title: "Area / ক্ষেত্র", width: 30 }, { title: "Existing / বিদ্যমান", width: 14 }, { title: "Note", width: 34 }, { title: "Proposed / প্রস্তাবিত", width: 14 }, { title: "Note", width: 30 }, { title: "Difference / পার্থক্য", width: 14 }],
    rows: [
      ["Citizen view / নাগরিকের দৃষ্টিকোণ", "", "", "", "", ""],
      row("Time / সময় (working days)", c.asis.time_days, "Sum of T", t?.time_days ?? "", "", c.diff?.time_days ?? ""),
      row("Visits / যাতায়াত", c.asis.visits, "Steps needing an office visit", t?.visits ?? "", "", c.diff?.visits ?? ""),
      row("Citizen cost / নাগরিকের ব্যয়", taka(c.asis.citizen_cost), `Per visit ৳${c.per_visit} (fare ${s0.cost_fare} + food ${s0.cost_food} + wage ${s0.cost_wage}) × visits + fees ৳${c.asis.fees}`, taka(t?.citizen_cost), t ? `Fees ৳${t.fees}` : "", taka(c.diff?.citizen_cost)),
      row("Documents / দাখিলিয় কাগজপত্রের সংখ্যা", c.asis.documents ?? "", "Sheet-3", t?.documents ?? "", "", c.diff?.documents ?? ""),
      ["Office view / দাপ্তরিক দৃষ্টিকোণ", "", "", "", "", ""],
      row("Office cost / দাপ্তরিক ব্যয়", taka(c.asis.office_cost), "", taka(t?.office_cost), "", taka(c.diff?.office_cost)),
      row("Steps / ধাপ", c.asis.steps, "", t?.steps ?? "", "", c.diff?.steps ?? ""),
      row("Staff / জনবল", c.asis.staff, "Distinct performers", t?.staff ?? "", "", c.diff?.staff ?? ""),
      row("Decision points", c.asis.decisions, "", t?.decisions ?? "", "", ""),
      ["", "", "", "", "", ""],
      ...(c.annual ? [["Annual saving / বার্ষিক সাশ্রয়", `${c.annual.users.toLocaleString("en-IN")} users`, `${c.annual.days.toLocaleString("en-IN")} days · ${c.annual.visits.toLocaleString("en-IN")} visits · ${taka(c.annual.taka)}`, "", "", ""]] : []),
    ],
  });

  // SPS checks
  sheets.push({
    name: "SPS checks",
    columns: [{ title: "Check", width: 50 }, { title: "Result", width: 10 }, { title: "Detail", width: 70 }],
    rows: runChecks(asis, tobe, sps).map((x) => [x.label, x.status.toUpperCase(), x.detail]),
  });

  // Implementation plan
  const plan = sps.plan ?? {};
  sheets.push({
    name: "Plan",
    columns: [{ title: "Strategic plan / কৌশলগত পরিকল্পনা", width: 40 }, ...MONTHS.map((m) => ({ title: m, width: 6 }))],
    rows: [
      ["Challenges · বাস্তবায়নে চ্যালেঞ্জসমূহ", plan.challenges ?? ""],
      ["Measures · চ্যালেঞ্জ মোকাবিলায় গৃহীত ব্যবস্থা", plan.measures ?? ""],
      ["Publicity · প্রচার ও অংশীজনদের সম্পৃক্তকরণ", plan.publicity ?? ""],
      ["Monitoring · পরিবীক্ষণ", plan.monitoring ?? ""],
      ["", ""],
      ["Time-based work plan / সময়াবদ্ধ কর্মপরিকল্পনা", ...MONTHS],
      ...(plan.workplan ?? []).map((w) => [w.activity, ...MONTHS.map((m) => (w.months.includes(m) ? "■" : ""))]),
      ["", ""],
      ["Implementation team / বাস্তবায়ন টিম", sps.team ?? ""],
    ],
  });

  // references of both processes
  const refs = new Map<string, { title: string; url: string }>();
  for (const st of [...asis, ...tobe]) for (const r of (st.sources ?? []) as Array<{ title: string; url: string }>) refs.set(r.url, r);
  if (refs.size) {
    sheets.push({
      name: "References",
      columns: [{ title: "Source", width: 50 }, { title: "Link", width: 70 }],
      rows: [...refs.values()].map((r) => [r.title, r.url.startsWith("/") ? origin + r.url : r.url]),
    });
  }
  return sheets;
}

const WRITER = `
import sys, json
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
data = json.load(sys.stdin)
wb = Workbook()
wb.remove(wb.active)
thin = Side(style="thin", color="D1D5DB")
for sh in data["sheets"]:
    ws = wb.create_sheet(sh["name"][:31])
    ws.append([data["title"]])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append([data["subtitle"]])
    ws["A2"].font = Font(italic=True, color="6B7280")
    ws.append([])
    ws.append([c["title"] for c in sh["columns"]])
    for cell in ws[4]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="4F46E5")
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)
    for row in sh["rows"]:
        ws.append(row)
    for r in ws.iter_rows(min_row=5, max_row=ws.max_row):
        for cell in r:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)
    for i, c in enumerate(sh["columns"]):
        ws.column_dimensions[chr(65 + i)].width = c["width"]
    ws.freeze_panes = "A5"
wb.save(sys.stdout.buffer)
`;

export async function exportExcel(kind: "asis" | "tobe" | "report", v: Version, origin: string, draft = false): Promise<Uint8Array> {
  const label = kind === "asis" ? `AS-IS process${draft ? "" : " (approved)"}` : kind === "tobe" ? "TO-BE process" : "SPS proposal (সেবা সহজীকরণ প্রস্তাব)";
  const when = new Date(v.approved_at * 1000).toISOString().slice(0, 16).replace("T", " ");
  const payload = {
    title: `${v.project_name} — ${label}`,
    subtitle: draft ? `Current version (not a saved version) · downloaded ${when} UTC · ${v.country}` : `Version ${v.version} · approved ${when} UTC · ${v.country}`,
    sheets: kind === "report" ? reportSheets(v, origin) : processSheets(kind, v, origin),
  };
  const proc = Bun.spawn(["python3", "-P", "-c", WRITER], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const [out, err, code] = await Promise.all([new Response(proc.stdout).arrayBuffer(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`Excel export failed: ${err.slice(-300)}`);
  return new Uint8Array(out);
}

type ProjectSnap = { name: string; country: string | null; asis_steps: string; tobe_steps: string; sps: string | null };

/** The project's current AS-IS / TO-BE (what is on screen, approved or not) in the shape of a version */
export function currentAsVersion(projectId: string): Version | null {
  const p = db.query("SELECT name, country, asis_steps, tobe_steps, sps FROM projects WHERE id = ?").get(projectId) as ProjectSnap | null;
  if (!p) return null;
  return {
    id: 0, version: 0, project_name: p.name, country: p.country ?? "Bangladesh", approved_at: Math.floor(Date.now() / 1000),
    asis_steps: JSON.parse(p.asis_steps || "[]"), tobe_steps: JSON.parse(p.tobe_steps || "[]"), sps: p.sps ? JSON.parse(p.sps) : {},
  } as Version;
}
