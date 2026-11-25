"use client";

/** All projects (Figma WS-01). */

import Link from "next/link";
import { useState } from "react";
import { Menu } from "@/components/Menu";
import { useStore } from "@/components/Store";
import { band } from "@/components/Gauge";
import { Chips, ErrorNote, PageHead, Person, Search, Tag, shortDate, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { iso } from "@/lib/schedule";
import { STATUSES, type Project, type ProjectStatus } from "@/lib/mock";

const STATUS_TONE: Record<ProjectStatus, Tone> = { Planning: "neutral", Active: "brand", "On hold": "warn", Completed: "ok" };
// the order the design shows them in
const FILTERS: ProjectStatus[] = ["Active", "Planning", "On hold", "Completed"];

function nextStep(p: Project) {
  const today = iso(new Date());
  const next = p.milestones.filter((m) => !m.done && m.due >= today).sort((a, b) => a.due.localeCompare(b.due))[0];
  return next ? `Next: ${next.title}, ${shortDate(next.due)}` : "No upcoming milestone";
}

function Card({ project: p, onError }: { project: Project; onError: (e: string | null) => void }) {
  const { patchProject, dropProject } = useStore();
  const score = p.score ?? null;
  const b = score === null ? null : band(score);

  async function remove() {
    if (!window.confirm(`Delete "${p.name}"? Its meetings, reports, risks and documents are deleted too. This can't be undone.`)) return;
    onError(null);
    try { await api(`/projects/${p.id}`, { method: "DELETE" }); dropProject(p.id); } catch (e) { onError((e as Error).message); }
  }

  return (
    <article className="pcard">
      <div className="pcard-head"><Tag>{p.code}</Tag><Tag tone={STATUS_TONE[p.status]}>{p.status}</Tag></div>
      <Menu className="pcard-menu" buttonClass="more-btn" label={`More options for ${p.name}`} button={<span aria-hidden>•••</span>}>
        {(close) => (<>
          {STATUSES.filter((s) => s !== p.status).map((s) => (
            <button type="button" key={s} className="menu-item" onClick={() => { close(); onError(null); patchProject(p.id, { status: s }).catch((e) => onError((e as Error).message)); }}>Mark as {s}</button>
          ))}
          <button type="button" className="menu-item all bad-text" onClick={() => { close(); void remove(); }}>Delete project</button>
        </>)}
      </Menu>
      <div>
        <h2><Link href={`/projects/${p.id}`}>{p.name}</Link></h2>
        <p className="pcard-goal">{p.goal || "No goal yet"}</p>
      </div>
      <div className="progress-line">
        <span className={`track${p.status === "Completed" ? " done" : ""}`}><i style={{ width: `${progress(p)}%` }} /></span>
        <span>{progress(p)}%</span>
        {p.status === "Completed" ? <Tag tone="ok">Closed</Tag> : b ? <Tag tone={b.cls === "ok" ? "ok" : b.cls === "warn" ? "warn" : "bad"}>{b.label} · {score}</Tag> : <Tag>No score yet</Tag>}
      </div>
      <div className="pcard-foot"><Person name={p.manager} none="No manager yet" /><span className="sub-text">{nextStep(p)}</span></div>
    </article>
  );
}

/** Share of Jira tasks that are done; the stored figure when there are none. */
function progress(p: Project) {
  const tasks = p.tasks ?? [];
  return tasks.length ? Math.round((tasks.filter((t) => t.category === "done").length / tasks.length) * 100) : p.progress;
}

export default function AllProjects() {
  const { projects, ready, loadError } = useStore();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | ProjectStatus>("all");
  const [error, setError] = useState<string | null>(null);

  const shown = projects.filter((p) => (status === "all" || p.status === status) && `${p.name} ${p.code} ${p.manager ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="ws-page">
      <PageHead title="All projects" lead="Projects you manage or follow. Health scores update after each Jira sync." />
      <div className="toolbar-row">
        <Search value={q} onChange={setQ} placeholder="Search by name, code or manager" />
        <Chips label="Filter by status" value={status} onChange={setStatus}
          options={[{ id: "all", label: "All", count: projects.length }, ...FILTERS.map((s) => ({ id: s, label: s, count: projects.filter((p) => p.status === s).length }))]} />
      </div>
      <ErrorNote error={error ?? loadError} />
      {!ready ? <p className="sub-text">Loading…</p> : !loadError && shown.length === 0 ? (
        <p className="sub-text">{projects.length === 0 ? "No projects yet. Choose New project to create one." : "No projects match your filters."}</p>
      ) : <div className="pcards">{shown.map((p) => <Card key={p.id} project={p} onError={setError} />)}</div>}
    </div>
  );
}
