"use client";

/** Reports (Figma RP-01), with the formats (RP-02) and automatic reports (RP-03) pop-ups. */

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FigmaIcon } from "@/components/FigmaIcon";
import { useFormats } from "@/components/FormatPanel";
import { FormatsModal } from "@/components/FormatsModal";
import { useStore } from "@/components/Store";
import { Empty, ErrorNote, PageHead, SOON, Search, Section, Tag, longDate, shortDate } from "@/components/ui";
import { api, reportUrl } from "@/lib/api";
import { frequencyName, nextRunText } from "@/lib/schedule";
import type { ReportMeta } from "@/lib/mock";

type View = "all" | "draft" | "final";

const TEMPLATES = [
  { id: "progress", name: "Progress report", text: "Where the project stands today: health, phases, decisions and risks.", icon: "reports", ready: true },
  { id: "quarterly", name: "Quarterly progress report", text: "A quarter against the plan.", icon: "overview" },
  { id: "risk", name: "Risk report", text: "Current and new risks, overdue items.", icon: "risks" },
  { id: "exec", name: "Executive summary", text: "One page on status and what needs attention.", icon: "file" },
  { id: "research", name: "Research paper", text: "Drafted only from approved sources.", icon: "resources" },
  { id: "briefing", name: "Briefing for senior officials", text: "A short, cited summary of policy documents.", icon: "files" },
];

function List() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { projects, reports, refreshReports, openReportSettings } = useStore();
  const project = projects.find((p) => p.id === id);
  const mine = reports.filter((r) => r.projectId === id);
  const { rows: formats, load: loadFormats } = useFormats(id, "report");
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void refreshReports(); }, [refreshReports]);

  async function prepare() {
    setBusy(true); setError(null);
    try {
      const r = await api<ReportMeta>(`/projects/${id}/reports`, { method: "POST", body: {} });
      await refreshReports();
      setBusy(false);
      router.push(`/projects/${id}/reports/${r.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  const shown = mine.filter((r) => (view === "all" || r.status === view) && r.periodLabel.toLowerCase().includes(q.trim().toLowerCase()));
  const schedule = project?.reportSchedule;
  const drafts = mine.filter((r) => r.status === "draft").length;

  return (
    <Section
      crumbs={[{ label: "Reports" }, { label: view === "draft" ? "Needs approval" : view === "final" ? "Approved" : "All reports" }]}
      active={view}
      onSelect={(v) => (v === "formats" ? setModal(true) : v === "auto" ? openReportSettings(id) : setView(v as View))}
      menu={[
        { items: [{ id: "all", label: "All reports", icon: "reports", count: mine.length }] },
        { title: "Status", items: [{ id: "draft", label: "Needs approval", icon: "clock", count: drafts }, { id: "final", label: "Approved", icon: "check", count: mine.length - drafts }] },
        { title: "Setup", items: [{ id: "formats", label: "Report formats", icon: "file", count: formats?.length }, { id: "auto", label: "Automatic reports", icon: "calendar" }] },
      ]}
      actions={<button type="button" className="ds-btn sm primary" disabled={busy} onClick={() => void prepare()}>{busy ? "Preparing draft…" : "Prepare report"}</button>}
    >
      <PageHead title="Reports" lead="Drafts are built from current project data. You review and approve them." />
      <ErrorNote error={error} />
      <div className="two-cards">
        <div className="setting-card">
          <span className="tmpl-ic"><FigmaIcon name="file" size={20} /></span>
          <div><strong>Report format</strong><span>{formats?.find((f) => f.isDefault)?.name ?? "Built-in format"} · default</span></div>
          <button type="button" className="ds-btn sm" onClick={() => setModal(true)}>Manage formats</button>
        </div>
        <div className="setting-card">
          <span className="tmpl-ic"><FigmaIcon name="calendar" size={20} /></span>
          <div><strong>Automatic reports</strong><span>{frequencyName(schedule)}{schedule?.enabled ? ` · ${nextRunText(schedule)}` : ""}</span></div>
          <button type="button" className="link-text" onClick={() => openReportSettings(id)}>Change</button>
        </div>
      </div>
      <h2 style={{ fontSize: 16, margin: 0 }}>Start from a template</h2>
      <div className="tmpl-grid">
        {TEMPLATES.map((t) => (
          <button type="button" key={t.id} className="tmpl" disabled={!t.ready || busy} title={t.ready ? "Prepare this report" : SOON} onClick={() => void prepare()}>
            <span className="tmpl-ic"><FigmaIcon name={t.icon} size={20} /></span><strong>{t.name}</strong><span>{t.text}</span>{!t.ready && <Tag>{SOON}</Tag>}
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="panel-head"><h2>Library</h2><Search value={q} onChange={setQ} placeholder="Search by period" /></div>
        {shown.length === 0 ? <Empty title={mine.length ? "No reports here" : "No reports yet"} text={mine.length ? undefined : "Choose Prepare report, or set up automatic reports."} /> : (
          <div className="table-x"><table className="tbl">
            <thead><tr><th>Report</th><th>Period</th><th>Status</th><th>Created</th><th>Export</th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}>
                <td><Link className="cell-title" href={`/projects/${id}/reports/${r.id}`}>Progress report</Link><span className="cell-sub">{r.trigger === "scheduled" ? "Automatic" : "Prepared by hand"}</span></td>
                <td>{r.periodLabel}</td>
                <td>{r.status === "draft" ? <Tag tone="ai">Draft to review</Tag> : <Tag tone="ok">Approved{r.approvedAt ? ` ${shortDate(r.approvedAt)}` : ""}</Tag>}</td>
                <td>{longDate(r.createdAt)}</td>
                <td>{r.status === "draft" ? <span className="sub-text">After approval</span> : <>{r.canExport && <><a className="link-text" href={`/api/reports/${r.id}/docx`}>Word</a> · </>}<a className="link-text" href={reportUrl(r.id)}>PDF</a></>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {modal && <FormatsModal projectId={id} initial="report" onClose={() => { setModal(false); void loadFormats(); }} />}
    </Section>
  );
}

export function ReportsList() {
  return (
    <Suspense fallback={<div className="section-body">Loading…</div>}>
      <List />
    </Suspense>
  );
}
