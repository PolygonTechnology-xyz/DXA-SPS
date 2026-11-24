"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useStore } from "@/components/Store";
import { FormatPanel, FormatPicker } from "@/components/FormatPanel";
import { PreviewModal } from "@/components/PreviewModal";
import { ChatPanel } from "@/components/ChatPanel";
import { api, reportUrl } from "@/lib/api";
import { frequencyName, nextRunText } from "@/lib/schedule";

function List() {
  const { id } = useParams<{ id: string }>();
  const { projects, reports, refreshReports, openReportSettings } = useStore();
  const project = projects.find((p) => p.id === id);
  const mine = reports.filter((r) => r.projectId === id);

  useEffect(() => { void refreshReports(); }, [refreshReports]);

  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<{ id: string; label: string; pdf?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<{ id: string; label: string; v: number } | null>(null); // the draft being discussed with the AI
  async function act(rid: string, kind: "approve" | "discard") {
    if (kind === "discard" && !window.confirm("Discard this draft?")) return;
    setBusy(rid); setError(null);
    try {
      await api(kind === "approve" ? `/reports/${rid}/approve` : `/reports/${rid}`, { method: kind === "approve" ? "POST" : "DELETE" });
      await refreshReports();
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }
  const drafts = mine.filter((r) => r.status === "draft").length;

  return (
    <>
      <header className="topbar">
        <Link href={`/projects/${id}`} className="muted">{project?.name ?? "Project"}</Link>
        <span className="muted">/</span>
        <h2>Reports</h2>
      </header>
      <div className="page">
        <div className="page-inner wide">
          <div className="row between wrap-row">
            <div>
              <h1 className="k-title">Reports</h1>
              <p className="k-sub">
                Schedule: <strong>{frequencyName(project?.reportSchedule)}</strong>
                {project?.reportSchedule?.enabled ? ` · ${nextRunText(project.reportSchedule)}` : ""}
              </p>
            </div>
            <button className="btn" onClick={() => openReportSettings(id)}>🗓️ Report settings</button>
          </div>

          <FormatPanel projectId={id} kind="report" />
          {error && <div className="note bad" role="alert">⚠ {error}</div>}
          {drafts > 0 && <div className="note info">{drafts} draft{drafts === 1 ? "" : "s"} waiting. Review the PDF, then approve it to make it the final version.</div>}
          {mine.length === 0 ? (
            <p className="empty">No reports yet. Set a schedule in Report settings, or use Download report on the dashboard.</p>
          ) : (
            <div className="card table-card">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Period</th><th>Created</th><th>Type</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {mine.map((r) => (
                      <tr key={r.id}>
                        <td><strong>{r.periodLabel}</strong></td>
                        <td>{new Date(r.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                        <td><span className={`badge ${r.trigger === "scheduled" ? "badge-info" : "badge-ok"}`}>{r.trigger === "scheduled" ? "Scheduled" : "Manual"}</span></td>
                        <td>{r.status === "draft" ? <span className="badge badge-warn">Draft · needs approval</span> : <span className="badge badge-ok">✔ Approved{r.approvedAt ? ` ${new Date(r.approvedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : ""}</span>}</td>
                        <td className="right">
                          {r.canExport && <><FormatPicker projectId={id} kind="report" value={r.formatId ?? null} disabled={busy === r.id} onPick={(f) => { setBusy(r.id); void api(`/reports/${r.id}/format`, { method: "PUT", body: { formatId: f } }).then(() => refreshReports()).catch((e) => setError((e as Error).message)).finally(() => setBusy(null)); }} />{" "}</>}
                          {r.canExport
                            ? <><button className="btn" onClick={() => setView({ id: r.id, label: r.periodLabel })}>👁 Preview</button>{" "}<a className="btn" href={`/api/reports/${r.id}/docx`}>⬇ Word</a>{" "}</>
                            : <><button className="btn" title="Shows the saved PDF. This report was made before Word export existed." onClick={() => setView({ id: r.id, label: r.periodLabel, pdf: true })}>👁 Preview</button>{" "}<button className="btn" disabled title="Word is available for reports made from now on.">⬇ Word</button>{" "}</>}
                          <a className="btn" href={reportUrl(r.id)}>⬇ PDF{r.status === "draft" ? " draft" : ""}</a>
                          {r.status === "draft" && <>{" "}<button className="btn" onClick={() => setChat({ id: r.id, label: r.periodLabel, v: 0 })}>✦ Ask AI to change</button>{" "}<button className="btn" disabled={busy === r.id} onClick={() => void act(r.id, "discard")}>Discard</button>{" "}<button className="btn primary" disabled={busy === r.id} onClick={() => void act(r.id, "approve")}>{busy === r.id ? "Saving…" : "Approve"}</button></>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {chat && (
            <div className="rv-scrim" onClick={() => { setChat(null); void refreshReports(); }}>
              <div className="rv" role="dialog" aria-label={`Change report: ${chat.label}`} onClick={(e) => e.stopPropagation()}>
                <div className="rv-head"><b>Report · {chat.label} (draft)</b>
                  <span className="pd-actions"><button className="pd-btn" onClick={() => { setChat(null); void refreshReports(); }}>Done</button></span></div>
                <ChatPanel<{ reply: string }> path={`/reports/${chat.id}/revise`} onResult={() => setChat((c) => c && { ...c, v: c.v + 1 })}
                  hint="Change the text or the design (colours, font, sizes). Figures come from live data."
                  examples={["Make it more colourful and professional", "Use dark blue headings and a serif font", "Make the summary shorter"]} />
                <iframe key={chat.v} className="rv-frame" title="Draft report" src={`/api/reports/${chat.id}/download?inline=1&v=${chat.v}`} />
              </div>
            </div>
          )}
          {view && <PreviewModal title={`Report · ${view.label}`} previewPath={`/reports/${view.id}/preview`} pdfSrc={view.pdf ? `/api/reports/${view.id}/download?inline=1` : undefined} docxHref={`/api/reports/${view.id}/docx`} onClose={() => setView(null)} />}
        </div>
      </div>
    </>
  );
}

export function ReportsList() {
  return (
    <Suspense fallback={<div className="page"><div className="page-inner muted">Loading…</div></div>}>
      <List />
    </Suspense>
  );
}
