"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Doc = { id: string; name: string; size: number; chars: number; uploadedAt: string };
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Project documents (plans, requirements, contracts). The AI reads them for risks, answers and reports. */
export function DocumentsCard({ projectId, onChange }: { projectId: string; onChange?: () => void }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setDocs(await api<Doc[]>(`/projects/${projectId}/documents`)); } catch (e) { setError((e as Error).message); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  async function upload(files: FileList | File[]) {
    setBusy(true); setError(null);
    const problems: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const res = await fetch(`/api/projects/${projectId}/documents`, { method: "POST", headers: { "X-File-Name": encodeURIComponent(f.name) }, body: f });
        if (!res.ok) { const d = await res.json().catch(() => null); problems.push(`${f.name}: ${typeof d?.detail === "string" ? d.detail : "the upload failed."}`); }
      } catch { problems.push(`${f.name}: could not reach the server.`); }
    }
    if (problems.length) setError(problems.join(" "));
    await load(); onChange?.();
    setBusy(false);
    if (input.current) input.current.value = "";
  }
  async function remove(d: Doc) {
    if (!window.confirm(`Remove "${d.name}"? The AI will stop using it.`)) return;
    try { await api(`/documents/${d.id}`, { method: "DELETE" }); await load(); onChange?.(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <article className="pd-card docs">
      <div className="pd-h"><h3>Project documents</h3><span className="pd-tag">The AI reads these</span></div>
      <div className={`docs-drop${over ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}>
        <span>Drop plans, requirements or contracts here (PDF, Word, text), or</span>
        <button className="pd-btn dark" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Reading…" : "⬆ Upload documents"}</button>
        <input ref={input} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.csv" onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); }} />
      </div>
      {error && <div className="note bad" role="alert">⚠ {error}</div>}
      {docs && docs.length === 0 && <p className="pd-muted">No documents yet. Once you add some, the AI uses them for risks, project chat and report sources.</p>}
      {docs && docs.length > 0 && (
        <ul className="docs-list">
          {docs.map((d) => (
            <li key={d.id}>
              <span><b>{d.name}</b><small>{kb(d.size)} · {d.chars.toLocaleString()} characters read · added {new Date(d.uploadedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</small></span>
              <button className="pd-btn" onClick={() => void remove(d)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
