import { db } from "../db/index";
import { ensureProjectIngested } from "./ingest";
import { DocSession, runDocAgent } from "./doc-agent";
import { runStreamed } from "./stream-call";
import { memoryBlock } from "./memory";
import { WEB_SEARCH } from "./web-tools";
import { collectWebResults, validateWebSources, extractJsonObject, attachQuotes, finalizeCitations, QUOTE_RULE, type KnownSource } from "./sources";
import {
  loadAsis, saveAsis, renumber, citedKinds, freezeCitations, nextFindingId, normalizeDigital, describeFinding,
  REVIEW_FIELDS, FIELD_LABEL, type Step, type Finding, type Review, type ReviewField,
} from "./asis-state";
import { ANTHROPIC_MODEL } from "../config";
import { SPS_GUIDE, SPS_PROFILE } from "./sps-guide";
import { getSps, updateSps } from "./sps";
import type { SpsDocument } from "./sps-calc";
import { log } from "../utils/log";

// ── AS-IS review ──────────────────────────────────────────────────────────────
//
// Runs after the AS-IS is mapped (and on "Review again"). For every step the agent
// finds the pain point, digital status and law/regulation — documents first, then
// the web for the project's country. Values backed by a document are written to the
// step; values found only on the web (or with no source) become findings that wait
// for the user's consent in the chat rail; what nobody knows becomes a question.

type Emit = (data: object) => void;

export function projectCountry(projectId: string): string {
  const row = db.query("SELECT country FROM projects WHERE id = ?").get(projectId) as { country: string | null } | null;
  return row?.country?.trim() || "Bangladesh";
}

/** "bn" when the user writes Bangla (latest chat message, else the project name/description) */
export function userLanguage(projectId: string): "bn" | "en" {
  const bangla = (t: string | undefined | null) => /[ঀ-৿]/.test(t ?? "");
  const last = db.query("SELECT content FROM chat_messages WHERE project_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1").get(projectId) as { content: string } | null;
  if (last) return bangla(last.content) ? "bn" : "en";
  const p = db.query("SELECT name, description FROM projects WHERE id = ?").get(projectId) as { name: string; description: string } | null;
  return bangla(p?.name) || bangla(p?.description) ? "bn" : "en";
}

const strip = (t: unknown) => String(t ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s+([.,;])/g, "$1").replace(/\s{2,}/g, " ").trim();
const now = () => Math.floor(Date.now() / 1000);

function saveChat(projectId: string, content: string, kind = "text", payload?: object) {
  db.query("INSERT INTO chat_messages (project_id, role, content, mode, pane, kind, payload) VALUES (?, 'assistant', ?, 'chat', 'asis', ?, ?)")
    .run(projectId, content, kind, payload ? JSON.stringify(payload) : null);
}

/** Posts a consent card in the chat rail for every pending finding (none → nothing) */
export function postConsentCard(projectId: string): number {
  const { steps, findings } = loadAsis(projectId);
  const all = findings.filter((f) => f.status === "pending");
  if (!all.length) return 0;
  const lang = userLanguage(projectId);
  const confirm = all.filter((f) => f.origin === "unsourced");
  if (confirm.length) {
    const head = lang === "bn"
      ? `এই ${confirm.length}টি তথ্যের কোনো উৎস (ফাইল বা ওয়েব) পাইনি। এগুলো কি ঠিক? হ্যাঁ / না / বাদ দিন — যেকোনো একটি বেছে নিন।`
      : `I couldn't find a source (your files or the web) for ${confirm.length} value${confirm.length > 1 ? "s" : ""}. ${confirm.length > 1 ? "Are they" : "Is it"} correct? Answer Yes, No or Skip.`;
    const lines = confirm.map((f) => `${f.id} — ${describeFinding(f, steps)}: ${strip(f.value)}${f.digital_note ? ` (${strip(f.digital_note)})` : ""}`);
    saveChat(projectId, `${head}\n${lines.join("\n")}`, "consent", { finding_ids: confirm.map((f) => f.id), lang, mode: "confirm" });
  }
  const pending = all.filter((f) => f.origin !== "unsourced");
  if (!pending.length) return all.length;
  const intro = lang === "bn"
    ? `আপনার আপলোড করা ফাইলে নেই এমন ${pending.length}টি তথ্য আমি ওয়েবে পেয়েছি। এগুলো কি AS-IS-এ ব্যবহার করব? কনফার্ম করুন।`
    : `I found ${pending.length} item${pending.length > 1 ? "s" : ""} on the web that ${pending.length > 1 ? "are" : "is"} not in your uploaded files. Should I use ${pending.length > 1 ? "them" : "it"} in the AS-IS? Please confirm.`;
  // the text is what the model sees in the history; the card is drawn from the payload
  const lines = pending.map((f) => `${f.id} — ${describeFinding(f, steps)}: ${strip(f.kind === "step" ? f.step?.action : f.value)}`);
  saveChat(projectId, `${intro}\n${lines.join("\n")}`, "consent", { finding_ids: pending.map((f) => f.id), lang });
  return all.length;
}

function reviewSystem(country: string, hasDocs: boolean, lang: "bn" | "en"): string {
  const sources = hasDocs
    ? `The user's uploaded documents are the primary source. You only know what is in them by looking:
- search_documents for each topic (pain points, complaints, delays, costs; portals, online systems, software; Acts, rules, orders, circulars, sections) — in English and in the local language.
- read_pages for the pages your searches point to (up to 5 per call). Documents marked NOT searchable must be read directly. Call independent tools together.
Then use web_search (when offered — at most 5, run them at once, each covering several steps) for what the documents do not say, on official ${country} sources: the national laws portal, gazettes, the ministry and the service portal.`
    : `Use web_search (at most 5, run them at once, each covering several steps) on official ${country} sources: the national laws portal, gazettes, the ministry and the service portal.`;
  return `${SPS_GUIDE}

You review the AS-IS process of a ${country} government service for SPS (Service Process Simplification) before it is approved.

For EVERY step find:
- PAIN point: the main problem for citizens or staff (delay, extra visit, cost, duplicate work), max 10 words.
- DIGITAL status: "manual" (paper or in person), "partly" (some parts online), or "online" (fully digital end to end), plus the system or portal name when one exists.
- LAW / regulation: the Act, rule, order or circular (with section) that requires or governs the step, max 10 words. Empty when none is found.
- Where the step does not have them yet: TIME (working days), VISIT (1 if the citizen must come in person) and FEE (taka).
For the whole service also fill:
- SERVICE PROFILE (Sheet-1): ${SPS_PROFILE.map((p) => `${p.key} (${p.options.join("/")})`).join("; ")}.
- DOCUMENTS (Sheet-3): every paper the citizen must submit — whether the citizen already has it ("citizen_own") or must get it from another office ("other_office"), and how the office checks it ("none", "own" records, or "other_office").

${sources}
Never guess. When neither the documents nor the web say it, leave the value empty and ask a question about it.

Answer with ONLY this JSON object — no text before or after it, no markdown:
{"sources":[{"id":"W1","title":"short page title","url":"https://exact-url-from-search"}],
 "review":[[1,"Two office visits needed [D1:3]","partly","sss.bkkb.gov.bd","[D1:2]","Welfare Fund Act 2004, s.12 [W1]",1,1,0]],
 "profile":{"file_method":"Hybrid","channel":"In person at office","fee_payment":"A-Challan","hotline":"None","tracking":"No"},
 "documents":[["National ID","citizen_own","other_office"],["Trade licence","other_office","other_office"]],
 "questions":[[9,"legal_basis","Which rule requires the five-level approval?","The Welfare Fund Act 2004 makes the Board the approving body [W1]. The circular lists the approval chain but names no rule for its five levels [D1:4]."]],
 "quotes":[["D1:3","Applicants must appear in person at the district office twice"],["W1","Section 12: the Board shall grant the stipend"]]}
Each review row: [step_number, pain, digital_status, system_name, digital_evidence, law, time_days, visit, fee] — one row for EVERY step (time_days / visit / fee: null when unknown).
profile: only items you found evidence for, values from the listed options.

Rules:
- GUARDRAIL: cite every value with where it came from: [D1:4] = a document page you read or saw in search results, [W1] = a web page. A value without a citation is thrown away — if you have no source, leave it empty and ask a question. digital_evidence = the citation(s) behind the digital status.
- Keep a value already in the step when it is right; replace it only with a better-cited one. Leave the user's own values ("confirmed_by_user") as they are.
- "sources": only web pages (W ids) you cite. [] if you did not search the web.
- ${QUOTE_RULE}
- "questions": at most 8, most important first, only for values neither the documents nor the web gave; field = pain_points | digital_status | legal_basis; one short question each, written in ${lang === "bn" ? "Bangla" : "English"}. Each question row: [step_number, field, question, found] — found = 2-3 short sentences (max 50 words) on what you DID find that relates to the question, in the same language, cited [D1:4] / [W1]; "" when nothing related was found.
- Be terse. No extra fields.`;
}

export async function runReview(projectId: string, emit: Emit): Promise<{ steps: Step[]; findings: Finding[]; review: Review } | null> {
  const project = db.query("SELECT name, description FROM projects WHERE id = ?").get(projectId) as { name: string; description: string } | null;
  let { steps, findings } = loadAsis(projectId);
  if (!project || !steps.length) return null;
  const country = projectCountry(projectId);
  const lang = userLanguage(projectId);

  emit({ type: "progress", text: `Reviewing ${steps.length} AS-IS steps — pain points, digital status, law / regulation…` });
  await ensureProjectIngested(projectId);
  const session = new DocSession(projectId, emit);
  // documents of this service decide the consent rule; the shared library is used either way
  const hasDocs = session.projectDocCount > 0;

  const compact = steps.map((s) => ({
    n: s.step_number, name: s.step_name, actor: s.actor, action: strip(s.action),
    ...(strip(s.pain_points) ? { pain: strip(s.pain_points) } : {}),
    ...(s.digital_status ? { digital: s.digital_status } : {}),
    ...(strip(s.legal_basis) ? { law: strip(s.legal_basis) } : {}),
    ...(Object.entries(s.field_sources ?? {}).some(([, v]) => v === "user")
      ? { confirmed_by_user: Object.entries(s.field_sources ?? {}).filter(([, v]) => v === "user").map(([k]) => k) } : {}),
  }));
  const rejected = findings.filter((f) => f.status === "rejected" && f.kind === "field").map((f) => {
    const st = steps.find((s) => s.uid === f.step_uid);
    return st ? `- step ${st.step_number} ${FIELD_LABEL[f.field!]}: ${strip(f.value)}` : "";
  }).filter(Boolean);
  const prompt = [
    `Service: ${project.name}${project.description ? ` — ${project.description}` : ""}`,
    `Country: ${country}`,
    `AS-IS steps (${steps.length}):\n${JSON.stringify(compact)}`,
    rejected.length ? `The user REJECTED these suggestions — do not propose them again:\n${rejected.join("\n")}` : "",
    session.docs.length ? session.catalogue() : "",
  ].filter(Boolean).join("\n\n") + memoryBlock(projectId);

  const system = reviewSystem(country, session.docs.length > 0, lang);
  // the review rows as they are written — the AS-IS table fills its columns live
  const reviewText = (t: string) => emit({ type: "review_text", text: t });
  const result = session.docs.length
    ? await runDocAgent({ label: "asis-review", model: ANTHROPIC_MODEL, system, prompt, session, webSearch: WEB_SEARCH, webSearchBudget: 5, maxIterations: 14, maxTokens: 16000, emit, onText: reviewText })
    : await runStreamed({ label: "asis-review", model: ANTHROPIC_MODEL, system, messages: [{ role: "user", content: prompt }], maxTokens: 16000, tools: [{ ...WEB_SEARCH, max_uses: 5 }], emit, onText: reviewText })
        .then((r) => ({ ...r, all: r.content }));

  const raw = extractJsonObject(result.content) as { sources?: Array<{ id?: string; url?: string; title?: string }>; review?: unknown[]; questions?: unknown[]; quotes?: unknown } | null;
  if (!raw || !Array.isArray(raw.review) || !raw.review.length) {
    log.error(`asis-review: no review rows (stop=${result.stop})`);
    emit({ type: "progress", text: "The review did not return results — you can run it again from the AS-IS page." });
    return null;
  }

  const known = new Map<string, KnownSource>([
    ...(session.docs.length ? session.known((fileId) => `/api/projects/${projectId}/files/${fileId}/view`) : []),
    ...validateWebSources(raw.sources, collectWebResults(result.all)),
  ]);
  attachQuotes(known, raw.quotes);
  const byNumber = new Map(steps.map((s) => [Number(s.step_number), s]));
  const newFindings: Finding[] = [];
  let findingNo = Number(nextFindingId(findings).slice(1));
  let confirmed = 0;

  // values the AI gave without any source (left out; asked as questions below)
  const unsourced: Array<{ step: Step; field: ReviewField; raw: string; note?: string }> = [];
  for (const row of raw.review) {
    if (!Array.isArray(row)) continue;
    const [n, pain, digital, system_name, evidence, law, days, visit, fee] = row as unknown[];
    const step = byNumber.get(Number(n));
    if (!step) continue;
    step.reviewed = true;
    // time / visit / fee only where the mapping left them empty
    if ((step.time_days === undefined || step.time_days === null) && days != null && Number.isFinite(Number(days))) step.time_days = Number(days);
    if (step.visit === undefined && visit != null) step.visit = Number(visit) === 1 || visit === true;
    if (!step.fee && Number(fee) > 0) step.fee = Number(fee);
    const digitalValue = normalizeDigital(String(digital ?? ""));
    const values: Record<ReviewField, { value: string; cited: string; note?: string }> = {
      pain_points: { value: String(pain ?? "").trim(), cited: String(pain ?? "") },
      digital_status: { value: digitalValue, cited: String(evidence ?? ""), note: `${String(system_name ?? "").trim()} ${String(evidence ?? "").trim()}`.trim() },
      legal_basis: { value: String(law ?? "").trim(), cited: String(law ?? "") },
    };

    for (const field of REVIEW_FIELDS) {
      const v = values[field];
      if (!strip(v.value)) continue;                                   // nothing found
      if (step.field_sources?.[field] === "user") continue;            // the user's word stands
      const kinds = citedKinds(v.cited, known);
      // GUARDRAIL: a value with no source is never saved or proposed — the user is asked instead
      if (!kinds.size) { unsourced.push({ step, field, raw: strip(v.value), note: strip(v.note) }); continue; }
      if (kinds.has("doc") || !hasDocs) {
        // Backed by a document (or the user chose web research: no documents at all) → confirmed
        step[field] = v.value;
        if (field === "digital_status") step.digital_note = v.note;
        step.field_sources = { ...step.field_sources, [field]: kinds.has("doc") ? "doc" : "web" };
        step.unknown_fields = (step.unknown_fields ?? []).filter((x) => x !== field);
        confirmed++;
        continue;
      }
      // Only on the web, or no source: a proposal for the user — unless the step already has a value
      if (strip(step[field]) || (field === "digital_status" && step.digital_status)) continue;
      const proposal = strip(field === "digital_status" ? `${v.value} ${v.note}` : v.value).toLowerCase();
      const seen = findings.some((f) => f.step_uid === step.uid && f.field === field && f.status === "rejected"
        && strip(f.kind === "field" && field === "digital_status" ? `${f.value} ${f.digital_note}` : f.value).toLowerCase() === proposal);
      if (seen) continue;
      // a newer proposal replaces an older pending one for the same value
      findings = findings.map((f) => (f.status === "pending" && f.step_uid === step.uid && f.field === field
        ? { ...f, status: "dropped" as const, decided_at: now() } : f));
      const frozen = freezeCitations([field === "digital_status" ? v.note ?? "" : v.value], known, findingNo);
      newFindings.push({
        id: `F${findingNo++}`, kind: "field", step_uid: step.uid, field,
        value: field === "digital_status" ? v.value : frozen.texts[0],
        ...(field === "digital_status" ? { digital_note: frozen.texts[0] } : {}),
        sources: frozen.sources, origin: "web", status: "pending", created_at: now(),
      });
    }
  }

  steps = renumber(steps, known);
  findings = [...findings, ...newFindings];

  // Sheet-1 (service profile) and Sheet-3 (documents) — the user's own entries stay
  const raw2 = raw as unknown as { profile?: Record<string, unknown>; documents?: unknown[] };
  const sps = getSps(projectId);
  const profile = { ...sps.profile };
  const profileKeys = new Set(SPS_PROFILE.map((p) => p.key));
  for (const [k, v] of Object.entries(raw2.profile ?? {})) {
    if (profileKeys.has(k) && String(v ?? "").trim() && profile[k]?.source !== "user") profile[k] = { value: String(v).trim(), source: hasDocs ? "review" : "web" };
  }
  const documents: SpsDocument[] = sps.documents?.some((d) => (d as SpsDocument & { user?: boolean }).user) ? sps.documents
    : (raw2.documents ?? []).flatMap((r) => {
        const [name, source, verify] = Array.isArray(r) ? r : [];
        if (!String(name ?? "").trim()) return [];
        return [{ name: String(name).trim(), source: source === "other_office" ? "other_office" : "citizen_own", verify: ["own", "other_office"].includes(String(verify)) ? String(verify) as SpsDocument["verify"] : "none" }];
      });
  updateSps(projectId, { profile, ...(documents.length ? { documents } : {}) });

  // Questions only for values that are still open (no value, no proposal, not marked unknown)
  const pendingKey = new Set(findings.filter((f) => f.status === "pending" && f.kind === "field").map((f) => `${f.step_uid}:${f.field}`));
  const stepsByNumber = new Map(steps.map((s) => [Number(s.step_number), s]));
  const questions: Review["questions"] = [];
  const foundText: string[] = [];   // what was found so far, per question (cited)
  for (const q of raw.questions ?? []) {
    if (!Array.isArray(q)) continue;
    const [n, field, question, found] = q as [unknown, unknown, unknown, unknown];
    const step = stepsByNumber.get(Number(n));
    const f = String(field) as ReviewField;
    if (!step || !REVIEW_FIELDS.includes(f) || !String(question ?? "").trim()) continue;
    if (strip(step[f]) || pendingKey.has(`${step.uid}:${f}`) || step.unknown_fields?.includes(f)) continue;
    questions.push({ step_uid: step.uid!, field: f, question: String(question).trim() });
    foundText.push(String(found ?? "").trim());
    if (questions.length >= 8) break;
  }
  // An uncited value is not saved: the user is asked to confirm it (Yes / No / Skip in the
  // chat) — their answer is its source. Values they already said no to, or skipped, are not asked again.
  let confirmCount = 0;
  for (const u of unsourced) {
    if (strip(u.step[u.field]) || (u.field === "digital_status" && u.step.digital_status)) continue;
    if (questions.some((q) => q.step_uid === u.step.uid && q.field === u.field)) continue;
    if (findings.some((f) => f.step_uid === u.step.uid && f.field === u.field && f.status === "pending")) continue;
    const answered = findings.some((f) => f.origin === "unsourced" && f.step_uid === u.step.uid && f.field === u.field
      && (f.status === "rejected" || f.status === "skipped") && strip(f.value).toLowerCase() === strip(u.raw).toLowerCase());
    if (answered) continue;
    findings.push({
      id: `F${findingNo++}`, kind: "field", step_uid: u.step.uid, field: u.field,
      value: u.raw, ...(u.field === "digital_status" ? { digital_note: u.note } : {}),
      sources: [], origin: "unsourced", status: "pending", created_at: now(),
    });
    confirmCount++;
  }
  if (unsourced.length) log.analyze(`asis-review guardrail: ${unsourced.length} value(s) without a source — ${confirmCount} put to the user to confirm`);
  const review: Review = { reviewed_at: now(), country, questions };
  saveAsis(projectId, { steps, findings, review });
  log.analyze(`asis-review done  steps=${steps.length}  confirmed=${confirmed}  proposals=${newFindings.length}  questions=${questions.length}`);

  // Chat rail: consent card for everything pending, then the open questions
  const cards = postConsentCard(projectId);
  if (questions.length) {
    const bn = lang === "bn";
    const intro = bn
      ? "এই তথ্যগুলো আপনার ফাইলে বা ওয়েবে পুরোপুরি পাইনি। যা পেয়েছি তা নিচে দিলাম — জানা থাকলে উত্তর দিন (না জানলে \"জানি না\" লিখুন):"
      : "I couldn't fully find these in your files or online. Here is what I found so far — if you know the answer, please reply (or say \"don't know\"):";
    // what was found, with only real sources (pages read, web pages that came back), numbered [1], [2]…
    const { items, sources } = finalizeCitations(foundText.map((found) => ({ found })), ["found"], known);
    const list = questions.map((q, i) => {
      const st = steps.find((s) => s.uid === q.step_uid);
      const found = strip(items[i].found) || (bn ? "এ বিষয়ে ফাইলে বা ওয়েবে কিছু পাইনি।" : "Nothing about this in your files or online.");
      const refs = items[i].sources.map((src) => `[${src.n}]`).join(" ");
      return [
        `**${i + 1}. Step ${st?.step_number} · ${FIELD_LABEL[q.field]}**`,
        found,
        ...(refs ? [`${bn ? "সূত্র" : "Sources"}: ${refs}`] : []),
        `**${bn ? "প্রশ্ন" : "Question"}:** ${q.question}`,
      ].join("\n");
    });
    saveChat(projectId, `${intro}\n\n${list.join("\n\n")}`, "text", sources.length ? { sources } : undefined);
  }
  emit({ type: "progress", text: `Review complete — ${confirmed} values from your documents${cards ? `, ${cards} to confirm in the chat` : ""}${questions.length ? `, ${questions.length} question${questions.length > 1 ? "s" : ""}` : ""}.` });
  emit({ type: "review_updated" });
  return { steps, findings, review };
}
