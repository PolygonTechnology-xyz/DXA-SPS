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
import { FigmaIcon } from "./FigmaIcon";
import { ApprovalList, Calendar, EmptyState, Skeleton, Stat, type Approval, type CalendarEntry } from "./OverviewParts";

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

export interface SyncState { busy: boolean; error?: string }

/** Re-imports the Jira tasks. The page header owns this, so the button and the error stay in step. */
export function useJiraSync(projectId: string) {
  const { replaceProject } = useStore();
  const [sync, setSync] = useState<SyncState>({ busy: false });
  async function refresh() {
    setSync({ busy: true });
    try {
      replaceProject(await api<Project>(`/projects/${projectId}/jira/refresh`, { method: "POST" }));
      setSync({ busy: false });
    } catch (e) {
      setSync({ busy: false, error: (e as Error).message });
    }
  }
  return { sync, refresh };
}

export function SyncControls({ project, sync, refresh }: { project: Project; sync: SyncState; refresh: () => Promise<void> }) {
  if (!project.jira) return null;
  return (<>
    <span className="ov-synced">Synced {ago(project.syncedAt)}</span>
    <button type="button" className="ds-btn sm" onClick={() => void refresh()} disabled={sync.busy}><FigmaIcon name="sync" size={16} />{sync.busy ? "Refreshing…" : "Refresh from Jira"}</button>
  </>);
}

export function Dashboard({ project, sync, onRetrySync }: { project: Project; sync: SyncState; onRetrySync: () => Promise<void> }) {
  const { refreshReports, reports } = useStore();
  const router = useRouter();
  const draftReports = reports.filter((r) => r.projectId === project.id && r.status === "draft");
  const [report, setReport] = useState<{ step: "idle" | "analysing"; error?: string }>({ step: "idle" });
  const [riskData, setRiskData] = useState<RisksData | null>(null);
  const [riskBusy, setRiskBusy] = useState(false);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [showAllRisks, setShowAllRisks] = useState(false);
  const [openRisks, setOpenRisks] = useState<Set<number>>(new Set()); // risks start collapsed; the list stays short
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const toggleRisk = (i: number) => setOpenRisks((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const [decisionRows, setDecisions] = useState<Decision[] | null>(null); // null while loading
  const [registerRows, setRegister] = useState<RegisterRisk[] | null>(null);
  const [minuteRows, setDraftMinutes] = useState<Meeting[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const loading = !decisionRows || !registerRows || !minuteRows;
  const decisions = decisionRows ?? [];
  const register = registerRows ?? [];
  const draftMinutes = minuteRows ?? [];
  const [review, setReview] = useState<"risks" | "summary" | null>(null);
  const [factorsOpen, setFactorsOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  useEffect(() => {
    let off = false;
    const failed = <T,>(set: (v: T[]) => void) => () => { if (!off) { set([]); setLoadFailed(true); } };
    api<RegisterRisk[]>(`/projects/${project.id}/register`).then((r) => { if (!off) setRegister(r); }).catch(failed(setRegister));
    api<Decision[]>(`/projects/${project.id}/decisions`).then((d) => { if (!off) setDecisions(d.slice(0, 3)); }).catch(failed(setDecisions));
    api<Meeting[]>(`/projects/${project.id}/meetings`).then((m) => { if (!off) setDraftMinutes(m.filter((x) => x.minutes && !x.approvedAt)); }).catch(failed(setDraftMinutes));
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

  async function exportReport() {
    setReport({ step: "analysing" });
    try {
      await api<ReportMeta>(`/projects/${project.id}/reports`, { method: "POST", body: {} });
      await refreshReports();
      router.push(`/projects/${project.id}/reports`); // the new draft is at the top of the library
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
    : project.milestones.filter((m) => m.source !== "setup").map((m) => ({ name: m.title, pct: m.done ? 100 : m.total ? Math.round(((m.doneTasks ?? 0) / m.total) * 100) : 0, note: m.total ? `${m.doneTasks ?? 0} of ${m.total}` : "" }))
  );
  const phaseState = (p: number) => (p >= 100 ? { t: "Done", c: "ok" } : p > 0 ? { t: "In progress", c: "info" } : { t: "Not started", c: "idle" });
  const sev = (v: string) => (v === "high" ? "High" : v === "medium" ? "Medium" : "Low");
  const currentPhase = phases.find((p) => p.pct > 0 && p.pct < 100) ?? phases.find((p) => p.pct < 100);

  const calendarEntries: CalendarEntry[] = [
    ...open.filter((t) => t.due).map((t) => {
      const late = actionStatus(t, today).label === "Overdue";
      return { key: t.key, title: t.summary, date: t.due!, who: t.assignee ?? "No owner", kind: late ? "Overdue" as const : "Action" as const, href: site ? `${site}/browse/${t.key}` : undefined };
    }),
    ...project.milestones.filter((m) => !m.done && m.due).map((m) => ({ key: `m-${m.title}`, title: m.title, date: m.due, who: m.total ? `${m.doneTasks ?? 0} of ${m.total} tasks done` : "Milestone", kind: "Milestone" as const })),
  ];

  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const approvals: Approval[] = [
    ...draftMinutes.map((m): Approval => ({ key: m.id, tone: "brand", icon: "calendar", title: `${m.title} minutes, ${day(m.heldOn + "T00:00:00")}`,
      detail: `Draft · ${m.minutes!.decisions.length} decision${m.minutes!.decisions.length === 1 ? "" : "s"}, ${m.minutes!.actions.length} action${m.minutes!.actions.length === 1 ? "" : "s"}`,
      action: "Review minutes", href: `/projects/${project.id}/meetings/${m.id}` })),
    ...draftReports.map((r): Approval => ({ key: r.id, tone: "warn", icon: "file", title: `Report draft · ${r.periodLabel}`, detail: "Approve it to make it final", when: day(r.createdAt), action: "Review report", href: `/projects/${project.id}/reports/${r.id}` })),
    ...register.filter((r) => r.status === "suggested").map((r): Approval => ({ key: r.id, tone: "bad", icon: "shield", title: `Potential risk: ${r.title}`, detail: r.source === "meeting" ? `From ${r.sourceRef ?? "meeting minutes"}` : "Found by the AI risk analysis", action: "Review risk", href: `/projects/${project.id}/risks` })),
  ];
  // Always offered, but not counted: it is a tool for drafting the summary, not something that is waiting.
  const summaryTool: Approval = { key: "summary", tone: "brand", icon: "aichat", title: "Project summary for reports", detail: "AI drafts findings and recommendations", action: review === "summary" ? "Close summary" : "Review summary", onClick: () => setReview(review === "summary" ? null : "summary") };
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning!" : hour < 18 ? "Good afternoon!" : "Good evening!";

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
    <section className="ov" aria-label="Project overview">
      <div className="ov-head">
        <div>
          <h1>{greeting}</h1>
          <p>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · {project.name}{currentPhase ? ` · Phase ${phases.indexOf(currentPhase) + 1} of ${phases.length}` : ""}</p>
        </div>
        <button type="button" className="ds-btn" disabled title="Not available yet"><FigmaIcon name="export" size={18} />Export</button>
      </div>

      <div className="ov-quick">
        <span>Quick actions</span>
        <Link href={`/projects/${project.id}/meetings`}><FigmaIcon name="qa-meeting" size={16} />Add meeting</Link>
        <button type="button" onClick={() => void exportReport()} disabled={report.step !== "idle"}><FigmaIcon name="qa-report" size={16} />{report.step === "idle" ? "Prepare report" : "Preparing draft…"}</button>
        <a href="#documents"><FigmaIcon name="qa-upload" size={16} />Upload document</a>
        <button type="button" onClick={() => void analyseRisks()} disabled={!project.jira || riskBusy}><FigmaIcon name="qa-risks" size={16} />{riskBusy ? "Finding risks…" : "Find new risks"}</button>
      </div>

      {report.error && <div className="note bad" role="alert">⚠ {report.error}</div>}
      {riskError && <div className="note bad" role="alert">⚠ {riskError}</div>}
      {loadFailed && <div className="note bad" role="alert">⚠ Some of this page could not be loaded. Reload to try again.</div>}
      {sync.error && (
        <div className="ov-error" role="alert">
          <FigmaIcon name="alert" size={18} />
          <div><b>Could not refresh from Jira</b><p>{sync.error} Showing data synced {ago(project.syncedAt)}.</p></div>
          <button type="button" className="ds-btn sm" onClick={() => void onRetrySync()} disabled={sync.busy}>Retry</button>
        </div>
      )}

      {project.jira && (<>
        <div className="ov-grid">
          <div className="ov-main">
            <div className="ov-top">
              <div className="ov-stats">
                <Stat icon="flag" label="To pilot launch" note="No launch date yet" />
                <Stat icon="check" value={done} unit={`of ${tasks.length} tasks`} label="Work complete" note={unassigned ? `${unassigned} open task${unassigned === 1 ? " has" : "s have"} no owner` : `${pct}% done`} tone={unassigned ? "warn" : undefined} />
                <Stat icon="checklist" label="Checklists received" note="No checklist source yet" />
                <Stat icon="clock" value={overdue.length} unit={overdue.length === 1 ? "action" : "actions"} label="Overdue" note={`${open.length} open · ${inProgress.length} in progress`} tone={overdue.length ? "bad" : undefined} />
              </div>
              <article className="ov-card">
                <div className="ov-card-h"><h2>Next meeting</h2></div>
                <EmptyState title="No upcoming meeting" text="Scheduled meetings and agendas are not available yet." />
                <Link className="ds-btn ov-bottom" href={`/projects/${project.id}/meetings`}>Open meetings</Link>
              </article>
            </div>

            <article className="ov-card">
              <div className="ov-card-h"><h2>Progress against plan</h2></div>
              <div className="ov-progress">
                <div className="ov-progress-side">
                  <div className="ov-overall"><b>{pct}<small>%</small></b><div><strong>Overall progress</strong><span>Share of Jira tasks done</span></div></div>
                  {currentPhase && <div className="ov-tile"><span>Current phase</span><strong>{currentPhase.name} · {currentPhase.pct}%</strong></div>}
                  {phases.length > 0 && (
                    <div className="ov-phases">
                      {phases.map((p) => <div className="ov-tile" key={p.name}><span title={p.name}>{p.name}</span><strong>{p.pct}%</strong><em>{phaseState(p.pct).t}{p.note ? ` · ${p.note}` : ""}</em></div>)}
                    </div>
                  )}
                </div>
                <EmptyState title="No planned progress yet" text="The plan and actual chart appears once there is a source for planned progress." />
              </div>
            </article>

            <article className="ov-card">
              <div className="ov-card-h"><h2>Needs your approval</h2>{!loading && <span className="ov-tag">{approvals.length} waiting</span>}</div>
              {loading ? <Skeleton rows={3} /> : (<>
                {approvals.length === 0 && <EmptyState positive title="You are all caught up" text="New drafts from DXA will appear here." />}
                <ApprovalList items={[...approvals, summaryTool]} />
              </>)}
              {riskBusy && <p className="ov-muted">Analysing risks from the latest Jira data…</p>}
            </article>
          </div>

          <div className="ov-side">
            <article className="ov-card">
              <div className="ov-card-h"><h2>Project health</h2></div>
              <p className="ov-muted">Updated {ago(project.syncedAt)} · DXA score</p>
              {score === null ? <EmptyState title="No score yet" text="There are no Jira tasks to score." /> : (<>
                <Gauge value={score} />
                <p className="ov-score"><b>{score}</b><span className={b!.cls}>/100 · {b!.label}</span></p>
                <ul className="ov-factors">
                  {factors.map((f) => <li key={f.label} className={f.points ? "hit" : ""}><strong>{f.label}</strong><span>{f.points ? `minus ${f.points}` : "0"}</span>{factorsOpen && <small>{f.note}</small>}</li>)}
                </ul>
                <button type="button" className="ov-link" aria-expanded={factorsOpen} onClick={() => setFactorsOpen((v) => !v)}>{factorsOpen ? "Hide details" : "What affects the score"}</button>
              </>)}
            </article>
            <Calendar entries={calendarEntries} />
          </div>
        </div>

        {review === "risks" && riskReview}
        {review === "summary" && <div className="dash"><SummaryCard projectId={project.id} /></div>}

        <div className="ov-pair">
          <article className="ov-card">
            <div className="ov-card-h"><h2>Recent decisions</h2><Link className="ov-link" href={`/projects/${project.id}/meetings`}>Open meetings</Link></div>
            {loading ? <Skeleton rows={3} /> : decisions.length === 0 ? <EmptyState title="No decisions yet" text="They appear once meeting minutes are drafted." /> : (
              <ul className="ov-rows">{decisions.map((d, i) => (
                <li key={i}><div><strong title={d.text}>{d.text}</strong><span>{d.meetingTitle} · {day(d.heldOn + "T00:00:00")}</span></div>
                  <em className={`ov-tag ${d.status === "Approved" ? "ok" : "warn"}`}>{d.status}</em></li>
              ))}</ul>
            )}
          </article>
          <article className="ov-card">
            <div className="ov-card-h"><h2>Top risks</h2><Link className="ov-link" href={`/projects/${project.id}/risks`}>Open risk register</Link></div>
            {loading ? <Skeleton rows={3} /> : topRisks.length === 0 ? <EmptyState title="No active risks" text="They come from meeting minutes and the risk analysis." /> : (
              <ul className="ov-rows">{topRisks.map((r) => {
                const late = r.evidence.filter((e) => e.daysOverdue).length;
                return (
                  <li key={r.id}><div><strong title={r.title}>{r.title}</strong>
                    <span title={r.reasons.join("\n")}>{[late ? `${late} Jira task${late === 1 ? "" : "s"} late` : "", r.owner ?? "no owner", r.needsIntervention ? "needs your attention" : ""].filter(Boolean).join(" · ")}</span></div>
                    <em className={`ov-tag ${r.severity === "high" ? "bad" : r.severity === "medium" ? "warn" : ""}`}>{sev(r.severity)}</em></li>
                );
              })}</ul>
            )}
          </article>
        </div>
      </>)}

      <div id="documents" className="pd"><DocumentsCard projectId={project.id} /></div>
    </section>
  );
}
