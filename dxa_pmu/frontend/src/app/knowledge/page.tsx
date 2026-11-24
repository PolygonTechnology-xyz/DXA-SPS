"use client";

import { useRef, useState } from "react";
import { useStore } from "@/components/Store";
import { CATEGORIES } from "@/lib/mock";

export default function Knowledge() {
  const { knowledge, addDocs, updateDoc, removeDoc } = useStore();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function take(files: FileList | null) {
    if (files?.length) addDocs(Array.from(files).map((f) => ({ name: f.name, size: f.size })));
  }

  return (
    <>
      <header className="topbar"><h2>Global Knowledges</h2></header>
      <div className="page">
        <div className="page-inner">
          <h1 className="k-title">Global Knowledges</h1>
          <p className="k-sub">Documents shared across every project: policies, templates and guidelines. The assistant uses these as reference for all PMU work.</p>

          <div
            className={`drop${over ? " over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
          >
            <div>📄 Drag &amp; drop files here, or <button type="button" className="btn" onClick={() => input.current?.click()}>Browse files</button></div>
            <small className="muted">After uploading, set a category and add your own tags. (Mock: files are not stored.)</small>
            <input ref={input} type="file" multiple hidden onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
          </div>

          {knowledge.length === 0 && <p className="empty">No documents yet.</p>}
          {knowledge.map((d) => (
            <div key={d.id} className="card k-item">
              <div className="row between">
                <div>
                  <strong>📄 {d.name}</strong>
                  <div className="muted small">{d.size} · uploaded {d.uploadedAt}</div>
                </div>
                <button className="btn" onClick={() => removeDoc(d.id)}>Remove</button>
              </div>
              <div className="row k-meta">
                <select className="field" value={d.category} onChange={(e) => updateDoc(d.id, { category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <TagEditor tags={d.tags} onChange={(tags) => updateDoc(d.id, { tags })} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="chips">
      {tags.map((t) => (
        <button key={t} className="chip" title="Remove tag" onClick={() => onChange(tags.filter((x) => x !== t))}>{t} ×</button>
      ))}
      <input
        className="tag-input"
        placeholder="+ add tag"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v.trim()) {
            e.preventDefault();
            if (!tags.includes(v.trim())) onChange([...tags, v.trim()]);
            setV("");
          }
        }}
      />
    </div>
  );
}
