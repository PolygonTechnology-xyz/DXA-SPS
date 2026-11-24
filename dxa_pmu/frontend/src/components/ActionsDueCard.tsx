"use client";

import { Fragment, useMemo, useState } from "react";
import type { JiraTask, Project } from "@/lib/mock";
import { actionStatus, startOfToday } from "@/lib/analysis";
import { api } from "@/lib/api";

const SHOWN = 6;
const PAGE = 20;
const RANK = { Overdue: 0, "Due soon": 1, "In progress": 2, "On track": 2 } as const;
const dueLabel = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const tone = (l: string) => (l === "Overdue" ? "danger" : l === "Due soon" ? "warn" : l === "In progress" ? "info" : "ok");

interface Row { t: JiraTask; label: string; rank: number }

function useRows(project: Project): { rows: Row[]; overdue: number; soon: number } {
  return useMemo(() => {
    const today = startOfToday();
    const rows = (project.tasks ?? []).filter((t) => t.category !== "done").map((t) => {
      const label = actionStatus(t, today).label;
      return { t, label, rank: t.due ? RANK[label as keyof typeof RANK] : 3 };
    });
    // Most urgent first: overdue, due within a week, dated later, then undated. Ties by date, then key.
    rows.sort((a, b) => a.rank - b.rank || (a.t.due ?? "9999").localeCompare(b.t.due ?? "9999") || a.t.key.localeCompare(b.t.key, undefined, { numeric: true }));
    return { rows, overdue: rows.filter((r) => r.label === "Overdue").length, soon: rows.filter((r) => r.label === "Due soon").length };
  }, [project.tasks]);
}

function TaskLink({ t, site }: { t: JiraTask; site?: string }) {
  return site ? <a href={`${site}/browse/${t.key}`} target="_blank" rel="noreferrer">{t.key}</a> : <>{t.key}</>;
}

interface Sum { open: boolean; busy?: boolean; text?: string; error?: string }

/** Each task has a Summary button: the AI writes a short summary of that task when asked. It is shown, never saved. */
function ActionTable({ rows, site, projectId }: { rows: Row[]; site?: string; projectId: string }) {
  const [sums, setSums] = useState<Record<string, Sum>>({});
  const set = (key: string, v: Sum) => setSums((s) => ({ ...s, [key]: v }));

  async function toggle(key: string) {
    const cur = sums[key];
    if (cur?.busy) return;
    if (cur?.text) { set(key, { ...cur, open: !cur.open }); return; }
    set(key, { open: true, busy: true });
    try {
      const r = await api<{ summary: string }>(`/projects/${projectId}/tasks/${encodeURIComponent(key)}/summary`, { method: "POST" });
      set(key, { open: true, text: r.summary });
    } catch (e) {
      set(key, { open: true, error: (e as Error).message });
    }
  }

  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Status</th><th><span className="visually-hidden">Summary</span></th></tr></thead>
        <tbody>
          {rows.map(({ t, label }) => {
            const s = sums[t.key];
            return (
              <Fragment key={t.key}>
                <tr>
                  <td><span className="act-key"><TaskLink t={t} site={site} /></span> {t.summary}</td>
                  <td>{t.assignee ?? <span className="muted">Unassigned</span>}</td>
                  <td className="nowrap">{t.due ? dueLabel(t.due) : <span className="muted">No date</span>}</td>
                  <td><span className={`badge badge-${tone(label)}`}>{label}</span></td>
                  <td className="nowrap">
                    <button className="btn sum-btn" aria-expanded={!!s?.open} disabled={s?.busy} onClick={() => void toggle(t.key)}>
                      {s?.busy ? "Summarising…" : s?.open && s.text ? "Hide" : "✨ Summary"}
                    </button>
                  </td>
                </tr>
                {s?.open && (
                  <tr className="sum-row">
                    <td colSpan={5}>
                      {s.busy && <span className="muted">The AI is reading {t.key}…</span>}
                      {s.error && <span className="sum-err" role="alert">⚠ {s.error} <button className="link-btn" onClick={() => void toggle(t.key)}>Try again</button></span>}
                      {s.text && <><p className="sum-text">{s.text}</p><span className="muted small">AI summary of {t.key} · not saved</span></>}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The few actions that need attention, with a searchable, paged list of everything behind "View all". */
export function ActionsDueCard({ project }: { project: Project }) {
  const { rows, overdue, soon } = useRows(project);
  const [all, setAll] = useState(false);
  const site = project.jira?.site;
  const note = rows.length === 0 ? "" : overdue + soon > 0 ? `${overdue} overdue · ${soon} due soon · ${rows.length} open` : `Nothing urgent · ${rows.length} open`;
  return (
    <article className="card full">
      <div className="card-head"><h3>Actions needing attention</h3><span className="muted small">{note || "From Jira"}</span></div>
      {rows.length === 0 ? <p className="muted pad">No open actions. Nice work.</p> : (
        <>
          <ActionTable rows={rows.slice(0, SHOWN)} site={site} projectId={project.id} />
          {rows.length > SHOWN && <button className="show-more" onClick={() => setAll(true)}>View all {rows.length} open actions →</button>}
        </>
      )}
      {all && <AllActionsModal rows={rows} site={site} projectId={project.id} onClose={() => setAll(false)} />}
    </article>
  );
}

type Filter = "all" | "overdue" | "soon" | "nodate" | "unassigned";
const FILTERS: { id: Filter; label: string; test: (r: Row) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "overdue", label: "Overdue", test: (r) => r.label === "Overdue" },
  { id: "soon", label: "Due soon", test: (r) => r.label === "Due soon" },
  { id: "nodate", label: "No date", test: (r) => !r.t.due },
  { id: "unassigned", label: "Unassigned", test: (r) => !r.t.assignee },
];

function AllActionsModal({ rows, site, projectId, onClose }: { rows: Row[]; site?: string; projectId: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const test = FILTERS.find((f) => f.id === filter)!.test;
  const needle = q.trim().toLowerCase();
  const list = rows.filter((r) => test(r) && (!needle || `${r.t.key} ${r.t.summary} ${r.t.assignee ?? "unassigned"}`.toLowerCase().includes(needle)));
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const at = Math.min(page, pages - 1);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="All open actions">
        <h3>All open actions <span className="muted small">({rows.length})</span></h3>
        <input className="field" placeholder="Search by task, key or owner…" value={q} aria-label="Search actions" autoFocus
          onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <div className="chips" role="group" aria-label="Filter">
          {FILTERS.map((f) => {
            const n = rows.filter(f.test).length;
            return <button key={f.id} className={`chip${filter === f.id ? " on" : ""}`} aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setPage(0); }}>{f.label} <strong>{n}</strong></button>;
          })}
        </div>
        {list.length === 0 ? <p className="muted">No actions match.</p> : <ActionTable rows={list.slice(at * PAGE, (at + 1) * PAGE)} site={site} projectId={projectId} />}
        <div className="row end pager">
          <span className="muted small">{list.length === 0 ? "0" : `${at * PAGE + 1}–${Math.min(list.length, (at + 1) * PAGE)}`} of {list.length}</span>
          <button className="btn" disabled={at === 0} onClick={() => setPage(at - 1)}>← Previous</button>
          <button className="btn" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next →</button>
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
