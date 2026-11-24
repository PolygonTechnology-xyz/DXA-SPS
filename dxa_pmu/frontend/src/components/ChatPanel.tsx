"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Msg = { role: "user" | "assistant"; content: string };

/** A short conversation with the AI about a draft. Each answer changes the draft; the person still approves it. */
export function ChatPanel<R extends { reply: string }>({ path, current, onResult, hint, examples }: {
  /** POST here to send; GET `${path}`'s sibling `/chat` returns the saved conversation. */
  path: string; current?: unknown; onResult: (r: R) => void; hint: string; examples: string[];
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatPath = path.replace(/\/revise$/, "/chat");
  useEffect(() => { let off = false; api<Msg[]>(chatPath).then((h) => { if (!off) setMsgs(h); }).catch(() => {}); return () => { off = true; }; }, [chatPath]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs, busy]);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setBusy(true); setError(null); setText("");
    try {
      const r = await api<R>(path, { method: "POST", body: { message, current } });
      setMsgs((m) => [...m, { role: "user", content: message }, { role: "assistant", content: r.reply }]);
      onResult(r);
    } catch (e) { setError((e as Error).message); setText(message); }
    setBusy(false);
  }

  return (
    <div className="chat">
      <div className="chat-h"><b>✦ Ask the AI for changes</b><small>{hint}</small></div>
      <div className="chat-log" aria-live="polite">
        {msgs.length === 0 && <div className="chat-ex">{examples.map((x) => <button key={x} className="chat-chip" onClick={() => void send(x)} disabled={busy}>{x}</button>)}</div>}
        {msgs.map((m, i) => <div key={i} className={`chat-m ${m.role}`}>{m.content}</div>)}
        {busy && <div className="chat-m assistant pd-muted">Working on it…</div>}
        <div ref={end} />
      </div>
      {error && <div className="note bad" role="alert">⚠ {error}</div>}
      <form className="chat-in" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <input className="field" value={text} maxLength={4000} disabled={busy} placeholder="Tell the AI what to change…" onChange={(e) => setText(e.target.value)} aria-label="Message to the AI" />
        <button className="btn primary" type="submit" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}
