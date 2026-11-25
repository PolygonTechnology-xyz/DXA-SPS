"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { NewProjectInput, Project, ReportMeta } from "@/lib/mock";

interface Store {
  projects: Project[];
  addProject: (p: NewProjectInput) => Promise<Project>;
  /** True once projects have been loaded from the server. */
  ready: boolean;
  /** Set when the first load failed, e.g. the backend is not running. */
  loadError: string | null;
  reports: ReportMeta[];
  refreshReports: () => Promise<void>;
  reportSettingsFor: string | null;
  openReportSettings: (projectId: string) => void;
  closeReportSettings: () => void;
  jiraFor: string | null;
  openJira: (projectId: string) => void;
  closeJira: () => void;
  /** Project whose Jira tasks were just fetched; the project page opens the assistant for it. */
  nudge: string | null;
  setNudge: (id: string | null) => void;
  /** Replace a project with the server's copy (after a Jira connect, refresh, etc.). */
  replaceProject: (p: Project) => void;
  /** Edit and save; reverts to the server's copy if saving fails. */
  updateProject: (id: string, patch: SavedFields) => void;
  /** Same, but throws the error so the caller can show it. */
  patchProject: (id: string, patch: SavedFields) => Promise<void>;
  /** Forget a project that was deleted on the server. */
  dropProject: (id: string) => void;
}

/** The fields the backend accepts on PATCH /projects/{id}. */
export type SavedFields = Partial<Pick<Project, "name" | "goal" | "status" | "files" | "reportSchedule">>;

const Ctx = createContext<Store | null>(null);

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [reportSettingsFor, setReportSettingsFor] = useState<string | null>(null);
  const openReportSettings = useCallback((id: string) => setReportSettingsFor(id), []);
  const closeReportSettings = useCallback(() => setReportSettingsFor(null), []);

  const refreshReports = useCallback(async () => {
    try { setReports(await api<ReportMeta[]>("/reports")); } catch { /* keep the list we have */ }
  }, []);

  useEffect(() => {
    api<Project[]>("/projects")
      .then((list) => { setProjects(list); void refreshReports(); })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setReady(true));
  }, [refreshReports]);

  const [nudge, setNudge] = useState<string | null>(null);
  const [jiraFor, setJiraFor] = useState<string | null>(null);
  const openJira = useCallback((id: string) => setJiraFor(id), []);
  const closeJira = useCallback(() => setJiraFor(null), []);

  const addProject = useCallback<Store["addProject"]>(async (p) => {
    const project = await api<Project>("/projects", { method: "POST", body: p });
    setProjects((prev) => [project, ...prev]);
    return project;
  }, []);

  const replaceProject = useCallback((p: Project) => {
    setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x)));
  }, []);

  const patchProject = useCallback<Store["patchProject"]>(async (id, patch) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p))); // show it straight away
    try {
      replaceProject(await api<Project>(`/projects/${id}`, { method: "PATCH", body: patch }));
    } catch (e) {
      try { replaceProject(await api<Project>(`/projects/${id}`)); } catch { /* keep what we have */ }
      throw e;
    }
  }, [replaceProject]);

  const updateProject = useCallback<Store["updateProject"]>((id, patch) => {
    patchProject(id, patch).catch(() => {});
  }, [patchProject]);

  const dropProject = useCallback((id: string) => setProjects((prev) => prev.filter((p) => p.id !== id)), []);

  const value = useMemo(
    () => ({ projects, ready, loadError, reports, refreshReports, reportSettingsFor, openReportSettings, closeReportSettings, jiraFor, openJira, closeJira, nudge, setNudge, addProject, replaceProject, updateProject, patchProject, dropProject }),
    [projects, ready, loadError, reports, refreshReports, reportSettingsFor, openReportSettings, closeReportSettings, jiraFor, openJira, closeJira, nudge, setNudge, addProject, replaceProject, updateProject, patchProject, dropProject],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
