/** What was confirmed when the project was set up, shown on the project page. */

import { money } from "./Badges";
import { dateRange, setupDate } from "@/lib/draft";
import type { Project } from "@/lib/mock";

export function SetupCard({ project: p }: { project: Project }) {
  const facts = [
    ["Project manager", p.manager],
    ["Start and end", dateRange(p.startDate, p.endDate)],
    ["Budget", p.budgetText || (p.budget != null ? money(p.budget) : null)],
    ["Phases", p.phases?.length ? p.phases.join(", ") : null],
  ].filter((f): f is [string, string] => !!f[1]);
  if (facts.length === 0 && p.milestones.length === 0) return null;
  return (
    <section className="np-card np-setup" aria-label="Project setup">
      <div className="np-card-h"><h2>Project setup</h2></div>
      {facts.map(([label, value]) => <div className="np-field" key={label}><span className="np-label">{label}</span><span className="np-value">{value}</span></div>)}
      {p.milestones.map((m, i) => (
        <div className="np-field" key={`${m.title}-${i}`}>
          <span className="np-label">{i === 0 ? "Milestones" : ""}</span>
          <span className="np-value">{m.title}</span>
          <span className={`np-tag${m.done ? " ok" : ""}`}>{m.done ? "Done" : m.due ? setupDate(m.due) : "No date"}</span>
        </div>
      ))}
    </section>
  );
}
