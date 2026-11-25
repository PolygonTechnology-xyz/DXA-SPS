"use client";

/** A project's resources (Figma RS-01): its documents and approved records, in one searchable list. */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useStore } from "@/components/Store";
import { Empty, ErrorNote, PageHead, SOON, Search, Section, Tag, fileSize, longDate, plural, shortDate } from "@/components/ui";
import { api, reportUrl, uploadFile } from "@/lib/api";
import type { Decision, Meeting, Project } from "@/lib/mock";

interface Doc { id: string; name: string; size: number; chars: number; uploadedAt: string }
type Kind = "document" | "report" | "minutes" | "decision";
interface Item { key: string; kind: Kind; title: string; sub: string; source: string; updated: string; facts: string; summary: string; href?: string; docId?: string }

const KINDS: { id: Kind; label: string; icon: string }[] = [
  { id: "document", label: "Documents", icon: "files" }, { id: "report", label: "Progress reports", icon: "reports" },
  { id: "minutes", label: "Minutes", icon: "meetings" }, { id: "decision", label: "Decisions", icon: "flag" },
];

export function ResourcesView() {
  const { id } = useParams<{ id: string }>();
  const { reports, refreshReports, replaceProject } = useStore();
  const [data, setData] = useState<{ docs: Doc[]; meetings: Meeting[]; decisions: Decision[] } | null>(null);
  const [kind, setKind] = useState<Kind | "all">("all");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => Promise.all([api<Doc[]>(`/projects/${id}/documents`), api<Meeting[]>(`/projects/${id}/meetings`), api<Decision[]>(`/projects/${id}/decisions?limit=500`)])
    .then(([docs, meetings, decisions]) => setData({ docs, meetings, decisions }))
    .catch((e) => { setData((v) => v ?? { docs: [], meetings: [], decisions: [] }); setError((e as Error).message); }), [id]);
  useEffect(() => { void load(); void refreshReports(); }, [load, refreshReports]);

  const items: Item[] = [
    ...(data?.docs ?? []).map((d): Item => ({ key: d.id, kind: "document", title: d.name, sub: fileSize(d.size), source: "Upload", updated: d.uploadedAt, facts: `${d.chars.toLocaleString("en-GB")} characters read`, summary: "DXA reads this document for risks, answers and reports.", docId: d.id })),
    ...reports.filter((r) => r.projectId === id && r.status === "final").map((r): Item => ({ key: r.id, kind: "report", title: `Progress report, ${r.periodLabel}`, sub: "Final", source: "DXA", updated: r.approvedAt ?? r.createdAt, facts: "Approved report", summary: `Covers ${r.periodLabel}.`, href: `/projects/${id}/reports/${r.id}` })),
    ...(data?.meetings ?? []).filter((m) => m.approvedAt && m.minutes).map((m): Item => ({ key: m.id, kind: "minutes", title: `Minutes: ${m.title}`, sub: shortDate(m.heldOn), source: "DXA", updated: m.approvedAt!, facts: `${plural(m.minutes!.decisions.length, "decision")} · ${plural(m.minutes!.actions.length, "action")}`, summary: m.minutes!.summary, href: `/projects/${id}/meetings/${m.id}` })),
    ...(data?.decisions ?? []).filter((d) => d.status === "Approved").map((d): Item => ({ key: `d-${d.number}`, kind: "decision", title: d.text, sub: `D-${d.number}`, source: "DXA", updated: d.heldOn, facts: `Made in ${d.meetingTitle}`, summary: d.text, href: `/projects/${id}/meetings/${d.meetingId}` })),
  ].sort((a, b) => b.updated.localeCompare(a.updated));

  const shown = items.filter((i) => (kind === "all" || i.kind === kind) && `${i.title} ${i.sub} ${i.summary}`.toLowerCase().includes(q.trim().toLowerCase()));
  const current = shown.find((i) => i.key === picked) ?? shown[0];

  async function refreshProject() {
    const p = await api<Project>(`/projects/${id}`);
    replaceProject(p);
  }
  async function upload(files: File[]) {
    setBusy(true); setError(null);
    const problems: string[] = [];
    for (const f of files) { try { await uploadFile(`/projects/${id}/documents`, f); } catch (e) { problems.push(`${f.name}: ${(e as Error).message}`); } }
    await load();
    await refreshProject().catch(() => {});
    if (problems.length) setError(problems.join(" "));
    setBusy(false);
  }
  async function remove(item: Item) {
    if (!item.docId || !window.confirm(`Remove "${item.title}"? DXA will stop using it.`)) return;
    try { await api(`/documents/${item.docId}`, { method: "DELETE" }); await load(); await refreshProject(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <Section
      crumbs={[{ label: "Resources" }, { label: KINDS.find((k) => k.id === kind)?.label ?? "All resources" }]}
      active={kind}
      onSelect={(v) => setKind(v as Kind | "all")}
      menu={[
        { items: [{ id: "all", label: "All resources", icon: "resources", count: items.length }] },
        { title: "By kind", items: KINDS.map((k) => ({ ...k, count: items.filter((i) => i.kind === k.id).length })) },
      ]}
      actions={<>
        <button type="button" className="ds-btn sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Reading…" : "Upload"}</button>
        <button type="button" className="ds-btn sm" disabled title="Use the Assistant on Overview for now">Ask about these</button>
      </>}
    >
      <input ref={input} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.csv" onChange={(e) => { if (e.target.files?.length) void upload(Array.from(e.target.files)); e.target.value = ""; }} />
      <PageHead title="Resources" lead="Approved records and project documents." />
      <Search full value={q} onChange={setQ} placeholder="Search documents, minutes, reports and decisions" />
      <ErrorNote error={error} />
      {data === null ? <p className="sub-text">Loading…</p> : (
        <div className="res-split">
          <section className="panel">
            {shown.length === 0 ? <Empty title={items.length ? "Nothing matches" : "No resources yet"} text={items.length ? undefined : "Upload a document, or approve minutes or a report."} /> : (
              <div className="table-x"><table className="tbl">
                <thead><tr><th>Document</th><th>Source</th><th>Updated</th></tr></thead>
                <tbody>{shown.map((i) => (
                  <tr key={i.key} className={`clickable${current?.key === i.key ? " on" : ""}`} onClick={() => setPicked(i.key)}>
                    <td><button type="button" className="cell-title" aria-pressed={current?.key === i.key}>{i.title}</button><span className="cell-sub">{KINDS.find((k) => k.id === i.kind)!.label} · {i.sub}</span></td>
                    <td><Tag>{i.source}</Tag></td><td>{shortDate(i.updated)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <div className="panel-foot">Showing {shown.length} of {plural(items.length, "resource")}</div>
          </section>
          {current && (
            <aside className="panel pad" aria-label="Details">
              <h2>{current.title}</h2>
              <span className="sub-text">{current.source} · {current.facts} · {longDate(current.updated)}</span>
              <div className="well">{current.summary}</div>
              <div className="toolbar-row">
                {current.href && <Link className="ds-btn sm" href={current.href}>Open</Link>}
                {current.kind === "report" && <a className="link-text" href={reportUrl(current.key)}>Download PDF</a>}
                {current.docId && <button type="button" className="link-text" onClick={() => void remove(current)}>Remove</button>}
                <button type="button" className="link-text" disabled title={SOON}>Ask about this</button>
              </div>
            </aside>
          )}
        </div>
      )}
    </Section>
  );
}
