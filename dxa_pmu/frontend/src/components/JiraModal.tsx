"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Project } from "@/lib/mock";
import { useStore } from "./Store";

const empty = { siteUrl: "", email: "", apiToken: "", projectKey: "" };

export function JiraModal() {
  const { projects, jiraFor, closeJira } = useStore();
  const project = projects.find((p) => p.id === jiraFor);
  if (!project) return null;
  return <Form key={project.id} projectId={project.id} onClose={closeJira} />;
}

function Form({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { projects, replaceProject, setNudge } = useStore();
  const project = projects.find((p) => p.id === projectId)!;
  const [editing, setEditing] = useState(!project.jira);
  const [f, setF] = useState({ ...empty, siteUrl: project.jira?.site ?? "", projectKey: project.jira?.key ?? "" });
  const [state, setState] = useState<{ kind: "idle" | "testing" | "error" | "ok"; msg?: string }>({ kind: "idle" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  /** Connect with new details, or (no body) re-import with the login the server already saved. */
  async function check(newDetails?: typeof f) {
    setState({ kind: "testing" });
    try {
      const next = newDetails
        ? (await api<{ message: string; projectName: string; project: Project }>(`/projects/${projectId}/jira`, { method: "POST", body: newDetails }))
        : { message: "Tasks refreshed.", projectName: project.jira?.name ?? "", project: await api<Project>(`/projects/${projectId}/jira/refresh`, { method: "POST" }) };
      setState({ kind: "ok", msg: `${next.message} Project: ${next.projectName}.` });
      setTimeout(() => {
        replaceProject(next.project);
        setNudge(projectId);
        onClose();
      }, 900);
    } catch (e) {
      setState({ kind: "error", msg: (e as Error).message });
    }
  }

  async function disconnect() {
    try {
      replaceProject(await api<Project>(`/projects/${projectId}/jira`, { method: "DELETE" }));
      onClose();
    } catch (e) {
      setState({ kind: "error", msg: (e as Error).message });
    }
  }

  const busy = state.kind === "testing" || state.kind === "ok";

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        onSubmit={(e) => { e.preventDefault(); void check(f); }}
        role="dialog" aria-modal="true" aria-label="Jira settings"
      >
        <h3>Jira settings</h3>

        {project.jira && (
          <div className="note ok">✓ Connected to <strong>{project.jira.key} ({project.jira.name})</strong> at {project.jira.site.replace("https://", "")}.<br />Your login is saved, so you do not need to enter it again.</div>
        )}

        {!project.jira && (
          <div className="need">
            <strong>What you need to connect</strong>
            <ol>
              <li>Your Jira address, like <code>https://your-company.atlassian.net</code></li>
              <li>The email you log in to Jira with</li>
              <li>An API token. Create one in your Atlassian account under Security → API tokens</li>
              <li>The project key: the short code before your task numbers (in <code>KAN-12</code> it is <code>KAN</code>)</li>
            </ol>
          </div>
        )}

        {editing && (
          <>
            <label htmlFor="j-site">Jira address</label>
            <input id="j-site" className="field" required placeholder="https://your-company.atlassian.net" value={f.siteUrl} onChange={set("siteUrl")} />

            <label htmlFor="j-email">Your Jira email</label>
            <input id="j-email" type="email" className="field" required autoComplete="off" value={f.email} onChange={set("email")} />

            <label htmlFor="j-token">API token</label>
            <input id="j-token" type="password" className="field" required autoComplete="off" value={f.apiToken} onChange={set("apiToken")} />
            <small className="muted">Stored encrypted on the server so you only enter it once.</small>

            <label htmlFor="j-key">Jira project key</label>
            <input id="j-key" className="field" required placeholder="KAN" value={f.projectKey} onChange={set("projectKey")} />
          </>
        )}

        {state.kind === "error" && <div className="note bad" role="alert">⚠ {state.msg}</div>}
        {state.kind === "ok" && <div className="note ok" role="status">✓ {state.msg}</div>}

        <div className="row end wrap-row">
          {project.jira && <button type="button" className="btn" onClick={() => void disconnect()}>Disconnect</button>}
          {project.jira && !editing && <button type="button" className="btn" onClick={() => setEditing(true)}>Change details</button>}
          <button type="button" className="btn" onClick={onClose}>Close</button>
          {editing ? (
            <button type="submit" className="btn primary" disabled={busy}>{state.kind === "testing" ? "Checking…" : "Test & connect"}</button>
          ) : (
            <button type="button" className="btn primary" disabled={busy} onClick={() => void check()}>{state.kind === "testing" ? "Checking…" : "Refresh tasks"}</button>
          )}
        </div>
      </form>
    </div>
  );
}
