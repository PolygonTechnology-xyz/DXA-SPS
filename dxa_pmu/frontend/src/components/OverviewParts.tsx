"use client";

/** Building blocks of the Overview screen (Figma OV-01 and its states, OV-01b). */

import Link from "next/link";
import { useState } from "react";
import { FigmaIcon } from "./FigmaIcon";
import { iso } from "@/lib/schedule";

export function EmptyState({ title, text, positive }: { title: string; text: string; positive?: boolean }) {
  return <div className={`ov-empty${positive ? " positive" : ""}`}>{positive && <i aria-hidden>✓</i>}<strong>{title}</strong><span>{text}</span></div>;
}

export function Skeleton({ rows }: { rows: number }) {
  return <div className="ov-skeleton" role="status" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <i key={i} />)}</div>;
}

/** A number tile. Without a value it shows a dash, so missing data is never mistaken for zero. */
export function Stat({ icon, value, unit, label, note, tone }: { icon: string; value?: number; unit?: string; label: string; note: string; tone?: "warn" | "bad" }) {
  return (
    <article className="ov-card ov-stat">
      <span className="ov-stat-ic"><FigmaIcon name={icon} size={16} /></span>
      <p className="ov-stat-v"><b>{value ?? "—"}</b>{unit && <span>{unit}</span>}</p>
      <strong>{label}</strong>
      <span className={tone ?? ""}>{note}</span>
    </article>
  );
}

export interface Approval {
  key: string;
  tone: "brand" | "warn" | "bad";
  icon: string;
  title: string;
  detail: string;
  when?: string;
  action: string;
  href?: string;
  onClick?: () => void;
}

const APPROVALS_SHOWN = 5;

export function ApprovalList({ items }: { items: Approval[] }) {
  const [all, setAll] = useState(false);
  return (<>
    <ul className="ov-approvals">
      {(all ? items : items.slice(0, APPROVALS_SHOWN)).map((a, i) => (
        <li key={a.key} className={a.tone}>
          <span className="ov-ap-ic"><FigmaIcon name={a.icon} size={18} /></span>
          <div><strong title={a.title}>{a.title}</strong><span>{a.detail}</span></div>
          {a.when && <time>{a.when}</time>}
          {a.href
            ? <Link className={`ds-btn sm${i === 0 ? " primary" : ""}`} href={a.href}>{a.action}</Link>
            : <button type="button" className={`ds-btn sm${i === 0 ? " primary" : ""}`} onClick={a.onClick}>{a.action}</button>}
        </li>
      ))}
    </ul>
    {items.length > APPROVALS_SHOWN && <button type="button" className="ov-link" onClick={() => setAll((v) => !v)} aria-expanded={all}>{all ? "Show fewer" : `See all ${items.length}`}</button>}
  </>);
}

export interface CalendarEntry { key: string; title: string; date: string; who: string; kind: "Overdue" | "Action" | "Milestone"; href?: string }

const UPCOMING_SHOWN = 4;
const parse = (d: string) => new Date(d + "T00:00:00");

/** This week, then what is late or coming up: open Jira tasks with a due date, and unfinished milestones. */
export function Calendar({ entries }: { entries: CalendarEntry[] }) {
  const [all, setAll] = useState(false);
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  const today = iso(now);
  // Late tasks first, then everything from today on, each by date. Past milestones are left out.
  const list = entries
    .filter((e) => e.kind === "Overdue" || e.date >= today)
    .sort((a, b) => Number(b.kind === "Overdue") - Number(a.kind === "Overdue") || a.date.localeCompare(b.date));
  return (
    <article className="ov-card ov-calendar">
      <div className="ov-card-h"><h2>Calendar</h2><span className="ov-tag">{now.toLocaleDateString("en-GB", { month: "long" })}</span></div>
      <ol className="ov-week">
        {week.map((d) => {
          const key = iso(d);
          const due = entries.filter((e) => e.date === key).length;
          return (
            <li key={key} className={key === today ? "today" : ""} aria-current={key === today ? "date" : undefined} title={due ? `${due} due` : undefined}>
              <span>{d.toLocaleDateString("en-GB", { weekday: "short" })}</span><b>{d.getDate()}</b><i className={due ? "on" : ""} />
            </li>
          );
        })}
      </ol>
      <h3>Upcoming</h3>
      {list.length === 0 ? <EmptyState title="Nothing coming up" text="No dated tasks or milestones are ahead." /> : (
        <ul className="ov-upcoming">
          {(all ? list : list.slice(0, UPCOMING_SHOWN)).map((e) => (
            <li key={e.key} className={e.kind.toLowerCase()}>
              <div>{e.href ? <a href={e.href} target="_blank" rel="noreferrer">{e.title}</a> : <strong>{e.title}</strong>}<em>{e.kind}</em></div>
              <span>{e.who} · {e.kind === "Overdue" ? "Was due " : ""}{parse(e.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
            </li>
          ))}
        </ul>
      )}
      {list.length > UPCOMING_SHOWN && <button type="button" className="ov-link ov-bottom" onClick={() => setAll((v) => !v)} aria-expanded={all}>{all ? "Show fewer" : `See all ${list.length}`}</button>}
    </article>
  );
}
