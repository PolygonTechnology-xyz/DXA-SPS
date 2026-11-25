"use client";

/** Automatic reports (Figma RP-03). */

import { useState } from "react";
import type { ReportFrequency, ReportSchedule } from "@/lib/mock";
import { api } from "@/lib/api";
import { nextRunText } from "@/lib/schedule";
import { useFormats } from "./FormatPanel";
import { useStore } from "./Store";
import { ErrorNote, Modal } from "./ui";

const OPTIONS: { id: ReportFrequency | "off"; title: string; hint: string }[] = [
  { id: "monthly", title: "Monthly", hint: "On the 1st of each month, covering the month before." },
  { id: "quarterly", title: "Quarterly", hint: "At the start of each quarter, covering the quarter before." },
  { id: "custom", title: "Custom dates", hint: "Pick a start and end date. The draft is created after the end date." },
  { id: "off", title: "Off", hint: "Prepare reports by hand from Overview or Reports." },
];

export function ReportSettingsModal() {
  const { projects, reportSettingsFor, closeReportSettings } = useStore();
  const project = projects.find((p) => p.id === reportSettingsFor);
  if (!project) return null;
  return <Form key={project.id} projectId={project.id} onClose={closeReportSettings} />;
}

function Form({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { projects, patchProject } = useStore();
  const project = projects.find((p) => p.id === projectId)!;
  const { rows: formats } = useFormats(projectId, "report");
  const [s, setS] = useState<ReportSchedule>(project.reportSchedule ?? { enabled: true, frequency: "monthly" });
  const [format, setFormat] = useState<string | null>(null); // null until changed
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const chosen = s.enabled ? s.frequency : "off";
  const invalid = s.enabled && s.frequency === "custom" && (!s.from || !s.to || s.from > s.to);
  const currentDefault = formats?.find((f) => f.isDefault)?.id ?? "";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await patchProject(projectId, { reportSchedule: s });
      if (format !== null && format !== currentDefault) await api(`/projects/${projectId}/formats/report/default`, { method: "PUT", body: { formatId: format || null } });
      onClose();
    } catch (err) { setError((err as Error).message); setSaving(false); }
  }

  return (
    <Modal title="Automatic reports" lead="DXA creates each report as a draft. It is not final until you approve it." onClose={onClose}>
      <form onSubmit={(e) => void save(e)} style={{ display: "contents" }}>
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <legend className="visually-hidden">How often</legend>
          {OPTIONS.map((o) => (
            <label key={o.id} className={`radio-card${chosen === o.id ? " on" : ""}`}>
              <input type="radio" name="freq" checked={chosen === o.id} onChange={() => setS(o.id === "off" ? { ...s, enabled: false } : { ...s, enabled: true, frequency: o.id })} />
              <span><strong>{o.title}</strong><small>{o.hint}</small></span>
            </label>
          ))}
        </fieldset>
        {chosen === "custom" && (
          <div className="form-grid">
            <div><label htmlFor="r-from">From</label><input id="r-from" type="date" className="field" required value={s.from ?? ""} onChange={(e) => setS({ ...s, from: e.target.value })} /></div>
            <div><label htmlFor="r-to">To</label><input id="r-to" type="date" className="field" required min={s.from} value={s.to ?? ""} onChange={(e) => setS({ ...s, to: e.target.value })} /></div>
          </div>
        )}
        <div>
          <label htmlFor="r-format">Format</label>
          <select id="r-format" className="field" value={format ?? currentDefault} onChange={(e) => setFormat(e.target.value)}>
            <option value="">Built-in format</option>
            {formats?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <small className="sub-text">This is the project&apos;s default report format.</small>
        </div>
        <div className="well">{nextRunText(s)}</div>
        <ErrorNote error={error} />
        <div className="dlg-actions">
          <button type="button" className="ds-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="ds-btn primary" disabled={invalid || saving}>{saving ? "Saving…" : "Save schedule"}</button>
        </div>
      </form>
    </Modal>
  );
}
