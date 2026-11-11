// Turning the model's compact rows into steps, and the shared bits of the analyze routes.

// An approved AS-IS / TO-BE is never changed in place: the page makes a new version first
export const LOCKED_ASIS = (v: number) => `AS-IS version ${v} is approved and can't be changed. Create a new version to change it.`;
export const LOCKED_TOBE = (v: number) => `TO-BE version ${v} is approved and can't be changed. Create a new version to change it.`;

// The model writes compact rows to save output tokens (= time); expand them here.
export function rows<T extends Record<string, unknown>>(list: unknown, keys: string[]): T[] {
  if (!Array.isArray(list)) return [];
  return list.map((r) => {
    if (!Array.isArray(r)) return r as T;           // tolerate object form too
    const o: Record<string, unknown> = {};
    keys.forEach((k, i) => { if (r[i] !== undefined && r[i] !== "") o[k] = r[i]; });
    return o as T;
  });
}
// Ensure every action starts with a short bold-able label ("Label: sentence")
export function withLabel<T extends Record<string, unknown>>(steps: T[]): T[] {
  return steps.map((s) => {
    const action = String(s.action ?? "").replace(/^(action|label)\s*:\s*/i, "");
    const colon = action.indexOf(":");
    const hasLabel = colon > 0 && colon <= 40 && !/\[\w+\]/.test(action.slice(0, colon));
    return { ...s, action: hasLabel ? action : `${s.step_name ?? "Step"}: ${action}` };
  });
}
export const ASIS_KEYS = ["step_number", "step_name", "actor", "action", "input", "time_days", "pain_points", "step_type", "visit", "fee", "no_goto"];
export const TOBE_KEYS = ["step_number", "step_name", "actor", "action", "channel", "time_days", "merged_from", "simplification_rationale", "legal_basis", "step_type", "visit", "fee", "no_goto", "digital_how", "if_rejected", "best_practice"];

/** The language of a process — the app works in English only */
export function stepsLanguage(_steps: Array<Record<string, unknown>>): "Bangla" | "English" {
  return "English";
}

// The guideline's step fields: type (activity / decision / document / message), visit (the
// citizen comes in person), fee (taka), time in working days, and for a decision the step
// "No" goes back to.
const STEP_TYPES = ["activity", "decision", "document", "message"];
export function normalizeSteps<T extends Record<string, unknown>>(steps: T[]): T[] {
  return steps.map((s) => {
    const type = String(s.step_type ?? "").toLowerCase();
    const visit = s.visit === true || s.visit === 1 || /^(1|true|yes|y)$/i.test(String(s.visit ?? ""));
    const fee = Number(String(s.fee ?? "").replace(/[^\d.]/g, ""));
    const days = Number(String(s.time_days ?? "").replace(/[^\d.]/g, ""));
    const noGoto = Number(s.no_goto);
    return {
      ...s,
      step_type: STEP_TYPES.includes(type) ? type : "activity",
      visit,
      ...(fee > 0 ? { fee } : { fee: undefined }),
      ...(String(s.time_days ?? "").trim() && Number.isFinite(days) ? { time_days: days } : {}),
      ...(type === "decision" && noGoto > 0 ? { no_goto: noGoto } : { no_goto: undefined }),
    };
  });
}
