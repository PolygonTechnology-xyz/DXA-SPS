"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { RegisterRisk } from "@/lib/mock";

const SEV = { high: "High", medium: "Medium", low: "Low" } as const;

/** The risk register. The AI fills it from meetings and Jira; a person can only remove what is not a risk. */
export function RiskRegister({ projectId, site, reload }: { projectId: string; site?: string; reload: number }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [rows, setRows] = useState<RegisterRisk[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (path: string, method: string) => {
    setError(null);
    try { setRows(await api<RegisterRisk[]>(path, { method })); }
    catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { void run(`/projects/${projectId}/register`, "GET"); }, [run, projectId, reload]);

  const flagged = rows?.filter((r) => r.needsIntervention).length ?? 0;
  const live = rows?.filter((r) => r.status !== "closed").length ?? 0;

  return (
    <section className="pd-card reg">
      <div style={{ marginBottom: 8 }}>
        <h3 className="reg-h">Risk register</h3>
        <p className="pd-sub">{rows ? `${live} risk${live === 1 ? "" : "s"}${flagged ? ` · ${flagged} need your attention` : ""}` : "Loading…"}</p>
      </div>
      {error && <div className="note bad" role="alert">⚠ {error}</div>}
      {rows && rows.length === 0 && <p className="empty">No risks yet. The AI adds them when meeting minutes are drafted and when it analyses Jira.</p>}
      {rows && rows.length > 0 && (
        <div className="reg-wrap">
          <table className="reg-table">
            <thead><tr><th>Risk</th><th>Severity</th><th>Owner</th><th>Source</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.title}</b>
                    <small className={open.has(r.id) ? "" : "reg-clamp"}>{r.description}</small>
                    {open.has(r.id) && (<>
                      {r.mitigation && <small><i>Action:</i> {r.mitigation}</small>}
                      {r.evidence.length > 0 && (
                        <div className="reg-tasks">
                          <b>Tasks behind this risk</b>
                          {r.evidence.map((e) => (
                            <a key={e.key} className="reg-task" href={site ? `${site}/browse/${e.key}` : undefined} target="_blank" rel="noreferrer">
                              <span className="reg-key">{e.key}</span>
                              <span>{e.summary}</span>
                              <span className="pd-muted">{[e.status, e.assignee ?? "unassigned", e.due ? `due ${e.due}` : "no date"].join(" · ")}</span>
                              {e.daysOverdue ? <span className="reg-late">{e.daysOverdue} d late</span> : null}
                            </a>
                          ))}
                        </div>
                      )}
                    </>)}
                    {(r.description.length > 140 || r.mitigation || r.evidence.length > 0) && (
                      <button className="pd-link left" aria-expanded={open.has(r.id)} onClick={() => toggle(r.id)}>{open.has(r.id) ? "Show less ▴" : `Show more${r.evidence.length ? ` · ${r.evidence.length} task${r.evidence.length === 1 ? "" : "s"}` : ""} ▾`}</button>
                    )}
                    {r.needsIntervention && <span className="reg-flag" title={r.reasons.join("\n")}>⚑ Needs your attention · {r.reasons[0]}</span>}
                  </td>
                  <td><span className={`pd-sev ${r.severity}`}>{SEV[r.severity]}</span></td>
                  <td>{r.owner ?? <span className="pd-muted">Not named</span>}</td>
                  <td><span className="pd-muted">{r.source === "meeting" ? r.sourceRef ?? "Meeting" : r.source === "analysis" ? "AI risk analysis" : "Added by hand"}</span></td>
                  <td><button className="reg-no" title="Remove it. The AI will not raise it again." onClick={() => { if (confirm("Not a risk? It will be removed and the AI will not raise it again.")) void run(`/register/${r.id}`, "DELETE"); }}><span aria-hidden>✕</span> Not a risk</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
