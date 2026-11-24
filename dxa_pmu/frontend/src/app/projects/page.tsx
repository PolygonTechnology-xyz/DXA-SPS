"use client";

import Link from "next/link";
import { useState } from "react";
import { HealthDot, Progress, StatusChip } from "@/components/Badges";
import { useStore } from "@/components/Store";
import { STATUSES } from "@/lib/mock";

export default function AllProjects() {
  const { projects, ready, loadError } = useStore();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const shown = projects.filter(
    (p) =>
      (!status || p.status === status) &&
      (p.name + p.code + (p.manager ?? "")).toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <header className="topbar"><h2>All Projects</h2></header>
      <div className="page">
        <div className="page-inner wide">
          <div className="toolbar">
            <input className="field" placeholder="Search by name, code or manager…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <Link href="/projects/new" className="btn primary">＋ Create Project</Link>
          </div>
          {!ready ? (
            <p className="empty">Loading…</p>
          ) : loadError ? (
            <div className="note bad" role="alert">⚠ {loadError}</div>
          ) : shown.length === 0 ? (
            <p className="empty">{projects.length === 0 ? "No projects yet. Create your first one from the chat." : "No projects match your filters."}</p>
          ) : (
            <div className="grid">
              {shown.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="card proj-card">
                  <div className="row between">
                    <small className="muted">{p.code}</small>
                    <StatusChip status={p.status} />
                  </div>
                  <h3>{p.name}</h3>
                  <p className="muted clamp">{p.goal}</p>
                  <Progress value={p.progress} />
                  <div className="row between small">
                    <HealthDot health={p.health} />
                    <span className="muted">{p.progress}%{p.manager ? ` · ${p.manager}` : ""}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
