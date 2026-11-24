"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useStore } from "@/components/Store";
import { FormatPanel, FormatPicker } from "@/components/FormatPanel";
import { PreviewModal } from "@/components/PreviewModal";
import { ChatPanel } from "@/components/ChatPanel";
import { api } from "@/lib/api";
import type { Meeting, Minutes } from "@/lib/mock";

const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const today = () => new Date().toISOString().slice(0, 10);

function MeetingCard({ m, onChange, onDelete }: { m: Meeting; onChange: (m: Meeting) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState<Minutes | null>(null); // the reviewer's edits to an unapproved draft
  const approved = !!m.approvedAt;
  const minutes = draft ?? m.minutes;

  async function run<T>(fn: () => Promise<T>, then: (r: T) => void) {
    setBusy(true); setError(null);
    try { then(await fn()); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  const generate = () => run(() => api<Meeting>(`/meetings/${m.id}/minutes`, { method: "POST" }), (r) => { setDraft(null); onChange(r); });
  const approve = () => minutes && run(() => api<Meeting>(`/meetings/${m.id}/approve`, { method: "POST", body: minutes }), (r) => { setDraft(null); onChange(r); });
  const edit = (patch: Partial<Minutes>) => minutes && setDraft({ ...minutes, ...patch });

  return (
    <article className="pd-card mt-card">
      <button className="mt-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span><b>{m.title}</b><small>{fmt(m.heldOn)}</small></span>
        <span className={`pd-sev ${approved ? "low" : m.minutes ? "medium" : "idle"}`}>{approved ? "Minutes approved" : m.minutes ? "Draft · needs approval" : "No minutes yet"}</span>
      </button>
      {open && (
        <div className="mt-body">
          {error && <div className="note bad" role="alert">⚠ {error}</div>}
          {!minutes ? (
            <>
              <p className="pd-muted">{m.notes.trim() ? "Claude can draft minutes from this transcript. You review and approve them." : "No transcript was added, so minutes can't be drafted."}</p>
              <pre className="mt-notes">{m.notes}</pre>
            </>
          ) : approved && !draft ? (
            <>
              <MinutesView mn={minutes} />
              <details className="mt-tr"><summary>Transcript</summary><pre className="mt-notes">{m.notes}</pre></details>
            </>
          ) : (
            <>
              <label className="mt-l">Summary<textarea className="field" rows={3} value={minutes.summary} onChange={(e) => edit({ summary: e.target.value })} /></label>
              <div className="mt-l">Decisions</div>
              {minutes.decisions.map((d, i) => (
                <div className="mt-edit" key={i}><input className="field" value={d} onChange={(e) => edit({ decisions: minutes.decisions.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Decision ${i + 1}`} />
                  <button className="icon-del" onClick={() => edit({ decisions: minutes.decisions.filter((_, j) => j !== i) })} aria-label="Remove decision">🗑</button></div>
              ))}
              <div className="mt-l">Actions</div>
              {minutes.actions.map((a, i) => (
                <div className="mt-edit" key={i}>
                  <input className="field" value={a.what} onChange={(e) => edit({ actions: minutes.actions.map((x, j) => (j === i ? { ...x, what: e.target.value } : x)) })} aria-label={`Action ${i + 1}`} />
                  <input className="field mt-owner" placeholder="Owner" value={a.owner ?? ""} onChange={(e) => edit({ actions: minutes.actions.map((x, j) => (j === i ? { ...x, owner: e.target.value || null } : x)) })} aria-label={`Owner of action ${i + 1}`} />
                  <button className="icon-del" onClick={() => edit({ actions: minutes.actions.filter((_, j) => j !== i) })} aria-label="Remove action">🗑</button>
                </div>
              ))}
              {(minutes.risks?.length ?? 0) > 0 && <div className="mt-l">Risks found</div>}
              {minutes.risks?.map((r, i) => (
                <div className="mt-edit" key={i}>
                  <input className="field" value={r.title} onChange={(e) => edit({ risks: minutes.risks!.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} aria-label={`Risk ${i + 1}`} />
                  <input className="field" value={r.ifNotDone} placeholder="If this is not done…" onChange={(e) => edit({ risks: minutes.risks!.map((x, j) => (j === i ? { ...x, ifNotDone: e.target.value } : x)) })} aria-label={`If not done ${i + 1}`} />
                  <input className="field" value={r.impact} placeholder="…this will happen" onChange={(e) => edit({ risks: minutes.risks!.map((x, j) => (j === i ? { ...x, impact: e.target.value } : x)) })} aria-label={`Impact ${i + 1}`} />
                  <button className="icon-del" onClick={() => edit({ risks: minutes.risks!.filter((_, j) => j !== i) })} aria-label="Remove risk">🗑</button>
                </div>
              ))}
              <p className="pd-muted">Edit or remove anything that is wrong, then approve. Risks found go into the risk register automatically. Only approved minutes count as the record.</p>
            </>
          )}
          {minutes && (
            <ChatPanel<{ reply: string; minutes: Minutes; meeting: Meeting }> path={`/meetings/${m.id}/revise`} current={minutes}
              onResult={(r) => { if (approved) setDraft(r.minutes); else setDraft(null); onChange(r.meeting); }}
              hint={approved ? "Change the design or ask for text changes. Text changes to approved minutes need approving again." : "Change the text or the design (colours, font, sizes). Nothing is final until you approve."}
              examples={["Make it look more colourful and professional", "Use a serif font and dark blue headings", "Make the summary shorter"]} />
          )}
          <div className="mt-foot">
            <button className="pd-btn" onClick={onDelete} disabled={busy}>Delete meeting</button>
            <span className="pd-actions">
              {m.minutes && <FormatPicker projectId={m.projectId} kind="minutes" value={m.formatId ?? null} disabled={busy} onPick={(f) => void run(() => api<Meeting>(`/meetings/${m.id}/format`, { method: "PUT", body: { formatId: f } }), onChange)} />}
              {m.minutes && !draft && <><button className="pd-btn" onClick={() => setPreview(true)}>👁 Preview</button><a className="pd-btn" href={`/api/meetings/${m.id}/minutes/docx`}>⬇ Download Word</a></>}
              <button className="pd-btn" disabled={busy || !m.notes.trim()} onClick={() => void generate()}>{busy ? "Working…" : minutes ? "↻ Redraft" : "Draft minutes"}</button>
              {minutes && (!approved || draft) && <button className="pd-btn dark" disabled={busy || !minutes.summary.trim()} onClick={() => void approve()}>Approve minutes</button>}
            </span>
          </div>
        </div>
      )}
      {preview && <PreviewModal title={`${m.title} · minutes`} previewPath={`/meetings/${m.id}/minutes/preview`} docxHref={`/api/meetings/${m.id}/minutes/docx`} onClose={() => setPreview(false)} />}
    </article>
  );
}

function MinutesView({ mn }: { mn: Minutes }) {
  return (
    <>
      <p>{mn.summary}</p>
      {mn.decisions.length > 0 && <><div className="mt-l">Decisions</div><ul className="mt-list">{mn.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></>}
      {(mn.risks?.length ?? 0) > 0 && <><div className="mt-l">Risks found</div><ul className="mt-list">{mn.risks!.map((r, i) => <li key={i}><b>{r.title}</b> <span className={`pd-sev ${r.severity}`}>{r.severity}</span><br />If {r.ifNotDone.replace(/\.$/, "")}, {r.impact}{r.owner ? <em> — {r.owner}</em> : null}</li>)}</ul></>}
      {mn.actions.length > 0 && <><div className="mt-l">Actions</div><ul className="mt-list">{mn.actions.map((a, i) => <li key={i}>{a.what}{a.owner ? <em> — {a.owner}</em> : null}</li>)}</ul></>}
    </>
  );
}

export function MeetingsView() {
  const { id } = useParams<{ id: string }>();
  const { projects } = useStore();
  const project = projects.find((p) => p.id === id);
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", heldOn: today(), notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api<Meeting[]>(`/projects/${id}/meetings`).then(setMeetings).catch((e) => setError((e as Error).message)), [id]);
  useEffect(() => { void load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await api<Meeting>(`/projects/${id}/meetings`, { method: "POST", body: form });
      setForm({ title: "", heldOn: today(), notes: "" }); setAdding(false);
      await load();
    } catch (err) { setError((err as Error).message); }
    setSaving(false);
  }
  async function remove(mid: string) {
    if (!window.confirm("Delete this meeting and its minutes?")) return;
    try { await api(`/meetings/${mid}`, { method: "DELETE" }); await load(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <header className="topbar">
        <Link href={`/projects/${id}`} className="muted">{project?.name ?? "Project"}</Link><span className="muted">/</span><h2>Meetings</h2>
      </header>
      <div className="page"><div className="page-inner wide pd">
        <div className="pd-top">
          <div><h1 className="pd-title">Meetings</h1><p className="pd-sub">Add a transcript, let Claude draft the minutes, then approve them. Approved decisions appear on the dashboard.</p></div>
          <button className="pd-btn dark" onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "＋ Add meeting"}</button>
        </div>
        <FormatPanel projectId={id} kind="minutes" />
        {error && <div className="note bad" role="alert">⚠ {error}</div>}
        {adding && (
          <form className="pd-card mt-form" onSubmit={(e) => void add(e)}>
            <label className="mt-l">Title<input className="field" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Steering Committee" /></label>
            <label className="mt-l">Date<input className="field" type="date" required value={form.heldOn} onChange={(e) => setForm({ ...form, heldOn: e.target.value })} /></label>
            <label className="mt-l">Transcript (English, বাংলা or both)<textarea className="field" rows={8} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Paste the transcript or notes here…" /></label>
            <label className="mt-l">…or upload a .txt file<input className="field" type="file" accept=".txt,text/plain" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((t) => setForm((x) => ({ ...x, notes: t.slice(0, 60000) }))); }} /></label>
            <div><button className="pd-btn dark" type="submit" disabled={saving || !form.title.trim()}>{saving ? "Saving…" : "Save meeting"}</button></div>
          </form>
        )}
        {!meetings ? <p className="pd-muted">Loading…</p> : meetings.length === 0 && !adding ? <p className="empty">No meetings yet. Use Add meeting to start.</p>
          : meetings.map((m) => <MeetingCard key={m.id} m={m} onChange={(n) => setMeetings((l) => l && l.map((x) => (x.id === n.id ? n : x)))} onDelete={() => void remove(m.id)} />)}
      </div></div>
    </>
  );
}
