"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/components/Store";

interface Msg { role: "me" | "bot"; text: string; error?: boolean }
interface Turn { reply: string; projectName: string | null; goal: string | null; ready: boolean }

const SUGGESTIONS = [
  { ic: "🧭", title: "What does this system do?", prompt: "What does this system do?", sub: "Get a quick tour of DXA PMU." },
  { ic: "🛠️", title: "How can you help me?", prompt: "How can you help me with my projects?", sub: "See what I can do for your projects." },
  { ic: "🚀", title: "Start a new project", prompt: "I want to manage a project", sub: 'Try: "I want to manage a project"' },
];

export function CreateChat({ title }: { title: string }) {
  const { addProject } = useStore();
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [proposal, setProposal] = useState<{ name: string; goal: string } | null>(null);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy, proposal]);

  async function send(raw: string) {
    const value = raw.trim();
    if (!value || busy || done) return;
    setText("");
    setProposal(null);
    const history = [...msgs, { role: "me" as const, text: value }];
    setMsgs(history);
    setBusy(true);
    try {
      const turn = await api<Turn>("/chat/create-project", {
        method: "POST",
        body: { messages: history.filter((m) => !m.error).map((m) => ({ role: m.role === "me" ? "user" : "assistant", content: m.text })) },
      });
      setMsgs((m) => [...m, { role: "bot", text: turn.reply }]);
      // The assistant only proposes; nothing is created until the person confirms.
      if (turn.ready && turn.projectName && turn.goal) setProposal({ name: turn.projectName, goal: turn.goal });
    } catch (e) {
      setMsgs((m) => [...m, { role: "bot", text: (e as Error).message, error: true }]);
    }
    setBusy(false);
  }

  async function confirm() {
    if (!proposal || busy) return;
    setBusy(true);
    try {
      const project = await addProject(proposal);
      setDone(true);
      setProposal(null);
      setTimeout(() => router.push(`/projects/${project.id}`), 600);
    } catch (e) {
      setMsgs((m) => [...m, { role: "bot", text: (e as Error).message, error: true }]);
    }
    setBusy(false);
  }

  const started = msgs.length > 0;

  return (
    <>
      <header className="topbar"><h2>{title}</h2></header>
      <div className="page chat">
        <div className="page-inner">
          {!started && (
            <div className="welcome">
              <div className="logo-lg">◆</div>
              <h1>Hi Demo, what would you like to do?</h1>
              <p>Pick a suggestion or ask your own question.</p>
              <div className="suggest">
                {SUGGESTIONS.map((s) => (
                  <button key={s.title} className="sg" onClick={() => void send(s.prompt)}>
                    <span className="ic">{s.ic}</span>
                    <strong>{s.title}</strong>
                    <span>{s.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="avatar">{m.role === "me" ? "D" : "◆"}</div>
              <div className="bubble">{m.error ? <span className="err">⚠ {m.text}</span> : m.text}</div>
            </div>
          ))}
          {busy && (
            <div className="msg bot"><div className="avatar">◆</div><div className="bubble typing"><span /><span /><span /></div></div>
          )}
          {proposal && !busy && (
            <div className="msg bot">
              <div className="avatar">◆</div>
              <div className="bubble">
                <strong>Create this project?</strong>
                <div><span className="muted">Name:</span> {proposal.name}</div>
                <div><span className="muted">Goal:</span> {proposal.goal}</div>
                <div className="row">
                  <button className="btn primary" onClick={() => void confirm()}>Create project</button>
                  <button className="btn" onClick={() => setProposal(null)}>Not yet, keep editing</button>
                </div>
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      <div className="composer-wrap">
        <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message DXA PMU…"
            disabled={done}
            autoFocus
          />
          <button className="send" type="submit" disabled={!text.trim() || busy || done} aria-label="Send">➤</button>
        </form>
        <div className="hint">Answers come from Claude</div>
      </div>
    </>
  );
}
