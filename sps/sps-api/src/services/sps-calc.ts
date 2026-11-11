import { feedbackClass } from "./sps-guide";

// ── SPS calculations (pure — no database, no AI) ──────────────────────────────
//
// Everything the guideline measures is computed here from the steps and the project's
// SPS data, so the numbers are exact and reproducible:
//   TCVQ (ছক-৭) for AS-IS and TO-BE, the difference and the annual saving,
//   and the SPS checks a TO-BE must pass before it can be approved.

/** Per-project SPS data (projects.sps) */
export interface SpsData {
  settings?: {
    cost_fare?: number;          // taka per visit
    cost_food?: number;
    cost_wage?: number;          // lost daily wage per visit
    users_per_year?: number;     // for the annual saving
    office_cost_asis?: number;   // office cost per application (taka), if known
    office_cost_tobe?: number;
    unexpected_asis?: number;    // unexpected citizen cost per application (middlemen etc.), taka
    unexpected_tobe?: number;
  };
  office?: { ministry?: string; department?: string; office?: string; services?: string };   // ম্যাট্রিক্স-১
  priority?: Record<string, number>;                                                           // ম্যাট্রিক্স-২
  feedback?: { respondents: number; averages: Record<string, number>; total: number; comments: string[] }; // ম্যাট্রিক্স-৩
  profile?: Record<string, { value: string; source?: string }>;                                // ছক-১
  documents?: SpsDocument[];                                                                    // ছক-৩
  problems?: SpsProblem[];                                                                      // ছক-৫
  problems_edited?: boolean;
  mapping?: SpsMapping[];                                                                       // ছক-৬
  plan?: SpsPlan;
  team?: string;
}

export interface SpsDocument {
  name: string;
  source: "citizen_own" | "other_office";       // the citizen already has it / must get it from another office
  verify: "none" | "own" | "other_office";      // the office checks it in its own records / with another office
  tobe?: "submit" | "auto" | "removed";         // TO-BE: still submitted / fetched-verified automatically / no longer needed
}
export interface SpsProblem { aspect: string; problem: string; demand: string; proposal: string; rationale: string }
export interface SpsMapping { asis: number; tobe: number | null; disposition: "kept" | "merged" | "removed"; reason: string }
export interface SpsPlan {
  challenges?: string; measures?: string; publicity?: string; monitoring?: string;
  workplan?: Array<{ activity: string; months: string[] }>;
}

export const DEFAULT_SETTINGS = { cost_fare: 200, cost_food: 200, cost_wage: 500, users_per_year: 0 };

interface StepLike { step_number?: number; actor?: unknown; time_days?: unknown; visit?: unknown; fee?: unknown; step_type?: unknown }

export interface Tcvq {
  time_days: number;
  visits: number;
  citizen_cost: number;
  fees: number;
  documents: number | null;
  steps: number;
  staff: number;
  decisions: number;
  office_cost: number | null;
}

const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^\d.]/g, "")); return Number.isFinite(n) ? n : 0; };
const isVisit = (v: unknown) => v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true" || String(v).toLowerCase() === "yes";
// The citizen is not "staff" (জনবল counts officers and employees involved)
const CITIZEN = /citizen|applicant|beneficiary|heir|নাগরিক|আবেদনকারী|সেবাগ্রহীতা|উপকারভোগী/i;

export function computeTcvq(steps: StepLike[], sps: SpsData, which: "asis" | "tobe"): Tcvq {
  const s = { ...DEFAULT_SETTINGS, ...sps.settings };
  const perVisit = num(s.cost_fare) + num(s.cost_food) + num(s.cost_wage);
  const visits = steps.filter((x) => isVisit(x.visit)).length;
  const fees = steps.reduce((sum, x) => sum + num(x.fee), 0);
  const docs = sps.documents?.length
    ? which === "asis" ? sps.documents.length : sps.documents.filter((d) => (d.tobe ?? "submit") === "submit").length
    : null;
  const staff = new Set(steps.map((x) => String(x.actor ?? "").trim()).filter((a) => a && !CITIZEN.test(a)));
  const officeCost = which === "asis" ? sps.settings?.office_cost_asis : sps.settings?.office_cost_tobe;
  const unexpected = num(which === "asis" ? s.unexpected_asis : s.unexpected_tobe);
  return {
    time_days: Math.round(steps.reduce((sum, x) => sum + num(x.time_days), 0) * 10) / 10,
    visits,
    citizen_cost: visits * perVisit + fees + unexpected,
    fees,
    documents: docs,
    steps: steps.length,
    staff: staff.size,
    decisions: steps.filter((x) => x.step_type === "decision").length,
    office_cost: officeCost != null && officeCost !== 0 ? num(officeCost) : null,
  };
}

export interface TcvqComparison {
  asis: Tcvq;
  tobe: Tcvq | null;
  diff: Partial<Record<keyof Tcvq, number>> | null;
  annual: { users: number; days: number; visits: number; taka: number } | null;
  per_visit: number;
}

export function compareTcvq(asisSteps: StepLike[], tobeSteps: StepLike[], sps: SpsData): TcvqComparison {
  const s = { ...DEFAULT_SETTINGS, ...sps.settings };
  const asis = computeTcvq(asisSteps, sps, "asis");
  const tobe = tobeSteps.length ? computeTcvq(tobeSteps, sps, "tobe") : null;
  const diff = tobe ? {
    time_days: Math.round((asis.time_days - tobe.time_days) * 10) / 10,
    visits: asis.visits - tobe.visits,
    citizen_cost: asis.citizen_cost - tobe.citizen_cost,
    documents: asis.documents != null && tobe.documents != null ? asis.documents - tobe.documents : undefined,
    steps: asis.steps - tobe.steps,
    staff: asis.staff - tobe.staff,
    office_cost: asis.office_cost != null && tobe.office_cost != null ? asis.office_cost - tobe.office_cost : undefined,
  } as Partial<Record<keyof Tcvq, number>> : null;
  const users = num(s.users_per_year);
  const annual = diff && users > 0
    ? { users, days: Math.round(users * (diff.time_days ?? 0)), visits: users * (diff.visits ?? 0), taka: users * (diff.citizen_cost ?? 0) }
    : null;
  return { asis, tobe, diff, annual, per_visit: num(s.cost_fare) + num(s.cost_food) + num(s.cost_wage) };
}

// ── SPS checks (the guideline's "do / don't" as rules) ────────────────────────

export interface SpsCheck { id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }

interface CheckStep extends StepLike { step_name?: unknown; action?: unknown; legal_basis?: unknown; channel?: unknown; simplification_rationale?: unknown }

export function runChecks(asisSteps: CheckStep[], tobeSteps: CheckStep[], sps: SpsData): SpsCheck[] {
  if (!tobeSteps.length) return [];
  const c = compareTcvq(asisSteps, tobeSteps, sps);
  const t = c.tobe!;
  const a = c.asis;
  const out: SpsCheck[] = [];
  const add = (id: string, label: string, status: SpsCheck["status"], detail: string) => out.push({ id, label, status, detail });

  // 1. TCVQ must improve
  add("time", "Time is reduced", t.time_days < a.time_days ? "pass" : a.time_days === 0 ? "warn" : "fail",
    a.time_days === 0 ? "AS-IS times are missing — add the time (T) of each step to measure it" : `${a.time_days} → ${t.time_days} working days`);
  add("visits", "Office visits are reduced", t.visits < a.visits ? "pass" : t.visits === 0 && a.visits === 0 ? "warn" : t.visits > a.visits ? "fail" : "warn",
    a.visits === 0 && t.visits === 0 ? "No visits marked — mark the steps where the citizen must come in person" : `${a.visits} → ${t.visits} visits`);
  add("cost", "Citizen cost is reduced", t.citizen_cost < a.citizen_cost ? "pass" : t.citizen_cost > a.citizen_cost ? "fail" : "warn",
    `৳${a.citizen_cost.toLocaleString("en-IN")} → ৳${t.citizen_cost.toLocaleString("en-IN")}`);
  add("steps", "Steps are reduced", t.steps < a.steps ? "pass" : "fail", `${a.steps} → ${t.steps} steps`);
  if (a.documents != null && t.documents != null) {
    add("documents", "Fewer documents to submit", t.documents < a.documents ? "pass" : "warn", `${a.documents} → ${t.documents} documents`);
  }

  // 2. Not "just moved online"
  const stepCut = a.steps ? (a.steps - t.steps) / a.steps : 0;
  const onlyOnline = stepCut < 0.2 && t.visits >= a.visits && t.time_days >= a.time_days * 0.8;
  add("not_just_online", "Not just the old process moved online", onlyOnline ? "fail" : "pass",
    onlyOnline ? "Steps, visits and time barely changed — unnecessary steps, approvals or checks remain" : `${Math.round(stepCut * 100)}% fewer steps`);

  // 3. Every AS-IS step accounted for (ছক-৬)
  const mapping = sps.mapping ?? [];
  const mapped = new Set(mapping.map((m) => m.asis));
  const unmapped = asisSteps.filter((s) => !mapped.has(Number(s.step_number))).map((s) => s.step_number);
  add("mapping", "Every AS-IS step is kept, merged or removed", !mapping.length ? "warn" : unmapped.length ? "warn" : "pass",
    !mapping.length ? "No step-by-step comparison yet — regenerate the TO-BE" : unmapped.length ? `Not accounted for: step ${unmapped.join(", ")}` : `${asisSteps.length} steps accounted for`);
  const noReason = mapping.filter((m) => m.disposition === "removed" && !m.reason.trim()).map((m) => m.asis);
  if (mapping.length) add("removal_reasons", "Every removed step has a reason", noReason.length ? "warn" : "pass", noReason.length ? `Missing a reason: step ${noReason.join(", ")}` : "All removals explained");

  // 4. Legally required steps are not dropped without a reason
  const legalRemoved = mapping.filter((m) => m.disposition === "removed").map((m) => asisSteps.find((s) => Number(s.step_number) === m.asis))
    .filter((s): s is CheckStep => !!s && !!String(s.legal_basis ?? "").replace(/\[[^\]]*\]/g, "").trim());
  add("legal", "Legally required steps are kept (simplified, not dropped)", legalRemoved.length ? "warn" : "pass",
    legalRemoved.length ? `Removed despite a legal basis: step ${legalRemoved.map((s) => s.step_number).join(", ")} — check the law allows it` : "No legally based step removed");

  // 5. Never ask twice
  const twice = (sps.documents ?? []).filter((d) => d.source === "other_office" && (d.tobe ?? "submit") === "submit");
  if (sps.documents?.length) {
    add("ask_twice", "No document the government already holds is asked again", twice.length ? "warn" : "pass",
      twice.length ? `Still collected from the citizen: ${twice.map((d) => d.name).join(", ")} — fetch or verify it from the other office's server` : "Documents held by other offices are fetched or verified");
  }

  // 6. Citizen-facing features the guideline expects
  const text = tobeSteps.map((s) => `${s.step_name} ${s.action} ${s.channel} ${s.simplification_rationale}`).join(" ").toLowerCase()
    + " " + (sps.problems ?? []).map((p) => p.proposal).join(" ").toLowerCase();
  const has = (re: RegExp) => re.test(text);
  add("tracking", "Tracking and notifications (SMS)", has(/track|sms|notif|ট্র্যাক|এসএমএস|অবহিত/) ? "pass" : "warn", "Citizens should see the status and be told when to act");
  add("grievance", "Complaint / GRS access", has(/grs|grievance|complaint|অভিযোগ/) ? "pass" : "warn", "Link the service to the Grievance Redress System (grs.gov.bd)");
  add("inclusion", "Inclusive: help desk / digital centre / accessibility", has(/udc|digital cent|help ?desk|assist|accessib|disab|প্রতিবন্ধী|ডিজিটাল সেন্টার|সহায়তা/) ? "pass" : "warn",
    "Keep an assisted channel and accessibility for persons with disabilities and the elderly");
  add("payment", "Fee can be paid without a visit", t.fees === 0 || has(/ek-?pay|a-?challan|mfs|online pay|bkash|nagad|card|অনলাইন পেমেন্ট/) ? "pass" : "warn",
    "Offer online payment (Ek-Pay, A-Challan, MFS)");
  return out;
}

export function checksBlocking(checks: SpsCheck[]): SpsCheck[] {
  return checks.filter((c) => c.status === "fail");
}

/** ম্যাট্রিক্স-৩ summary from respondent rows (14 scores of 1–5 each) */
export function summariseFeedback(rows: number[][], comments: string[], keys: string[]) {
  const valid = rows.filter((r) => r.length >= keys.length && r.slice(0, keys.length).every((v) => v >= 1 && v <= 5));
  const averages: Record<string, number> = {};
  keys.forEach((k, i) => { averages[k] = valid.length ? Math.round((valid.reduce((s, r) => s + r[i], 0) / valid.length) * 10) / 10 : 0; });
  const total = Math.round(Object.values(averages).reduce((s, v) => s + v, 0) * 10) / 10;
  return { respondents: valid.length, averages, total, comments: comments.filter((c) => c.trim()).slice(0, 50), class: feedbackClass(total) };
}
