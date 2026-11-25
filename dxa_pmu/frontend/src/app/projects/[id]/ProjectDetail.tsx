"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { StatusChip } from "@/components/Badges";
import { SetupCard } from "@/components/SetupCard";
import { Dashboard, SyncControls, useJiraSync } from "@/components/Dashboard";
import { useStore } from "@/components/Store";
import { api } from "@/lib/api";
import type { Project } from "@/lib/mock";

type Act = "docs" | "jira";
interface Msg { role: "me" | "bot"; text: string; error?: boolean; actions?: { id: "analyse"; label: string }[] }

const NEXT_ACTIONS: Msg["actions"] = [{ id: "analyse", label: "🔍 Analyse the tasks" }];

interface AnalysisOut { summary: string; riskLevel: string; findings: string[]; recommendations: string[] }

function formatAnalysis(a: AnalysisOut) {
  return [
    a.summary,
    `Overall risk: ${a.riskLevel}.`,
    ...(a.findings.length ? ["", "What I see:", ...a.findings.map((f) => `• ${f}`)] : []),
    ...(a.recommendations.length ? ["", "What to do next:", ...a.recommendations.map((r, i) => `${i + 1}. ${r}`)] : []),
  ].join("\n");
}

function Editable({ value, multiline, onSave }: { value: string; multiline?: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  const done = () => { setEditing(false); if (v.trim() && v !== value) onSave(v.trim()); else setV(value); };
  if (!editing) return <div className="p-value" onClick={() => { setV(value); setEditing(true); }} title="Click to edit">{value || "—"}</div>;
  const common = { className: "field", autoFocus: true, value: v, onBlur: done };
  return multiline
    ? <textarea {...common} rows={3} onChange={(e) => setV(e.target.value)} />
    : <input {...common} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />;
}

function Assistant({ project, act, onClose }: { project: Project; act: Act; onClose: () => void }) {
  const { updateProject } = useStore();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  const bot = (t: string, extra: Partial<Msg> = {}) => setMsgs((m) => [...m, { role: "bot", text: t, ...extra }]);

  useEffect(() => {
    const count = project.tasks?.length ?? 0;
    setMsgs([act === "jira"
      ? {
          role: "bot",
          text: count > 0
            ? `I got the tasks! I found ${count} task${count === 1 ? "" : "s"} in your Jira project ${project.jira?.key}. What would you like to do next?`
            : `Jira is connected, but I did not find any tasks in ${project.jira?.key} yet. Add some in Jira and refresh, and I will pick them up.`,
          actions: count > 0 ? NEXT_ACTIONS : undefined,
        }
      : { role: "bot", text: "Great. Click the 📎 button below to add your files, such as a project plan, proposal or scope document. I will add them to this project." }]);
    // seed once per opening; later project edits must not reset the conversation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [act]);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs]);

  async function choose(a: NonNullable<Msg["actions"]>[number]) {
    setMsgs((m) => [...m.map((x) => ({ ...x, actions: undefined })), { role: "me", text: a.label }]);
    setBusy(true);
    try {
      bot(formatAnalysis(await api<AnalysisOut>(`/projects/${project.id}/analysis`, { method: "POST" })));
    } catch (e) {
      bot((e as Error).message, { error: true });
    }
    setBusy(false);
  }

  async function send() {
    const v = text.trim();
    if (!v || busy) return;
    setText("");
    const history = [...msgs, { role: "me" as const, text: v }];
    setMsgs(history);
    setBusy(true);
    try {
      const { reply } = await api<{ reply: string }>(`/projects/${project.id}/chat`, {
        method: "POST",
        body: { messages: history.filter((m) => !m.error).map((m) => ({ role: m.role === "me" ? "user" : "assistant", content: m.text })) },
      });
      bot(reply);
    } catch (e) {
      bot((e as Error).message, { error: true });
    }
    setBusy(false);
  }

  function attach(list: FileList | null) {
    if (!list?.length) return;
    const names = Array.from(list).map((f) => f.name);
    updateProject(project.id, { files: [...project.files, ...names] });
    setMsgs((m) => [...m, { role: "me", text: `📎 ${names.join(", ")}` }]);
    setTimeout(() => bot(`Added ${names.length} file${names.length > 1 ? "s" : ""} to the project. Reading documents is not available yet, so for now ${names.length > 1 ? "they are" : "it is"} only listed.`), 400);
  }

  return (
    <aside className="rail">
      <div className="rail-head"><strong>✎ Assistant</strong><button className="btn" onClick={onClose}>Hide »</button></div>
      <div className="rail-msgs">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}><div className="avatar">{m.role === "me" ? "D" : "◆"}</div><div className="bubble">{m.error ? <span className="err">⚠ {m.text}</span> : m.text}{m.actions && (
              <div className="quick">{m.actions.map((a) => <button key={a.id} className="btn" disabled={busy} onClick={() => void choose(a)}>{a.label}</button>)}</div>
            )}</div></div>
        ))}
        {busy && <div className="msg bot"><div className="avatar">◆</div><div className="bubble typing"><span /><span /><span /></div></div>}
        <div ref={end} />
      </div>
      <form className="rail-in" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <button type="button" className="icon-btn" title="Attach files" onClick={() => file.current?.click()}>📎</button>
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about this project…" />
        <button className="btn primary" type="submit" disabled={busy || !text.trim()}>Send</button>
        <input ref={file} type="file" multiple hidden onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />
      </form>
    </aside>
  );
}

function Detail() {
  const { id } = useParams<{ id: string }>();
  const { projects, ready, loadError, updateProject, openJira, nudge, setNudge } = useStore();
  const [act, setAct] = useState<Act | null>(null);
  const p = projects.find((x) => x.id === id);
  const { sync, refresh } = useJiraSync(id);

  useEffect(() => {
    if (nudge && nudge === id) { setAct("jira"); setNudge(null); }
  }, [nudge, id, setNudge]);

  if (!p) {
    return (
      <div className="page"><div className="page-inner">
        <p className="empty">{!ready ? "Loading…" : loadError ?? "Project not found."} {ready && <Link href="/projects">Back to all projects</Link>}</p>
      </div></div>
    );
  }

  const hasSetup = !!(p.manager || p.startDate || p.endDate || p.budgetText || p.budget != null || p.phases?.length || p.milestones.length);
  const hasDashboard = !!p.jira || p.files.length > 0;

  return (
    <>
      <header className="topbar">
        <h2>{hasDashboard ? "Overview" : p.name}</h2>
        <span className="topbar-spacer" />
        {hasDashboard && <SyncControls project={p} sync={sync} refresh={refresh} />}
        {!act && <button className="ds-btn sm rail-open" onClick={() => setAct("docs")}>Assistant</button>}
      </header>
      <div className="split">
        <div className={`page${hasDashboard ? " ov-page" : ""}`}>
          <div className="page-inner wide">
            {!hasDashboard && (
              <div className="card p-card">
                <div className="row between">
                  <small className="muted">{p.code}</small>
                  <StatusChip status={p.status} />
                </div>
                <div className="p-label">Project</div>
                <Editable value={p.name} onSave={(name) => updateProject(p.id, { name })} />
                <div className="p-label">Goal</div>
                <Editable multiline value={p.goal} onSave={(goal) => updateProject(p.id, { goal })} />
                <div className="p-saved">Click any text to edit. Changes save automatically</div>
              </div>
            )}

            {hasSetup && !p.jira && <SetupCard project={p} />}

            {hasDashboard && <Dashboard project={p} sync={sync} onRetrySync={refresh} />}

            {hasSetup && p.jira && <SetupCard project={p} />}

            {p.files.length > 0 && (
              <details className="rec" id="files" open>
                <summary>📄 Uploaded documents <span className="chip">{p.files.length}</span></summary>
                <ul>{p.files.map((f, i) => <li key={f + i}>{f}</li>)}</ul>
              </details>
            )}

            <h3 className="p-q">{hasDashboard ? "Add more to this project" : "How would you like to continue?"}</h3>
            <div className="choices">
              {!p.jira && (
                <button className={`choice${p.jira ? " on" : ""}`} onClick={() => openJira(p.id)}>
                  <strong>🔗 Import my tasks from Jira</strong>
                  <small>Already tracking this work in Jira? Link it and your tasks and progress will show up here.</small>
                </button>
              )}
              <button className={`choice${act === "docs" ? " on" : ""}`} onClick={() => setAct("docs")}>
                <strong>📎 {p.files.length > 0 ? "Upload more documents" : "Upload project documents"}</strong>
                <small>Have a plan, proposal or scope document? Upload it and I will build the project details from it.</small>
              </button>
            </div>
          </div>
        </div>
                {act && <Assistant key={act} project={p} act={act} onClose={() => setAct(null)} />}
      </div>
    </>
  );
}

export function ProjectDetail() {
  return (
    <Suspense fallback={<div className="page"><div className="page-inner muted">Loading…</div></div>}>
      <Detail />
    </Suspense>
  );
}
