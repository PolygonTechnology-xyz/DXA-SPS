"use client";

import type { Project } from "@/lib/mock";
import { analyse } from "@/lib/analysis";

// Same palette as the PDF report.
const GREY = "#94a3b8", GREEN = "#16a34a", AMBER = "#f59e0b", RED = "#dc2626", ACCENT = "#4f46e5";

interface Part { label: string; value: number; color: string }

function Legend({ parts }: { parts: Part[] }) {
  return (
    <ul className="chart-legend">
      {parts.map((p) => (
        <li key={p.label}><span className="swatch" style={{ background: p.color }} />{p.label} <strong>{p.value}</strong></li>
      ))}
    </ul>
  );
}

const summary = (parts: Part[]) => parts.map((p) => `${p.label} ${p.value}`).join(", ");

function Pie({ parts }: { parts: Part[] }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((n, p) => n + p.value, 0);
  const R = 50;
  let angle = -Math.PI / 2;
  return (
    <div className="chart-row">
      <svg viewBox="-55 -55 110 110" className="pie" role="img" aria-label={`Tasks by status: ${summary(parts)}`}>
        {shown.length === 1 ? <circle r={R} fill={shown[0].color} /> : shown.map((p) => {
          const a0 = angle, a1 = angle + (p.value / total) * 2 * Math.PI;
          angle = a1;
          const [x0, y0, x1, y1] = [Math.cos(a0) * R, Math.sin(a0) * R, Math.cos(a1) * R, Math.sin(a1) * R];
          return <path key={p.label} d={`M0 0 L${x0} ${y0} A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1} Z`} fill={p.color} stroke="var(--surface, #fff)" strokeWidth="1" />;
        })}
      </svg>
      <Legend parts={parts} />
    </div>
  );
}

function Bars({ parts, label }: { parts: Part[]; label: string }) {
  const max = Math.max(1, ...parts.map((p) => p.value));
  const W = 260, H = 110, base = 92, bw = 40, gap = (W - parts.length * bw) / (parts.length + 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="bars" role="img" aria-label={`${label}: ${summary(parts)}`}>
      <line x1="0" x2={W} y1={base} y2={base} stroke="var(--line, #e4e4df)" />
      {parts.map((p, i) => {
        const h = (p.value / max) * (base - 18);
        const x = gap + i * (bw + gap);
        return (
          <g key={p.label}>
            <rect x={x} y={base - h} width={bw} height={h} rx="3" fill={p.color} />
            <text x={x + bw / 2} y={base - h - 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor">{p.value}</text>
            <text x={x + bw / 2} y={base + 13} textAnchor="middle" fontSize="10" fill="currentColor" opacity=".7">{p.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Workload({ project }: { project: Project }) {
  const rows = [...analyse(project).load.entries()]
    .map(([name, r]) => ({ name, todo: r.open - r.inProgress, prog: r.inProgress, done: r.done, total: r.open + r.done }))
    .sort((a, b) => (b.todo + b.prog) - (a.todo + a.prog) || a.name.localeCompare(b.name))
    .slice(0, 12);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const legend: Part[] = [{ label: "To do", value: rows.reduce((n, r) => n + r.todo, 0), color: GREY }, { label: "In progress", value: rows.reduce((n, r) => n + r.prog, 0), color: ACCENT }, { label: "Done", value: rows.reduce((n, r) => n + r.done, 0), color: GREEN }];
  return (
    <>
      <div className="wl" role="img" aria-label={`Workload by owner: ${rows.map((r) => `${r.name} ${r.todo} to do, ${r.prog} in progress, ${r.done} done`).join("; ")}`}>
        {rows.map((r) => (
          <div className="wl-row" key={r.name}>
            <span className="wl-name" title={r.name}>{r.name}</span>
            <div className="wl-track" style={{ width: `${(r.total / max) * 100}%` }}>
              {[[r.todo, GREY, "To do"], [r.prog, ACCENT, "In progress"], [r.done, GREEN, "Done"]].map(([n, c, l]) => (n as number) > 0 && (
                <span key={l as string} className="wl-seg" style={{ flex: n as number, background: c as string }} title={`${l}: ${n}`}>{n as number}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Legend parts={legend} />
    </>
  );
}

/** The report's charts, drawn from the project's Jira tasks. */
export function Charts({ project }: { project: Project }) {
  const a = analyse(project);
  if (a.tasks.length === 0) return null;
  const status: Part[] = [{ label: "To do", value: a.todo.length, color: GREY }, { label: "In progress", value: a.inProgress.length, color: ACCENT }, { label: "Done", value: a.done, color: GREEN }];
  const dated = a.open.length - a.noDate.length;
  const schedule: Part[] = [
    { label: "Overdue", value: a.overdue.length, color: RED },
    { label: "Due soon", value: a.dueSoon.length, color: AMBER },
    { label: "On track", value: dated - a.overdue.length - a.dueSoon.length, color: GREEN },
    { label: "No date", value: a.noDate.length, color: GREY },
  ];
  return (
    <>
      <article className="card span-5">
        <div className="card-head"><h3>Tasks by status</h3><span className="muted small">{a.tasks.length} tasks</span></div>
        <div className="chart-body"><Pie parts={status} /></div>
      </article>
      <article className="card span-7">
        <div className="card-head"><h3>Open tasks by schedule</h3><span className="muted small">{a.open.length} open</span></div>
        <div className="chart-body">{a.open.length === 0 ? <p className="muted">No open tasks.</p> : <Bars parts={schedule} label="Open tasks by schedule" />}</div>
      </article>
      <article className="card full">
        <div className="card-head"><h3>Workload by owner</h3><span className="muted small">Tasks per person</span></div>
        <div className="chart-body"><Workload project={project} /></div>
      </article>
    </>
  );
}
