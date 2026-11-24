import type { JiraTask, Project } from "./mock";

export const DAY = 86_400_000;

export type Tone = "danger" | "warn" | "info" | "ok";

export const startOfToday = () => new Date(new Date().toDateString()).getTime();

export function actionStatus(t: JiraTask, today: number): { label: string; tone: Tone } {
  if (t.due) {
    const diff = new Date(t.due + "T00:00:00").getTime() - today;
    if (diff < 0) return { label: "Overdue", tone: "danger" };
    if (diff <= 7 * DAY) return { label: "Due soon", tone: "warn" };
  }
  return t.category === "indeterminate" ? { label: "In progress", tone: "info" } : { label: "On track", tone: "ok" };
}

export const isHigh = (t: JiraTask) => /^(highest|high|critical|blocker|major)$/i.test(t.priority ?? "");
export const isRisk = (t: JiraTask) => t.type.toLowerCase() === "bug" || isHigh(t);

export function analyse(project: Project) {
  const tasks = project.tasks ?? [];
  const today = startOfToday();
  const open = tasks.filter((t) => t.category !== "done");
  const overdue = open.filter((t) => actionStatus(t, today).label === "Overdue");
  const dueSoon = open.filter((t) => actionStatus(t, today).label === "Due soon");
  const risks = open.filter(isRisk);
  const highRisks = risks.filter(isHigh);
  const todo = tasks.filter((t) => t.category === "new");
  const inProgress = tasks.filter((t) => t.category === "indeterminate");
  const done = tasks.length - open.length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const unassigned = open.filter((t) => !t.assignee);
  const noDate = open.filter((t) => !t.due);

  const load = new Map<string, { open: number; inProgress: number; done: number }>();
  for (const t of tasks) {
    const who = t.assignee ?? "Unassigned";
    const row = load.get(who) ?? { open: 0, inProgress: 0, done: 0 };
    if (t.category === "done") row.done++;
    else { row.open++; if (t.category === "indeterminate") row.inProgress++; }
    load.set(who, row);
  }

  const findings: string[] = [];
  if (tasks.length === 0) findings.push("No tasks were found in Jira, so progress cannot be measured yet.");
  if (overdue.length) findings.push(`${overdue.length} open ${overdue.length === 1 ? "task is" : "tasks are"} overdue (${overdue.map((t) => t.key).join(", ")}). Agree a new date or unblock ${overdue.length === 1 ? "it" : "them"} first.`);
  if (dueSoon.length) findings.push(`${dueSoon.length} ${dueSoon.length === 1 ? "task is" : "tasks are"} due within 7 days.`);
  if (highRisks.length) findings.push(`${highRisks.length} high-severity ${highRisks.length === 1 ? "item needs" : "items need"} attention: ${highRisks.map((t) => t.key).join(", ")}.`);
  if (unassigned.length) findings.push(`${unassigned.length} open ${unassigned.length === 1 ? "task has" : "tasks have"} no owner. Assign owners so work does not stall.`);
  if (open.length && noDate.length === open.length) findings.push("None of the open tasks has a due date, so delays cannot be detected. Add due dates in Jira.");
  else if (noDate.length) findings.push(`${noDate.length} open ${noDate.length === 1 ? "task has" : "tasks have"} no due date.`);
  if (inProgress.length && inProgress.length >= Math.max(5, todo.length * 2)) findings.push("Many tasks are in progress at once. Consider finishing some before starting new work.");
  if (tasks.length && !overdue.length && !highRisks.length && !unassigned.length) findings.push("No overdue, high-severity or unowned items. The project looks healthy.");

  const headline = tasks.length === 0
    ? "No Jira tasks are available yet."
    : `${done} of ${tasks.length} tasks are complete (${pct}%). ${open.length} remain open${overdue.length ? `, ${overdue.length} of them overdue` : ""}.`;

  return { tasks, today, open, overdue, dueSoon, risks, highRisks, todo, inProgress, done, pct, unassigned, noDate, load, findings, headline };
}
