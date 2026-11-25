"use client";

/** The "Draft setup" card (Figma WS-02): every field can be checked and edited before the project is created. */

import { useState } from "react";
import type { DraftMilestone, ProjectDraft } from "@/lib/mock";
import { SETUP_DATE, dateRange, milestoneSummary, pageLabel, phaseSummary } from "@/lib/draft";

export type FieldKey = "name" | "goal" | "manager" | "dates" | "budget" | "phases" | "milestones";
type SingleKey = "name" | "goal" | "manager" | "budget";

interface Props {
  draft: ProjectDraft;
  fileName: string | null;
  edited: Set<FieldKey>;
  /** True while the AI is working, so an edit cannot be overwritten by its answer. */
  locked: boolean;
  creating: boolean;
  connectJira: boolean;
  onConnectJira: (v: boolean) => void;
  onEdit: (key: FieldKey, patch: Partial<ProjectDraft>) => void;
  onStartOver: () => void;
  onCreate: () => void;
}

export function DraftCard({ draft, fileName, edited, locked, creating, connectJira, onConnectJira, onEdit, onStartOver, onCreate }: Props) {
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const missing = fileName ? "Not found in the document" : "Not given yet";
  const close = () => setEditing(null);
  const save = (key: FieldKey, patch: Partial<ProjectDraft>) => { onEdit(key, patch); close(); };

  function row(key: FieldKey, label: string, shown: string | null, pages: number[], editor: React.ReactNode) {
    const source = edited.has(key) ? "Edited" : pageLabel(pages);
    return (
      <div className="np-field">
        <span className="np-label">{label}</span>
        {editing === key ? editor : (<>
          {shown
            ? <button type="button" className="np-value" disabled={locked} onClick={() => setEditing(key)} aria-label={`Edit ${label.toLowerCase()}: ${shown}`} title="Edit">{shown}</button>
            : <span className="np-value missing">{missing}</span>}
          {shown && source && <span className="np-tag">{source}</span>}
          {!shown && <button type="button" className="np-link" disabled={locked} onClick={() => setEditing(key)}>Add<span className="visually-hidden"> {label.toLowerCase()}</span></button>}
        </>)}
      </div>
    );
  }

  const single = (key: SingleKey, label: string, max: number) =>
    row(key, label, draft[key].value, draft[key].pages,
      <TextEditor label={label} initial={draft[key].value ?? ""} max={max} multiline={key === "goal"} onCancel={close}
        onSave={(v) => save(key, { [key]: { value: v || null, pages: [] } })} />);

  const hasName = !!draft.name.value?.trim();
  return (
    <section className="np-card np-draft" aria-label="Draft setup">
      <div className="np-card-h"><h2>Draft setup from {fileName ?? "your description"}</h2><span className="np-tag brand">AI draft</span></div>
      <p className="np-sub">Check each field. Values DXA could not find stay empty instead of being guessed. Select a value to change it.</p>
      <div className="np-fields">
        <div>
          {single("name", "Project name", 200)}
          {single("goal", "Goal", 5000)}
          {row("phases", "Phases", phaseSummary(draft.phases), draft.phasePages,
            <PhaseEditor initial={draft.phases} onCancel={close} onSave={(phases) => save("phases", { phases, phasePages: [] })} />)}
          {row("milestones", "Milestones", milestoneSummary(draft.milestones), draft.milestonePages,
            <MilestoneEditor initial={draft.milestones} onCancel={close} onSave={(milestones) => save("milestones", { milestones, milestonePages: [] })} />)}
        </div>
        <div>
          {single("manager", "Project manager", 120)}
          {row("dates", "Start and end", dateRange(draft.start.value, draft.end.value), [...draft.start.pages, ...draft.end.pages],
            <DateEditor start={draft.start.value ?? ""} end={draft.end.value ?? ""} onCancel={close}
              onSave={(start, end) => save("dates", { start: { value: start || null, pages: [] }, end: { value: end || null, pages: [] } })} />)}
          {single("budget", "Budget", 120)}
          <div className="np-field">
            <span className="np-label">Jira project</span>
            <span className="np-value missing">{connectJira ? "Connect after creating the project" : "Not linked yet"}</span>
            <button type="button" className="np-link" onClick={() => onConnectJira(!connectJira)}>{connectJira ? "Undo" : "Connect"}</button>
          </div>
        </div>
      </div>
      <div className="np-actions">
        <p>{hasName ? "Nothing is saved until you create the project." : "Add a project name to create the project. Nothing is saved until then."}</p>
        <button type="button" className="ds-btn" disabled={creating} onClick={onStartOver}>Start over</button>
        <button type="button" className="ds-btn primary" disabled={!hasName || locked || creating || editing !== null} onClick={onCreate}>{creating ? "Creating…" : "Create project"}</button>
      </div>
    </section>
  );
}

function EditorButtons({ onCancel, disabled }: { onCancel: () => void; disabled?: boolean }) {
  return (
    <span className="np-editor-btns">
      <button type="submit" className="ds-btn sm primary" disabled={disabled}>Save</button>
      <button type="button" className="ds-btn sm" onClick={onCancel}>Cancel</button>
    </span>
  );
}

function Editor({ onSubmit, onCancel, children, invalid }: { onSubmit: () => void; onCancel: () => void; children: React.ReactNode; invalid?: boolean }) {
  return (
    <form className="np-editor" onSubmit={(e) => { e.preventDefault(); if (!invalid) onSubmit(); }} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      {children}
      <EditorButtons onCancel={onCancel} disabled={invalid} />
    </form>
  );
}

function TextEditor({ label, initial, max, multiline, onSave, onCancel }: { label: string; initial: string; max: number; multiline: boolean; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const common = { className: "field", autoFocus: true, maxLength: max, value: v, "aria-label": label };
  return (
    <Editor onSubmit={() => onSave(v.trim())} onCancel={onCancel}>
      {multiline ? <textarea {...common} rows={3} onChange={(e) => setV(e.target.value)} /> : <input {...common} onChange={(e) => setV(e.target.value)} />}
    </Editor>
  );
}

function DateEditor({ start, end, onSave, onCancel }: { start: string; end: string; onSave: (s: string, e: string) => void; onCancel: () => void }) {
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);
  const bad = (v: string) => v !== "" && !SETUP_DATE.test(v);
  const reversed = !!s && !!e && !bad(s) && !bad(e) && e.slice(0, s.length) < s.slice(0, e.length);
  return (
    <Editor onSubmit={() => onSave(s, e)} onCancel={onCancel} invalid={bad(s) || bad(e) || reversed}>
      <span className="np-two">
        <input className="field" autoFocus value={s} onChange={(x) => setS(x.target.value.trim())} placeholder="Start" aria-label="Start date" aria-invalid={bad(s)} />
        <input className="field" value={e} onChange={(x) => setE(x.target.value.trim())} placeholder="End" aria-label="End date" aria-invalid={bad(e) || reversed} />
      </span>
      <small className={bad(s) || bad(e) || reversed ? "np-bad" : ""}>{reversed ? "The end is before the start." : "Use YYYY-MM or YYYY-MM-DD."}</small>
    </Editor>
  );
}

function PhaseEditor({ initial, onSave, onCancel }: { initial: string[]; onSave: (v: string[]) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial.join("\n"));
  const list = v.split("\n").map((x) => x.trim().slice(0, 200)).filter(Boolean);
  return (
    <Editor onSubmit={() => onSave(list)} onCancel={onCancel} invalid={list.length > 40}>
      <textarea className="field" autoFocus rows={Math.min(10, Math.max(4, initial.length + 1))} value={v} onChange={(e) => setV(e.target.value)} aria-label="Phases, one per line" />
      <small className={list.length > 40 ? "np-bad" : ""}>{list.length > 40 ? "Use 40 phases or fewer." : "One phase per line, in order."}</small>
    </Editor>
  );
}

function MilestoneEditor({ initial, onSave, onCancel }: { initial: DraftMilestone[]; onSave: (v: DraftMilestone[]) => void; onCancel: () => void }) {
  const [rows, setRows] = useState<DraftMilestone[]>(initial.length ? initial : [{ title: "", due: null }]);
  const set = (i: number, patch: Partial<DraftMilestone>) => setRows((l) => l.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const list = rows.map((m) => ({ ...m, title: m.title.trim() })).filter((m) => m.title);
  const undated = rows.some((m) => !m.title.trim() && m.due); // a date with no name would be lost
  return (
    <Editor onSubmit={() => onSave(list)} onCancel={onCancel} invalid={undated}>
      <span className="np-milestones">
        {rows.map((m, i) => (
          <span className="np-milestone" key={i}>
            <input className="field" autoFocus={i === 0} maxLength={200} value={m.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="Milestone" aria-label={`Milestone ${i + 1}`} />
            <input className="field" type="date" value={m.due ?? ""} onChange={(e) => set(i, { due: e.target.value || null })} aria-label={`Due date of milestone ${i + 1}`} />
            <button type="button" className="np-link" onClick={() => setRows((l) => l.filter((_, j) => j !== i))}>Remove<span className="visually-hidden"> milestone {i + 1}</span></button>
          </span>
        ))}
      </span>
      {rows.length < 100 && <button type="button" className="np-link" onClick={() => setRows((l) => [...l, { title: "", due: null }])}>Add a milestone</button>}
      {undated && <small className="np-bad">Name every milestone that has a date.</small>}
    </Editor>
  );
}
