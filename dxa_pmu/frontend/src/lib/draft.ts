/** Helpers for the New project draft. */

import type { NewProjectInput, ProjectDraft } from "./mock";

const empty = () => ({ value: null, pages: [] });

export const emptyDraft = (): ProjectDraft => ({
  name: empty(), goal: empty(), manager: empty(), start: empty(), end: empty(), budget: empty(),
  phases: [], phasePages: [], milestones: [], milestonePages: [],
});

export const hasContent = (d: ProjectDraft) =>
  [d.name, d.goal, d.manager, d.start, d.end, d.budget].some((f) => f.value) || d.phases.length > 0 || d.milestones.length > 0;

export const SETUP_DATE = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

/** "2026-01" as "Jan 2026", "2026-01-31" as "31 Jan 2026". */
export function setupDate(v: string) {
  const full = v.length === 10;
  return new Date(`${v}${full ? "" : "-01"}T00:00:00`).toLocaleDateString("en-GB", full ? { day: "numeric", month: "short", year: "numeric" } : { month: "short", year: "numeric" });
}

export function dateRange(start?: string | null, end?: string | null) {
  if (start && end) return `${setupDate(start)} to ${setupDate(end)}`;
  if (start) return `Starts ${setupDate(start)}`;
  return end ? `Ends ${setupDate(end)}` : null;
}

/** [1] as "Page 1", [4,5,6] as "Pages 4 to 6", [1,3] as "Pages 1, 3". */
export function pageLabel(pages: number[]) {
  if (pages.length === 0) return null;
  const p = [...new Set(pages)].sort((a, b) => a - b);
  if (p.length === 1) return `Page ${p[0]}`;
  const run = p.every((n, i) => i === 0 || n === p[i - 1] + 1);
  return run ? `Pages ${p[0]} to ${p[p.length - 1]}` : `Pages ${p.join(", ")}`;
}

export function phaseSummary(phases: string[]) {
  if (phases.length === 0) return null;
  return phases.length === 1 ? `1 found: ${phases[0]}` : `${phases.length} found: ${phases[0]} to ${phases[phases.length - 1]}`;
}

export function milestoneSummary(list: ProjectDraft["milestones"]) {
  if (list.length === 0) return null;
  const first = list.map((m) => m.due).filter((d): d is string => !!d).sort()[0];
  return `${list.length} found, ${first ? `first due ${setupDate(first)}` : "no dates yet"}`;
}

export const toNewProject = (d: ProjectDraft): NewProjectInput => ({
  name: (d.name.value ?? "").trim(),
  goal: d.goal.value ?? "",
  manager: d.manager.value,
  startDate: d.start.value,
  endDate: d.end.value,
  budgetText: d.budget.value,
  phases: d.phases,
  milestones: d.milestones.map((m) => ({ title: m.title, due: m.due ?? "" })),
});
