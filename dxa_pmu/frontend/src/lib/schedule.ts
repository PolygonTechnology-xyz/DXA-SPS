import type { ReportSchedule } from "./mock";

export interface Period { from: string; to: string; label: string }

const pad = (n: number) => String(n).padStart(2, "0");
/** Local calendar date as YYYY-MM-DD (not UTC, so "today" is the user's today). */
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const dayShort = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const monthName = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

export const customLabel = (from: string, to: string) => `${dayShort(from)} – ${day(to)}`;

/** The most recent finished period that should have a report, or null if none is due yet. */
export function duePeriod(s: ReportSchedule, now = new Date()): Period | null {
  if (!s.enabled) return null;
  const y = now.getFullYear();
  const m = now.getMonth();
  if (s.frequency === "monthly") {
    const from = new Date(y, m - 1, 1);
    return { from: iso(from), to: iso(new Date(y, m, 0)), label: monthName(from) };
  }
  if (s.frequency === "quarterly") {
    const q = Math.floor(m / 3);
    const from = new Date(y, q * 3 - 3, 1);
    return { from: iso(from), to: iso(new Date(y, q * 3, 0)), label: `Q${Math.floor(from.getMonth() / 3) + 1} ${from.getFullYear()}` };
  }
  if (!s.from || !s.to || s.from > s.to) return null;
  return s.to <= iso(now) ? { from: s.from, to: s.to, label: customLabel(s.from, s.to) } : null;
}

/** Plain-language description of when the next report is created. */
export function nextRunText(s: ReportSchedule, now = new Date()): string {
  if (!s.enabled) return "Automatic reports are off.";
  const y = now.getFullYear();
  const m = now.getMonth();
  if (s.frequency === "monthly") return `Next report: ${day(iso(new Date(y, m + 1, 1)))}, covering ${monthName(now)}.`;
  if (s.frequency === "quarterly") {
    const q = Math.floor(m / 3);
    return `Next report: ${day(iso(new Date(y, q * 3 + 3, 1)))}, covering Q${q + 1} ${y}.`;
  }
  if (!s.from || !s.to) return "Choose a start and end date.";
  if (s.from > s.to) return "The end date must be after the start date.";
  return s.to <= iso(now)
    ? `The report for ${customLabel(s.from, s.to)} is created as soon as you open the app.`
    : `Report on ${day(s.to)}, covering ${customLabel(s.from, s.to)}.`;
}

export const frequencyName = (s?: ReportSchedule) =>
  !s || !s.enabled ? "Off" : s.frequency === "monthly" ? "Monthly" : s.frequency === "quarterly" ? "Quarterly" : "Custom";
