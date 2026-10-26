import Anthropic from "@anthropic-ai/sdk";
import { db, docsSignature } from "../db/index";
import { ensureProjectIngested } from "../services/ingest";
import { DocSession, runDocAgent } from "../services/doc-agent";
import { memoryBlock } from "../services/memory";
import { runStreamed } from "../services/stream-call";
import { WEB_SEARCH, WEB_FETCH } from "../services/web-tools";
import { runReview, postConsentCard, projectCountry } from "../services/review";
import { ensureUids, renumber, toIdMarkers, freezeCitations, loadAsis, CITED_FIELDS, type Step, type Finding } from "../services/asis-state";
import { SPS_GUIDE, SPS_ASPECTS } from "../services/sps-guide";
import { getSps, updateSps, spsPromptBlock } from "../services/sps";
import type { SpsDocument, SpsMapping, SpsProblem } from "../services/sps-calc";
import { collectWebResults, validateWebSources, finalizeCitations, extractJsonObject, attachQuotes, QUOTE_RULE, type KnownSource } from "../services/sources";
import { ANTHROPIC_MODEL } from "../config";
import { streamSse, streamJob } from "../utils/sse";
import { json } from "../utils/cors";
import { log } from "../utils/log";
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "../config";
import { activeInfo, syncActive } from "../services/versions";

// An approved AS-IS / TO-BE is never changed in place: the page makes a new version first
const LOCKED_ASIS = (v: number) => `AS-IS version ${v} is approved and can't be changed. Create a new version to change it.`;
const LOCKED_TOBE = (v: number) => `TO-BE version ${v} is approved and can't be changed. Create a new version to change it.`;

export async function handleAnalyze(req: Request, url: URL): Promise<Response> {
  const method = req.method.toUpperCase();

  // ── AI: Map the AS-IS (documents first, web for gaps), then review it ──────

  if (method === "POST" && url.pathname === "/api/analyze/asis") {
    const body = await req.json() as { input: string; project_id?: string; url?: string; query?: string; review?: boolean };
    return streamJob(body.project_id ?? `adhoc-${Date.now()}`, "asis", async (emit) => {
      const lock = body.project_id ? activeInfo(body.project_id) : null;
      if (lock?.asis_locked) { emit({ type: "error", message: LOCKED_ASIS(lock.version) }); return; }
      if (body.project_id) {
        emit({ type: "progress", text: "Preparing uploaded documents…" });
        await ensureProjectIngested(body.project_id);
      }
      const country = body.project_id ? projectCountry(body.project_id) : "Bangladesh";
      // Uploaded documents are the primary source when present: the agent searches and reads
      // them page by page; the web only fills gaps they leave
      const session = body.project_id ? new DocSession(body.project_id, emit) : null;
      const docsFirst = !!session?.projectDocCount;
      const fetchUrl = docsFirst ? undefined : body.url?.trim() || undefined;
      log.analyze(`asis  project=${body.project_id ?? "none"}  docs=${session?.docs.length ?? 0}  country=${country}  url=${fetchUrl ?? "-"}  query=${body.query ?? "-"}`);
      emit({ type: "progress", text: docsFirst ? `Reading ${session!.docs.length} uploaded document(s)…` : "Researching the process online…" });

      // One mapping pass: the cited steps (guardrail applied), or why there are none
      type Pass = { steps: Step[]; error?: string };
      const mapOnce = async (retryNote = ""): Promise<Pass> => {
        let content: Anthropic.ContentBlock[];
        let allBlocks: Anthropic.ContentBlock[];
        let stop: string | null;
        if (docsFirst) {
          const result = await runDocAgent({
            label: "asis",
            model: ANTHROPIC_MODEL,
            system: asisAgentSystem(country),
            prompt: `${body.input}\n\nCountry: ${country}\n\n${session!.catalogue()}${memoryBlock(body.project_id)}`,
            session: session!,
            webSearch: WEB_SEARCH,
            webSearchBudget: 2,
            maxTokens: 16000,          // a full process map can have 40+ steps
            emit,
            onText: (t) => emit({ type: "text", text: t }),
          });
          ({ content, all: allBlocks, stop } = result);
        } else {
          const tools: unknown[] = [{ ...WEB_SEARCH, max_uses: retryNote ? 3 : 2 }];
          if (fetchUrl) tools.push(WEB_FETCH);
          const request = [
            body.input,
            `Country: ${country}`,
            body.query ? `Search focus: ${body.query}` : "",
            fetchUrl ? `Read this page first with web_fetch and base the process on it: ${fetchUrl}\nIf it cannot be read, find the same page or site with web_search and cite that result.` : "",
            retryNote,
          ].filter(Boolean).join("\n\n") + memoryBlock(body.project_id);
          const result = await runStreamed({
            label: "asis",
            model: ANTHROPIC_MODEL,
            system: asisSystem(country),
            messages: [{ role: "user", content: request }],
            maxTokens: 16000,          // 8000 cut long processes off mid-JSON
            tools,
            betas: fetchUrl ? ["web-fetch-2025-09-10"] : undefined,
            emit,
            onText: (t) => emit({ type: "text", text: t }),
          });
          ({ content, stop } = result);
          allBlocks = content;
        }

        const allText = content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
        log.analyze(`asis output  chars=${allText.length}  before-json=${Math.max(0, allText.indexOf("{"))}  blocks=${content.map((b) => {
          const r = b as unknown as { type: string; content?: { type?: string; error_code?: string } };
          return r.type === "web_fetch_tool_result" || r.type === "web_search_tool_result" ? `${r.type.split("_")[1]}(${r.content?.error_code ?? (Array.isArray(r.content) ? (r.content as unknown[]).length : r.content?.type ?? "?")})` : r.type;
        }).join(",")}`);
        const raw = extractJsonObject(content) as { steps?: unknown[]; sources?: Array<{ id?: string; url?: string; title?: string }>; quotes?: unknown } | null;
        const parsed = raw ? { ...raw, steps: withLabel(rows(raw.steps, ASIS_KEYS)) } : null;
        if (!parsed?.steps?.length) {
          log.error(`asis: no steps in response (stop=${stop})`);
          logFailure(body.project_id, { pass: retryNote ? 2 : 1, error: "no steps", stop, text: allText.slice(0, 1500), blocks: blockSummary(content) });
          return { steps: [], error: "AI did not return structured steps. Please try again." };
        }
        // web-only: the model sometimes cites "[1]" or "(W1)" instead of "[W1]" — read them as the
        // W-numbered sources it declared (still checked against the real search results below)
        if (!docsFirst) normalizeWebMarkers(parsed.steps as Array<Record<string, unknown>>, parsed.sources);
        const retrieved = collectWebResults(allBlocks);
        const misses: string[] = [];
        const known = new Map<string, KnownSource>([
          ...(docsFirst ? session!.known((fileId) => `/api/projects/${body.project_id}/files/${fileId}/view`) : []),
          ...validateWebSources(parsed.sources, retrieved, fetchUrl ? [fetchUrl] : [], (miss) => misses.push(miss)),
        ]);
        attachQuotes(known, raw?.quotes);
        let steps = ensureUids(normalizeSteps(finalizeCitations(parsed.steps, ["action", "input", "pain_points"], known).items as Step[]));

        // Steps are kept even without a reference (cited ones carry their [n] links). What was
        // not found stays empty — never guessed: an uncited pain point is cleared.
        const cited = (t: unknown) => /\[\d+\]/.test(String(t ?? ""));
        steps = steps.map((s) => (String(s.pain_points ?? "").trim() && !cited(s.pain_points) ? { ...s, pain_points: "" } : s));
        const unsourced = steps.filter((s) => !(s.sources ?? []).length).length;
        if (unsourced) {
          log.analyze(`asis: ${unsourced} of ${steps.length} step(s) without a reference (kept); retrieved web results: ${retrieved.size}; citable sources: ${[...known.keys()].join(", ") || "none"}`);
          if (misses.length) {
            log.analyze(`asis sources not among the search results: ${misses.join(" | ")}  ·  results: ${[...retrieved.values()].slice(0, 8).map((r) => r.url).join(" | ") || "none"}`);
            logFailure(body.project_id, {
              pass: retryNote ? 2 : 1, error: "steps without reference (kept)", unsourced, of: steps.length, blocks: blockSummary(content),
              declared: parsed.sources ?? [], misses, retrieved: [...retrieved.values()].slice(0, 12).map((r) => r.url),
            });
          }
        }
        return { steps };
      };

      let pass = await mapOnce();
      // Web-only runs fail now and then (a search that returns nothing usable, a source URL the
      // model wrote differently from the result, a cut-off answer): try once more before giving up
      if (pass.error && !docsFirst) {
        log.analyze(`asis web-only: first pass failed (${pass.error}) — retrying once`);
        emit({ type: "progress", text: "No usable web sources yet — searching again…" });
        emit({ type: "restart" });
        pass = await mapOnce(
          "IMPORTANT: the previous attempt could not be used because its steps were not backed by real search results. " +
          "You MUST call web_search first. In \"sources\", list only URLs copied exactly, character for character, from the search results you received, and cite them in the steps as [W1], [W2]…",
        );
      }
      if (pass.error) {
        emit({ type: "error", message: pass.error });
        return;
      }
      let steps = pass.steps;

      // With documents, a step no document supports (found on the web) is a proposal
      // the user must accept in the chat rail — it is not part of the AS-IS until then
      const findings: Finding[] = [];
      if (docsFirst) {
        const kept: Step[] = [];
        for (const s of steps) {
          const kinds = new Set((s.sources ?? []).map((src) => src.kind));
          if (kinds.has("doc")) {
            kept.push({ ...s, ...(String(s.pain_points ?? "").trim() ? { field_sources: { pain_points: "doc" as const } } : {}) });
            continue;
          }
          // no source at all: kept as it is (its details stay empty where nothing was found)
          if (!kinds.size) { kept.push(s); continue; }
          const n = findings.length + 1;
          const withIds = toIdMarkers(s);
          const texts = CITED_FIELDS.map((f) => String(withIds.step[f] ?? ""));
          const frozen = freezeCitations(texts, withIds.known, n);
          const proposed: Step = { ...withIds.step, sources: undefined };
          CITED_FIELDS.forEach((f, i) => { if (withIds.step[f] !== undefined) proposed[f] = frozen.texts[i]; });
          findings.push({
            id: `F${n}`, kind: "step", after_uid: kept.length ? kept[kept.length - 1].uid : null, step: proposed,
            sources: frozen.sources, origin: "web", status: "pending", created_at: Math.floor(Date.now() / 1000),
          });
        }
        steps = renumber(kept);
      } else {
        steps = steps.map((s) => (String(s.pain_points ?? "").trim() ? { ...s, field_sources: { pain_points: "web" as const } } : s));
      }
      log.analyze(`asis done  steps=${steps.length}  proposed-steps=${findings.length}`);

      if (body.project_id) {
        // a new AS-IS starts afresh: a fresh review (old findings and questions belong to the old
        // steps) and no TO-BE yet — the old TO-BE was designed from the old AS-IS. Approved
        // AS-IS / TO-BE versions stay in Outputs.
        db.query("UPDATE projects SET asis_steps = ?, asis_findings = ?, asis_review = NULL, asis_gaps = '[]', asis_docs_sig = ?, tobe_steps = '[]', status = 'asis_complete', updated_at = unixepoch() WHERE id = ?")
          .run(JSON.stringify(steps), JSON.stringify(findings), docsSignature(body.project_id), body.project_id);
        updateSps(body.project_id, { mapping: [] });
        syncActive(body.project_id);   // the first AS-IS of a project becomes its version 1
        // the mapped steps (as saved) — shown while the review fills in their columns
        emit({ type: "asis_saved", steps });

        // Review right away: pain point, digital status and law for every step
        if (body.review !== false) {
          const reviewed = await runReview(body.project_id, emit);
          if (reviewed) steps = reviewed.steps;
          else postConsentCard(body.project_id);
        } else {
          postConsentCard(body.project_id);
        }
      }
      emit({ type: "done", text: JSON.stringify({ steps }), saved: !!body.project_id });
    });
  }

  // ── AI: Review the AS-IS again ("Review now" / "Review again") ─────────────

  if (method === "POST" && url.pathname === "/api/analyze/asis-review") {
    const body = await req.json() as { project_id: string };
    return streamJob(body.project_id, "asis", async (emit) => {
      const lock = activeInfo(body.project_id);
      if (lock?.asis_locked) { emit({ type: "error", message: LOCKED_ASIS(lock.version) }); return; }
      const result = await runReview(body.project_id, emit);
      if (!result) {
        emit({ type: "error", message: "The review did not return results. Please try again." });
        return;
      }
      emit({ type: "done", text: JSON.stringify({ steps: result.steps }) });
    });
  }

  // ── AI: Generate TO-BE from the approved AS-IS, the guideline's way ─────────
  //
  // One call produces the problem/proposal analysis of the 20 aspects (ছক-৫), the TO-BE
  // steps (with type, visit, fee, time), what happened to every AS-IS step (ছক-৬) and which
  // documents the citizen still submits (ছক-৩). TCVQ (ছক-৭) and the SPS checks are then
  // computed from these in code.

  if (method === "POST" && url.pathname === "/api/analyze/tobe") {
    const body = await req.json() as { project_id: string };
    return streamJob(body.project_id, "tobe", async (emit) => {
      const lock = activeInfo(body.project_id);
      if (lock?.tobe_locked) { emit({ type: "error", message: LOCKED_TOBE(lock.version) }); return; }
      const project = db.query("SELECT name, description, goal FROM projects WHERE id = ?").get(body.project_id) as { name: string; description: string; goal: string | null } | null;
      if (!project) { emit({ type: "error", message: "Project not found." }); return; }
      const country = projectCountry(body.project_id);
      const sps = getSps(body.project_id);
      // asis_steps holds only confirmed information (documents, the user, accepted web findings)
      const { steps: asis } = loadAsis(body.project_id);
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
        };
      });
      const sourceList = [...known].map(([id, s]) => `[${id}] ${s.title}`).join("\n") || "(none)";
      const userProblems = sps.problems_edited && sps.problems?.length
        ? `\n\nPROBLEM ANALYSIS (Sheet-5) — written by the user; keep it as it is and design the TO-BE from it:\n${JSON.stringify(sps.problems)}`
        : "";

      emit({ type: "progress", text: `Analysing the 20 SPS aspects and designing the TO-BE from ${asis.length} approved AS-IS steps…` });
      log.analyze(`tobe-generate  project=${body.project_id}  asis=${compactSteps.length}  sources=${known.size}  docs=${sps.documents?.length ?? 0}`);
      const result = await runStreamed({
        label: "tobe-generate",
        model: ANTHROPIC_MODEL,
        system: tobeSystem(country),
        messages: [{
          role: "user",
          content: `LANGUAGE: write every text (problems, steps, mapping reasons) in ${stepsLanguage(asis)}.\n\nService: ${project.name}${project.description ? ` — ${project.description}` : ""}${project.goal ? `\nGoal of the simplification (design the TO-BE to reach it): ${project.goal}` : ""}\nCountry: ${country}\n\nApproved AS-IS steps (confirmed by the user):\n${JSON.stringify(compactSteps)}\n\nCitable sources:\n${sourceList}${spsPromptBlock(body.project_id)}${userProblems}${memoryBlock(body.project_id)}`,
        }],
        maxTokens: 16000,
        emit,
        onText: (t) => emit({ type: "text", text: t }),
      });

      const raw = extractJsonObject(result.content) as { problems?: unknown[]; tobe_steps?: unknown[]; mapping?: unknown[]; documents?: unknown[] } | null;
      const parsed = raw ? { tobe_steps: normalizeSteps(withLabel(rows(raw.tobe_steps, TOBE_KEYS))) } : null;
      if (!parsed?.tobe_steps?.length) {
        log.error(`tobe-generate: no steps (stop=${result.stop})`);
        emit({ type: "error", message: "AI did not return structured TO-BE steps. Please try again." });
        return;
      }
      const { items: tobe_steps, sources } = finalizeCitations(parsed.tobe_steps, ["action", "simplification_rationale", "legal_basis"], known);

      // ছক-৫, ছক-৬ and the documents' TO-BE status
      const plain = (t: unknown) => String(t ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim();
      const aspectKeys = new Set(SPS_ASPECTS.map((a) => a.key));
      const problems: SpsProblem[] = sps.problems_edited && sps.problems?.length ? sps.problems
        : (raw?.problems ?? []).flatMap((r) => {
            const [aspect, problem, demand, proposal, rationale] = Array.isArray(r) ? r : [];
            return aspectKeys.has(String(aspect)) ? [{ aspect: String(aspect), problem: plain(problem), demand: plain(demand), proposal: plain(proposal), rationale: plain(rationale) }] : [];
          });
      const mapping: SpsMapping[] = (raw?.mapping ?? []).flatMap((r) => {
        const [asisN, tobeN, disposition, reason] = Array.isArray(r) ? r : [];
        const d = String(disposition);
        if (!Number(asisN) || !["kept", "merged", "removed"].includes(d)) return [];
        return [{ asis: Number(asisN), tobe: Number(tobeN) || null, disposition: d as SpsMapping["disposition"], reason: plain(reason) }];
      });
      const docStatus = new Map((raw?.documents ?? []).flatMap((r) => {
        const [name, status] = Array.isArray(r) ? r : [];
        return ["submit", "auto", "removed"].includes(String(status)) ? [[String(name).trim().toLowerCase(), String(status) as SpsDocument["tobe"]]] : [];
      }));
      const documents = (sps.documents ?? []).map((d) => ({ ...d, tobe: docStatus.get(d.name.trim().toLowerCase()) ?? d.tobe }));
      updateSps(body.project_id, { problems, mapping, documents });
      log.analyze(`tobe-generate done  steps=${tobe_steps.length}  sources=${sources.length}  problems=${problems.length}  mapping=${mapping.length}`);

      // Which AS-IS steps each TO-BE step came from, also by their fixed uid: the numbers shift
      // when the user later deletes or adds AS-IS steps, the uids do not (Compare table)
      const asisByNumber = new Map(loadAsis(body.project_id).steps.map((st) => [Number(st.step_number), st.uid]));
      for (const t of tobe_steps as Array<Record<string, unknown>>) {
        const nums = (Array.isArray(t.merged_from) ? t.merged_from : String(t.merged_from ?? "").split(/[^\d]+/))
          .map(Number).filter((n) => Number.isInteger(n) && n > 0);
        t.merged_from = nums;
        t.merged_from_uids = nums.map((n) => asisByNumber.get(n)).filter(Boolean);
      }

      db.query("UPDATE projects SET tobe_steps = ?, status = 'tobe_complete', updated_at = unixepoch() WHERE id = ?")
        .run(JSON.stringify(tobe_steps), body.project_id);
      syncActive(body.project_id);
      emit({ type: "done", text: JSON.stringify({ tobe_steps }), saved: true });
    });
  }

  // ── AI: Draft the implementation plan (strategic plan + time-based work plan) ──

  if (method === "POST" && url.pathname === "/api/analyze/sps-plan") {
    const body = await req.json() as { project_id: string };
    return streamSse(async (emit) => {
      const p = db.query("SELECT name, description, tobe_steps FROM projects WHERE id = ?").get(body.project_id) as { name: string; description: string; tobe_steps: string } | null;
      if (!p) { emit({ type: "error", message: "Project not found." }); return; }
      const sps = getSps(body.project_id);
      const tobe = (JSON.parse(p.tobe_steps || "[]") as Array<Record<string, unknown>>).map((s) => `${s.step_number}. ${String(s.action ?? "").replace(/\[[^\]]*\]/g, "")}`);
      emit({ type: "progress", text: "Drafting the implementation plan…" });
      const result = await runStreamed({
        label: "sps-plan",
        model: ANTHROPIC_MODEL,
        system: `${SPS_GUIDE}

You draft the implementation plan of an approved SPS proposal, in the format of the guideline's sample: a strategic plan and a time-based work plan over the coming fiscal year (July to June).
Answer with ONLY this JSON object:
{"challenges":"…","measures":"…","publicity":"…","monitoring":"…","workplan":[["Activity",["Jul","Aug"]]]}
- challenges: what makes it hard (law/rule changes, system development, server integration, staff mindset and skills). measures: how they are handled. publicity: how citizens and stakeholders are informed. monitoring: who monitors. Each 1–3 sentences.
- workplan: 8–12 activities in order (working-group meeting, new process map, procurement / system development, integration and interoperability, piloting, training, office order, citizen charter update, documentation, sending evidence to the ministry SPS committee), each with the months it runs (Jul, Aug, Sep, Oct, Nov, Dec, Jan, Feb, Mar, Apr, May, Jun).
- Write every text in the LANGUAGE given in the request.`,
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
      updateSps(body.project_id, { plan });
      emit({ type: "done", text: JSON.stringify({ plan }) });
    });
  }

  return json({ error: "not_found" }, 404);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// The model writes compact rows to save output tokens (= time); expand them here.
function rows<T extends Record<string, unknown>>(list: unknown, keys: string[]): T[] {
  if (!Array.isArray(list)) return [];
  return list.map((r) => {
    if (!Array.isArray(r)) return r as T;           // tolerate object form too
    const o: Record<string, unknown> = {};
    keys.forEach((k, i) => { if (r[i] !== undefined && r[i] !== "") o[k] = r[i]; });
    return o as T;
  });
}
// Ensure every action starts with a short bold-able label ("Label: sentence")
function withLabel<T extends Record<string, unknown>>(steps: T[]): T[] {
  return steps.map((s) => {
    const action = String(s.action ?? "").replace(/^(action|label)\s*:\s*/i, "");
    const colon = action.indexOf(":");
    const hasLabel = colon > 0 && colon <= 40 && !/\[\w+\]/.test(action.slice(0, colon));
    return { ...s, action: hasLabel ? action : `${s.step_name ?? "Step"}: ${action}` };
  });
}
const ASIS_KEYS = ["step_number", "step_name", "actor", "action", "input", "time_days", "pain_points", "step_type", "visit", "fee", "no_goto"];
const TOBE_KEYS = ["step_number", "step_name", "actor", "action", "channel", "time_days", "merged_from", "simplification_rationale", "legal_basis", "step_type", "visit", "fee", "no_goto"];

/** The language of a process: Bangla when most steps are written in Bangla, else English */
function stepsLanguage(steps: Array<Record<string, unknown>>): "Bangla" | "English" {
  const bangla = steps.filter((s) => /[\u0980-\u09FF]/.test(String(s.action ?? ""))).length;
  return steps.length && bangla / steps.length > 0.5 ? "Bangla" : "English";
}

// The guideline's step fields: type (activity / decision / document / message), visit (the
// citizen comes in person), fee (taka), time in working days, and for a decision the step
// "No" goes back to.
const STEP_TYPES = ["activity", "decision", "document", "message"];
function normalizeSteps<T extends Record<string, unknown>>(steps: T[]): T[] {
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

// ── Prompts ───────────────────────────────────────────────────────────────────

const CITE_RULES = `Citations: end a sentence with a marker for the source that supports it — [D1] for uploaded document 1, [W1] for web page 1. Only cite documents/pages you actually read; never invent URLs. Cite every step you can. NEVER GUESS: when a detail (input, time, fee, pain point…) is not in your sources, leave that field empty (or null) — an empty field is better than an invented one. A step you know from the process but cannot cite is kept without a marker.`;

const asisSystem = (country: string) => `${SPS_GUIDE}

You map the current (AS-IS) process of a ${country} government service for SPS (Service Process Simplification) analysis.

Use web_search to find the official procedure — run your searches at once, with specific queries (official portal, gazette, circular). Do not write any text before or between searches.

Answer with ONLY this JSON object — no text before or after it, no markdown:
{"sources":[{"id":"W1","title":"short page title","url":"https://exact-url-from-search"}],
 "steps":[[1,"Submit Application","Citizen","Online Submission: Citizen fills the online form and uploads NID and photo [W1]","NID, photo",1,"Portal slow at peak hours","document",0,0,null]],
 "quotes":[["W1","Applicants fill in the online form and upload a copy of the NID"]]}
Each step is one array: [step_number, step_name, actor, action, input (max 4 words), time_days, pain_points (max 7 words, or empty), step_type, visit, fee, no_goto].
- actor = the performer (P): the designation doing the step (e.g. "Desk officer", "Upazila Nirbahi Officer", "Applicant").
- action = a 2-3 word label, a colon, then one sentence of at most 13 words.
- time_days = T: working days the step takes (number; 0 for the same day; null if unknown).
- step_type = activity | decision (approve / reject / verify) | document (papers are attached or submitted) | message (letter / SMS / notice is sent).
- visit = 1 when the citizen must come to an office in person for this step, else 0. fee = taka the citizen pays at this step (0 if none).
- no_goto = for a decision: the step number a "No" goes back to (else null).

Rules:
- 8 to 10 steps, in order, including waiting/approval steps that matter.
- "sources": at most 3 web pages (W ids), only ones you cite. Prefer official government pages of ${country}.
- ${QUOTE_RULE}
- ${CITE_RULES}
- Be terse. No extra fields.`;

const asisAgentSystem = (country: string) => `${SPS_GUIDE}

You map the current (AS-IS) process of a ${country} government service for SPS (Service Process Simplification) analysis.

The user's uploaded documents are your primary source. You only know what is in them by looking:
- search_documents finds the pages that match a question or keywords. Run several focused searches — the application procedure, required documents and inputs, processing times, offices and approvals — in English and in the local language.
- read_pages reads pages (up to 5 per call). Read the pages your searches point to, and neighbouring pages when a procedure continues. Documents marked NOT searchable must be read directly, starting from their first pages. A short document (a few pages) can simply be read in full.
- Call independent tools together in one turn. Search first; never read a long report page by page from the start.
Base the process on what you read. Do not guess.

When the documents clearly leave out a step the process needs, you may use web_search (when offered) on official ${country} sources to find it. A step you take from the web is shown to the user as a proposal for their confirmation, so cite it. Never use the web to replace or contradict the documents. (Pain points, digital status and laws for each step are checked in a separate review — do not search for them now.)

When you have enough, answer with ONLY this JSON object — no text before or after it, no markdown:
{"sources":[{"id":"W1","title":"short page title","url":"https://exact-url-from-search"}],
 "steps":[[1,"Submit Application","Citizen","Online Submission: Citizen fills the online form and uploads NID and photo [D1:4]","NID, photo",1,"Portal slow at peak hours [D1:4]","document",0,0,null],[6,"File Approval","Office head","Approval: Office head approves or returns the file [D1:5]","",1,"","decision",0,0,4]],
 "quotes":[["D1:4","The applicant shall submit the online form with a copy of the National ID and a photograph"],["D1:5","The Director shall approve or return the file"]]}
Each step is one array: [step_number, step_name, actor, action, input (max 4 words), time_days, pain_points (max 7 words, or empty), step_type, visit, fee, no_goto].
- actor = the performer (P): the designation doing the step (e.g. "Desk officer", "Upazila Nirbahi Officer", "Applicant").
- action = a 2-3 word label, a colon, then one sentence of at most 13 words.
- time_days = T: working days the step takes (number; 0 for the same day; null if unknown).
- step_type = activity | decision (approve / reject / verify) | document (papers are attached or submitted) | message (letter / SMS / notice is sent).
- visit = 1 when the citizen must come to an office in person for this step, else 0. fee = taka the citizen pays at this step (0 if none).
- no_goto = for a decision: the step number a "No" goes back to (else null).

Rules:
- If a document already contains a step-by-step process map or step table (numbered steps, a "Seq"/"Step" column, BPMN-style rows), it IS the AS-IS: read every part of it (all its sections/pages) and output EVERY step, one row per step, in the same order — do not merge, drop, summarise or renumber away steps. Keep exception and recurring steps too. Use the other documents only to fill in or cite details.
- Otherwise: the steps the documents describe, in order (usually 8 to 20), including waiting/approval steps that matter.
- Cite every action with the page it came from: [D1:4] = document D1, page 4. Cite only pages you read with read_pages or saw in search_documents results — every step needs one. Web pages: [W1].
- "sources": only web pages (W ids) you cite. [] if you did not search the web.
- ${QUOTE_RULE}
- Be terse. No extra fields.`;

const tobeSystem = (country: string) => `${SPS_GUIDE}

You design the simplified TO-BE process for a ${country} government service.
The AS-IS steps you get are approved by the user: their pain point, digital status, law / regulation, time (days), visits and fees are confirmed. Base the redesign on them, on the SPS DATA (citizen feedback, service profile, documents) and on the project memory.

Work in this order:
1. PROBLEM ANALYSIS (Sheet-5): go through each of the 20 aspects — ${SPS_ASPECTS.map((a) => a.key).join(", ")} — and for each one that applies give the problem, the citizen's demand, your proposal and its rationale (what it saves: time, visits, cost, papers). Skip aspects with no problem. (If the user gave a PROBLEM ANALYSIS, use theirs and output "problems":[].)
2. TO-BE STEPS from those proposals, following the design rules.
3. MAPPING (Sheet-6): every AS-IS step → the TO-BE step it became, and kept / merged / removed with a reason.
4. DOCUMENTS: for each document in the SPS DATA, whether the citizen still submits it, it is fetched / verified automatically from another office's server, or it is no longer needed.

Answer with ONLY this JSON object — no text before or after it, no markdown:
{"problems":[["form","3-page form and 11 documents","Simple form","1-page form; NID data auto-filled; drop 5 documents","Fewer errors, less hardship"]],
 "tobe_steps":[[1,"Apply Online","Applicant","Online Application: Applicant applies on the portal with NID data auto-filled [S1]","digital",1,[1,2,3],"Same data already held by EC; no paper form needed [S2]","Passport Order 1973 Art.5 [S3]","document",0,0,null],
  [4,"Approval","Office head","Approval: Office head approves online or returns the file [S4]","digital",1,[5,6],"One approval instead of two layers","","decision",0,0,3]],
 "mapping":[[1,1,"merged","Information now on the portal"],[5,0,"removed","Duplicate layer of approval"]],
 "documents":[["NID","auto"],["Photo","submit"],["Character certificate","removed"]]}
problems row: [aspect_key, problem, citizen_demand, proposal, rationale] — each text max 25 words.
tobe_steps row: [step_number, step_name, actor, action, channel (digital|in_person|hybrid), time_days, merged_from (AS-IS step numbers), simplification_rationale (max 14 words), legal_basis (max 8 words, or empty), step_type (activity|decision|document|message), visit (1 if the citizen must come in person, else 0), fee (taka, 0 if none), no_goto (for a decision: the step a "No" returns to)].
mapping row: [asis_step_number, tobe_step_number (0 when removed), "kept"|"merged"|"removed", reason (max 12 words)] — one row for EVERY AS-IS step.
documents row: [document name exactly as in the SPS DATA, "submit"|"auto"|"removed"].
action = a 2-3 word label, a colon, then one sentence of at most 18 words.

Rules:
- Fewer steps, fewer visits (ideally none), fewer working days and less citizen cost than the AS-IS — never just the same process online.
- Time (T) per step in working days, realistic for the new way of working.
- Cite with the source ids from "Citable sources" exactly as given (e.g. [S3]). Cite the law behind every kept legal step and the evidence behind every removal when you have it. Never invent ids.
- Write every text in the LANGUAGE given at the top of the request — never switch language because the guideline uses Bangla terms.
- Keep every field short — no extra fields.`;

// ── AS-IS failure diagnostics ──────────────────────────────────────────────────

/** "[1]" / "(W1)" / "[w1]" → "[W1]" when the model declared W-numbered web sources */
function normalizeWebMarkers(steps: Array<Record<string, unknown>>, sources: Array<{ id?: string }> | undefined) {
  const ids = new Set((sources ?? []).map((x) => String(x.id ?? "").toUpperCase()).filter((x) => /^W\d+$/.test(x)));
  if (!ids.size) return;
  for (const st of steps) {
    for (const f of ["action", "input", "pain_points"]) {
      if (typeof st[f] !== "string") continue;
      st[f] = (st[f] as string)
        .replace(/\(\s*([Ww]\d+(?:\s*,\s*[Ww]\d+)*)\s*\)/g, "[$1]")
        .replace(/\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]/g, (m, nums: string) => {
          const mapped = nums.split(",").map((n) => `W${n.trim()}`);
          return mapped.every((id) => ids.has(id)) ? `[${mapped.join(",")}]` : m;
        })
        .replace(/\[\s*w(\d+)/g, "[W$1");
    }
  }
}

function blockSummary(content: Anthropic.ContentBlock[]): string {
  return content.map((b) => {
    const r = b as unknown as { type: string; content?: unknown };
    if (r.type === "web_search_tool_result") {
      const c = r.content as { error_code?: string } | unknown[];
      return `search(${Array.isArray(c) ? c.length : (c as { error_code?: string })?.error_code ?? "?"})`;
    }
    return r.type;
  }).join(",");
}

/** One JSON line per failed AS-IS pass in data/logs/asis-failures.log — readable later, unlike the terminal */
function logFailure(projectId: string | undefined, detail: Record<string, unknown>) {
  try {
    const dir = join(DATA_DIR, "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "asis-failures.log"), JSON.stringify({ at: new Date().toISOString(), project: projectId ?? null, ...detail }) + "\n");
  } catch (err) {
    log.error(`asis failure log: ${String(err)}`);
  }
}
