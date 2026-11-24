"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { JiraModal } from "./JiraModal";
import { ReportSettingsModal } from "./ReportSettingsModal";
import { frequencyName } from "@/lib/schedule";
import { StoreProvider, useStore } from "./Store";

const P: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  book: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  report: "M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  gear: "M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  cal: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  back: "M15 5l-7 7 7 7",
  panel: "M4 5h16v14H4zM10 5v14",
  mic: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4",
  warn: "M12 4l9 16H3zM12 10v4M12 17v.5",
};
function Icon({ n }: { n: string }) {
  return <svg className="nav-svg" viewBox="0 0 24 24" aria-hidden="true"><path d={P[n]} /></svg>;
}

const NAV = [
  { href: "/projects/new", label: "Create Project", icon: "plus", primary: true },
  { href: "/projects", label: "All Projects", icon: "folder" },
  { href: "/knowledge", label: "Global Knowledges", icon: "book" },
];

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "P";

function isActive(pathname: string, href: string) {
  if (href === "/projects") return pathname === "/projects" || (pathname.startsWith("/projects/") && pathname !== "/projects/new");
  return pathname === href;
}

function NavLinks({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const { id } = useParams<{ id?: string }>();
  const { projects, reports, openJira, openReportSettings } = useStore();
  const project = id ? projects.find((p) => p.id === id) : undefined;
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (project) {
    return (
      <nav className="nav-list slide-in" key={project.id}>
        <Link href="/projects" onClick={onNavigate} className="proj-switch" title="Back to all projects">
          <span className="ps-badge">{initials(project.name)}</span>
          <span className="label ps-name">{project.name}</span>
          <span className="label ps-chev">⌃<br />⌄</span>
        </Link>
        <Link href={`/projects/${project.id}`} onClick={onNavigate} className={`nav-item${pathname === `/projects/${project.id}` ? " active" : ""}`} title="Dashboard">
          <Icon n="grid" /><span className="label">Dashboard</span>
        </Link>
        <Link href={`/projects/${project.id}/meetings`} onClick={onNavigate} className={`nav-item${pathname.endsWith("/meetings") ? " active" : ""}`} title="Meetings">
          <Icon n="mic" /><span className="label">Meetings</span>
        </Link>
        <Link href={`/projects/${project.id}/reports`} onClick={onNavigate} className={`nav-item${pathname.endsWith("/reports") ? " active" : ""}`} title="Reports">
          <Icon n="report" /><span className="label">Reports</span>
          {reports.filter((r) => r.projectId === project.id).length > 0 && <span className="count label">{reports.filter((r) => r.projectId === project.id).length}</span>}
        </Link>
        <Link href={`/projects/${project.id}/risks`} onClick={onNavigate} className={`nav-item${pathname.endsWith("/risks") ? " active" : ""}`} title="Risks">
          <Icon n="warn" /><span className="label">Risks</span>
        </Link>
        {project.files.length > 0 && (
          <Link href={`/projects/${project.id}#files`} onClick={onNavigate} className="nav-item" title="Uploaded documents">
            <Icon n="file" /><span className="label">Sources</span>
            <span className="count label">{project.files.length}</span>
          </Link>
        )}
        <div className="nav-spacer" />
        <button className="nav-item" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen} title="Settings">
          <Icon n="gear" /><span className="label">Settings</span>
        </button>
        {settingsOpen && (
          <button className="nav-item indent" onClick={() => { openJira(project.id); onNavigate(); }} title="Jira settings">
            <Icon n="link" /><span className="label">Jira settings</span>
            <span className={`label small ${project.jira ? "tick" : "muted"}`}>{project.jira ? "Connected" : "Not connected"}</span>
          </button>
        )}
        {settingsOpen && (
          <button className="nav-item indent" onClick={() => { openReportSettings(project.id); onNavigate(); }} title="Report settings">
            <Icon n="cal" /><span className="label">Report settings</span>
            <span className={`label small ${project.reportSchedule?.enabled ? "tick" : "muted"}`}>{frequencyName(project.reportSchedule)}</span>
          </button>
        )}
      </nav>
    );
  }

  return (
    <nav className="nav-list">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          onClick={onNavigate}
          className={`nav-item${n.primary ? " primary" : ""}${!n.primary && isActive(pathname, n.href) ? " active" : ""}`}
          title={n.label}
        >
          <Icon n={n.icon} />
          <span className="label">{n.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <ShellInner>{children}</ShellInner>
      <JiraModal />
      <ReportSettingsModal />
    </StoreProvider>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <div className="app">
        <aside className={`sidebar${collapsed ? " collapsed" : ""}${mobileOpen ? " open" : ""}`}>
          <div className="side-top">
            <div className="logo"><i>D</i><span>DXA</span></div>
            <button className="icon-btn" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle sidebar"><Icon n="panel" /></button>
          </div>
          <Suspense fallback={null}><NavLinks onNavigate={() => setMobileOpen(false)} /></Suspense>
          <div className="spacer" />
          <div className="user">
            <div className="avatar">DU</div>
            <div className="user-meta"><div>Demo User</div></div>
          </div>
        </aside>
        {mobileOpen && <div className="scrim" onClick={() => setMobileOpen(false)} />}
        <main className="main">
          <button className="icon-btn mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu">☰</button>
          {children}
        </main>
      </div>
    </>
  );
}
