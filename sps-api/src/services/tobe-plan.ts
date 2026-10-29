import { runStreamed } from "./stream-call";
import { extractJsonObject } from "./sources";
import { catalogueBlock, PLATFORM_KEYWORDS } from "./digital-catalogue";
import { ANTHROPIC_MODEL_FAST, TOBE_MODEL } from "../config";
import { log } from "../utils/log";

// After the TO-BE is designed: a critic flags what is unrealistic, then an implementation pass
// fixes what it can and writes how each step is put in place. What is still wrong stays on the
// step as a warning ("checks") for the user.

type Emit = (data: object) => void;
type TobeRow = Record<string, unknown>;

export type Effort = "quick" | "medium" | "long";
export interface Implementation { prerequisites: string; legal_fit: string; owner: string; effort: Effort; fallback: string }
export interface StepCheck { severity: "high" | "medium"; issue: string }
interface Issue { id: string; step: number; severity: StepCheck["severity"]; issue: string; code?: boolean }

const plain = (t: unknown) => String(t ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim();
const isDigital = (s: TobeRow) => s.channel === "digital" || s.channel === "hybrid";

/** The rules code can check for itself */
function codeChecks(steps: TobeRow[]): Omit<Issue, "id">[] {
  const out: Omit<Issue, "id">[] = [];
  for (const s of steps) {
    const n = Number(s.step_number);
    const how = plain(s.digital_how).toLowerCase();
    if (isDigital(s) && !how) out.push({ step: n, severity: "high", issue: "Digital step does not say how it is digitalized.", code: true });
    else if (isDigital(s) && !PLATFORM_KEYWORDS.some((k) => how.includes(k))) out.push({ step: n, severity: "medium", issue: "Names no known platform or system for the digital step.", code: true });
    if (s.step_type === "decision") {
      if (!plain(s.if_rejected)) out.push({ step: n, severity: "high", issue: "Decision has no rejection path — the applicant would not know what happens next.", code: true });
      if (!Number(s.no_goto)) out.push({ step: n, severity: "medium", issue: "Decision does not say which step a \"No\" returns to.", code: true });
    }
  }
  return out;
}

const compact = (s: TobeRow) => [s.step_number, s.step_name, s.actor, s.action, s.channel, s.time_days ?? null, s.merged_from ?? [], s.digital_how ?? "", s.if_rejected ?? "", s.step_type, s.visit ? 1 : 0, s.fee ?? 0, s.no_goto ?? null];
const STEP_FORMAT = "Each TO-BE step: [step_number, step_name, actor, action, channel, time_days, merged_from (AS-IS steps), digital_how, if_rejected, step_type, visit, fee, no_goto].";

const CRITIC_SYSTEM = `You review a proposed TO-BE (simplified) process for a Bangladesh government service and flag what is NOT realistic to implement. Be strict but fair; only real problems.

Check every step for:
- a system or platform that does not exist or is vague ("online system", "digital platform") — real ones are listed below, or "new module on <portal>";
- a digital step that does not say concretely how it works (which system, what is automated, how the citizen is informed);
- a decision or refusal with no clear path for the applicant (who tells them, how, what to fix, where the flow returns, appeal);
- the old process simply moved online (same approvals, same checks, same papers);
- a time that is not realistic (e.g. "same day" for something that needs several offices or a committee);
- anything that would need an Act, rule, order or regulation to be amended or newly issued (always "high" — the TO-BE must stay within current law), or that removes / bypasses a step the law cited in the AS-IS requires;
- an AS-IS step marked "required_by_law" that no TO-BE step covers (merged_from), or whose legal act the TO-BE step no longer performs (always "high");
- the citizen still asked for data another office already holds;
- a digital-only step with no assisted channel (digital centre / help desk) for citizens without digital skills.

${catalogueBlock()}

Answer with ONLY this JSON: {"issues":[[step_number,"high"|"medium","the problem, max 20 words"]]}
At most 15 issues, most serious first. {"issues":[]} when the design is realistic.`;

const PLAN_SYSTEM = `You are a Bangladesh e-government implementation planner. You get a TO-BE (simplified) process and the problems a reviewer found. For EVERY step you (1) fix what the reviewer found where it can be fixed in these fields, and (2) say how the step is put in place.
The TO-BE must work WITHIN CURRENT LAW: no step may need an Act, rule, order or regulation to be amended or newly issued. When a step would, rewrite its action / channel so it stays within what the law already allows.

${catalogueBlock()}

Answer with ONLY this JSON, one row per TO-BE step, no other text:
{"steps":[[1,"","","<digital_how>","<if_rejected>",2,"<prerequisites>","<legal_fit>",1,"<owner>","quick","<fallback>"]],"fixed":["I1","I3"]}
Row: [step_number, action, channel, digital_how, if_rejected, time_days, prerequisites, legal_fit, within_law, owner, effort, fallback].
- action / channel: "" to keep them; otherwise the revised action ("Label: one sentence", max 18 words) / channel (digital|in_person|hybrid) — only to bring a step within current law or fix a reviewer's issue. A step that covers an AS-IS step "required_by_law" must keep doing that legal act — digitalize how it is done, never drop it.
- digital_how (max 35 words): for a digital/hybrid step, the concrete way it works — the named system from the list (or "new module on <portal>"), what is automated (auto-fill, verification, data pulled from which office), how the citizen is told (SMS, portal tracking). "" for an in-person step.
- if_rejected (max 40 words): for a decision or any step that can refuse/return: who tells the applicant, how and with the reason; what they fix and by when; the step it returns to; appeal (to whom, within how many days; GRS). "" when the step cannot reject.
- time_days: realistic working days for this step in the new way of working (number).
- prerequisites (max 30 words): what must exist first — agreements/MoUs, API access, accounts, forms approved, staff training, budget.
- legal_fit (max 20 words): the current Act / rule / order / circular that allows the step as designed (keep its citation marker if known), or "No specific rule needed".
- within_law: 1 when the step works under current law without any amendment or new order; 0 when it cannot (then it is flagged for the user).
- owner (max 8 words): the office/unit responsible for putting it in place.
- effort: "quick" (under 3 months, existing systems) | "medium" (3-12 months) | "long" (over a year: a new system or integration).
- fallback (max 20 words): what happens when the digital route fails or the citizen cannot use it (digital centre, help desk, paper fallback).
- "fixed": the ids of the reviewer's issues your rows resolve. Issues you cannot fix in these fields (e.g. the step itself should be redesigned) are NOT listed.
Keep citation markers such as [D1:4], [S2] or [W1] that are already in digital_how / if_rejected; never invent new ones. English only. Be specific to this service — no generic filler.`;

/**
 * Critic + implementation pass over the designed TO-BE. Returns the steps with digital_how /
 * if_rejected / time revised, an `implementation` card and the `checks` still open. When a pass
 * fails, the design is returned as it is (with the code checks).
 */
export async function refineTobe(opts: {
  service: string; country: string; asis: unknown[]; steps: TobeRow[]; emit: Emit;
}): Promise<TobeRow[]> {
  const { emit } = opts;
  let steps = opts.steps.map((s) => ({ ...s }));
  const issues: Issue[] = [];
  const add = (i: Omit<Issue, "id">) => issues.push({ ...i, id: `I${issues.length + 1}` });
  codeChecks(steps).forEach(add);

  const context = `Service: ${opts.service}\nCountry: ${opts.country}\n\nAS-IS steps (approved):\n${JSON.stringify(opts.asis)}\n\n${STEP_FORMAT}\nTO-BE steps:\n${JSON.stringify(steps.map(compact))}`;

  // 1. the critic (a fast model: it only reads and flags)
  emit({ type: "progress", text: "Checking the TO-BE for anything unrealistic…" });
  try {
    const r = await runStreamed({
      label: "tobe-critic", model: ANTHROPIC_MODEL_FAST, system: CRITIC_SYSTEM,
      messages: [{ role: "user", content: context }], maxTokens: 3000, emit,
    });
    const raw = extractJsonObject(r.content) as { issues?: unknown[] } | null;
    for (const row of raw?.issues ?? []) {
      const [n, sev, text] = Array.isArray(row) ? row : [];
      if (!steps.some((s) => Number(s.step_number) === Number(n)) || !plain(text)) continue;
      add({ step: Number(n), severity: sev === "high" ? "high" : "medium", issue: plain(text) });
    }
  } catch (err) {
    log.error(`tobe-critic: ${String(err)}`);
  }
  log.analyze(`tobe-critic  issues=${issues.length}  (code=${issues.filter((i) => i.code).length})`);

  // 2. the implementation pass (fixes what it can, plans every step)
  emit({ type: "progress", text: `Planning how each step is implemented${issues.length ? ` and fixing ${issues.length} issue${issues.length > 1 ? "s" : ""}` : ""}…` });
  let fixed = new Set<string>();
  const needsLaw = new Set<number>();   // steps the planner could not keep within current law
  try {
    const r = await runStreamed({
      label: "tobe-plan", model: TOBE_MODEL, system: PLAN_SYSTEM,
      messages: [{ role: "user", content: `${context}\n\nREVIEWER'S ISSUES:\n${issues.map((i) => `${i.id} — step ${i.step} (${i.severity}): ${i.issue}`).join("\n") || "(none)"}` }],
      maxTokens: 24000, params: { thinking: { type: "adaptive" }, output_config: { effort: "medium" } }, emit,
    });
    const raw = extractJsonObject(r.content) as { steps?: unknown[]; fixed?: unknown[] } | null;
    const byNumber = new Map((raw?.steps ?? []).filter(Array.isArray).map((row) => [Number((row as unknown[])[0]), row as unknown[]]));
    steps = steps.map((s) => {
      const row = byNumber.get(Number(s.step_number));
      if (!row) return s;
      const [, action, channel, how, rejected, days, prerequisites, legal, withinLaw, owner, effort, fallback] = row;
      const txt = (v: unknown) => String(v ?? "").trim();
      if (withinLaw === 0 || withinLaw === false || String(withinLaw ?? "").trim() === "0") needsLaw.add(Number(s.step_number));
      const implementation: Implementation = {
        prerequisites: txt(prerequisites), legal_fit: txt(legal), owner: txt(owner),
        effort: (["quick", "medium", "long"].includes(String(effort)) ? effort : "medium") as Effort, fallback: txt(fallback),
      };
      return {
        ...s,
        ...(txt(action) ? { action: txt(action) } : {}),
        ...(["digital", "in_person", "hybrid"].includes(txt(channel)) ? { channel: txt(channel) } : {}),
        ...(txt(how) ? { digital_how: txt(how) } : {}),
        ...(txt(rejected) ? { if_rejected: txt(rejected) } : {}),
        ...(days != null && txt(days) !== "" && Number.isFinite(Number(days)) ? { time_days: Number(days) } : {}),
        implementation,
      };
    });
    fixed = new Set((raw?.fixed ?? []).map(String));
    log.analyze(`tobe-plan  planned=${byNumber.size}/${steps.length}  fixed=${fixed.size}/${issues.length}`);
  } catch (err) {
    log.error(`tobe-plan: ${String(err)}`);
  }

  // 3. what is still open: the code checks re-run on the result, the critic's issues not fixed
  const open = [
    ...codeChecks(steps),
    ...issues.filter((i) => !i.code && !fixed.has(i.id)),
    ...[...needsLaw].map((n) => ({ step: n, severity: "high" as const, issue: "Needs a law or rule change — redesign this step within current law." })),
  ];
  return steps.map((s) => {
    const checks: StepCheck[] = open.filter((i) => i.step === Number(s.step_number)).map((i) => ({ severity: i.severity, issue: i.issue }));
    return { ...s, checks };
  });
}
