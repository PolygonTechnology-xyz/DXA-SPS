"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { mockKnowledge, type KnowledgeDoc, type Project, type ReportMeta } from "@/lib/mock";

interface Store {
  projects: Project[];
  knowledge: KnowledgeDoc[];
  addProject: (p: { name: string; goal: string }) => Promise<Project>;
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
  addDocs: (files: { name: string; size: number }[]) => void;
  updateDoc: (id: string, patch: Partial<Pick<KnowledgeDoc, "category" | "tags">>) => void;
  removeDoc: (id: string) => void;
}

/** The fields the backend accepts on PATCH /projects/{id}. */
export type SavedFields = Partial<Pick<Project, "name" | "goal" | "status" | "files" | "reportSchedule">>;

const Ctx = createContext<Store | null>(null);

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}

function fmtSize(bytes: number) {
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1e3)) + " KB";
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [knowledge, setKnowledge] = useState(mockKnowledge);
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

  const addDocs = useCallback<Store["addDocs"]>((files) => {
    const today = new Date().toISOString().slice(0, 10);
    setKnowledge((prev) => [
      ...files.map((f, i) => ({
        id: `k-${Date.now()}-${i}`,
        name: f.name,
        size: fmtSize(f.size),
        category: "Other",
        tags: [],
        uploadedAt: today,
      })),
      ...prev,
    ]);
  }, []);

  const updateDoc = useCallback<Store["updateDoc"]>((id, patch) => {
    setKnowledge((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  const removeDoc = useCallback((id: string) => {
    setKnowledge((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const value = useMemo(
    () => ({ projects, knowledge, ready, loadError, reports, refreshReports, reportSettingsFor, openReportSettings, closeReportSettings, jiraFor, openJira, closeJira, nudge, setNudge, addProject, replaceProject, updateProject, patchProject, addDocs, updateDoc, removeDoc }),
    [projects, knowledge, ready, loadError, reports, refreshReports, reportSettingsFor, openReportSettings, closeReportSettings, jiraFor, openJira, closeJira, nudge, setNudge, addProject, replaceProject, updateProject, patchProject, addDocs, updateDoc, removeDoc],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
