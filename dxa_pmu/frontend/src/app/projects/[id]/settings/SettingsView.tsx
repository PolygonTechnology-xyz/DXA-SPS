"use client";

/** Project settings (Figma ST-01): connections, formats and project details. */

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FigmaIcon } from "@/components/FigmaIcon";
import { FormatsModal } from "@/components/FormatsModal";
import { useStore } from "@/components/Store";
import { ErrorNote, PageHead, SOON, Section, Tag, plural } from "@/components/ui";
import { api } from "@/lib/api";
import { frequencyName } from "@/lib/schedule";
import { STATUSES, type Project, type ProjectStatus } from "@/lib/mock";

type View = "connections" | "details";

const NOT_CONNECTED = [
  { name: "Outlook", icon: "aichat", text: "Project email, from the folders and addresses you choose." },
  { name: "Fathom", icon: "meetings", text: "Meeting recordings, transcripts and notes." },
  { name: "SharePoint", icon: "folder", text: "Policy, procedure and contract libraries." },
  { name: "Google Sheets", icon: "checklist", text: "Optional. For lists that live in a sheet." },
];

export function SettingsView() {
  const { id } = useParams<{ id: string }>();
  const { projects, openJira, openReportSettings } = useStore();
  const project = projects.find((p) => p.id === id);
  const [view, setView] = useState<View>("connections");
  const [formats, setFormats] = useState(false);

  return (
    <Section
      crumbs={[{ label: "Settings" }, { label: view === "details" ? "Project details" : "Connections" }]}
      active={view}
      onSelect={(v) => (v === "formats" ? setFormats(true) : v === "auto" ? openReportSettings(id) : setView(v as View))}
      menu={[{ items: [
        { id: "connections", label: "Connections", icon: "sync" },
        { id: "scope", label: "Scope and mapping", icon: "settings", disabled: true },
        { id: "people", label: "People", icon: "overview", disabled: true },
        { id: "formats", label: "Formats", icon: "file" },
        { id: "auto", label: `Automatic reports: ${frequencyName(project?.reportSchedule)}`, icon: "calendar" },
        { id: "details", label: "Project details", icon: "folder" },
      ] }]}
    >
      {!project ? <p className="sub-text">Loading…</p> : view === "details" ? <Details key={project.id} project={project} /> : (<>
        <PageHead title="Connections" lead="The tools DXA reads for this project." />
        <div className="conn-grid">
          <article className="conn">
            <div className="conn-head"><span className="tmpl-ic"><FigmaIcon name="checklist" size={20} /></span>
              <div><strong>Jira</strong><span>{project.syncedAt ? `Synced ${new Date(project.syncedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : "Never synced"}</span></div>
              <Tag tone={project.jira ? "ok" : "neutral"}>{project.jira ? "Connected" : "Not connected"}</Tag></div>
            <p>{project.jira ? `Project ${project.jira.key} (${project.jira.name}), ${plural(project.tasks?.length ?? 0, "task")}. DXA only reads from Jira.` : "Link a Jira project to see tasks, progress and the health score."}</p>
            <div className="dlg-actions"><button type="button" className="ds-btn sm primary" onClick={() => openJira(id)}>{project.jira ? "Manage" : "Connect"}</button></div>
          </article>
          <article className="conn">
            <div className="conn-head"><span className="tmpl-ic"><FigmaIcon name="upload-cloud" size={20} /></span>
              <div><strong>Uploads</strong><span>Documents added by hand</span></div><Tag tone={project.files.length ? "ok" : "neutral"}>{plural(project.files.length, "file")}</Tag></div>
            <p>Use Resources to add or remove project documents.</p>
            <div className="dlg-actions"><Link className="ds-btn sm" href={`/projects/${id}/resources`}>Open Resources</Link></div>
          </article>
          {NOT_CONNECTED.map((c) => (
            <article className="conn" key={c.name}>
              <div className="conn-head"><span className="tmpl-ic"><FigmaIcon name={c.icon} size={20} /></span><div><strong>{c.name}</strong></div><Tag>Not connected</Tag></div>
              <p>{c.text}</p>
              <div className="dlg-actions"><button type="button" className="ds-btn sm" disabled title={SOON}>Connect</button></div>
            </article>
          ))}
        </div>
      </>)}
      {formats && <FormatsModal projectId={id} initial="report" onClose={() => setFormats(false)} />}
    </Section>
  );
}

function Details({ project }: { project: Project }) {
  const { patchProject, dropProject } = useStore();
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [goal, setGoal] = useState(project.goal);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [state, setState] = useState<{ busy?: boolean; saved?: boolean; error?: string }>({});
  const changed = name !== project.name || goal !== project.goal || status !== project.status;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try { await patchProject(project.id, { name: name.trim(), goal, status }); setState({ saved: true }); } catch (err) { setState({ error: (err as Error).message }); }
  }
  async function remove() {
    if (!window.confirm(`Delete "${project.name}"? Its meetings, reports, risks and documents are deleted too. This can't be undone.`)) return;
    try {
      await api(`/projects/${project.id}`, { method: "DELETE" });
      router.push("/projects");
      dropProject(project.id);
    } catch (err) { setState({ error: (err as Error).message }); }
  }

  return (<>
    <PageHead title="Project details" lead={project.code} />
    <form className="panel pad" onSubmit={(e) => void save(e)}>
      <label htmlFor="p-name">Name</label><input id="p-name" className="field" required maxLength={200} value={name} onChange={(e) => { setName(e.target.value); setState({}); }} />
      <label htmlFor="p-goal">Goal</label><textarea id="p-goal" className="field" rows={3} maxLength={5000} value={goal} onChange={(e) => { setGoal(e.target.value); setState({}); }} />
      <label htmlFor="p-status">Status</label><select id="p-status" className="field" value={status} onChange={(e) => { setStatus(e.target.value as ProjectStatus); setState({}); }}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
      <ErrorNote error={state.error ?? null} />
      <div className="dlg-actions">{state.saved && <span className="sub-text" role="status">Saved</span>}<button type="submit" className="ds-btn primary" disabled={!changed || !name.trim() || state.busy}>{state.busy ? "Saving…" : "Save"}</button></div>
    </form>
    <div className="panel pad"><h2>Delete project</h2><span className="sub-text">Removes the project with its meetings, reports, risks and documents.</span><div><button type="button" className="ds-btn sm bad-text" onClick={() => void remove()}>Delete project</button></div></div>
  </>);
}
