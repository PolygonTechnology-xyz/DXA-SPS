"use client";

import { useEffect, useState } from "react";
import type { SummaryApproved, SummaryDraft } from "@/lib/mock";
import { api } from "@/lib/api";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** The AI project summary. Claude writes a draft; it becomes a record (and appears in reports) only after a person approves it. */
export function SummaryCard({ projectId }: { projectId: string }) {
  const [approved, setApproved] = useState<SummaryApproved | null>(null);
  const [draft, setDraft] = useState<SummaryDraft | null>(null);
  const [text, setText] = useState("");
  const [skipF, setSkipF] = useState<Set<number>>(new Set());
  const [skipR, setSkipR] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<SummaryApproved | null>(`/projects/${projectId}/summary`).then((a) => { if (!cancelled) setApproved(a); }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const d = await api<SummaryDraft>(`/projects/${projectId}/analysis`, { method: "POST" });
      setDraft(d); setText(d.summary); setSkipF(new Set()); setSkipR(new Set());
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  async function approve() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      setApproved(await api<SummaryApproved>(`/projects/${projectId}/summary/approve`, {
        method: "POST",
        body: {
          summary: text.trim(), riskLevel: draft.riskLevel,
          findings: draft.findings.filter((_, i) => !skipF.has(i)),
          recommendations: draft.recommendations.filter((_, i) => !skipR.has(i)),
        },
      }));
      setDraft(null);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  const flip = (set: Set<number>, i: number) => { const n = new Set(set); if (n.has(i)) n.delete(i); else n.add(i); return n; };

  return (
    <article className="card full">
      <div className="card-head">
        <h3>Project summary</h3>
        <span className="muted small">{draft ? "Draft · not approved" : approved ? `✔ Approved ${when(approved.approvedAt)}` : "AI summary"}</span>
      </div>
      {error && <div className="note bad pad" role="alert">⚠ {error}</div>}

      {draft ? (
        <div className="pad">
          <div className="note info">AI draft. Edit the text, untick anything you do not agree with, then approve. Reports only include what you approve.</div>
          <label htmlFor="sum-text" className="small">Summary</label>
          <textarea id="sum-text" className="field" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          {draft.findings.length > 0 && <><div className="small muted review-h">Findings</div>
            <ul className="review">{draft.findings.map((f, i) => (
              <li key={i}><label><input type="checkbox" checked={!skipF.has(i)} onChange={() => setSkipF(flip(skipF, i))} /> {f}</label></li>
            ))}</ul></>}
          {draft.recommendations.length > 0 && <><div className="small muted review-h">Recommendations</div>
            <ul className="review">{draft.recommendations.map((f, i) => (
              <li key={i}><label><input type="checkbox" checked={!skipR.has(i)} onChange={() => setSkipR(flip(skipR, i))} /> {f}</label></li>
            ))}</ul></>}
          <div className="row end">
            <button className="btn" disabled={busy} onClick={() => setDraft(null)}>Discard</button>
            <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void approve()}>{busy ? "Saving…" : "Approve"}</button>
          </div>
        </div>
      ) : approved ? (
        <div className="pad">
          <p>{approved.summary}</p>
          {approved.findings.length > 0 && <ul className="review">{approved.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>}
          {approved.recommendations.length > 0 && <ol className="review">{approved.recommendations.map((f, i) => <li key={i}>{f}</li>)}</ol>}
          <div className="row end">
            <button className="btn" disabled={busy} onClick={() => void generate()}>{busy ? "Analysing…" : "↻ New draft"}</button>
          </div>
        </div>
      ) : (
        <div className="pad">
          <p className="muted">No approved summary yet. Reports use rule-based findings until you approve an AI summary.</p>
          <button className="btn" disabled={busy} onClick={() => void generate()}>{busy ? "Analysing…" : "Generate AI summary"}</button>
        </div>
      )}
    </article>
  );
}
