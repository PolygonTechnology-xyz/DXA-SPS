"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Decision, RegisterRisk, Meeting, Project, ReportMeta, RisksData } from "@/lib/mock";
import { actionStatus, isHigh, isRisk, startOfToday } from "@/lib/analysis";
import { api } from "@/lib/api";
import { useStore } from "./Store";
import { SummaryCard } from "./SummaryCard";
import { DocumentsCard } from "@/components/DocumentsCard";
import { Gauge, band, scoreProject } from "./Gauge";

const RISKS_SHOWN = 3;

function ago(iso?: string) {
  if (!iso) return "never";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

const dueLabel = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export function Dashboard({ project }: { project: Project }) {
  const { replaceProject, refreshReports, reports } = useStore();
  const router = useRouter();
  const draftReports = reports.filter((r) => r.projectId === project.id && r.status === "draft");
  const [sync, setSync] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [report, setReport] = useState<{ step: "idle" | "analysing"; error?: string }>({ step: "idle" });
  const [riskData, setRiskData] = useState<RisksData | null>(null);
  const [riskBusy, setRiskBusy] = useState(false);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [showAllRisks, setShowAllRisks] = useState(false);
  const [openRisks, setOpenRisks] = useState<Set<number>>(new Set()); // risks start collapsed; the list stays short
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const toggleRisk = (i: number) => setOpenRisks((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [register, setRegister] = useState<RegisterRisk[]>([]);
  const flagged = register.filter((x) => x.needsIntervention);
  const [draftMinutes, setDraftMinutes] = useState<Meeting[]>([]);
  const [review, setReview] = useState<"risks" | "summary" | null>(null);
  const [factorsOpen, setFactorsOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  useEffect(() => {
    let off = false;
    api<RegisterRisk[]>(`/projects/${project.id}/register`).then((r) => { if (!off) setRegister(r); }).catch(() => {});
    api<Decision[]>(`/projects/${project.id}/decisions`).then((d) => { if (!off) setDecisions(d.slice(0, 4)); }).catch(() => {});
    api<Meeting[]>(`/projects/${project.id}/meetings`).then((m) => { if (!off) setDraftMinutes(m.filter((x) => x.minutes && !x.approvedAt)); }).catch(() => {});
    return () => { off = true; };
  }, [project.id]);
  const tasks = project.tasks ?? [];
  const site = project.jira?.site;
  const today = startOfToday();

  const open = tasks.filter((t) => t.category !== "done");
  const overdue = open.filter((t) => actionStatus(t, today).label === "Overdue");
  const risks = open.filter(isRisk);
  const highRisks = risks.filter(isHigh);
  const inProgress = tasks.filter((t) => t.category === "indeterminate");
  const done = tasks.length - open.length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const unassigned = open.filter((t) => !t.assignee).length;

  const [note, setNote] = useState("");
  // guidance undefined keeps the earlier messages; [] clears them.
  async function analyseRisks(guidance?: string[]) {
    setRiskBusy(true);
    setRiskError(null);
    try {
      setRiskData(await api<RisksData>(`/projects/${project.id}/risks`, { method: "POST", body: guidance ? { guidance } : undefined }));
    } catch (e) {
      setRiskError((e as Error).message);
    }
    setRiskBusy(false);
  }

  // Show the saved analysis, and have the agent redo it whenever the tasks or the report period changed.
  const riskInputs = `${project.syncedAt}|${JSON.stringify(project.reportSchedule)}|${project.goal}`;
  useEffect(() => {
    if (!project.jira) return;
    let cancelled = false;
    (async () => {
      try {
        const current = await api<RisksData>(`/projects/${project.id}/risks`);
        if (cancelled) return;
        setRiskData(current);
        if (current.status !== "ready") {
          setRiskBusy(true);
          const fresh = await api<RisksData>(`/projects/${project.id}/risks`, { method: "POST" });
          if (!cancelled) { setRiskData(fresh); api<RegisterRisk[]>(`/projects/${project.id}/register`).then((r) => { if (!cancelled) setRegister(r); }).catch(() => {}); }
        }
        if (!cancelled) setRiskError(null);
      } catch (e) {
        if (!cancelled) setRiskError((e as Error).message);
      }
      if (!cancelled) setRiskBusy(false);
    })();
    return () => { cancelled = true; };
    // riskInputs captures everything that should trigger a new analysis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, !!project.jira, riskInputs]);

  // Approving makes the draft a record; it can't be edited or withdrawn afterwards (re-analyse starts a new draft).
  async function approveRisks() {
    setApproving(true);
    setRiskError(null);
    try {
      setRiskData(await api<RisksData>(`/projects/${project.id}/risks/approve`, { method: "POST", body: {} }));
    } catch (e) { setRiskError((e as Error).message); }
    setApproving(false);
  }
  // Deleting removes a risk from the draft (by position), so it is not approved.
  async function deleteRisk(i: number) {
    setApproving(true);
    setRiskError(null);
    try {
      setRiskData(await api<RisksData>(`/projects/${project.id}/risks/${i}`, { method: "DELETE" }));
      setOpenRisks(new Set());
    } catch (e) { setRiskError((e as Error).message); }
    setApproving(false);
  }

  async function refresh() {
    setSync({ busy: true });
    try {
      replaceProject(await api<Project>(`/projects/${project.id}/jira/refresh`, { method: "POST" }));
      setSync({ busy: false });
    } catch (e) {
      setSync({ busy: false, error: (e as Error).message });
    }
  }

  async function exportReport() {
    setReport({ step: "analysing" });
    try {
      await api<ReportMeta>(`/projects/${project.id}/reports`, { method: "POST", body: {} });
      await refreshReports();
      router.push(`/projects/${project.id}/reports`); // review the draft and approve it there
      setReport({ step: "idle" });
    } catch (e) {
      setReport({ step: "idle", error: (e as Error).message });
    }
  }

  const activeReg = register.filter((r) => r.status === "open" || r.status === "mitigating");
  const hi = activeReg.filter((r) => r.severity === "high").length;
  const { score, factors } = scoreProject(project, hi);
  const b = score === null ? null : band(score);
  const topRisks = activeReg.slice(0, 3);

  // Phases: epics (progress from their child tasks), otherwise Jira versions.
  const epics = tasks.filter((t) => /^(epic|workstream)$/i.test(t.type) || tasks.some((x) => x.epic === t.key));
  const phases = (epics.length
    ? epics.map((e) => { const kids = tasks.filter((t) => t.epic === e.key); const d = kids.filter((t) => t.category === "done").length; return { name: e.summary, pct: kids.length ? Math.round((d / kids.length) * 100) : e.category === "done" ? 100 : 0, note: `${d} of ${kids.length}` }; })
    : project.milestones.map((m) => ({ name: m.title, pct: m.done ? 100 : m.total ? Math.round(((m.doneTasks ?? 0) / m.total) * 100) : 0, note: m.total ? `${m.doneTasks ?? 0} of ${m.total}` : "" }))
  );
  const phaseState = (p: number) => (p >= 100 ? { t: "Done", c: "ok" } : p > 0 ? { t: "In progress", c: "info" } : { t: "Not started", c: "idle" });
  const todayIso = new Date().toISOString().slice(0, 10);
  const deadlines = project.milestones.filter((m) => !m.done && m.due >= todayIso).sort((a, c) => a.due.localeCompare(c.due)).slice(0, 4);
  const sev = (s: string) => (s === "high" ? "High" : s === "medium" ? "Medium" : "Low");

  const riskReview = (
    <article className="pd-card pd-review dash">
                  <div className="card-head">
                    <h3>Risk analysis</h3>
                    <span className="muted small">{riskData ? riskData.scope.label : "AI analysis"}</span>
                  </div>
                  {riskError && <div className="note bad pad" role="alert">⚠ {riskError}</div>}
                  {!riskData && riskBusy && <p className="muted pad">Analysing risks…</p>}
                  {riskData && (
                    <>
                      <div className="risk-status">
                        {riskData.risks.length > 0 && (riskData.isApproved
                          ? <span className="badge badge-ok">✔ Approved {new Date(riskData.approved!.approvedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>
                          : <span className="badge badge-info">Draft · not approved</span>)}
                        {!riskData.isApproved && riskData.risks.length > 0 && <span className="muted small">Delete any risk you disagree with, then approve. Reports use approved risks only.</span>}
                      </div>
                      {riskData.overview && (
                        <div className="risk-overview-wrap">
                          <p className={`risk-overview${overviewOpen ? "" : " clamp"}`}>{riskData.overview}</p>
                          <button className="link-btn" onClick={() => setOverviewOpen((v) => !v)}>{overviewOpen ? "Less" : "More"}</button>
                        </div>
                      )}
                      {riskData.risks.length === 0 ? <p className="muted pad">No risks found for this period.</p> : (
                        <>
                          <ul className={`list risk-list${!riskData.isApproved && riskData.risks.length > 4 ? " scroll" : ""}`}>
                            {riskData.risks.slice(0, showAllRisks || !riskData.isApproved ? undefined : RISKS_SHOWN).map((r, i) => {
                              const open = openRisks.has(i);
                              return (
                                <li key={i}>
                                  <div className="list-main">
                                    <button className="risk-head" aria-expanded={open} onClick={() => toggleRisk(i)}>
                                      <span className="caret">{open ? "▾" : "▸"}</span>
                                      <span className="list-title">{r.title}</span>
                                    </button>
                                    {!open && r.taskKeys.length > 0 && <div className="list-meta risk-sub">{r.taskKeys.length} task{r.taskKeys.length === 1 ? "" : "s"}</div>}
                                    {open && (
                                      <div className="risk-body">
                                        <div className="list-meta">{r.rationale}</div>
                                        <div className="risk-action">→ {r.mitigation}</div>
                                        {(r.evidence?.length ? r.evidence : r.taskKeys.map((k) => ({ key: k, daysOverdue: null as number | null, summary: "", status: "", assignee: null, due: null }))).length > 0 && (
                                          <div className="chips risk-chips">
                                            {(r.evidence?.length ? r.evidence : r.taskKeys.map((k) => ({ key: k, daysOverdue: null as number | null, summary: "", status: "", assignee: null as string | null, due: null as string | null }))).slice(0, 8).map((e) => (
                                              <a key={e.key} className={`chip${e.daysOverdue ? " late" : ""}`} href={site ? `${site}/browse/${e.key}` : undefined} target="_blank" rel="noreferrer"
                                                title={[e.summary, e.status, e.assignee ?? "unassigned", e.due ? `due ${dueLabel(e.due)}` : ""].filter(Boolean).join(" · ")}>
                                                {e.key}{e.daysOverdue ? ` · ${e.daysOverdue} d late` : ""}
                                              </a>
                                            ))}
                                            {r.taskKeys.length > 8 && <span className="muted small">+{r.taskKeys.length - 8} more</span>}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <span className={`badge badge-${r.severity === "high" ? "danger" : r.severity === "medium" ? "warn" : "info"}`}>{r.severity === "high" ? "High" : r.severity === "medium" ? "Medium" : "Low"}</span>
                                  {!riskData.isApproved && (
                                    <button className="icon-del" disabled={approving || riskBusy} onClick={() => void deleteRisk(i)}
                                      aria-label={`Delete risk: ${r.title}`} title="Delete this risk from the draft">🗑</button>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                          {riskData.isApproved && riskData.risks.length > RISKS_SHOWN && (
                            <button className="show-more" onClick={() => setShowAllRisks((v) => !v)} aria-expanded={showAllRisks}>
                              {showAllRisks ? "Show less ▴" : `Show ${riskData.risks.length - RISKS_SHOWN} more ▾`}
                            </button>
                          )}
                        </>
                      )}
                      <div className="risk-guide">
                        <button className="link-btn" aria-expanded={guideOpen} onClick={() => setGuideOpen((v) => !v)}>
                          💬 Guide the analysis{riskData.guidance.length ? ` (${riskData.guidance.length})` : ""} {guideOpen ? "▴" : "▾"}
                        </button>
                        {guideOpen && (
                          <>
                            <div className="small muted">Tell the AI what to focus on or what it is missing. It re-analyses with your message.</div>
                            {riskData.guidance.map((g, i) => <div key={i} className="guide-msg">{g}</div>)}
                            <form className="guide-form" onSubmit={(e) => {
                              e.preventDefault();
                              const t = note.trim();
                              if (!t || riskBusy) return;
                              setNote("");
                              void analyseRisks([...riskData.guidance, t]);
                            }}>
                              <input className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
                                placeholder="e.g. focus on schedule risk…" aria-label="Guide the risk analysis" disabled={riskBusy} />
                              <button className="btn primary" type="submit" disabled={riskBusy || !note.trim()}>{riskBusy ? "…" : "Send"}</button>
                            </form>
                            {riskData.guidance.length > 0 && <button className="link-btn" disabled={riskBusy} onClick={() => void analyseRisks([])}>Clear guidance and re-analyse</button>}
                          </>
                        )}
                      </div>
                      <div className="risk-foot">
                        <span className="muted small">{riskBusy ? "Updating…" : riskData.aiGenerated ? "Drafted by AI" : "Rule-based (AI unavailable)"}{!riskData.isApproved && riskData.approved ? ` · last approved ${new Date(riskData.approved.approvedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : ""}</span>
                        <span className="row">
                          {!riskData.isApproved && riskData.risks.length > 0 && riskData.status === "ready" && (
                            <button className="btn primary" disabled={approving || riskBusy} onClick={() => void approveRisks()}>
                              {approving ? "Saving…" : `Approve ${riskData.risks.length}`}
                            </button>)}
                          <button className="btn" disabled={riskBusy} onClick={() => void analyseRisks()} aria-label="Re-analyse" title="Re-analyse">↻</button>
                        </span>
                      </div>
                    </>
                  )}
                </article>
  );

  return (
    <section className="pd" aria-label="Project dashboard">
      <div className="pd-top">
        <div>
          <div className="pd-crumb">{project.name} / Dashboard</div>
          <h2 className="pd-title">Programme dashboard</h2>
          <p className="pd-sub">{project.name}{project.jira ? ` · ${project.jira.key}` : ""} · Updated {ago(project.syncedAt)}</p>
        </div>
        <div className="pd-actions">
          <button className="pd-btn" onClick={() => void exportReport()} disabled={report.step !== "idle"}>{report.step === "idle" ? "📄 Prepare report" : "Preparing draft…"}</button>
          {project.jira && (<>
            <button className="pd-btn dark" onClick={() => void refresh()} disabled={sync.busy}>{sync.busy ? "Refreshing…" : "↻ Refresh from Jira"}</button>
          </>)}
        </div>
      </div>
      {report.error && <div className="note bad" role="alert">⚠ {report.error}</div>}
      {sync.error && <div className="note bad" role="alert">⚠ {sync.error}</div>}

      {project.jira && (<>
        <div className="pd-row2">
          <article className="pd-card">
            <div className="pd-h"><h3>Project health</h3><span className="pd-tag">DXA score</span></div>
            {score === null ? <p className="pd-muted">No tasks yet, so no score.</p> : (<>
              <Gauge value={score} />
              <div className="pd-score"><b>{score}</b><span>/100</span></div>
              <div className="pd-center"><span className={`pd-pill ${b!.cls}`}>{b!.label}</span></div>
              <p className="pd-scale">Critical below 40 · At risk 40–69 · On track 70+</p>
              <button className="pd-link" aria-expanded={factorsOpen} onClick={() => setFactorsOpen((v) => !v)}>What affects the score {factorsOpen ? "⌃" : "›"}</button>
              {factorsOpen && <ul className="pd-factors">{factors.map((f) => <li key={f.label}><span>{f.label}<small>{f.note}</small></span><b className={f.points ? "bad" : ""}>{f.points ? `−${f.points}` : "0"}</b></li>)}</ul>}
            </>)}
          </article>

          <article className="pd-card">
            <div className="pd-h"><h3>Needs your approval</h3><span className="pd-tag">AI drafts · you approve</span></div>
            <div className="pd-ask">
              {activeReg.length > 0 && (
                <div className="pd-item"><span className="pd-ic warn">⚠</span><div><b>Risks found by AI</b><small>{activeReg.length} risk{activeReg.length === 1 ? "" : "s"} from meetings and Jira{hi ? ` · ${hi} high` : ""} · remove any that are not risks</small></div>
                  <Link className="pd-btn dark" href={`/projects/${project.id}/risks`}>Review risks</Link></div>
              )}
              {draftReports.map((r) => (
                <div className="pd-item" key={r.id}><span className="pd-ic">📄</span><div><b>Report draft · {r.periodLabel}</b><small>Prepared {new Date(r.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} · approve to make it final</small></div>
                  <Link className="pd-btn dark" href={`/projects/${project.id}/reports`}>Review report</Link></div>
              ))}
              {draftMinutes.map((m) => (
                <div className="pd-item" key={m.id}><span className="pd-ic">🎙</span><div><b>{m.title} minutes</b><small>Draft from {new Date(m.heldOn + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} · {m.minutes!.decisions.length} decision{m.minutes!.decisions.length === 1 ? "" : "s"}, {m.minutes!.actions.length} action{m.minutes!.actions.length === 1 ? "" : "s"}</small></div>
                  <Link className="pd-btn dark" href={`/projects/${project.id}/meetings`}>Review minutes</Link></div>
              ))}
              <div className="pd-item"><span className="pd-ic">▤</span><div><b>Project summary</b><small>AI drafts findings and recommendations for reports</small></div>
                <button className="pd-btn" onClick={() => setReview(review === "summary" ? null : "summary")}>{review === "summary" ? "Close" : "Review summary"}</button></div>
              {riskBusy && <div className="pd-item"><span className="pd-ic">⟳</span><div><b>Analysing risks…</b><small>The AI is re-checking the latest Jira data</small></div></div>}
            </div>
          </article>
        </div>

        {review === "risks" && riskReview}
        {review === "summary" && <div className="dash"><SummaryCard projectId={project.id} /></div>}

        <div className="pd-kpis">
          <div className="pd-card pd-kpi"><span className="pd-k">✔ Work complete</span><b>{done} of {tasks.length}</b><div className="pd-bar"><i style={{ width: `${pct}%` }} /></div><small>{pct}% done</small></div>
          <div className="pd-card pd-kpi"><span className="pd-k">⏳ In progress</span><b>{inProgress.length}</b><small>{unassigned} without an owner</small></div>
          <div className="pd-card pd-kpi"><span className="pd-k">▤ Open actions</span><b>{open.length}</b><small className={overdue.length ? "bad" : ""}>{overdue.length} overdue</small></div>
          <div className="pd-card pd-kpi"><span className="pd-k">⚠ High risks</span><b>{hi}</b><small className={hi ? "bad" : ""}>{activeReg.length} active in the register</small></div>
        </div>

        <div className="pd-row3">
          <article className="pd-card">
            <div className="pd-h"><h3>Programme phases</h3><span className="pd-muted">{phases.length} phase{phases.length === 1 ? "" : "s"}</span></div>
            {phases.length === 0 ? <p className="pd-muted">No phases found. Group work under epics or Jira versions to see progress here.</p> : phases.map((p) => { const st = phaseState(p.pct); return (
              <div className="pd-phase" key={p.name}>
                <div className="pd-phase-h"><span>{p.name}</span><span className="pd-phase-r"><b>{p.pct}%</b><em className={`pd-st ${st.c}`}>{st.t}</em></span></div>
                <div className="pd-track"><i className={st.c} style={{ width: `${p.pct}%` }} /></div>
              </div>); })}
          </article>
          <article className="pd-card">
            <div className="pd-h"><h3>📅 Next deadlines</h3></div>
            {deadlines.length === 0 ? <p className="pd-muted">No upcoming milestones.</p> : deadlines.map((m) => { const d = new Date(m.due + "T00:00:00"); return (
              <div className="pd-dl" key={m.title}>
                <div className="pd-date"><b>{String(d.getDate()).padStart(2, "0")}</b><span>{d.toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}</span></div>
                <div><b>{m.title}</b><small>{m.total ? `${m.doneTasks ?? 0} of ${m.total} tasks done` : "Jira version"}</small></div>
              </div>); })}
          </article>
        </div>

        <div className="pd-row-eq">
          <article className="pd-card">
            <div className="pd-h"><h3>Recent decisions</h3></div>
            {decisions.length === 0 ? <p className="pd-muted">No decisions yet. They appear here once meeting minutes are drafted from a transcript.</p> : decisions.map((d, i) => (
              <div className="pd-risk" key={i}>
                <div><b>{d.text}</b><small>{d.meetingTitle} · {new Date(d.heldOn + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</small></div>
                <span className={`pd-st ${d.status === "Approved" ? "ok" : "warnb"}`}>{d.status}</span>
              </div>
            ))}
            <Link className="pd-link left" href={`/projects/${project.id}/meetings`}>Open meetings ›</Link>
          </article>
      <article className="pd-card">
            <div className="pd-h"><h3>Top risks</h3><span className="pd-muted">{activeReg.length} active{flagged.length ? ` · ${flagged.length} need your attention` : ""}</span></div>
            {topRisks.length === 0 && <p className="pd-muted">No active risks. They come from meeting minutes, the risk analysis, or are added by hand.</p>}
            {topRisks.map((r) => (
              <div className="pd-risk top" key={r.id}>
                <div>
                  <b>{r.title}</b>
                  <small className="reg-clamp">{r.description || r.mitigation}</small>
                  {r.evidence.length > 0 && (
                    <div className="reg-tasks">
                      {r.evidence.slice(0, 3).map((e) => (
                        <a key={e.key} className="reg-task" href={project.jira?.site ? `${project.jira.site}/browse/${e.key}` : undefined} target="_blank" rel="noreferrer">
                          <span className="reg-key">{e.key}</span>
                          <span>{e.summary}</span>
                          <span className="pd-muted">{[e.status, e.assignee ?? "unassigned", e.due ? `due ${e.due}` : "no date"].join(" · ")}</span>
                          {e.daysOverdue ? <span className="reg-late">{e.daysOverdue} d late</span> : null}
                        </a>
                      ))}
                      {r.evidence.length > 3 && <Link className="pd-link left" href={`/projects/${project.id}/risks`}>+{r.evidence.length - 3} more task{r.evidence.length - 3 === 1 ? "" : "s"} ›</Link>}
                    </div>
                  )}
                  {r.needsIntervention && <span className="reg-flag" title={r.reasons.join("\n")}>⚑ Needs your attention</span>}
                </div>
                <span className={`pd-sev ${r.severity}`}>{sev(r.severity)}</span>
              </div>
            ))}
            <Link className="pd-link left" href={`/projects/${project.id}/risks`}>Open risk register ›</Link>
          </article>
        </div>
      </>)}

      <DocumentsCard projectId={project.id} />
    </section>
  );
}
