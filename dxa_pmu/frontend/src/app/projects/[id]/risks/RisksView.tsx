"use client";

/** The risk register and the risks DXA suggests (Figma RK-01). A suggestion stays one until a person confirms it. */

import { Fragment, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useStore } from "@/components/Store";
import { Empty, ErrorNote, Modal, PageHead, Person, Section, Tag, cap, levelTone, plural, shortDate } from "@/components/ui";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import type { Level, RegisterRisk, RisksData } from "@/lib/mock";

type View = "register" | "suggested" | "high" | "medium" | "low" | "noowner";
const LEVELS: Level[] = ["high", "medium", "low"];
const TREND = { rising: "↑ Rising", steady: "— Steady", falling: "↓ Falling" } as const;
export const riskId = (r: RegisterRisk) => `R-${String(r.number ?? 0).padStart(2, "0")}`;
const sourceName = (r: RegisterRisk) => (r.source === "meeting" ? r.sourceRef ?? "Meeting" : r.source === "analysis" ? "AI risk analysis" : "Added by hand");

export function RisksView() {
  const { id } = useParams<{ id: string }>();
  const { projects } = useStore();
  const project = projects.find((p) => p.id === id);
  const [rows, setRows] = useState<RegisterRisk[] | null>(null);
  const [view, setView] = useState<View>("register");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<RegisterRisk | "new" | null>(null);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api<RegisterRisk[]>(`/projects/${id}/register`).then(setRows).catch((e) => { setRows((v) => v ?? []); setError((e as Error).message); }), [id]);
  useEffect(() => { void load(); }, [load]);

  // Opening the page refreshes DXA's suggestions when Jira, the meetings or the documents changed.
  useEffect(() => {
    if (!project?.jira) return;
    let off = false;
    (async () => {
      try {
        const cur = await api<RisksData>(`/projects/${id}/risks`);
        if (off || cur.status === "ready") return;
        setFinding(true);
        await api<RisksData>(`/projects/${id}/risks`, { method: "POST" });
        if (!off) await load();
      } catch (e) { if (!off) setError((e as Error).message); }
      if (!off) setFinding(false);
    })();
    return () => { off = true; };
  }, [id, !!project?.jira, project?.syncedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  async function find() {
    setFinding(true); setError(null);
    try { await api<RisksData>(`/projects/${id}/risks`, { method: "POST" }); await load(); } catch (e) { setError((e as Error).message); }
    setFinding(false);
  }
  async function change(path: string, method: string, body?: unknown) {
    setError(null);
    try { setRows(await api<RegisterRisk[]>(path, { method, body })); } catch (e) { setError((e as Error).message); }
  }
  const dismiss = (r: RegisterRisk, ask: string) => { if (window.confirm(ask)) void change(`/register/${r.id}`, "DELETE"); };

  const all = rows ?? [];
  const suggested = all.filter((r) => r.status === "suggested");
  const register = all.filter((r) => r.status !== "suggested");
  const live = register.filter((r) => r.status !== "closed");
  const listed = view === "noowner" ? live.filter((r) => !r.owner) : view === "high" || view === "medium" || view === "low" ? live.filter((r) => r.severity === view) : register;
  const unrated = live.filter((r) => !r.likelihood || !r.impact);

  const exportCsv = () => downloadCsv("risk-register.csv", [["ID", "Risk", "Description", "Severity", "Likelihood", "Impact", "Trend", "Owner", "Status", "Source", "Mitigation"],
    ...register.map((r) => [riskId(r), r.title, r.description, r.severity, r.likelihood, r.impact, r.trend, r.owner, r.status, sourceName(r), r.mitigation])]);

  const cells = (impact: Level, likelihood: Level) => live.filter((r) => r.impact === impact && r.likelihood === likelihood);
  const heat = (impact: Level, likelihood: Level) => {
    const n = (v: Level) => (v === "high" ? 2 : v === "medium" ? 1 : 0);
    const sum = n(impact) + n(likelihood);
    return sum >= 3 ? " hot" : sum === 2 ? " mid" : "";
  };
  const moving = [
    { title: "↑ Rising", list: live.filter((r) => r.trend === "rising") },
    { title: "New suggestions", list: suggested },
    { title: "↓ Falling", list: live.filter((r) => r.trend === "falling") },
    { title: "No owner", list: live.filter((r) => !r.owner) },
  ];

  return (
    <Section
      crumbs={[{ label: "Risks" }, { label: view === "suggested" ? "Suggested by DXA" : "Risk register" }]}
      active={view}
      onSelect={(v) => setView(v as View)}
      menu={[
        { items: [{ id: "register", label: "Risk register", icon: "risks", count: live.length }, { id: "suggested", label: "Suggested by DXA", icon: "sparkles", count: suggested.length }] },
        { title: "By severity", items: LEVELS.map((l) => ({ id: l, label: cap(l), icon: "flag", count: live.filter((r) => r.severity === l).length })) },
        { title: "Owner", items: [{ id: "noowner", label: "No owner", icon: "alert", count: live.filter((r) => !r.owner).length }] },
      ]}
      actions={<>
        <button type="button" className="ds-btn sm" disabled={finding || !project?.jira} title={project?.jira ? undefined : "Connect Jira first"} onClick={() => void find()}>{finding ? "DXA is analysing…" : "Find new risks"}</button>
        <button type="button" className="ds-btn sm" onClick={() => setEditing("new")}>Add risk</button>
      </>}
    >
      <PageHead title="Risks" lead="Your risk register, plus potential risks DXA found in the evidence. A suggestion stays a suggestion until someone confirms it." />
      <ErrorNote error={error} />
      {rows === null ? <p className="sub-text">Loading…</p> : (<>
        {view === "register" && (
          <div className="risk-top">
            <section className="panel pad">
              <div className="panel-head" style={{ padding: 0 }}><h2>Risk map</h2><Tag>{live.length} open</Tag></div>
              <span className="sub-text">Uses the likelihood and impact ratings in your register.{unrated.length ? ` ${plural(unrated.length, "risk")} not rated yet.` : ""}</span>
              <div className="risk-map">
                {LEVELS.map((impact) => (
                  <Fragment key={impact}>
                    <span>{cap(impact)} impact</span>
                    {(["low", "medium", "high"] as Level[]).map((likelihood) => {
                      const c = cells(impact, likelihood);
                      return <div key={likelihood} className={`risk-cell${c.length ? heat(impact, likelihood) : ""}`}><b>{c.length}</b>{c.length ? c.map(riskId).join(", ") : "None"}</div>;
                    })}
                  </Fragment>
                ))}
                <span />{["Low", "Medium", "High"].map((l) => <span key={l} className="axis">{l} likelihood</span>)}
              </div>
            </section>
            <section className="panel pad">
              <h2>Moving now</h2>
              <ul className="moving">{moving.map((x) => <li key={x.title}><b>{x.title}</b><span>{x.list.length ? x.list.slice(0, 3).map((r) => `${riskId(r)} ${r.title}`).join("; ") + (x.list.length > 3 ? ` and ${x.list.length - 3} more` : "") : "None"}</span></li>)}</ul>
            </section>
          </div>
        )}

        {(view === "register" || view === "suggested") && (suggested.length > 0 || view === "suggested") && (<>
          <h2 style={{ fontSize: 16, margin: 0 }}>Suggested by DXA <Tag tone="ai">{suggested.length} to review</Tag></h2>
          {suggested.length === 0 ? <Empty title="No suggestions to review" /> : (
            <div className="suggest-grid">
              {suggested.map((r) => (
                <article className="risk-card" key={r.id}>
                  <div className="toolbar-row"><Tag tone="ai">Potential risk</Tag><Tag tone={levelTone(r.severity)}>{cap(r.severity)}</Tag><span className="sub-text">{sourceName(r)}</span></div>
                  <h3>{r.title}</h3>
                  {r.description && <p>{r.description}</p>}
                  {r.evidence.map((e) => <div key={e.key} className="jira-row"><span className="grow">{e.summary}</span><Tag>Jira · {e.key}</Tag></div>)}
                  {r.mitigation && <div className="well"><small>Suggested mitigation, not a decision</small>{r.mitigation}</div>}
                  <div className="suggest-actions">
                    <button type="button" className="link-text" onClick={() => dismiss(r, "Dismiss this suggestion? DXA will not raise it again.")}>Dismiss</button>
                    <button type="button" className="ds-btn sm" onClick={() => setEditing(r)}>Edit</button>
                    <button type="button" className="ds-btn sm primary" onClick={() => void change(`/register/${r.id}`, "PATCH", { status: "open" })}>Add to register</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>)}

        {view !== "suggested" && (
          <section className="panel">
            <div className="panel-head"><h2>Risk register</h2><button type="button" className="link-text" disabled={!register.length} onClick={exportCsv}>Export</button></div>
            {listed.length === 0 ? <Empty title={register.length ? "No risks here" : "No risks in the register yet"} text={register.length ? undefined : "Add a risk, or confirm one of DXA's suggestions."} /> : (
              <div className="table-x"><table className="tbl">
                <thead><tr><th>ID</th><th>Risk</th><th>Severity</th><th>Trend</th><th>Owner</th><th>Status</th></tr></thead>
                <tbody>{listed.map((r) => (
                  <Fragment key={r.id}>
                    <tr className={open === r.id ? "on" : ""}>
                      <td><Tag>{riskId(r)}</Tag></td>
                      <td><button type="button" className="cell-title" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{r.title}</button>
                        <span className="cell-sub">{r.needsIntervention ? `⚑ ${r.reasons[0]}` : sourceName(r)}</span></td>
                      <td><Tag tone={levelTone(r.severity)}>{cap(r.severity)}</Tag></td>
                      <td>{r.trend ? TREND[r.trend] : <span className="sub-text">Not set</span>}</td>
                      <td><Person name={r.owner} /></td>
                      <td><Tag>{r.status === "open" ? "Active" : cap(r.status)}</Tag></td>
                    </tr>
                    {open === r.id && (
                      <tr className="on"><td colSpan={6}><div className="risk-detail">
                        <div className="panel"><span className="eyebrow">Risk statement</span>{r.description || "No description yet."}
                          {r.mitigation && <><span className="eyebrow" style={{ marginTop: 10 }}>Mitigation</span>{r.mitigation}</>}</div>
                        {r.evidence.length > 0 && (
                          <div className="panel"><span className="eyebrow">Linked Jira tasks</span>
                            {r.evidence.map((e) => (
                              <div className="jira-row" key={e.key}>
                                {project?.jira ? <a className="tag" href={`${project.jira.site}/browse/${e.key}`} target="_blank" rel="noreferrer">{e.key}</a> : <Tag>{e.key}</Tag>}
                                <span className="grow">{e.summary}<span className="cell-sub">{e.status} · {e.assignee ?? "no owner"}</span></span>
                                {e.daysOverdue ? <Tag tone="bad">{plural(e.daysOverdue, "day")} late</Tag> : e.due ? <Tag>Due {shortDate(e.due)}</Tag> : <Tag>No date</Tag>}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="toolbar-row">
                          {r.needsIntervention && <span className="bad-text">⚑ Needs your attention: {r.reasons.join("; ")}</span>}
                          <span className="topbar-spacer" />
                          <button type="button" className="link-text" onClick={() => dismiss(r, "Not a risk? It will be removed and DXA will not raise it again.")}>Not a risk</button>
                          <button type="button" className="ds-btn sm" onClick={() => setEditing(r)}>{r.owner ? "Edit" : "Assign owner or edit"}</button>
                        </div>
                      </div></td></tr>
                    )}
                  </Fragment>
                ))}</tbody>
              </table></div>
            )}
          </section>
        )}
      </>)}
      {editing && <RiskForm projectId={id} risk={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(next) => { setRows(next); setEditing(null); }} />}
    </Section>
  );
}

function RiskForm({ projectId, risk, onClose, onSaved }: { projectId: string; risk: RegisterRisk | null; onClose: () => void; onSaved: (rows: RegisterRisk[]) => void }) {
  const [f, setF] = useState({
    title: risk?.title ?? "", description: risk?.description ?? "", mitigation: risk?.mitigation ?? "", owner: risk?.owner ?? "",
    severity: risk?.severity ?? ("medium" as Level), likelihood: risk?.likelihood ?? "", impact: risk?.impact ?? "", trend: risk?.trend ?? "",
    status: risk?.status ?? "open",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    const body = { ...f, title: f.title.trim(), owner: f.owner.trim() || null, likelihood: f.likelihood || null, impact: f.impact || null, trend: f.trend || null };
    try {
      // editing a suggestion keeps it a suggestion; only "Add to register" confirms it
      onSaved(await api<RegisterRisk[]>(risk ? `/register/${risk.id}` : `/projects/${projectId}/register`, { method: risk ? "PATCH" : "POST", body: risk?.status === "suggested" ? { ...body, status: undefined } : body }));
    } catch (err) { setError((err as Error).message); setSaving(false); }
  }

  const choose = (k: "severity" | "likelihood" | "impact" | "trend", label: string, options: string[], none?: string) => (
    <div><label htmlFor={`rk-${k}`}>{label}</label><select id={`rk-${k}`} className="field" value={f[k]} onChange={set(k)}>{none && <option value="">{none}</option>}{options.map((o) => <option key={o} value={o}>{cap(o)}</option>)}</select></div>
  );

  return (
    <Modal title={risk ? `Edit ${riskId(risk)}` : "Add a risk"} onClose={onClose}>
      <form onSubmit={(e) => void save(e)} style={{ display: "contents" }}>
        <div><label htmlFor="rk-title">Risk</label><input id="rk-title" className="field" required maxLength={300} value={f.title} onChange={set("title")} /></div>
        <div><label htmlFor="rk-desc">Risk statement</label><textarea id="rk-desc" className="field" rows={3} maxLength={3000} value={f.description} onChange={set("description")} placeholder="If …, then …" /></div>
        <div><label htmlFor="rk-mit">Mitigation</label><textarea id="rk-mit" className="field" rows={2} maxLength={3000} value={f.mitigation} onChange={set("mitigation")} /></div>
        <div className="form-grid">
          <div><label htmlFor="rk-owner">Owner</label><input id="rk-owner" className="field" maxLength={120} value={f.owner} onChange={set("owner")} /></div>
          {choose("severity", "Severity", LEVELS)}
          {choose("likelihood", "Likelihood", LEVELS, "Not rated")}
          {choose("impact", "Impact", LEVELS, "Not rated")}
          {choose("trend", "Trend", ["rising", "steady", "falling"], "Not set")}
          {risk && risk.status !== "suggested" && <div><label htmlFor="rk-status">Status</label><select id="rk-status" className="field" value={f.status} onChange={set("status")}>{["open", "mitigating", "accepted", "closed"].map((o) => <option key={o} value={o}>{o === "open" ? "Active" : cap(o)}</option>)}</select></div>}
        </div>
        <ErrorNote error={error} />
        <div className="dlg-actions"><button type="button" className="ds-btn" onClick={onClose}>Cancel</button><button type="submit" className="ds-btn primary" disabled={saving || !f.title.trim()}>{saving ? "Saving…" : risk ? "Save" : "Add to register"}</button></div>
      </form>
    </Modal>
  );
}
