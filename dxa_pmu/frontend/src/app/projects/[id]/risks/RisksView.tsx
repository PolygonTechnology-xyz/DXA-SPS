"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useStore } from "@/components/Store";
import { RiskRegister } from "@/components/RiskRegister";
import { api } from "@/lib/api";
import type { RisksData } from "@/lib/mock";

/** The risk register. The AI keeps it up to date from meetings and Jira; people only remove what is not a risk. */
export function RisksView() {
  const { id } = useParams<{ id: string }>();
  const { projects } = useStore();
  const project = projects.find((p) => p.id === id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Asks the AI to look at the latest Jira data and meetings; new risks land in the register by themselves.
  const refresh = useCallback(async () => {
    setBusy(true); setError(null);
    try { await api<RisksData>(`/projects/${id}/risks`, { method: "POST" }); setReload((n) => n + 1); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  }, [id]);

  // Opening the page checks that the AI's view is current, and refreshes it when Jira or the meetings changed.
  useEffect(() => {
    if (!project?.jira) return;
    let off = false;
    (async () => {
      try {
        const cur = await api<RisksData>(`/projects/${id}/risks`);
        if (off || cur.status === "ready") return;
        setBusy(true);
        await api<RisksData>(`/projects/${id}/risks`, { method: "POST" });
        if (!off) setReload((n) => n + 1);
      } catch (e) { if (!off) setError((e as Error).message); }
      if (!off) setBusy(false);
    })();
    return () => { off = true; };
  }, [id, !!project?.jira, project?.syncedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <header className="topbar">
        <Link href={`/projects/${id}`} className="muted">{project?.name ?? "Project"}</Link><span className="muted">/</span><h2>Risks</h2>
      </header>
      <div className="page"><div className="page-inner wide pd">
        <div className="pd-top">
          <div><h1 className="pd-title">Risks</h1><p className="pd-sub">The AI finds risks in your meetings and Jira and keeps this register up to date. Remove any you do not consider a risk.</p></div>
          <div className="pd-actions">
            <button className="pd-btn dark" disabled={busy || !project?.jira} onClick={() => void refresh()}>{busy ? "AI is analysing…" : "↻ Find new risks with AI"}</button>
          </div>
        </div>
        {error && <div className="note bad" role="alert">⚠ {error}</div>}
        <RiskRegister projectId={id} site={project?.jira?.site} reload={reload} />
      </div></div>
    </>
  );
}
