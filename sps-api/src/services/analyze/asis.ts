import Anthropic from "@anthropic-ai/sdk";
import { db, docsSignature } from "../../db/index";
import { ensureProjectIngested } from "../ingest";
import { DocSession, runDocAgent } from "../doc-agent";
import { memoryBlock } from "../memory";
import { runStreamed } from "../stream-call";
import { WEB_SEARCH, WEB_FETCH } from "../web-tools";
import { acceptedWebSources, acceptedSourcesBlock } from "../web-sources";
import { runReview, postConsentCard, projectCountry } from "../review";
import { ensureUids, renumber, toIdMarkers, freezeCitations, CITED_FIELDS, type Step, type Finding } from "../asis-state";
import { updateSps } from "../sps";
import { collectWebResults, validateWebSources, finalizeCitations, extractJsonObject, attachQuotes, type KnownSource } from "../sources";
import { syncActive, activeInfo } from "../versions";
import { ANTHROPIC_MODEL } from "../../config";
import { log } from "../../utils/log";
import { asisSystem, asisAgentSystem } from "./prompts";
import { rows, withLabel, normalizeSteps, ASIS_KEYS, LOCKED_ASIS } from "./steps";
import { normalizeWebMarkers, blockSummary, logFailure } from "./diagnostics";

type Emit = (data: object) => void;

export interface AsisRequest { input: string; project_id?: string; url?: string; query?: string; review?: boolean }

/** Where this AS-IS comes from: the uploaded documents first, else the web */
interface AsisContext {
  body: AsisRequest;
  emit: Emit;
  country: string;
  session: DocSession | null;
  docsFirst: boolean;
  fetchUrl: string | undefined;
  /** sites the user accepted on the Knowledge page: citable as they are, never a proposal again */
  acceptedUrls: string[];
  acceptedBlock: string;
  /** the user chose the web sources: the process comes from their files and those sites only */
  chosenOnly: boolean;
}

/** Map the AS-IS (documents first, web for gaps), save it, then review it */
export async function mapAsis(body: AsisRequest, emit: Emit): Promise<void> {
  const lock = body.project_id ? activeInfo(body.project_id) : null;
  if (lock?.asis_locked) { emit({ type: "error", message: LOCKED_ASIS(lock.version) }); return; }
  if (body.project_id) {
    emit({ type: "progress", text: "Preparing uploaded documents…" });
    await ensureProjectIngested(body.project_id);
  }
  const ctx = asisContext(body, emit);
  log.analyze(`asis  project=${body.project_id ?? "none"}  docs=${ctx.session?.docs.length ?? 0}  country=${ctx.country}  url=${ctx.fetchUrl ?? "-"}  query=${body.query ?? "-"}`);
  emit({ type: "progress", text: ctx.docsFirst ? `Reading ${ctx.session!.docs.length} uploaded document(s)…` : "Researching the process online…" });

  let pass = await mapOnce(ctx);
  // Web-only runs fail now and then (a search that returns nothing usable, a source URL the
  // model wrote differently from the result, a cut-off answer): try once more before giving up
  if (pass.error && !ctx.docsFirst) {
    log.analyze(`asis web-only: first pass failed (${pass.error}) — retrying once`);
    emit({ type: "progress", text: "No usable web sources yet — searching again…" });
    emit({ type: "restart" });
    pass = await mapOnce(ctx, ctx.chosenOnly
      ? "IMPORTANT: the previous attempt could not be used. Build the steps from the accepted web sources below and cite them as [W1], [W2]… — in \"sources\", list each with its exact URL."
      : "IMPORTANT: the previous attempt could not be used because its steps were not backed by real search results. " +
        "You MUST call web_search first. In \"sources\", list only URLs copied exactly, character for character, from the search results you received, and cite them in the steps as [W1], [W2]…",
    );
  }
  if (pass.error) {
    emit({ type: "error", message: pass.error });
    return;
  }

  const { steps: kept, findings } = ctx.docsFirst
    ? splitWebProposals(pass.steps, ctx.acceptedUrls)
    : { steps: pass.steps.map((s) => (String(s.pain_points ?? "").trim() ? { ...s, field_sources: { pain_points: "web" as const } } : s)), findings: [] };
  let steps = kept;
  log.analyze(`asis done  steps=${steps.length}  proposed-steps=${findings.length}`);

  if (body.project_id) {
    saveAsis(body.project_id, steps, findings);
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
}

/** Review the AS-IS again ("Review now" / "Review again") */
export async function reviewAsis(projectId: string, emit: Emit): Promise<void> {
  const lock = activeInfo(projectId);
  if (lock?.asis_locked) { emit({ type: "error", message: LOCKED_ASIS(lock.version) }); return; }
  const result = await runReview(projectId, emit);
  if (!result) {
    emit({ type: "error", message: "The review did not return results. Please try again." });
    return;
  }
  emit({ type: "done", text: JSON.stringify({ steps: result.steps }) });
}

function asisContext(body: AsisRequest, emit: Emit): AsisContext {
  // Uploaded documents are the primary source when present: the agent searches and reads
  // them page by page; the web only fills gaps they leave
  const session = body.project_id ? new DocSession(body.project_id, emit) : null;
  const docsFirst = !!session?.projectDocCount;
  const acceptedUrls = body.project_id ? acceptedWebSources(body.project_id).map((s) => s.url) : [];
  return {
    body, emit, session, docsFirst, acceptedUrls,
    country: body.project_id ? projectCountry(body.project_id) : "Bangladesh",
    fetchUrl: docsFirst ? undefined : body.url?.trim() || undefined,
    acceptedBlock: body.project_id ? acceptedSourcesBlock(body.project_id) : "",
    chosenOnly: acceptedUrls.length > 0,
  };
}

type Pass = { steps: Step[]; error?: string };

/** One mapping pass: the cited steps (guardrail applied), or why there are none */
async function mapOnce(ctx: AsisContext, retryNote = ""): Promise<Pass> {
  const { body, emit, session, docsFirst, fetchUrl, acceptedUrls } = ctx;
  const { content, all: allBlocks, stop } = docsFirst ? await callDocAgent(ctx) : await callWeb(ctx, retryNote);

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
    ...validateWebSources(parsed.sources, retrieved, [...(fetchUrl ? [fetchUrl] : []), ...acceptedUrls], (miss) => misses.push(miss)),
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
}

type ModelResult = { content: Anthropic.ContentBlock[]; all: Anthropic.ContentBlock[]; stop: string | null };

/** The uploaded documents, searched and read page by page; the web only for gaps */
function callDocAgent(ctx: AsisContext): Promise<ModelResult> {
  const { body, emit, session, country } = ctx;
  return runDocAgent({
    label: "asis",
    model: ANTHROPIC_MODEL,
    system: asisAgentSystem(country),
    prompt: `${body.input}\n\nCountry: ${country}\n\n${session!.catalogue()}${ctx.acceptedBlock}${memoryBlock(body.project_id)}`,
    session: session!,
    webSearch: WEB_SEARCH,
    webSearchBudget: ctx.chosenOnly ? 0 : 2,
    maxTokens: 16000,          // a full process map can have 40+ steps
    emit,
    onText: (t) => emit({ type: "text", text: t }),
  });
}

/** No documents: web search, or only the sites the user accepted */
async function callWeb(ctx: AsisContext, retryNote: string): Promise<ModelResult> {
  const { body, emit, country, fetchUrl, chosenOnly } = ctx;
  const tools: unknown[] = chosenOnly
    ? [{ ...WEB_FETCH, max_uses: Math.min(ctx.acceptedUrls.length, 4) }]
    : [{ ...WEB_SEARCH, max_uses: retryNote ? 3 : 2 }];
  if (fetchUrl && !chosenOnly) tools.push(WEB_FETCH);
  const request = [
    body.input,
    `Country: ${country}`,
    chosenOnly ? "Map the process ONLY from the web sources the user accepted (listed below) — do not look for other sites. Read a page with web_fetch when its facts are missing or too thin." : "",
    body.query ? `Search focus: ${body.query}` : "",
    fetchUrl ? `Read this page first with web_fetch and base the process on it: ${fetchUrl}\nIf it cannot be read, find the same page or site with web_search and cite that result.` : "",
    retryNote,
  ].filter(Boolean).join("\n\n") + ctx.acceptedBlock + memoryBlock(body.project_id);
  const result = await runStreamed({
    label: "asis",
    model: ANTHROPIC_MODEL,
    system: asisSystem(country),
    messages: [{ role: "user", content: request }],
    maxTokens: 16000,          // 8000 cut long processes off mid-JSON
    tools,
    betas: fetchUrl || chosenOnly ? ["web-fetch-2025-09-10"] : undefined,
    emit,
    onText: (t) => emit({ type: "text", text: t }),
  });
  return { ...result, all: result.content };
}

/**
 * With documents, a step no document supports (found on the web) is a proposal the user
 * must accept in the chat rail — it is not part of the AS-IS until then.
 */
function splitWebProposals(steps: Step[], acceptedUrls: string[]): { steps: Step[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const kept: Step[] = [];
  for (const s of steps) {
    const kinds = new Set((s.sources ?? []).map((src) => src.kind));
    if (kinds.has("doc")) {
      kept.push({ ...s, ...(String(s.pain_points ?? "").trim() ? { field_sources: { pain_points: "doc" as const } } : {}) });
      continue;
    }
    // no source at all: kept as it is (its details stay empty where nothing was found)
    if (!kinds.size) { kept.push(s); continue; }
    // only sites the user already accepted on the Knowledge page: no second approval
    if ((s.sources ?? []).every((src) => src.kind === "web" && acceptedUrls.includes(src.url))) { kept.push(s); continue; }
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
  return { steps: renumber(kept), findings };
}

/**
 * A new AS-IS starts afresh: a fresh review (old findings and questions belong to the old
 * steps) and no TO-BE yet — the old TO-BE was designed from the old AS-IS. Approved
 * AS-IS / TO-BE versions stay in Outputs.
 */
function saveAsis(projectId: string, steps: Step[], findings: Finding[]) {
  db.query("UPDATE projects SET asis_steps = ?, asis_findings = ?, asis_review = NULL, asis_gaps = '[]', asis_docs_sig = ?, tobe_steps = '[]', status = 'asis_complete', updated_at = unixepoch() WHERE id = ?")
    .run(JSON.stringify(steps), JSON.stringify(findings), docsSignature(projectId), projectId);
  updateSps(projectId, { mapping: [] });
  syncActive(projectId);   // the first AS-IS of a project becomes its version 1
}
