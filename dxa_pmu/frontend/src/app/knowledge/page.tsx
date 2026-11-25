"use client";

/** All resources (Figma WS-03): documents every project shares. */

import { useCallback, useEffect, useRef, useState } from "react";
import { FigmaIcon } from "@/components/FigmaIcon";
import { Chips, ErrorNote, PageHead, Search, fileSize, shortDate } from "@/components/ui";
import { api, uploadFile } from "@/lib/api";
import { CATEGORIES, type SharedDoc } from "@/lib/mock";

export default function AllResources() {
  const [docs, setDocs] = useState<SharedDoc[] | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api<SharedDoc[]>("/knowledge").then(setDocs).catch((e) => { setDocs([]); setError((e as Error).message); }), []);
  useEffect(() => { void load(); }, [load]);

  async function upload(files: FileList | File[]) {
    setBusy(true); setError(null);
    const problems: string[] = [];
    for (const f of Array.from(files)) {
      try { await uploadFile("/knowledge", f); } catch (e) { problems.push(`${f.name}: ${(e as Error).message}`); }
    }
    await load();
    if (problems.length) setError(problems.join(" "));
    setBusy(false);
  }
  async function change(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); await load(); } catch (e) { setError((e as Error).message); }
  }
  const patch = (d: SharedDoc, body: { category?: string; tags?: string[] }) => change(() => api(`/knowledge/${d.id}`, { method: "PATCH", body }));

  const list = docs ?? [];
  const shown = list.filter((d) => (category === "all" || d.category === category) && `${d.name} ${d.tags.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="ws-page">
      <PageHead title="All resources" lead="Policies, templates and guidelines for every project. DXA uses them as reference in all PMU work.">
        <button type="button" className="ds-btn primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Reading…" : "Upload"}</button>
      </PageHead>
      <input ref={input} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.csv" onChange={(e) => { if (e.target.files?.length) void upload(Array.from(e.target.files)); e.target.value = ""; }} />
      <div className="toolbar-row">
        <Search value={q} onChange={setQ} placeholder="Search documents and tags" />
        <Chips label="Filter by category" value={category} onChange={setCategory}
          options={[{ id: "all", label: "All", count: list.length }, ...CATEGORIES.map((c) => ({ id: c, label: c, count: list.filter((d) => d.category === c).length }))]} />
      </div>
      <ErrorNote error={error} />
      <section className="panel">
        <div className="panel-head"><h2>Documents</h2><span className="tag">{shown.length} {shown.length === 1 ? "file" : "files"}</span></div>
        {docs === null ? <div className="panel-foot">Loading…</div> : shown.length === 0 ? <div className="panel-foot">{list.length === 0 ? "No documents yet." : "No documents match."}</div> : (
          <div className="table-x">
            <table className="tbl">
              <thead><tr><th>Document</th><th>Category</th><th>Tags</th><th>Used by</th><th>Added</th><th><span className="visually-hidden">Remove</span></th></tr></thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.id}>
                    <td><span className="cell-title">{d.name}</span><span className="cell-sub">{fileSize(d.size)}</span></td>
                    <td><select className="field" value={d.category} aria-label={`Category of ${d.name}`} onChange={(e) => void patch(d, { category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></td>
                    <td><Tags doc={d} onChange={(tags) => void patch(d, { tags })} /></td>
                    <td>All projects</td>
                    <td>{shortDate(d.uploadedAt)}</td>
                    <td><button type="button" className="link-text" onClick={() => { if (window.confirm(`Remove "${d.name}"? DXA will stop using it.`)) void change(() => api(`/knowledge/${d.id}`, { method: "DELETE" })); }}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className={`drop-line${over ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) void upload(Array.from(e.dataTransfer.files)); }}>
        <FigmaIcon name="upload-cloud" size={20} />
        <span>Drop files here to add them. Set a category and tags after upload so DXA can find them. PDF, Word, text, Markdown or CSV, up to 25 MB.</span>
      </div>
    </div>
  );
}

function Tags({ doc, onChange }: { doc: SharedDoc; onChange: (t: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState("");
  const done = () => { const t = v.trim(); if (t && !doc.tags.includes(t)) onChange([...doc.tags, t]); setV(""); setAdding(false); };
  return (
    <span className="tags-cell">
      {doc.tags.map((t) => <button type="button" key={t} className="tag tag-btn" title="Remove tag" aria-label={`Remove tag ${t}`} onClick={() => onChange(doc.tags.filter((x) => x !== t))}>{t} ×</button>)}
      {adding
        ? <input className="tag-input-sm" autoFocus maxLength={40} value={v} aria-label="New tag" onChange={(e) => setV(e.target.value)} onBlur={done} onKeyDown={(e) => { if (e.key === "Enter") done(); if (e.key === "Escape") { setV(""); setAdding(false); } }} />
        : <button type="button" className="link-text" onClick={() => setAdding(true)}>Add tag</button>}
    </span>
  );
}
