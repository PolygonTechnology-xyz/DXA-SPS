"use client";

import { useState } from "react";
import type { ReportFrequency, ReportSchedule } from "@/lib/mock";
import { nextRunText } from "@/lib/schedule";
import { useStore } from "./Store";

const OPTIONS: { id: ReportFrequency; title: string; hint: string }[] = [
  { id: "monthly", title: "Monthly", hint: "A report on the 1st of every month, covering the month before." },
  { id: "quarterly", title: "Quarterly", hint: "A report at the start of each quarter, covering the quarter before." },
  { id: "custom", title: "Custom dates", hint: "Pick your own start and end date. The report is created once the end date arrives." },
];

export function ReportSettingsModal() {
  const { projects, reportSettingsFor, closeReportSettings } = useStore();
  const project = projects.find((p) => p.id === reportSettingsFor);
  if (!project) return null;
  return <Form key={project.id} projectId={project.id} onClose={closeReportSettings} />;
}

function Form({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { projects, patchProject } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const project = projects.find((p) => p.id === projectId)!;
  const [s, setS] = useState<ReportSchedule>(project.reportSchedule ?? { enabled: true, frequency: "monthly" });
  const invalid = s.enabled && s.frequency === "custom" && (!s.from || !s.to || s.from > s.to);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await patchProject(projectId, { reportSchedule: s });
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={(e) => void save(e)} role="dialog" aria-modal="true" aria-label="Report settings">
        <h3>Report settings</h3>
        <p className="muted small">Choose when this project&apos;s report is created. Finished reports appear under <strong>Reports</strong> in the sidebar.</p>

        <label className="switch">
          <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
          <span>Create reports automatically</span>
        </label>

        <fieldset className="freq" disabled={!s.enabled}>
          <legend className="visually-hidden">How often</legend>
          {OPTIONS.map((o) => (
            <label key={o.id} className={`freq-opt${s.frequency === o.id ? " on" : ""}`}>
              <input type="radio" name="freq" checked={s.frequency === o.id} onChange={() => setS({ ...s, frequency: o.id })} />
              <span><strong>{o.title}</strong><small>{o.hint}</small></span>
            </label>
          ))}
        </fieldset>

        {s.enabled && s.frequency === "custom" && (
          <div className="two">
            <div>
              <label htmlFor="r-from">From</label>
              <input id="r-from" type="date" className="field" required value={s.from ?? ""} onChange={(e) => setS({ ...s, from: e.target.value })} />
            </div>
            <div>
              <label htmlFor="r-to">To</label>
              <input id="r-to" type="date" className="field" required min={s.from} value={s.to ?? ""} onChange={(e) => setS({ ...s, to: e.target.value })} />
            </div>
          </div>
        )}

        <div className="note info">{nextRunText(s)}</div>
        <small className="muted">Reports are created when the app is open on or after the report date.</small>

        {error && <div className="note bad" role="alert">⚠ {error}</div>}

        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={invalid || saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
