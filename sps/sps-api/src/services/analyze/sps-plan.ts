import { db } from "../../db/index";
import { runStreamed } from "../stream-call";
import { getSps, updateSps } from "../sps";
import { extractJsonObject } from "../sources";
import { ANTHROPIC_MODEL } from "../../config";
import { spsPlanSystem } from "./prompts";
import { stepsLanguage } from "./steps";

type Emit = (data: object) => void;

/** Draft the implementation plan (strategic plan + time-based work plan) */
export async function draftSpsPlan(projectId: string, emit: Emit): Promise<void> {
  const p = db.query("SELECT name, description, tobe_steps FROM projects WHERE id = ?").get(projectId) as { name: string; description: string; tobe_steps: string } | null;
  if (!p) { emit({ type: "error", message: "Project not found." }); return; }
  const sps = getSps(projectId);
  const tobe = (JSON.parse(p.tobe_steps || "[]") as Array<Record<string, unknown>>).map((s) => `${s.step_number}. ${String(s.action ?? "").replace(/\[[^\]]*\]/g, "")}`);
  emit({ type: "progress", text: "Drafting the implementation plan…" });
  const result = await runStreamed({
    label: "sps-plan",
    model: ANTHROPIC_MODEL,
    system: spsPlanSystem,
    messages: [{ role: "user", content: `LANGUAGE: ${stepsLanguage(JSON.parse(p.tobe_steps || "[]"))}\n\nService: ${p.name} — ${p.description ?? ""}\n\nTO-BE steps:\n${tobe.join("\n")}\n\nProposals (Sheet-5):\n${(sps.problems ?? []).map((x) => `- ${x.aspect}: ${x.proposal}`).join("\n")}` }],
    maxTokens: 3000,
    emit,
  });
  const raw = extractJsonObject(result.content) as { challenges?: string; measures?: string; publicity?: string; monitoring?: string; workplan?: unknown[] } | null;
  if (!raw) { emit({ type: "error", message: "The plan could not be drafted. Please try again." }); return; }
  const plan = {
    challenges: String(raw.challenges ?? ""), measures: String(raw.measures ?? ""), publicity: String(raw.publicity ?? ""), monitoring: String(raw.monitoring ?? ""),
    workplan: (raw.workplan ?? []).flatMap((r) => Array.isArray(r) && typeof r[0] === "string" ? [{ activity: r[0], months: Array.isArray(r[1]) ? r[1].map(String) : [] }] : []),
  };
  updateSps(projectId, { plan });
  emit({ type: "done", text: JSON.stringify({ plan }) });
}
