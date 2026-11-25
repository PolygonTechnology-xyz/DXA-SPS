"use client";

/** Reviewing a report draft (Figma RP-04) and changing it with DXA (RP-05). */

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChatPanel } from "@/components/ChatPanel";
import { FormatPicker } from "@/components/FormatPanel";
import { useStore } from "@/components/Store";
import { Empty, ErrorNote, Section, Tag, longDate, shortDate } from "@/components/ui";
import { api, reportUrl } from "@/lib/api";
import type { ReportMeta } from "@/lib/mock";

/** Gives each heading in the preview an id, and lists them for the section menu. */
function outline(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const sections = [...doc.querySelectorAll("h1, h2")].map((h, i) => { h.id = `s-${i}`; return { id: h.id, title: h.textContent?.trim() ?? "" }; }).filter((s) => s.title);
  return { html: doc.documentElement.outerHTML, sections };
}

export function ReportReview() {
  const { id, reportId } = useParams<{ id: string; reportId: string }>();
  const router = useRouter();
  const { reports, refreshReports, ready } = useStore();
  const report = reports.find((r) => r.id === reportId && r.projectId === id);
  const [version, setVersion] = useState(0); // bumped when the document changes
  const [doc, setDoc] = useState<ReturnType<typeof outline> | null>(null);
  const [chat, setChat] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looked, setLooked] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => { void refreshReports().finally(() => setLooked(true)); }, [refreshReports]);

  const canPreview = report?.canExport;
  const format = report?.formatId;
  useEffect(() => {
    if (!canPreview) return;
    let off = false;
    api<{ html: string }>(`/reports/${reportId}/preview`).then((r) => { if (!off) setDoc(outline(r.html)); }).catch((e) => { if (!off) setError((e as Error).message); });
    return () => { off = true; };
  }, [reportId, canPreview, format, version]);

  const back = { label: "Reports", href: `/projects/${id}/reports` };
  if (!report) {
    const loading = !ready || !looked;
    return <Section crumbs={[back, { label: loading ? "Loading…" : "Not found" }]}>{!loading && <Empty title="Report not found" />}</Section>;
  }
  const draft = report.status === "draft";
  const title = `${report.periodLabel} progress report`;

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }
  const approve = () => run("approve", async () => { await api(`/reports/${reportId}/approve`, { method: "POST" }); await refreshReports(); setChat(false); });
  const reject = () => { if (window.confirm("Reject this draft? It will be deleted.")) void run("reject", async () => { await api(`/reports/${reportId}`, { method: "DELETE" }); await refreshReports(); router.push(back.href); }); };
  const regenerate = () => {
    if (!window.confirm("Prepare this report again from today's data? Changes made to this draft are lost.")) return;
    void run("regenerate", async () => {
      // make the new draft first, so a failure never loses this one
      const next = await api<ReportMeta>(`/projects/${id}/reports`, { method: "POST", body: { periodLabel: report.periodLabel } });
      await api(`/reports/${reportId}`, { method: "DELETE" });
      await refreshReports();
      router.replace(`${back.href}/${next.id}`);
    });
  };

  return (
    <div className="review-wrap">
      <div className="review-main">
        <Section
          crumbs={[back, { label: title }]}
          actions={draft ? (<>
            {!chat && <button type="button" className="ds-btn sm" onClick={() => setChat(true)}>Change with DXA</button>}
            <button type="button" className="link-text" disabled={!!busy} onClick={regenerate}>{busy === "regenerate" ? "Preparing…" : "Regenerate"}</button>
            <button type="button" className="ds-btn sm" disabled={!!busy} onClick={reject}>Reject</button>
            <button type="button" className="ds-btn sm primary" disabled={!!busy} onClick={() => void approve()}>{busy === "approve" ? "Saving…" : "Approve report"}</button>
          </>) : (<>
            {report.canExport && <a className="ds-btn sm" href={`/api/reports/${report.id}/docx`}>Export Word</a>}
            <a className="ds-btn sm primary" href={reportUrl(report.id)}>Export PDF</a>
          </>)}
          menu={doc?.sections.length ? [{ title: "Sections", items: doc.sections.map((s) => ({ id: s.id, label: s.title })) }] : undefined}
          onSelect={(sid) => frame.current?.contentDocument?.getElementById(sid)?.scrollIntoView({ behavior: "smooth" })}
        >
          <div className="page-head">
            <div><h1>{title}</h1><p>Created {longDate(report.createdAt)}</p></div>
            <div className="toolbar-row">
              {draft ? <Tag tone="ai">Draft</Tag> : <Tag tone="ok">Approved{report.approvedAt ? ` ${shortDate(report.approvedAt)}` : ""}</Tag>}
              <span className="filter-chip on">English</span>
              <button type="button" className="filter-chip" disabled title="Bangla reports are not available yet">Bangla</button>
              {report.canExport && <span className="pd"><FormatPicker projectId={id} kind="report" value={report.formatId ?? null} disabled={!!busy} onPick={(f) => void run("format", async () => { await api(`/reports/${reportId}/format`, { method: "PUT", body: { formatId: f } }); await refreshReports(); })} /></span>}
              {draft && <a className="link-text" href={reportUrl(report.id)}>Download PDF draft</a>}
              {draft && report.canExport && <a className="link-text" href={`/api/reports/${report.id}/docx`}>Download Word draft</a>}
            </div>
          </div>
          <ErrorNote error={error} />
          {!report.canExport
            ? <iframe className="report-frame" title={title} src={`${reportUrl(report.id)}?inline=1&v=${version}`} />
            // allow-same-origin only lets this page scroll to a section; scripts in the document stay blocked
            : doc ? <iframe ref={frame} className="report-frame" title={title} sandbox="allow-same-origin" srcDoc={doc.html} />
            : !error && <p className="sub-text">Preparing preview…</p>}
        </Section>
      </div>
      {chat && draft && (
        <aside className="review-side" aria-label="Change this draft">
          <div className="review-side-head"><b>Change this draft</b><button type="button" className="link-text" onClick={() => setChat(false)}>Close</button></div>
          <div className="pd" style={{ flex: 1, minHeight: 0 }}>
            <ChatPanel<{ reply: string }> path={`/reports/${report.id}/revise`} onResult={() => { setVersion((v) => v + 1); void refreshReports(); }}
              hint="Ask for changes to wording or design. Figures come from live data, so they stay as they are."
              examples={["Shorten the summary", "Use dark blue headings", "Make it more formal"]} />
          </div>
        </aside>
      )}
    </div>
  );
}
