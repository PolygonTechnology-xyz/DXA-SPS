"use client";

/** The New project journey (Figma WS-02): start from a document or a description, check the draft, then create. */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, uploadFile } from "@/lib/api";
import { emptyDraft, hasContent, toNewProject } from "@/lib/draft";
import type { Project, ProjectDraft } from "@/lib/mock";
import { DraftCard, type FieldKey } from "./DraftCard";
import { FigmaIcon } from "./FigmaIcon";
import { useStore } from "./Store";

const MAX_BYTES = 25 * 1024 * 1024;
const TYPES = [".pdf", ".docx", ".txt", ".md"];
const CHIPS = ["What can DXA do?", "Start a payments project"];
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

interface Msg { role: "user" | "assistant"; content: string; error?: boolean; local?: boolean }
interface DocResult { draft: ProjectDraft; fileName: string; size: number; pages: number | null; pagesRead: number | null; trimmed: boolean }
interface DocState { file: File; status: "reading" | "read" | "failed"; result?: DocResult; error?: string }

export function NewProject() {
  const router = useRouter();
  const { addProject, replaceProject, openJira } = useStore();
  const [draft, setDraft] = useState<ProjectDraft>(emptyDraft);
  const [edited, setEdited] = useState<Set<FieldKey>>(new Set());
  const [doc, setDoc] = useState<DocState | null>(null);
  const [fileName, setFileName] = useState<string | null>(null); // the document the current draft came from
  const [source, setSource] = useState<File | null>(null);       // attached to the project when it is created
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [chatting, setChatting] = useState(false);
  const [over, setOver] = useState(false);
  const [connectJira, setConnectJira] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** Set when the project exists but its document could not be attached, so it is never created twice. */
  const [unattached, setUnattached] = useState<{ project: Project; error: string } | null>(null);
  const [round, setRound] = useState(0); // bumped by "Start over" to reset the draft card
  const input = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const work = useRef<AbortController | null>(null);
  const chatRound = useRef(0);

  useEffect(() => { if (msgs.length) log.current?.scrollTo({ top: log.current.scrollHeight }); }, [msgs, chatting]);
  useEffect(() => () => work.current?.abort(), []);

  const reading = doc?.status === "reading";
  const busy = reading || chatting;
  const showDraft = hasContent(draft) || connectJira || doc?.status === "read";

  async function readDocument(file: File) {
    if (busy || creating || unattached) return;
    const fail = (error: string) => setDoc({ file, status: "failed", error });
    if (!TYPES.some((t) => file.name.toLowerCase().endsWith(t))) return fail("Upload a PDF, Word (.docx) or text file.");
    if (file.size > MAX_BYTES) return fail("That file is larger than 25 MB.");
    if (hasContent(draft) && !window.confirm("Replace the current draft with what DXA reads from this document?")) return;
    work.current = new AbortController();
    setDoc({ file, status: "reading" });
    setCreateError(null);
    try {
      const result = await uploadFile<DocResult>("/project-drafts/document", file, work.current.signal);
      setDraft(result.draft);
      setEdited(new Set());
      setFileName(result.fileName);
      setSource(file);
      setDoc({ file, status: "read", result });
      setRound((n) => n + 1);
    } catch (e) {
      if (!work.current.signal.aborted) fail((e as Error).message);
    }
  }

  async function send(raw: string) {
    const content = raw.trim();
    if (!content || busy || creating || unattached) return;
    setText("");
    const history: Msg[] = [...msgs, { role: "user", content }];
    setMsgs(history);
    setChatting(true);
    const mine = ++chatRound.current;
    try {
      const turn = await api<{ reply: string; draft: ProjectDraft }>("/project-drafts/chat", {
        method: "POST",
        body: { messages: history.filter((m) => !m.error && !m.local).slice(-50).map(({ role, content }) => ({ role, content })), draft },
      });
      if (mine !== chatRound.current) return; // "Start over" was chosen while waiting
      // a field the chat changed is no longer the person's own edit
      const changed: Record<FieldKey, boolean> = {
        name: turn.draft.name.value !== draft.name.value, goal: turn.draft.goal.value !== draft.goal.value,
        manager: turn.draft.manager.value !== draft.manager.value, budget: turn.draft.budget.value !== draft.budget.value,
        dates: turn.draft.start.value !== draft.start.value || turn.draft.end.value !== draft.end.value,
        phases: JSON.stringify(turn.draft.phases) !== JSON.stringify(draft.phases),
        milestones: JSON.stringify(turn.draft.milestones) !== JSON.stringify(draft.milestones),
      };
      setEdited((set) => new Set([...set].filter((k) => !changed[k])));
      setDraft(turn.draft);
      setMsgs((m) => [...m, { role: "assistant", content: turn.reply }]);
    } catch (e) {
      if (mine !== chatRound.current) return;
      setMsgs((m) => [...m, { role: "assistant", content: (e as Error).message, error: true }]);
      setText(content);
    }
    setChatting(false);
  }

  function importFromJira() {
    setConnectJira(true);
    setMsgs((m) => [...m, { role: "assistant", local: true, content: "Jira is linked to a project, so give it a name first: tell me here, or add it in the draft below. After you choose Create project, I will open the Jira connection." }]);
    composer.current?.focus();
  }

  function startOver() {
    if (hasContent(draft) && !window.confirm("Discard this draft and the conversation?")) return;
    reset();
  }

  /** Next keeps this page's state while you are elsewhere, so it is cleared before leaving. */
  function reset() {
    work.current?.abort();
    chatRound.current++;
    setDraft(emptyDraft()); setEdited(new Set()); setDoc(null); setFileName(null); setSource(null);
    setMsgs([]); setText(""); setChatting(false); setConnectJira(false); setCreateError(null);
    setCreating(false); setUnattached(null);
    setRound((n) => n + 1);
  }

  function open(project: Project) {
    reset();
    router.push(`/projects/${project.id}`);
    if (connectJira) openJira(project.id);
  }

  async function attach(project: Project, file: File) {
    await uploadFile(`/projects/${project.id}/documents`, file);
    replaceProject(await api<Project>(`/projects/${project.id}`)); // the project now lists the document
  }

  async function create() {
    if (creating || unattached) return;
    setCreating(true);
    setCreateError(null);
    let project: Project;
    try {
      project = await addProject(toNewProject(draft));
    } catch (e) {
      setCreateError((e as Error).message);
      setCreating(false);
      return;
    }
    if (source) {
      try { await attach(project, source); } catch (e) {
        setUnattached({ project, error: (e as Error).message });
        setCreating(false);
        return;
      }
    }
    open(project);
  }

  async function retryAttach() {
    if (!unattached || !source) return;
    setCreating(true);
    try { await attach(unattached.project, source); open(unattached.project); } catch (e) {
      setUnattached({ ...unattached, error: (e as Error).message });
      setCreating(false);
    }
  }

  const r = doc?.result;
  const readNote = !r ? "" : r.pages == null ? (r.trimmed ? "only the first part was read" : "read") : r.trimmed ? `read ${r.pagesRead} of ${r.pages} pages` : `read ${r.pages} page${r.pages === 1 ? "" : "s"}`;

  return (
    <div className="page">
      <div className="np">
        <div>
          <h1>New project</h1>
          <p className="np-lead">Upload a plan or describe the project. DXA drafts the setup and you check every field before anything is saved.</p>
        </div>

        <div className="np-start">
          <section className="np-card" aria-label="Start from a document">
            <div className="np-card-h"><h2>Start from a document</h2></div>
            <div className={`np-drop${over ? " over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void readDocument(f); }}>
              <span className="np-drop-ic"><FigmaIcon name="upload-cloud" size={22} /></span>
              <strong>Drop a project plan, proposal or scope document</strong>
              <span>PDF, Word or text, up to 25 MB</span>
              <button type="button" className="ds-btn sm" disabled={busy || !!unattached} onClick={() => input.current?.click()}>Browse files</button>
              <input ref={input} type="file" hidden accept={TYPES.join(",")} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readDocument(f); }} />
            </div>
            {doc && (
              <div className="np-file" role="status">
                <span className="np-file-ic"><FigmaIcon name="doc" size={18} /></span>
                <div>
                  <strong>{doc.file.name}</strong>
                  <span>{size(doc.file.size)}{doc.status === "read" ? ` · ${readNote}` : ""}</span>
                  {doc.error && <span className="np-bad">{doc.error}</span>}
                </div>
                <span className={`np-tag ${doc.status === "read" ? (r?.trimmed ? "warn" : "ok") : doc.status === "failed" ? "bad" : ""}`}>
                  {doc.status === "read" ? (r?.trimmed ? "Partly read" : "Read") : doc.status === "failed" ? "Not read" : "Reading…"}
                </span>
              </div>
            )}
          </section>

          <section className="np-card np-chat" aria-label="Or describe it">
            <div className="np-card-h"><h2>Or describe it</h2></div>
            <div className="np-log" ref={log} aria-live="polite">
              <div className="np-msg"><b>DXA</b><p>Tell me the goal, who is involved and the key dates. I will turn it into a project setup you can check and edit.</p></div>
              {msgs.map((m, i) => (
                <div key={i} className={`np-msg ${m.role}${m.error ? " error" : ""}`}><b>{m.role === "user" ? "You" : "DXA"}</b><p>{m.content}</p></div>
              ))}
              {chatting && <div className="np-msg"><b>DXA</b><p>Working on it…</p></div>}
              {msgs.length === 0 && (
                <div className="np-chips">
                  {CHIPS.map((c) => <button type="button" key={c} disabled={busy} onClick={() => void send(c)}>{c}</button>)}
                  <button type="button" disabled={busy} onClick={importFromJira}>Import from Jira</button>
                </div>
              )}
            </div>
            <form className="np-composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
              <input ref={composer} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder="Message DXA" aria-label="Message DXA" disabled={!!unattached} />
              <button type="button" className="np-mic" disabled title="Voice input is not available yet" aria-label="Voice input"><FigmaIcon name="mic" size={18} /></button>
              <button type="submit" className="ds-btn sm primary" disabled={!text.trim() || busy || !!unattached}><FigmaIcon name="send-up" size={16} />Send</button>
            </form>
          </section>
        </div>

        {createError && <div className="note bad" role="alert">⚠ {createError}</div>}
        {unattached ? (
          <section className="np-card" role="alert">
            <h2>{unattached.project.name} was created, but the document was not attached</h2>
            <p className="np-sub">{unattached.error}</p>
            <div className="np-actions"><p />
              <button type="button" className="ds-btn" disabled={creating} onClick={() => open(unattached.project)}>Open without it</button>
              <button type="button" className="ds-btn primary" disabled={creating} onClick={() => void retryAttach()}>{creating ? "Attaching…" : "Try again"}</button>
            </div>
          </section>
        ) : showDraft && (
          <DraftCard key={round} draft={draft} fileName={fileName} edited={edited} locked={busy} creating={creating}
            connectJira={connectJira} onConnectJira={setConnectJira}
            onEdit={(key, patch) => { setDraft((d) => ({ ...d, ...patch })); setEdited((s) => new Set(s).add(key)); }}
            onStartOver={startOver} onCreate={() => void create()} />
        )}
      </div>
    </div>
  );
}
