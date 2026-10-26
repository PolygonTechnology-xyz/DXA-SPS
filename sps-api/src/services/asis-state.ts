import { db } from "../db/index";
import { finalizeCitations, type KnownSource, type StepSource } from "./sources";
import { nanoid } from "../utils/id";

// ── AS-IS state: steps, findings, consent ─────────────────────────────────────
//
// asis_steps holds only CONFIRMED information: what the documents say, what the user
// said, and web/AI information the user accepted. Anything found only on the web (or
// suggested by the AI without a source) while documents exist is a FINDING — a
// proposal kept in asis_findings until the user accepts or rejects it in the chat rail.
// TO-BE therefore never sees unconfirmed information.

export const REVIEW_FIELDS = ["pain_points", "digital_status", "legal_basis"] as const;
export type ReviewField = typeof REVIEW_FIELDS[number];
export type FieldSource = "doc" | "web" | "user" | "ai";
export const DIGITAL_VALUES = ["manual", "partly", "online"] as const;

export const FIELD_LABEL: Record<ReviewField, string> = {
  pain_points: "Pain point",
  digital_status: "Digital status",
  legal_basis: "Law / regulation",
};

export interface Step extends Record<string, unknown> {
  uid?: string;
  step_number: number;
  step_name?: string;
  action?: string;
  pain_points?: string;
  digital_status?: string;           // manual | partly | online
  digital_note?: string;             // system name + citations, e.g. "sss.bkkb.gov.bd [D1:2]"
  legal_basis?: string;
  field_sources?: Partial<Record<ReviewField, FieldSource>>;
  unknown_fields?: ReviewField[];    // the user said it is not known
  step_source?: FieldSource;         // set when a whole step came from a finding
  reviewed?: boolean;
  sources?: StepSource[];
  // the guideline's step fields
  step_type?: "activity" | "decision" | "document" | "message";
  time_days?: number;
  visit?: boolean;
  fee?: number;
  no_goto?: number;
}

export interface Finding {
  id: string;                        // F1, F2… (short, so the user and the agent can refer to them)
  kind: "field" | "step";
  step_uid?: string;                 // field: the step it belongs to
  field?: ReviewField;
  value?: string;                    // field value, with citation ids ([W1]…)
  digital_note?: string;             // digital_status findings: system name + citations
  after_uid?: string | null;         // step: insert after this step (null = at the start)
  step?: Step;                       // step: the proposed step, citation ids in its text
  sources: Array<{ id: string } & KnownSource>;
  // web: found on the web (Use / Don't use); unsourced: a value with no source the user is
  // asked to confirm (Yes / No / Skip) — the user's answer becomes its source
  origin: "web" | "ai" | "unsourced";
  status: "pending" | "accepted" | "rejected" | "dropped" | "skipped";
  created_at: number;
  decided_at?: number;
}

export interface Review {
  reviewed_at: number;
  country: string;
  questions: Array<{ step_uid: string; field: ReviewField; question: string }>;
}

// Text fields of a step that may hold citation markers
export const CITED_FIELDS = ["action", "input", "pain_points", "digital_note", "legal_basis"];

export function ensureUids(steps: Step[]): Step[] {
  return steps.map((s) => (s.uid ? s : { ...s, uid: nanoid().slice(0, 10) }));
}

export function loadAsis(projectId: string): { steps: Step[]; findings: Finding[]; review: Review | null } {
  const row = db.query("SELECT asis_steps, asis_findings, asis_review FROM projects WHERE id = ?").get(projectId) as
    { asis_steps: string | null; asis_findings: string | null; asis_review: string | null } | null;
  const parse = <T>(v: string | null, fallback: T): T => { try { return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
  return {
    steps: ensureUids(parse<Step[]>(row?.asis_steps ?? null, [])),
    // GUARDRAIL: a pending suggestion without any source (made before sources were required) is
    // dropped — except a value put to the user to confirm (their answer is the source)
    findings: parse<Finding[]>(row?.asis_findings ?? null, []).map((f) =>
      f.status === "pending" && f.origin !== "unsourced" && !(f.sources ?? []).length ? { ...f, status: "dropped" as const } : f),
    review: parse<Review | null>(row?.asis_review ?? null, null),
  };
}

export function saveAsis(projectId: string, data: { steps?: Step[]; findings?: Finding[]; review?: Review | null }): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.steps) { sets.push("asis_steps = ?"); vals.push(JSON.stringify(data.steps)); }
  if (data.findings) { sets.push("asis_findings = ?"); vals.push(JSON.stringify(data.findings)); }
  if (data.review !== undefined) { sets.push("asis_review = ?"); vals.push(data.review ? JSON.stringify(data.review) : null); }
  if (!sets.length) return;
  db.query(`UPDATE projects SET ${sets.join(", ")}, updated_at = unixepoch() WHERE id = ?`).run(...vals, projectId);
}

export function nextFindingId(findings: Finding[]): string {
  const max = findings.reduce((m, f) => Math.max(m, Number(f.id.replace(/\D/g, "")) || 0), 0);
  return `F${max + 1}`;
}

// ── Citations ─────────────────────────────────────────────────────────────────
//
// Stored steps carry numbered markers ([1], [2]) plus a sources list. To add new
// cited text (a review value, an accepted finding) the numbers are turned back into
// ids ([S1]…), merged with the new sources and renumbered across all steps.

const NUM_MARKER = /\[(\d+)\]/g;

/** "[3]" → "[S3]" in a step's cited fields; returns the matching sources by id */
export function toIdMarkers(step: Step): { step: Step; known: Map<string, KnownSource> } {
  const known = new Map<string, KnownSource>();
  for (const src of step.sources ?? []) known.set(`S${src.n}`, { title: src.title, url: src.url, kind: src.kind, ...(src.quotes?.length ? { quotes: src.quotes } : {}) });
  const next: Step = { ...step };
  for (const f of CITED_FIELDS) {
    const v = next[f];
    if (typeof v === "string") next[f] = v.replace(NUM_MARKER, (_m, n: string) => `[S${n}]`);
  }
  return { step: next, known };
}

/** Renumbers citations across all steps (1, 2… in order of first use) and step numbers */
export function renumber(steps: Step[], extraKnown?: Map<string, KnownSource>): Step[] {
  const known = new Map<string, KnownSource>(extraKnown);
  const withIds = steps.map((s) => {
    const r = toIdMarkers(s);
    for (const [k, v] of r.known) known.set(k, v);
    return r.step;
  });
  // the same source may sit under different S-numbers only if it was numbered differently — S ids are global, so fine
  const { items } = finalizeCitations(withIds, CITED_FIELDS, known);
  return items.map((s, i) => ({ ...s, step_number: i + 1 }));
}

/** Source kinds a text cites, looked up by id ([D1:4] → doc, [W1] → web) */
export function citedKinds(text: string, known: Map<string, KnownSource>): Set<string> {
  const kinds = new Set<string>();
  const re = /\[\s*([A-Za-z]\d+(?::\d+(?:-\d+)?)?(?:\s*,\s*[A-Za-z]\d+(?::\d+(?:-\d+)?)?)*)\s*\]/g;
  for (const m of text.matchAll(re)) {
    for (const raw of m[1].split(",")) {
      let id = raw.trim().toUpperCase().replace(/-\d+$/, "");
      if (!known.has(id)) id = id.split(":")[0];
      const src = known.get(id);
      if (src) kinds.add(src.kind);
    }
  }
  return kinds;
}

/**
 * Gives a finding's citations their own ids (X<n>), so they stay valid however the
 * steps are renumbered before the user decides. Returns the rewritten texts + sources.
 */
export function freezeCitations(texts: string[], known: Map<string, KnownSource>, findingNo: number): { texts: string[]; sources: Array<{ id: string } & KnownSource> } {
  const ids = new Map<string, string>();
  const sources: Array<{ id: string } & KnownSource> = [];
  const re = /\[\s*([^\]]+?)\s*\]/g;
  const out = texts.map((t) => t.replace(re, (whole, inner: string) => {
    const parts = inner.split(",").map((raw) => {
      let id = raw.trim().toUpperCase().replace(/-\d+$/, "");
      if (!known.has(id)) id = id.split(":")[0];
      const src = known.get(id);
      if (!src) return null;
      if (!ids.has(id)) {
        const x = `X${findingNo * 1000 + ids.size + 1}`;
        ids.set(id, x);
        sources.push({ id: x, ...src });
      }
      return ids.get(id)!;
    }).filter(Boolean);
    return parts.length ? `[${parts.join(", ")}]` : (/^\s*[A-Za-z]?\d/.test(inner) ? "" : whole);
  }).replace(/\s{2,}/g, " ").trim());
  return { texts: out, sources };
}

// ── Coverage (for the readiness panel, the approval gate and the chat) ──────────

export interface Coverage {
  steps: number;
  fields: Record<ReviewField, { confirmed: number; pending: number; unknown: number; missing: number }>;
  pending: number;                  // pending findings (fields + steps)
  pendingSteps: number;
  missing: number;
}

export function coverage(steps: Step[], findings: Finding[]): Coverage {
  const pendingField = new Set(findings.filter((f) => f.status === "pending" && f.kind === "field").map((f) => `${f.step_uid}:${f.field}`));
  const fields = Object.fromEntries(REVIEW_FIELDS.map((f) => [f, { confirmed: 0, pending: 0, unknown: 0, missing: 0 }])) as Coverage["fields"];
  for (const s of steps) {
    for (const f of REVIEW_FIELDS) {
      const c = fields[f];
      if (String(s[f] ?? "").trim() && s[f] !== "—") c.confirmed++;
      else if (pendingField.has(`${s.uid}:${f}`)) c.pending++;
      else if (s.unknown_fields?.includes(f)) c.unknown++;
      else c.missing++;
    }
  }
  const pending = findings.filter((f) => f.status === "pending").length;
  return {
    steps: steps.length,
    fields,
    pending,
    pendingSteps: findings.filter((f) => f.status === "pending" && f.kind === "step").length,
    missing: REVIEW_FIELDS.reduce((n, f) => n + fields[f].missing, 0),
  };
}

// ── Consent decisions ─────────────────────────────────────────────────────────

export interface Decision { id: string; decision: "accept" | "reject" | "skip"; value?: string }

/** Pending findings whose step no longer exists (dropped by the user) are closed */
export function syncFindings(steps: Step[], findings: Finding[]): Finding[] {
  const uids = new Set(steps.map((s) => s.uid));
  return findings.map((f) => (f.status === "pending" && f.kind === "field" && f.step_uid && !uids.has(f.step_uid)
    ? { ...f, status: "dropped" as const, decided_at: Math.floor(Date.now() / 1000) }
    : f));
}

export function describeFinding(f: Finding, steps: Step[]): string {
  if (f.kind === "step") {
    const after = steps.find((s) => s.uid === f.after_uid);
    return `New step${after ? ` after step ${after.step_number}` : " at the start"}: ${f.step?.step_name ?? ""}`;
  }
  const step = steps.find((s) => s.uid === f.step_uid);
  return `Step ${step?.step_number ?? "?"} · ${FIELD_LABEL[f.field!]}`;
}

/** Applies the user's decisions; returns the new steps/findings and a summary line per decision */
export function applyDecisions(projectId: string, decisions: Decision[], via: "button" | "chat"): { steps: Step[]; findings: Finding[]; results: string[] } {
  let { steps, findings } = loadAsis(projectId);
  const extraKnown = new Map<string, KnownSource>();
  const now = Math.floor(Date.now() / 1000);
  const results: string[] = [];
  const log = db.query("INSERT INTO consent_log (project_id, finding_id, decision, what, value, decided_via) VALUES (?, ?, ?, ?, ?, ?)");

  for (const d of decisions) {
    const f = findings.find((x) => x.id.toUpperCase() === String(d.id).toUpperCase());
    if (!f) { results.push(`${d.id}: not found`); continue; }
    if (f.status !== "pending") { results.push(`${f.id}: already ${f.status}`); continue; }
    const what = describeFinding(f, steps);

    // Skip: leave the value empty for now (not asked again)
    if (d.decision === "skip") {
      f.status = "skipped";
      f.decided_at = now;
      log.run(projectId, f.id, "skipped", what, f.value ?? f.step?.step_name ?? "", via);
      results.push(`${f.id} (${what}): skipped`);
      continue;
    }

    if (d.decision === "reject") {
      f.status = "rejected";
      f.decided_at = now;
      log.run(projectId, f.id, "rejected", what, f.value ?? f.step?.step_name ?? "", via);
      results.push(`${f.id} (${what}): not used`);
      continue;
    }

    const edited = typeof d.value === "string" && d.value.trim() ? d.value.trim() : undefined;
    for (const s of f.sources) extraKnown.set(s.id, { title: s.title, url: s.url, kind: s.kind, ...(s.quotes?.length ? { quotes: s.quotes } : {}) });

    if (f.kind === "field") {
      const idx = steps.findIndex((s) => s.uid === f.step_uid);
      if (idx === -1) { f.status = "dropped"; f.decided_at = now; results.push(`${f.id}: its step was removed`); continue; }
      const step = { ...steps[idx] };
      const field = f.field!;
      if (field === "digital_status") {
        step.digital_status = edited ? normalizeDigital(edited) || step.digital_status : f.value;
        step.digital_note = edited ? (normalizeDigital(edited) ? "" : edited) : f.digital_note;
      } else {
        step[field] = edited ?? f.value;
      }
      // a value the user confirmed (no other source) has the user as its source
      step.field_sources = { ...step.field_sources, [field]: edited || f.origin === "unsourced" ? "user" : f.origin };
      step.unknown_fields = (step.unknown_fields ?? []).filter((x) => x !== field);
      steps[idx] = step;
    } else {
      const proposed: Step = { ...(f.step as Step), uid: f.step?.uid ?? nanoid().slice(0, 10), step_source: f.origin, reviewed: false };
      const at = f.after_uid === null ? 0 : steps.findIndex((s) => s.uid === f.after_uid) + 1;
      steps.splice(at > 0 ? at : f.after_uid === null ? 0 : steps.length, 0, proposed);
    }
    f.status = "accepted";
    f.decided_at = now;
    log.run(projectId, f.id, "accepted", what, edited ?? f.value ?? f.step?.step_name ?? "", via);
    results.push(`${f.id} (${what}): used${edited ? " (your version)" : ""}`);
  }

  steps = renumber(steps, extraKnown);
  saveAsis(projectId, { steps, findings });
  return { steps, findings, results };
}

export function normalizeDigital(v: string): "manual" | "partly" | "online" | "" {
  const t = v.toLowerCase();
  if (/(fully|completely|end-to-end)?\s*online|digital end|সম্পূর্ণ\s*অনলাইন/.test(t) && !/partly|partial|semi|hybrid|আংশিক/.test(t)) return "online";
  if (/partly|partial|semi|hybrid|আংশিক|both/.test(t)) return "partly";
  if (/manual|paper|offline|in[- ]person|ম্যানুয়াল|কাগজ/.test(t)) return "manual";
  return "";
}
