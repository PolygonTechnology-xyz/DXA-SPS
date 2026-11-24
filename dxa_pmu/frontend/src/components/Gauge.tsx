"use client";

import GaugeComponent from "react-gauge-component";
import type { Project } from "@/lib/mock";
import { actionStatus, startOfToday } from "@/lib/analysis";

export interface Factor { label: string; points: number; note: string }

/** DXA score, 0–100, computed from the Jira data. Each factor can only subtract, so the list explains the score. */
export function scoreProject(project: Project, approvedHigh?: number) {
  const tasks = project.tasks ?? [];
  const today = startOfToday();
  const open = tasks.filter((t) => t.category !== "done");
  const overdue = open.filter((t) => actionStatus(t, today).label === "Overdue").length;
  const high = approvedHigh ?? 0; // high risks come from the risk register, not from task priority
  const unassigned = open.filter((t) => !t.assignee).length;
  const noDate = open.filter((t) => !t.due).length;
  const o = open.length || 1;
  const factors: Factor[] = [
    { label: "Overdue work", points: Math.min(40, Math.round((overdue / o) * 80)), note: `${overdue} of ${open.length} open items are past due` },
    { label: "High risks", points: Math.min(30, high * 10), note: `${high} high-severity risk${high === 1 ? "" : "s"}` },
    { label: "No owner", points: Math.min(15, Math.round((unassigned / o) * 30)), note: `${unassigned} open items unassigned` },
    { label: "No due date", points: Math.min(15, Math.round((noDate / o) * 15)), note: `${noDate} open items without a date` },
  ];
  const score = tasks.length ? Math.max(0, 100 - factors.reduce((a, f) => a + f.points, 0)) : null;
  return { score, factors };
}

export const band = (s: number) => (s < 40 ? { label: "Critical", cls: "bad" } : s < 70 ? { label: "At risk", cls: "warn" } : { label: "On track", cls: "ok" });

export function Gauge({ value }: { value: number }) {
  return (
    <div className="gauge" role="img" aria-label={`Project health ${value} out of 100`}>
      <GaugeComponent
        type="semicircle"
        value={value}
        minValue={0}
        maxValue={100}
        marginInPercent={{ top: 0.06, bottom: 0, left: 0.06, right: 0.06 }}
        arc={{
          width: 0.16, padding: 0.02, cornerRadius: 8,
          subArcs: [{ limit: 40, color: "#b8261f" }, { limit: 70, color: "#e08a1e" }, { limit: 100, color: "#10a392" }],
        }}
        pointer={{ type: "needle", color: "#0b3a4a", baseColor: "#0b3a4a", length: 0.7, width: 12, animate: true, elastic: false }}
        labels={{
          valueLabel: { hide: true },
          tickLabels: { type: "outer", hideMinMax: false, defaultTickValueConfig: { style: { fontSize: "11px", fill: "#6a7472" } }, ticks: [{ value: 0 }, { value: 100 }], defaultTickLineConfig: { hide: true } },
        }}
      />
    </div>
  );
}
