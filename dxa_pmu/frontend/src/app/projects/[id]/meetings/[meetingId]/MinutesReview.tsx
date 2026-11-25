"use client";

/** One meeting: reviewing, editing and approving its minutes (Figma MT-03, MT-04). */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChatPanel } from "@/components/ChatPanel";
import { FormatPicker } from "@/components/FormatPanel";
import { PreviewModal } from "@/components/PreviewModal";
import { Empty, ErrorNote, Person, Section, Tag, levelTone, longDate, cap, shortDate } from "@/components/ui";
import { api } from "@/lib/api";
import type { Meeting, Minutes } from "@/lib/mock";

type Tab = "summary" | "decisions" | "actions" | "questions" | "transcript";

export function MinutesReview() {
  const { id, meetingId } = useParams<{ id: string; meetingId: string }>();
  const router = useRouter();
  const problem = useSearchParams().get("problem");
  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined);
  const [draft, setDraft] = useState<Minutes | null>(null); // the reviewer's unsaved edits
  const [tab, setTab] = useState<Tab>("summary");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(problem);
  const [preview, setPreview] = useState(false);

  const load = useCallback(() => api<Meeting[]>(`/projects/${id}/meetings`)
    .then((l) => setMeeting(l.find((m) => m.id === meetingId) ?? null))
    .catch((e) => { setMeeting(null); setError((e as Error).message); }), [id, meetingId]);
  useEffect(() => { void load(); }, [load]);

  const back = { label: "Meetings", href: `/projects/${id}/meetings` };
  if (!meeting) {
    return <Section crumbs={[back, { label: meeting === null ? "Not found" : "Loading…" }]}><ErrorNote error={error} />{meeting === null && <Empty title="Meeting not found" />}</Section>;
  }
  const m = meeting;
  const minutes = draft ?? m.minutes;
  const approved = !!m.approvedAt;

  async function run(what: string, fn: () => Promise<Meeting>) {
    setBusy(what); setError(null);
    try { setMeeting(await fn()); setDraft(null); } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }
  const generate = () => {
    if (m.minutes && !window.confirm("Draft the minutes again? This replaces the current draft and any edits" + (approved ? ", and the minutes will need approving again." : "."))) return;
    void run("generate", () => api<Meeting>(`/meetings/${m.id}/minutes`, { method: "POST" }));
  };
  const approve = () => minutes && void run("approve", () => api<Meeting>(`/meetings/${m.id}/approve`, { method: "POST", body: tidy(minutes) }));
  const reject = () => { if (window.confirm("Reject this draft? The transcript stays, and you can draft again.")) void run("reject", () => api<Meeting>(`/meetings/${m.id}/minutes`, { method: "DELETE" })); };
  async function remove() {
    if (!window.confirm("Delete this meeting and its minutes?")) return;
    try { await api(`/meetings/${m.id}`, { method: "DELETE" }); router.push(back.href); } catch (e) { setError((e as Error).message); }
  }

  const title = `${m.title}, ${shortDate(m.heldOn)}`;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "summary", label: "Summary" }, { id: "decisions", label: "Decisions", count: minutes?.decisions.length },
    { id: "actions", label: "Actions", count: minutes?.actions.length }, { id: "questions", label: "Open questions", count: minutes?.openQuestions?.length ?? 0 },
    { id: "transcript", label: "Transcript" },
  ];

  return (
    <Section
      crumbs={[back, { label: title }]}
      actions={<>
        {approved ? <Tag tone="ok">Approved {shortDate(m.approvedAt!)}</Tag> : m.minutes ? <Tag tone="ai">Minutes draft</Tag> : <Tag>No minutes yet</Tag>}
        {m.minutes && <button type="button" className="link-text" disabled={!!busy || !m.notes.trim()} onClick={generate}>{busy === "generate" ? "Drafting…" : "Regenerate"}</button>}
        <button type="button" className="link-text" disabled={!!busy} onClick={() => void remove()}>Delete meeting</button>
      </>}
    >
      <div className="page-head"><div><h1>{title}</h1><p>{longDate(m.heldOn)}</p></div>
        {m.minutes && <div className="pd"><FormatPicker projectId={id} kind="minutes" value={m.formatId ?? null} disabled={!!busy} onPick={(f) => void run("format", () => api<Meeting>(`/meetings/${m.id}/format`, { method: "PUT", body: { formatId: f } }))} /></div>}
      </div>
      <ErrorNote error={error} />

      {!minutes ? <Transcript meeting={m} busy={busy} onSave={(notes) => run("transcript", () => api<Meeting>(`/meetings/${m.id}/transcript`, { method: "PUT", body: { notes } }))} onDraft={generate} /> : (<>
        <div className="tabs" role="tablist">
          {tabs.map((t) => <button type="button" role="tab" key={t.id} aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}{t.count !== undefined && <Tag>{t.count}</Tag>}</button>)}
        </div>
        <div className="split-2">
          <div className="doc-block">
            {tab === "transcript" ? <pre className="transcript">{m.notes}</pre>
              : draft ? <Editor tab={tab} value={draft} onChange={setDraft} />
              : <Reading tab={tab} value={minutes} />}
          </div>
          <aside className="panel pad">
            <h2>Ask about this meeting</h2>
            <div className="pd">
              <ChatPanel<{ reply: string; minutes: Minutes; meeting: Meeting }> path={`/meetings/${m.id}/revise`} current={minutes}
                onResult={(r) => { setMeeting(r.meeting); setDraft(approved ? r.minutes : null); }}
                hint={approved ? "Text changes to approved minutes need approving again." : "Ask a question, or ask for changes to the text or design. Nothing is final until you approve."}
                examples={["Make the summary shorter", "List what is still undecided", "Use a serif font and dark blue headings"]} />
            </div>
          </aside>
        </div>

        {approved && !draft ? (
          <div className="banner ai sticky-bar"><Tag tone="ok">Approved</Tag><div>These minutes are the record.</div>
            <button type="button" className="ds-btn sm" onClick={() => setDraft(m.minutes)}>Edit</button>
            <button type="button" className="ds-btn sm" onClick={() => setPreview(true)}>Preview</button>
            <a className="ds-btn sm" href={`/api/meetings/${m.id}/minutes/docx`}>Export Word</a>
            <button type="button" className="ds-btn sm primary" disabled title="Email is not connected">Send by email</button>
          </div>
        ) : (
          <div className="banner ai sticky-bar"><Tag tone="ai">{m.aiGenerated ? "AI draft" : "Draft"}</Tag><div>Check names, decisions and dates before you approve.</div>
            {!approved && <button type="button" className="link-text" disabled={!!busy} onClick={reject}>Reject</button>}
            {!draft && <button type="button" className="ds-btn sm" onClick={() => setPreview(true)}>Preview</button>}
            {draft ? <button type="button" className="ds-btn sm" disabled={!!busy} onClick={() => setDraft(null)}>Discard edits</button>
              : <button type="button" className="ds-btn sm" disabled={!!busy} onClick={() => { setDraft(m.minutes); if (tab === "transcript") setTab("summary"); }}>Edit</button>}
            <button type="button" className="ds-btn sm primary" disabled={!!busy || !minutes.summary.trim()} onClick={approve}>{busy === "approve" ? "Saving…" : "Approve minutes"}</button>
          </div>
        )}
      </>)}
      {preview && <PreviewModal title={`${m.title} · minutes`} previewPath={`/meetings/${m.id}/minutes/preview`} docxHref={`/api/meetings/${m.id}/minutes/docx`} onClose={() => setPreview(false)} />}
    </Section>
  );
}

/** Drops rows left empty while editing. */
const tidy = (mn: Minutes): Minutes => ({
  ...mn,
  decisions: mn.decisions.filter((x) => x.trim()),
  actions: mn.actions.filter((a) => a.what.trim()),
  keyOutcomes: (mn.keyOutcomes ?? []).filter((x) => x.trim()),
  openQuestions: (mn.openQuestions ?? []).filter((x) => x.trim()),
  risks: (mn.risks ?? []).filter((r) => r.title.trim()),
});

function Transcript({ meeting, busy, onSave, onDraft }: { meeting: Meeting; busy: string | null; onSave: (n: string) => void; onDraft: () => void }) {
  const [notes, setNotes] = useState(meeting.notes);
  const changed = notes !== meeting.notes;
  return (
    <section className="panel pad">
      <h2>Transcript</h2>
      <textarea className="field" rows={12} maxLength={60000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Paste the transcript or your own notes here…" aria-label="Transcript" />
      <div className="dlg-actions">
        {changed && <button type="button" className="ds-btn" disabled={!!busy} onClick={() => onSave(notes)}>{busy === "transcript" ? "Saving…" : "Save transcript"}</button>}
        <button type="button" className="ds-btn primary" disabled={!!busy || changed || !meeting.notes.trim()} onClick={onDraft}>{busy === "generate" ? "Drafting…" : "Draft minutes"}</button>
      </div>
    </section>
  );
}

function Bullets({ title, items, none }: { title: string; items: string[]; none: string }) {
  return (<><h2>{title}</h2>{items.length ? <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="sub-text">{none}</p>}</>);
}

function Reading({ tab, value: mn }: { tab: Tab; value: Minutes }) {
  const all = tab === "summary";
  return (<>
    {all && (<><h2>Purpose</h2><p>{mn.summary}</p><Bullets title="Key outcomes" items={mn.keyOutcomes ?? []} none="None recorded." /></>)}
    {(all || tab === "decisions") && (<><h2>Decisions</h2>
      {mn.decisions.length ? <ul className="rows">{mn.decisions.map((d, i) => <li key={i}><span className="grow">{d}</span></li>)}</ul> : <p className="sub-text">No decisions recorded.</p>}</>)}
    {(all || tab === "actions") && (<><h2>Action items</h2>
      {mn.actions.length ? <ul className="rows">{mn.actions.map((a, i) => <li key={i}><span className="grow">{a.what}</span><Person name={a.owner} /><span className="sub-text">{a.due ? shortDate(a.due) : "No date"}</span></li>)}</ul> : <p className="sub-text">No actions recorded.</p>}</>)}
    {(all || tab === "questions") && <Bullets title="Open questions" items={mn.openQuestions ?? []} none="No open questions recorded." />}
    {all && !!mn.risks?.length && (<><h2>Risks raised</h2><p className="sub-text">These appear on the Risks page as suggestions until someone confirms them.</p>
      <ul className="rows">{mn.risks.map((r, i) => <li key={i}><span className="grow"><b>{r.title}</b><br /><span className="sub-text">If {r.ifNotDone.replace(/\.$/, "")}, {r.impact}</span></span><Tag tone={levelTone(r.severity)}>{cap(r.severity)}</Tag></li>)}</ul></>)}
  </>);
}

function StringList({ title, items, onChange }: { title: string; items: string[]; onChange: (v: string[]) => void }) {
  return (<>
    <h2>{title}</h2>
    {items.map((x, i) => (
      <div className="edit-row" key={i}>
        <input className="field" value={x} aria-label={`${title} ${i + 1}`} onChange={(e) => onChange(items.map((y, j) => (j === i ? e.target.value : y)))} />
        <button type="button" className="link-text" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
      </div>
    ))}
    <button type="button" className="link-text" style={{ alignSelf: "flex-start" }} onClick={() => onChange([...items, ""])}>Add</button>
  </>);
}

function Editor({ tab, value: mn, onChange }: { tab: Tab; value: Minutes; onChange: (m: Minutes) => void }) {
  const all = tab === "summary";
  const set = (patch: Partial<Minutes>) => onChange({ ...mn, ...patch });
  const action = (i: number, patch: Partial<Minutes["actions"][number]>) => set({ actions: mn.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  return (<>
    {all && (<><h2>Purpose</h2><textarea className="field" rows={4} value={mn.summary} aria-label="Purpose" onChange={(e) => set({ summary: e.target.value })} />
      <StringList title="Key outcomes" items={mn.keyOutcomes ?? []} onChange={(keyOutcomes) => set({ keyOutcomes })} /></>)}
    {(all || tab === "decisions") && <StringList title="Decisions" items={mn.decisions} onChange={(decisions) => set({ decisions })} />}
    {(all || tab === "actions") && (<><h2>Action items</h2>
      {mn.actions.map((a, i) => (
        <div className="edit-row" key={i}>
          <input className="field" value={a.what} aria-label={`Action ${i + 1}`} onChange={(e) => action(i, { what: e.target.value })} />
          <input className="field short" placeholder="Owner" value={a.owner ?? ""} aria-label={`Owner of action ${i + 1}`} onChange={(e) => action(i, { owner: e.target.value || null })} />
          <input className="field short" type="date" value={a.due ?? ""} aria-label={`Due date of action ${i + 1}`} onChange={(e) => action(i, { due: e.target.value || null })} />
          <button type="button" className="link-text" onClick={() => set({ actions: mn.actions.filter((_, j) => j !== i) })}>Remove</button>
        </div>
      ))}
      <button type="button" className="link-text" style={{ alignSelf: "flex-start" }} onClick={() => set({ actions: [...mn.actions, { what: "", owner: null, due: null }] })}>Add</button></>)}
    {(all || tab === "questions") && <StringList title="Open questions" items={mn.openQuestions ?? []} onChange={(openQuestions) => set({ openQuestions })} />}
    {all && !!mn.risks?.length && (<><h2>Risks raised</h2>
      {mn.risks.map((r, i) => {
        const risk = (patch: Partial<typeof r>) => set({ risks: mn.risks!.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
        return (
          <div className="edit-row" key={i}>
            <input className="field" value={r.title} aria-label={`Risk ${i + 1}`} onChange={(e) => risk({ title: e.target.value })} />
            <input className="field" value={r.ifNotDone} placeholder="If this is not done…" aria-label={`If not done ${i + 1}`} onChange={(e) => risk({ ifNotDone: e.target.value })} />
            <input className="field" value={r.impact} placeholder="…this will happen" aria-label={`What happens ${i + 1}`} onChange={(e) => risk({ impact: e.target.value })} />
            <button type="button" className="link-text" onClick={() => set({ risks: mn.risks!.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        );
      })}</>)}
  </>);
}
