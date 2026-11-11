import Anthropic from "@anthropic-ai/sdk";
import { db } from "../../db/index";
import { DocSession, runDocAgent } from "../doc-agent";
import { memoryBlock } from "../memory";
import { runStreamed } from "../stream-call";
import { WEB_SEARCH, WEB_FETCH } from "../web-tools";
import { acceptedWebSources, acceptedSourcesBlock } from "../web-sources";
import { projectCountry } from "../review";
import { toIdMarkers, loadAsis, type Step } from "../asis-state";
import { SPS_ASPECTS } from "../sps-guide";
import { getSps, updateSps, spsPromptBlock } from "../sps";
import type { SpsDocument, SpsMapping, SpsProblem } from "../sps-calc";
import { collectWebResults, validateWebSources, finalizeCitations, extractJsonObject, type KnownSource } from "../sources";
import { refineTobe } from "../tobe-plan";
import { ensureDigitalPlan } from "../digital-plan";
import { activeInfo, syncActive } from "../versions";
import { TOBE_MODEL } from "../../config";
import { log } from "../../utils/log";
import { tobeSystem } from "./prompts";
import { rows, withLabel, normalizeSteps, stepsLanguage, TOBE_KEYS, LOCKED_TOBE } from "./steps";

// Generate the TO-BE from the approved AS-IS, the guideline's way.
//
// One call produces the problem/proposal analysis of the 20 aspects (ছক-৫), the TO-BE
// steps (with type, visit, fee, time), what happened to every AS-IS step (ছক-৬) and which
// documents the citizen still submits (ছক-৩). A critic and an implementation pass then
// refine the steps; TCVQ (ছক-৭) and the SPS checks are computed from these in code.

type Emit = (data: object) => void;
type Project = { name: string; description: string; goal: string | null };
type Sps = ReturnType<typeof getSps>;
type CompactStep = Record<string, unknown>;
/** The design call's JSON: compact rows, expanded in code */
type TobeAnswer = { problems?: unknown[]; tobe_steps?: unknown[]; mapping?: unknown[]; documents?: unknown[]; sources?: Array<{ id?: string; url?: string; title?: string }> };

export async function generateTobe(projectId: string, emit: Emit): Promise<void> {
  const lock = activeInfo(projectId);
  if (lock?.tobe_locked) { emit({ type: "error", message: LOCKED_TOBE(lock.version) }); return; }
  const project = db.query("SELECT name, description, goal FROM projects WHERE id = ?").get(projectId) as Project | null;
  if (!project) { emit({ type: "error", message: "Project not found." }); return; }
  const country = projectCountry(projectId);
  const sps = getSps(projectId);
  // asis_steps holds only confirmed information (documents, the user, accepted web findings)
  const { steps: asis } = loadAsis(projectId);
  const { compactSteps, known } = compactAsis(asis);

  // 1. research and design
  const session = new DocSession(projectId, emit);
  const acceptedUrls = acceptedWebSources(projectId).map((x) => x.url);
  const prompt = tobePrompt({ projectId, project, country, asis, compactSteps, known, session, sps });
  emit({ type: "progress", text: `Researching the rules and systems, then designing the TO-BE from ${asis.length} approved AS-IS steps…` });
  log.analyze(`tobe-generate  project=${projectId}  model=${TOBE_MODEL}  asis=${compactSteps.length}  sources=${known.size}  docs=${session.docs.length}  accepted=${acceptedUrls.length}  sps-docs=${sps.documents?.length ?? 0}`);
  const result = await designTobe({ country, prompt, session, acceptedUrls, emit });

  const raw = extractJsonObject(result.content) as TobeAnswer | null;
  const designed = raw ? normalizeSteps(withLabel(rows(raw.tobe_steps, TOBE_KEYS))) : [];
  if (!designed.length) {
    log.error(`tobe-generate: no steps (stop=${result.stop})`);
    emit({ type: "error", message: "AI did not return structured TO-BE steps. Please try again." });
    return;
  }
  // what the research read is citable too: document pages, and web pages that really came back
  for (const [k, v] of session.known((fileId) => `/api/projects/${projectId}/files/${fileId}/view`)) known.set(k, v);
  for (const [k, v] of validateWebSources(raw?.sources, collectWebResults(result.all), acceptedUrls)) known.set(k, v);

  // 2. a critic flags what is unrealistic; an implementation pass fixes what it can and plans each step
  const refined = await refineTobe({ service: project.name, country, asis: compactSteps, steps: designed, emit });
  const finalized = finalizeCitations(refined, ["action", "simplification_rationale", "legal_basis", "digital_how", "if_rejected", "best_practice"], known);
  const tobe_steps = keepWebBestPractice(finalized.items);

  // a step the law requires that the design dropped is flagged on the TO-BE step that follows it
  flagDroppedLegalSteps(asis, tobe_steps as Array<Record<string, unknown>>);

  // 3. ছক-৫, ছক-৬ and the documents' TO-BE status
  const sheets = parseSheets(raw!, sps);
  updateSps(projectId, sheets);
  log.analyze(`tobe-generate done  steps=${tobe_steps.length}  sources=${finalized.sources.length}  problems=${sheets.problems.length}  mapping=${sheets.mapping.length}`);

  linkAsisUids(projectId, tobe_steps as Array<Record<string, unknown>>);
  db.query("UPDATE projects SET tobe_steps = ?, status = 'tobe_complete', updated_at = unixepoch() WHERE id = ?")
    .run(JSON.stringify(tobe_steps), projectId);
  syncActive(projectId);
  // the Digitalization Analysis for Outputs, drafted in the background
  const version = activeInfo(projectId);
  if (version) ensureDigitalPlan(projectId, version.id);
  emit({ type: "done", text: JSON.stringify({ tobe_steps }), saved: true });
}

/** The AS-IS as short objects for the prompt, with its citations as source ids ([S1]…) */
function compactAsis(asis: Step[]): { compactSteps: CompactStep[]; known: Map<string, KnownSource> } {
  const known = new Map<string, KnownSource>();
  const compactSteps = asis.map((s) => {
    const r = toIdMarkers(s);
    for (const [k, v] of r.known) known.set(k, v);
    const st = r.step;
    return {
      n: s.step_number, name: s.step_name, actor: s.actor, action: st.action,
      type: s.step_type ?? "activity", days: s.time_days ?? null, visit: !!s.visit, ...(s.fee ? { fee: s.fee } : {}),
      ...(st.pain_points ? { pain: st.pain_points } : {}),
      ...(s.digital_status ? { digital: `${s.digital_status}${st.digital_note ? ` — ${st.digital_note}` : ""}` } : {}),
      ...(st.legal_basis ? { law: st.legal_basis } : {}),
      // confirmed by the user: this step must stay (digitalized), never removed
      ...(st.law_required ? { required_by_law: st.law_required } : {}),
    };
  });
  return { compactSteps, known };
}

function tobePrompt(o: {
  projectId: string; project: Project; country: string; asis: Step[]; compactSteps: CompactStep[];
  known: Map<string, KnownSource>; session: DocSession; sps: Sps;
}): string {
  const { projectId, project, sps } = o;
  const sourceList = [...o.known].map(([id, s]) => `[${id}] ${s.title}`).join("\n") || "(none)";
  const userProblems = sps.problems_edited && sps.problems?.length
    ? `\n\nPROBLEM ANALYSIS (Sheet-5) — written by the user; keep it as it is and design the TO-BE from it:\n${JSON.stringify(sps.problems)}`
    : "";
  return `LANGUAGE: write every text (problems, steps, mapping reasons) in ${stepsLanguage(o.asis)}.\n\nService: ${project.name}${project.description ? ` — ${project.description}` : ""}${project.goal ? `\nGoal of the simplification (design the TO-BE to reach it): ${project.goal}` : ""}\nCountry: ${o.country}\n\nApproved AS-IS steps (confirmed by the user):\n${JSON.stringify(o.compactSteps)}\n\nCitable sources:\n${sourceList}${o.session.docs.length ? `\n\n${o.session.catalogue()}` : ""}${acceptedSourcesBlock(projectId)}${spsPromptBlock(projectId)}${userProblems}${memoryBlock(projectId)}`;
}

/**
 * Research before designing: the uploaded files and the shared law library (document tools),
 * the sites the user accepted (web_fetch), and web searches for world best practice.
 */
async function designTobe(o: {
  country: string; prompt: string; session: DocSession; acceptedUrls: string[]; emit: Emit;
}): Promise<{ content: Anthropic.ContentBlock[]; all: Anthropic.ContentBlock[]; stop: string | null }> {
  const { country, prompt, session, acceptedUrls, emit } = o;
  const domains = [...new Set(acceptedUrls.map((u) => { try { return new URL(u).hostname; } catch { return ""; } }).filter(Boolean))];
  const fetchTools = domains.length ? [{ ...WEB_FETCH, max_uses: Math.min(acceptedUrls.length, 3), allowed_domains: domains }] : [];
  const betas = fetchTools.length ? ["web-fetch-2025-09-10"] : undefined;
  // thinking shares max_tokens with the JSON answer: "high" plus 17 pages read cut the JSON off at 32k
  const thinking = { thinking: { type: "adaptive" }, output_config: { effort: "medium" } };
  const onText = (t: string) => emit({ type: "text", text: t });

  if (session.docs.length) {
    return runDocAgent({
      label: "tobe-generate", model: TOBE_MODEL, system: tobeSystem(country), prompt, session,
      webSearch: WEB_SEARCH, webSearchBudget: 5, extraTools: fetchTools, betas, params: thinking,
      maxIterations: 10, maxTokens: 64000, emit, onText,
    });
  }
  const r = await runStreamed({
    label: "tobe-generate", model: TOBE_MODEL, system: tobeSystem(country),
    messages: [{ role: "user", content: prompt }],
    tools: [{ ...WEB_SEARCH, max_uses: 5 }, ...fetchTools], betas, params: thinking,
    maxTokens: 64000, emit, onText,
  });
  return { ...r, all: r.content };
}

/**
 * AS-IS steps the user confirmed as required by law must live on in the TO-BE (merged_from).
 * One that is missing gets a high check on the TO-BE step that now covers the step before it.
 */
function flagDroppedLegalSteps(asis: Step[], tobeSteps: Array<Record<string, unknown>>) {
  if (!tobeSteps.length) return;
  const from = (t: Record<string, unknown>) => (Array.isArray(t.merged_from) ? t.merged_from : String(t.merged_from ?? "").split(/[^\d]+/)).map(Number);
  const covered = new Set(tobeSteps.flatMap(from));
  for (const s of asis) {
    if (!String(s.law_required ?? "").trim() || covered.has(Number(s.step_number))) continue;
    const before = asis.filter((a) => a.step_number < s.step_number && covered.has(Number(a.step_number))).pop();
    const at = (before && tobeSteps.find((t) => from(t).includes(Number(before.step_number)))) || tobeSteps[0];
    const rule = String(s.law_required).replace(/\s*\[[^\]]*\]/g, "").trim();
    const checks = (at.checks as Array<{ severity: string; issue: string }> | undefined) ?? [];
    at.checks = [...checks, { severity: "high", issue: `AS-IS step ${s.step_number} (${s.step_name ?? "step"}) is required by law (${rule}) but was removed — keep it, digitalized.` }];
    log.analyze(`tobe-generate: legally required AS-IS step ${s.step_number} was dropped — flagged`);
  }
}

/** A best practice is shown only with the web page it was taken from */
function keepWebBestPractice<T extends { sources: Array<{ n: number; kind: string }> }>(steps: T[]): T[] {
  return steps.map((t) => {
    const bp = String((t as Record<string, unknown>).best_practice ?? "");
    const fromWeb = [...bp.matchAll(/\[(\d+)\]/g)].some((m) => t.sources.some((src) => src.n === Number(m[1]) && src.kind === "web"));
    return bp && !fromWeb ? { ...t, best_practice: "" } : t;
  });
}

/** ছক-৫ (problems; the user's own when they edited it), ছক-৬ (mapping) and the documents' TO-BE status */
function parseSheets(raw: TobeAnswer, sps: Sps): { problems: SpsProblem[]; mapping: SpsMapping[]; documents: SpsDocument[] } {
  const plain = (t: unknown) => String(t ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim();
  const aspectKeys = new Set(SPS_ASPECTS.map((a) => a.key));
  const problems: SpsProblem[] = sps.problems_edited && sps.problems?.length ? sps.problems
    : (raw.problems ?? []).flatMap((r) => {
        const [aspect, problem, demand, proposal, rationale] = Array.isArray(r) ? r : [];
        return aspectKeys.has(String(aspect)) ? [{ aspect: String(aspect), problem: plain(problem), demand: plain(demand), proposal: plain(proposal), rationale: plain(rationale) }] : [];
      });
  const mapping: SpsMapping[] = (raw.mapping ?? []).flatMap((r) => {
    const [asisN, tobeN, disposition, reason] = Array.isArray(r) ? r : [];
    const d = String(disposition);
    if (!Number(asisN) || !["kept", "merged", "removed"].includes(d)) return [];
    return [{ asis: Number(asisN), tobe: Number(tobeN) || null, disposition: d as SpsMapping["disposition"], reason: plain(reason) }];
  });
  const docStatus = new Map((raw.documents ?? []).flatMap((r) => {
    const [name, status] = Array.isArray(r) ? r : [];
    return ["submit", "auto", "removed"].includes(String(status)) ? [[String(name).trim().toLowerCase(), String(status) as SpsDocument["tobe"]]] : [];
  }));
  const documents = (sps.documents ?? []).map((d) => ({ ...d, tobe: docStatus.get(d.name.trim().toLowerCase()) ?? d.tobe }));
  return { problems, mapping, documents };
}

/**
 * Which AS-IS steps each TO-BE step came from, also by their fixed uid: the numbers shift
 * when the user later deletes or adds AS-IS steps, the uids do not (Compare table)
 */
function linkAsisUids(projectId: string, tobeSteps: Array<Record<string, unknown>>) {
  const asisByNumber = new Map(loadAsis(projectId).steps.map((st) => [Number(st.step_number), st.uid]));
  for (const t of tobeSteps) {
    const nums = (Array.isArray(t.merged_from) ? t.merged_from : String(t.merged_from ?? "").split(/[^\d]+/))
      .map(Number).filter((n) => Number.isInteger(n) && n > 0);
    t.merged_from = nums;
    t.merged_from_uids = nums.map((n) => asisByNumber.get(n)).filter(Boolean);
  }
}
