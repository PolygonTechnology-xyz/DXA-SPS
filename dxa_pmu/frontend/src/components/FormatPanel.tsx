"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { PreviewModal } from "@/components/PreviewModal";

export type FormatRow = { id: string; name: string; uploadedAt: string; isDefault: boolean };
type Kind = "minutes" | "report";

export function useFormats(projectId: string, kind: Kind) {
  const [rows, setRows] = useState<FormatRow[] | null>(null);
  const load = useCallback(async () => {
    try { setRows((await api<Record<Kind, FormatRow[]>>(`/projects/${projectId}/formats`))[kind]); } catch { /* keep what we have */ }
  }, [projectId, kind]);
  useEffect(() => { void load(); }, [load]);
  return { rows, load };
}

/** Picks the format one document uses: the project default, the built-in one, or any uploaded example. */
export function FormatPicker({ projectId, kind, value, onPick, disabled }: { projectId: string; kind: Kind; value: string | null; onPick: (id: string | null) => void; disabled?: boolean }) {
  const { rows } = useFormats(projectId, kind);
  return (
    <label className="fmt-pick">Format
      <select className="field" value={value ?? ""} disabled={disabled} onChange={(e) => onPick(e.target.value || null)} aria-label="Format for this document">
        <option value="">Project default</option>
        <option value="builtin">Built-in format</option>
        {rows?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </label>
  );
}

const LABEL: Record<Kind, string> = { minutes: "Minutes formats", report: "Report formats" };

/** All the project's formats: upload as many Word examples as you like, choose the default, and preview each with current data. */
export function FormatPanel({ projectId, kind, onChange }: { projectId: string; kind: Kind; onChange?: () => void }) {
  const { rows, load } = useFormats(projectId, kind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<string | null>(null); // "default" | "builtin" | format id
  const [open, setOpen] = useState(true);
  const file = useRef<HTMLInputElement>(null);

  async function upload(files: FileList) {
    setBusy(true); setError(null);
    try {
      for (const f of Array.from(files)) {
        const res = await fetch(`/api/projects/${projectId}/formats/${kind}`, { method: "POST", headers: { "X-File-Name": encodeURIComponent(f.name) }, body: f });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(`${f.name}: ${typeof data?.detail === "string" ? data.detail : "the upload failed. Please try again."}`);
      }
      await load(); onChange?.();
    } catch (e) { setError((e as Error).message); await load(); }
    setBusy(false);
    if (file.current) file.current.value = "";
  }
  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await load(); onChange?.(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  const makeDefault = (id: string | null) => act(() => api(`/projects/${projectId}/formats/${kind}/default`, { method: "PUT", body: { formatId: id } }));
  const remove = (r: FormatRow) => { if (window.confirm(`Remove "${r.name}"? Documents that used it fall back to the default.`)) void act(() => api(`/formats/${r.id}`, { method: "DELETE" })); };

  const list = rows ?? [];
  const noDefault = !list.some((r) => r.isDefault);
  const q = (v: string) => (v === "default" ? "" : `?format=${v}`);

  return (
    <div className="pd-card fmt">
      <div className="fmt-row">
        <div><b>{LABEL[kind]}</b><small>{list.length ? `${list.length} uploaded · ${list.find((r) => r.isDefault)?.name ?? "built-in"} is the default` : "Using the built-in format"}</small></div>
        <div className="pd-actions">
          <button className="pd-btn" onClick={() => setView("default")}>👁 Preview default</button>
          <button className="pd-btn dark" disabled={busy} onClick={() => file.current?.click()}>{busy ? "Working…" : "⬆ Upload formats (.docx)"}</button>
          <input ref={file} type="file" multiple hidden accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); }} />
        </div>
      </div>
      {error && <div className="note bad" role="alert">⚠ {error}</div>}
      <p className="pd-muted" style={{ margin: "8px 0 0" }}>Upload any Word documents you already use, for example past {kind === "minutes" ? "meeting minutes" : "reports"}. The AI reads each one&apos;s layout and writes new documents the same way. Pick the default here, or choose a format for a single {kind === "minutes" ? "meeting" : "report"}.</p>
      <button className="pd-link left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Hide" : "Show"} formats {open ? "⌃" : "›"}</button>
      {open && (
        <ul className="fmt-list">
          <li className={noDefault ? "on" : ""}>
            <span><b>Built-in format</b><small>The standard look, coloured and ready to use</small></span>
            <span className="pd-actions">
              {noDefault ? <span className="fmt-tag">Default</span> : <button className="pd-btn" disabled={busy} onClick={() => void makeDefault(null)}>Make default</button>}
              <button className="pd-btn" onClick={() => setView("builtin")}>👁 Preview</button>
              <a className="pd-btn" href={`/api/projects/${projectId}/formats/${kind}/sample`}>⬇ Sample</a>
            </span>
          </li>
          {list.map((r) => (
            <li key={r.id} className={r.isDefault ? "on" : ""}>
              <span><b>{r.name}</b><small>Uploaded {new Date(r.uploadedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</small></span>
              <span className="pd-actions">
                {r.isDefault ? <span className="fmt-tag">Default</span> : <button className="pd-btn" disabled={busy} onClick={() => void makeDefault(r.id)}>Make default</button>}
                <button className="pd-btn" onClick={() => setView(r.id)}>👁 Preview</button>
                <a className="pd-btn" href={`/api/formats/${r.id}/file`}>⬇ Download</a>
                <button className="pd-btn" disabled={busy} onClick={() => remove(r)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {view && <PreviewModal title={`${LABEL[kind]} · preview with current data`} previewPath={`/projects/${projectId}/formats/${kind}/preview${q(view)}`} docxHref={`/api/projects/${projectId}/formats/${kind}/preview.docx${q(view)}`} onClose={() => setView(null)} />}
    </div>
  );
}
