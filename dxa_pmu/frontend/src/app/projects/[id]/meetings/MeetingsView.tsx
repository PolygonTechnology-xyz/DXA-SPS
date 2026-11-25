"use client";

/** Meetings (Figma MT-01), adding one (MT-02), and the Actions (MT-05) and Decisions (MT-06) records. */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FormatsModal } from "@/components/FormatsModal";
import { useFormats } from "@/components/FormatPanel";
import { useStore } from "@/components/Store";
import { Chips, Empty, ErrorNote, Modal, PageHead, Person, SOON, Search, Section, Tag, longDate, plural, shortDate } from "@/components/ui";
import { api, uploadFile } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { iso } from "@/lib/schedule";
import type { Decision, Meeting, Project } from "@/lib/mock";

type View = "all" | "review" | "notranscript" | "approved" | "actions" | "decisions";

const needsReview = (m: Meeting) => !!m.minutes && !m.approvedAt;
const noTranscript = (m: Meeting) => !m.notes.trim() && !m.minutes;

interface ActionRow { key: string; what: string; from: string; href?: string; owner: string | null; due: string | null; jira: string | null; jiraUrl?: string }

/** Actions agreed in approved minutes, and open Jira tasks. */
function actionRows(project: Project | undefined, meetings: Meeting[]): ActionRow[] {
  const fromMinutes = meetings.filter((m) => m.approvedAt && m.minutes).flatMap((m) => m.minutes!.actions.map((a, i): ActionRow => ({
    key: `${m.id}-${i}`, what: a.what, from: `${m.title}, ${shortDate(m.heldOn)}`, href: `/projects/${m.projectId}/meetings/${m.id}`, owner: a.owner, due: a.due ?? null, jira: null,
  })));
  const fromJira = (project?.tasks ?? []).filter((t) => t.category !== "done").map((t): ActionRow => ({
    key: t.key, what: t.summary, from: "Jira", owner: t.assignee, due: t.due, jira: t.key, jiraUrl: project?.jira ? `${project.jira.site}/browse/${t.key}` : undefined,
  }));
  // overdue and dated first, undated last
  return [...fromMinutes, ...fromJira].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
}

const daysLate = (due: string | null) => (due && due < iso(new Date()) ? Math.round((new Date(`${iso(new Date())}T00:00:00`).getTime() - new Date(`${due}T00:00:00`).getTime()) / 86_400_000) : 0);

export function MeetingsView() {
  const { id } = useParams<{ id: string }>();
  const { projects } = useStore();
  const project = projects.find((p) => p.id === id);
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [view, setView] = useState<View>("all");
  const [adding, setAdding] = useState(false);
  const [formats, setFormats] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => Promise.all([api<Meeting[]>(`/projects/${id}/meetings`), api<Decision[]>(`/projects/${id}/decisions?limit=500`)])
    .then(([m, d]) => { setMeetings(m); setDecisions(d); })
    .catch((e) => { setMeetings((v) => v ?? []); setDecisions((v) => v ?? []); setError((e as Error).message); }), [id]);
  useEffect(() => { void load(); }, [load]);

  const all = meetings ?? [];
  const actions = actionRows(project, all);
  const records = view === "actions" || view === "decisions";
  const title = view === "actions" ? "Actions" : view === "decisions" ? "Decisions" : "All meetings";

  const exportRecords = () => view === "actions"
    ? downloadCsv("actions.csv", [["Action", "From", "Owner", "Due", "Jira"], ...actions.map((a) => [a.what, a.from, a.owner, a.due, a.jira])])
    : downloadCsv("decisions.csv", [["ID", "Decision", "Meeting", "Date", "Status"], ...(decisions ?? []).map((d) => [`D-${d.number}`, d.text, d.meetingTitle, d.heldOn, d.status])]);

  return (
    <Section
      crumbs={[{ label: "Meetings" }, { label: title }]}
      active={view}
      onSelect={(v) => (v === "formats" ? setFormats(true) : setView(v as View))}
      menu={[
        { items: [{ id: "all", label: "All meetings", icon: "meetings", count: all.length }] },
        { title: "Status", items: [
          { id: "review", label: "Minutes to review", icon: "reports", count: all.filter(needsReview).length },
          { id: "notranscript", label: "No transcript", icon: "alert", count: all.filter(noTranscript).length },
          { id: "approved", label: "Approved", icon: "check", count: all.filter((m) => m.approvedAt).length }] },
        { title: "Records", items: [
          { id: "actions", label: "Actions", icon: "checklist", count: actions.length },
          { id: "decisions", label: "Decisions", icon: "flag", count: decisions?.length ?? 0 }] },
        { title: "Setup", items: [{ id: "formats", label: "Minutes formats", icon: "file" }] },
      ]}
      actions={records ? (<>
        <button type="button" className="ds-btn sm" onClick={exportRecords}>Export</button>
        {view === "actions" && <button type="button" className="ds-btn sm primary" disabled title={SOON}>Add action</button>}
      </>) : (<>
        <button type="button" className="ds-btn sm" onClick={() => setFormats(true)}>Minutes formats</button>
        <button type="button" className="ds-btn sm primary" onClick={() => setAdding(true)}>Add meeting</button>
      </>)}
    >
      <ErrorNote error={error} />
      {meetings === null ? <p className="sub-text">Loading…</p>
        : view === "actions" ? <Actions rows={actions} />
        : view === "decisions" ? <Decisions rows={decisions ?? []} projectId={id} />
        : <List projectId={id} meetings={all.filter((m) => view === "review" ? needsReview(m) : view === "notranscript" ? noTranscript(m) : view === "approved" ? !!m.approvedAt : true)} total={all.length} />}
      {adding && <AddMeeting projectId={id} onSaved={() => { setAdding(false); void load(); }} onClose={() => { setAdding(false); void load(); }} onManage={() => { setAdding(false); setFormats(true); }} />}
      {formats && <FormatsModal projectId={id} initial="minutes" onClose={() => setFormats(false)} />}
    </Section>
  );
}

function List({ projectId, meetings, total }: { projectId: string; meetings: Meeting[]; total: number }) {
  return (<>
    <PageHead title="Meetings" lead="Add a transcript. DXA drafts the minutes in your format and you approve them." />
    <section className="panel">
      {meetings.length === 0 ? <Empty title={total === 0 ? "No meetings yet" : "No meetings here"} text={total === 0 ? "Choose Add meeting to start." : undefined} /> : (
        <div className="table-x">
          <table className="tbl">
            <thead><tr><th>Meeting</th><th>Transcript</th><th>Minutes</th><th>Found</th><th><span className="visually-hidden">Open</span></th></tr></thead>
            <tbody>
              {meetings.map((m) => {
                const href = `/projects/${projectId}/meetings/${m.id}`;
                return (
                  <tr key={m.id}>
                    <td><Link className="cell-title" href={href}>{m.title}</Link><span className="cell-sub">{longDate(m.heldOn)}</span></td>
                    <td>{m.notes.trim() ? <Tag tone="ok">Transcript ready</Tag> : <Tag tone="warn">No transcript</Tag>}</td>
                    <td>{m.approvedAt ? <Tag tone="ok">Approved</Tag> : m.minutes ? <Tag tone="ai">Draft to review</Tag> : <Tag>Not started</Tag>}</td>
                    <td className="sub-text">{m.minutes && <>{plural(m.minutes.decisions.length, "decision")}<br />{plural(m.minutes.actions.length, "action")}</>}</td>
                    <td>{needsReview(m) ? <Link className="ds-btn sm primary" href={href}>Review minutes</Link> : noTranscript(m) ? <Link className="ds-btn sm" href={href}>Add transcript</Link> : <Link className="link-text" href={href}>Open</Link>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="panel-foot">Showing {meetings.length} of {plural(total, "meeting")}</div>
    </section>
    <div className="well"><b>No transcript?</b><p className="sub-text">Open the meeting and add your own notes. Recording upload and Fathom are not connected yet.</p></div>
  </>);
}

const PAGE = 25;

function Actions({ rows }: { rows: ActionRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "overdue" | "noowner">("all");
  const [shown, setShown] = useState(PAGE);
  const overdue = rows.filter((r) => daysLate(r.due));
  const noOwner = rows.filter((r) => !r.owner);
  const list = (filter === "overdue" ? overdue : filter === "noowner" ? noOwner : rows).filter((r) => `${r.what} ${r.owner ?? ""} ${r.jira ?? ""} ${r.from}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (<>
    <PageHead title="Actions" lead="Action items from approved minutes, and open Jira tasks. DXA never changes Jira." />
    <Chips label="Filter actions" value={filter} onChange={(v) => { setFilter(v); setShown(PAGE); }} options={[{ id: "all", label: "Open", count: rows.length }, { id: "overdue", label: "Overdue", count: overdue.length }, { id: "noowner", label: "Without an owner", count: noOwner.length }]} />
    <section className="panel">
      <div className="panel-head"><h2>Open actions</h2><Search value={q} onChange={setQ} placeholder="Search actions" /></div>
      {list.length === 0 ? <Empty title="No actions" /> : (
        <div className="table-x"><table className="tbl">
          <thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Jira</th><th>Status</th></tr></thead>
          <tbody>{list.slice(0, shown).map((r) => {
            const late = daysLate(r.due);
            return (
              <tr key={r.key}>
                <td><span className="cell-title">{r.what}</span>{r.href ? <Link className="cell-sub" href={r.href}>{r.from}</Link> : <span className="cell-sub">{r.from}</span>}</td>
                <td><Person name={r.owner} /></td>
                <td>{r.due ? shortDate(r.due) : <span className="sub-text">No date</span>}</td>
                <td>{r.jira ? (r.jiraUrl ? <a className="tag" href={r.jiraUrl} target="_blank" rel="noreferrer">{r.jira}</a> : <Tag>{r.jira}</Tag>) : "—"}</td>
                <td>{late ? <Tag tone="bad">{plural(late, "day")} late</Tag> : <Tag>Open</Tag>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <div className="panel-foot"><span>Showing {Math.min(shown, list.length)} of {list.length}, earliest due first</span>{shown < list.length && <button type="button" className="ds-btn sm" onClick={() => setShown((n) => n + PAGE)}>Show more</button>}</div>
    </section>
  </>);
}

function Decisions({ rows, projectId }: { rows: Decision[]; projectId: string }) {
  const [q, setQ] = useState("");
  const list = rows.filter((d) => `D-${d.number} ${d.text} ${d.meetingTitle}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (<>
    <PageHead title="Decisions" lead="Every decision links to the meeting it was made in. Decisions in unapproved minutes stay drafts." />
    <section className="panel">
      <div className="panel-head"><h2>Decision log</h2><Search value={q} onChange={setQ} placeholder="Search decisions" /></div>
      {list.length === 0 ? <Empty title="No decisions" text={rows.length ? undefined : "They appear once meeting minutes are drafted."} /> : (
        <div className="table-x"><table className="tbl">
          <thead><tr><th>ID</th><th>Decision</th><th>Made in</th><th>Status</th></tr></thead>
          <tbody>{list.map((d) => (
            <tr key={d.number}>
              <td><Tag>D-{d.number}</Tag></td><td>{d.text}</td>
              <td><Link className="cell-title" href={`/projects/${projectId}/meetings/${d.meetingId}`}>{d.meetingTitle}</Link><span className="cell-sub">{longDate(d.heldOn)}</span></td>
              <td>{d.status === "Approved" ? <Tag tone="ok">Approved</Tag> : <Tag tone="warn">Awaiting approval</Tag>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  </>);
}

function AddMeeting({ projectId, onClose, onSaved, onManage }: { projectId: string; onClose: () => void; onSaved: () => void; onManage: () => void }) {
  const router = useRouter();
  const { rows: formats } = useFormats(projectId, "minutes");
  const [title, setTitle] = useState("");
  const [heldOn, setHeldOn] = useState(() => iso(new Date()));
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [format, setFormat] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function readFile(file: File) {
    setBusy("Reading the file…"); setError(null);
    try {
      const r = await uploadFile<{ text: string; trimmed: boolean }>("/transcripts/text", file);
      setNotes(r.text); setMode("paste");
      if (r.trimmed) setError("The file was long, so only the first 60,000 characters were kept.");
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !title.trim()) return;
    setBusy("Saving…"); setError(null);
    let m: Meeting;
    try {
      m = await api<Meeting>(`/projects/${projectId}/meetings`, { method: "POST", body: { title: title.trim(), heldOn, notes } });
    } catch (err) { setError((err as Error).message); setBusy(null); return; }
    // the meeting is saved from here on, so a later failure is shown on its page instead of saving it twice
    let problem = "";
    try {
      if (format) await api(`/meetings/${m.id}/format`, { method: "PUT", body: { formatId: format } });
      if (notes.trim()) { setBusy("Drafting minutes…"); await api(`/meetings/${m.id}/minutes`, { method: "POST" }); }
    } catch (err) { problem = (err as Error).message; }
    onSaved(); // close the pop-up before leaving, or it would still be open on coming back
    router.push(`/projects/${projectId}/meetings/${m.id}${problem ? `?problem=${encodeURIComponent(problem)}` : ""}`);
  }

  return (
    <Modal title="Add a meeting" lead="DXA drafts the minutes from the transcript. Nothing is final until you approve them." onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={(e) => void save(e)} style={{ display: "contents" }}>
        <div className="form-grid">
          <div><label htmlFor="m-title">Title</label><input id="m-title" className="field" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly steering committee" /></div>
          <div><label htmlFor="m-date">Date</label><input id="m-date" className="field" type="date" required value={heldOn} onChange={(e) => setHeldOn(e.target.value)} /></div>
        </div>
        <div>
          <span className="form-label">Transcript</span>
          <div className="chips-row">
            <button type="button" className={`filter-chip${mode === "paste" ? " on" : ""}`} onClick={() => setMode("paste")}>Paste text</button>
            <button type="button" className={`filter-chip${mode === "file" ? " on" : ""}`} onClick={() => setMode("file")}>Upload a file</button>
            <button type="button" className="filter-chip" disabled title="Fathom is not connected">From Fathom</button>
          </div>
        </div>
        {mode === "paste"
          ? <textarea className="field" rows={7} maxLength={60000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Paste the transcript or notes here…" aria-label="Transcript" />
          : <input className="field" type="file" accept=".txt,.vtt,.docx" aria-label="Transcript file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />}
        <span className="sub-text">English, Bangla or both. Files: .txt, .docx or .vtt</span>
        <div>
          <label htmlFor="m-format">Minutes format</label>
          <select id="m-format" className="field" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="">{formats?.find((f) => f.isDefault)?.name ?? "Built-in format"} (default)</option>
            <option value="builtin">Built-in format</option>
            {formats?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <button type="button" className="link-text" onClick={onManage}>Manage formats</button>
        </div>
        <ErrorNote error={error} />
        <div className="dlg-actions">
          <button type="button" className="ds-btn" disabled={!!busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="ds-btn primary" disabled={!!busy || !title.trim()}>{busy ?? (notes.trim() ? "Save and draft minutes" : "Save meeting")}</button>
        </div>
      </form>
    </Modal>
  );
}
