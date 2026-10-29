import { db } from "../db/index";
import { client } from "./ai";
import { ANTHROPIC_MODEL } from "../config";
import { log } from "../utils/log";

// ── Digitalization Analysis ───────────────────────────────────────────────────
//
// From an approved TO-BE: every piece of digital infrastructure its steps rely on, whether
// the government already has it, it needs an upgrade, or it must be built — how it is built,
// and the high-level cost heads (software development, hosting, maintenance …). No amounts.
// Drafted on its own in the background once a TO-BE is generated (again if the TO-BE changed
// by its approval), so Outputs has it ready; "Redraft" on the page redoes it.

export const COST_HEADS = {
  software_development: "Software development",
  integration: "Integration / API",
  hosting: "Server & hosting",
  maintenance: "Maintenance & support (yearly)",
  licence: "Licence / subscription",
  hardware: "Hardware & devices",
  security: "Security & digital signature",
  sms_payment: "SMS / payment gateway charges",
  data_agreement: "Data-sharing agreement (MoU)",
  training: "Training & change management",
} as const;
type CostHead = keyof typeof COST_HEADS;

const KINDS = ["website", "portal_module", "mobile_app", "integration", "system", "hardware", "other"] as const;
const STATUSES = ["existing", "upgrade", "new"] as const;

export interface DigitalComponent {
  name: string;
  kind: (typeof KINDS)[number];
  status: (typeof STATUSES)[number];
  /** TO-BE step numbers that use it */
  steps: number[];
  purpose: string;
  /** how it is built or what work it needs */
  build: string;
  cost_heads: CostHead[];
}
export interface DigitalPlan { components: DigitalComponent[]; drafted_at: number; /** the TO-BE it was drafted from */ sig: string }

const sigOf = (tobeSteps: string) => String(Bun.hash(tobeSteps || "[]"));

const SYSTEM = `You list the digital infrastructure of a simplified (TO-BE) government service process in Bangladesh, for its budget's cost heads.

From the TO-BE steps (how each is digitalized, and what must be put in place), list every distinct piece of digital infrastructure the steps rely on — a website or portal, a new module on a portal, a mobile app, a data link / API to another office's system (NID / Porichoy, BDRIS, ekPay, bank / MFS), a government system (e-Nothi / D-Nothi, GRS, myGov), SMS gateway, digital signature, devices.
Merge mentions of the same thing across steps into one item.

For each item:
- status: "existing" — already running and used as it is (e.g. e-Nothi for an office already on it); "upgrade" — exists but needs a new module, feature, integration or onboarding; "new" — must be built or procured.
- build: how it is built or what work it needs (max 25 words) — e.g. "Develop a responsive web form and employer accounts on the BKKB portal; host at the National Data Centre (BCC)". For "existing": what it takes to use it (onboarding, accounts).
- cost_heads: the high-level budget heads it needs, from: ${Object.keys(COST_HEADS).join(", ")}. An existing system usually needs only training (and maybe licence or maintenance). Never amounts.
- purpose: what it does in this service (max 20 words).

Answer with ONLY this JSON, no text around it:
{"components":[{"name":"BKKB service portal (sss.bkkb.gov.bd)","kind":"website","status":"upgrade","steps":[1,2],"purpose":"Online one-stage application and employer endorsement","build":"Add the application form, employer accounts and status tracking to the existing portal","cost_heads":["software_development","hosting","maintenance","security","training"]}]}
kind: ${KINDS.join(" | ")}. steps: the TO-BE step numbers that use it.
Write every text in ENGLISH, even when the steps are in Bangla — system and office names in their English form (e.g. "BKKB service portal", "Porichoy NID API", "e-Nothi").`;

const strip = (t: unknown) => String(t ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim();

const drafting = new Set<number>();

/** Draft the plan in the background unless the version has one for its current TO-BE (or one is being drafted) */
export function ensureDigitalPlan(projectId: string, versionId: number): void {
  const row = db.query("SELECT tobe_steps, digital_plan FROM tobe_versions WHERE project_id = ? AND id = ?").get(projectId, versionId) as
    { tobe_steps: string | null; digital_plan: string | null } | null;
  if (!row || drafting.has(versionId) || (JSON.parse(row.tobe_steps || "[]") as unknown[]).length === 0) return;
  const plan = (() => { try { return JSON.parse(row.digital_plan || "null") as DigitalPlan | null; } catch { return null; } })();
  if (plan && plan.sig === sigOf(row.tobe_steps || "[]")) return;
  draftDigitalPlan(projectId, versionId).catch((err) => log.error(`digital-plan ${projectId} v${versionId}: ${String(err)}`));
}

/** Draft (or redraft) the plan of a version's TO-BE and save it with the version */
export async function draftDigitalPlan(projectId: string, versionId: number): Promise<DigitalPlan | null> {
  const row = db.query("SELECT tobe_steps, project_name FROM tobe_versions WHERE project_id = ? AND id = ?").get(projectId, versionId) as
    { tobe_steps: string; project_name: string } | null;
  const steps = JSON.parse(row?.tobe_steps || "[]") as Array<Record<string, unknown>>;
  if (!row || !steps.length) return null;
  drafting.add(versionId);
  try { return await draft(projectId, versionId, row.project_name, row.tobe_steps, steps); } finally { drafting.delete(versionId); }
}

async function draft(projectId: string, versionId: number, service: string, tobeJson: string, steps: Array<Record<string, unknown>>): Promise<DigitalPlan | null> {
  const lines = steps.map((s) => {
    const im = (s.implementation ?? {}) as Record<string, unknown>;
    return `${s.step_number}. ${strip(s.step_name)} [${s.channel}] — ${strip(s.action)}\n   digitalized: ${strip(s.digital_how) || "—"}\n   to put in place: ${strip(im.prerequisites) || "—"}`;
  });

  const res = await client.messages.stream({
    model: ANTHROPIC_MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Service: ${service}\n\nTO-BE steps:\n${lines.join("\n")}` }],
  }).finalMessage();
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const raw = (() => { try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return null; } })() as { components?: unknown[] } | null;
  if (!raw?.components) { log.error(`digital-plan ${projectId} v${versionId}: no JSON (stop=${res.stop_reason})`); return null; }

  const pick = <T extends string>(v: unknown, all: readonly T[], dflt: T): T => (all.includes(v as T) ? (v as T) : dflt);
  const components: DigitalComponent[] = raw.components.flatMap((c) => {
    const o = c as Record<string, unknown>;
    if (!strip(o.name)) return [];
    return [{
      name: strip(o.name), kind: pick(o.kind, KINDS, "other"), status: pick(o.status, STATUSES, "new"),
      steps: (Array.isArray(o.steps) ? o.steps : []).map(Number).filter((n) => Number.isFinite(n)),
      purpose: strip(o.purpose), build: strip(o.build),
      cost_heads: (Array.isArray(o.cost_heads) ? o.cost_heads : []).filter((h): h is CostHead => typeof h === "string" && h in COST_HEADS),
    }];
  });
  const plan: DigitalPlan = { components, drafted_at: Math.floor(Date.now() / 1000), sig: sigOf(tobeJson) };
  db.query("UPDATE tobe_versions SET digital_plan = ? WHERE id = ?").run(JSON.stringify(plan), versionId);
  log.analyze(`digital-plan ${projectId} v${versionId}: ${components.length} components`);
  return plan;
}
