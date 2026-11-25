"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { FigmaIcon } from "./FigmaIcon";
import { Menu } from "./Menu";
import { JiraModal } from "./JiraModal";
import { ReportSettingsModal } from "./ReportSettingsModal";
import { StoreProvider, useStore } from "./Store";

/** Shown on controls that are in the design but have nothing behind them yet. */
const SOON = "Not available yet";

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "P";

function useCurrentProject() {
  const { id } = useParams<{ id?: string }>();
  const { projects } = useStore();
  return id ? projects.find((p) => p.id === id) : undefined;
}

function ProjectSwitcher() {
  const project = useCurrentProject();
  const { projects } = useStore();
  if (!project) return null;
  return (
    <Menu className="switcher" buttonClass="switcher-btn" label="Switch project" button={<>
      <span className="switcher-mark">{initials(project.name)}</span>
      <span className="switcher-name">{project.name}</span>
      <FigmaIcon name="chevron" size={16} />
    </>}>
      {(close) => (<>
        {projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} onClick={close} className={`menu-item${p.id === project.id ? " on" : ""}`}>{p.name}</Link>
        ))}
        <Link href="/projects" onClick={close} className="menu-item all">All projects</Link>
      </>)}
    </Menu>
  );
}

function RailItem({ href, icon, label, active, onClick }: { href: string; icon: string; label: string; active?: boolean; onClick: () => void }) {
  return (
    <Link href={href} onClick={onClick} className={`rail-item${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
      <span className="rail-tile"><FigmaIcon name={icon} size={20} /></span>
      <span>{label}</span>
    </Link>
  );
}

/** Inside a project: the dark rail. Elsewhere: the workspace menu. */
function SideNav({ collapsed, mobileOpen, onNavigate }: { collapsed: boolean; mobileOpen: boolean; onNavigate: () => void }) {
  const pathname = usePathname();
  const project = useCurrentProject();
  const open = mobileOpen ? " open" : "";

  if (project) {
    const base = `/projects/${project.id}`;
    return (
      <nav className={`prail${open}`} aria-label="Project">
        <RailItem href={base} icon="overview" label="Overview" active={pathname === base} onClick={onNavigate} />
        <RailItem href={`${base}/meetings`} icon="meetings" label="Meetings" active={pathname.startsWith(`${base}/meetings`)} onClick={onNavigate} />
        <RailItem href={`${base}/reports`} icon="reports" label="Reports" active={pathname.startsWith(`${base}/reports`)} onClick={onNavigate} />
        <RailItem href={`${base}/risks`} icon="risks" label="Risks" active={pathname.endsWith("/risks")} onClick={onNavigate} />
        <RailItem href={`${base}/resources`} icon="resources" label="Resources" active={pathname.endsWith("/resources")} onClick={onNavigate} />
        <div className="rail-spacer" />
        <RailItem href={`${base}/settings`} icon="settings" label="Settings" active={pathname.endsWith("/settings")} onClick={onNavigate} />
      </nav>
    );
  }

  const items = [
    { href: "/projects", label: "All projects", icon: "folder" },
    { href: "/knowledge", label: "All resources", icon: "files" },
  ];
  return (
    <nav className={`wsmenu${collapsed ? " collapsed" : ""}${open}`} aria-label="Workspace">
      <div className="ws-head">
        <b className="ws-label">DXA</b>
        <button type="button" className="ds-btn sm ws-label" disabled title={SOON}><FigmaIcon name="search" size={16} />Search</button>
      </div>
      <Link href="/projects/new" onClick={onNavigate} className="ds-btn primary ws-new" title="New project">
        <FigmaIcon name="add" size={18} /><span className="ws-label">New project</span>
      </Link>
      {items.map((n) => (
        <Link key={n.href} href={n.href} onClick={onNavigate} title={n.label} className={`ws-item${pathname === n.href ? " active" : ""}`}>
          <FigmaIcon name={n.icon} size={20} /><span className="ws-label">{n.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** The collapse button for the workspace menu. The project rail is already narrow. */
function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { id } = useParams<{ id?: string }>();
  if (id) return null;
  return (
    <button type="button" className="top-btn collapse-toggle" onClick={onToggle} aria-pressed={collapsed} title={collapsed ? "Expand menu" : "Collapse menu"} aria-label={collapsed ? "Expand menu" : "Collapse menu"}>
      {collapsed ? "»" : "«"}
    </button>
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
    <div className="app">
      <header className="appbar">
        <button type="button" className="top-btn mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu">☰</button>
        <Link href="/projects/new" className="home-btn"><FigmaIcon name="home" size={18} /><span>Home</span></Link>
        <Suspense fallback={null}>
          <ProjectSwitcher />
          <CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        </Suspense>
        <div className="appbar-spacer" />
        <button type="button" className="ds-btn primary ask" disabled title={SOON}><FigmaIcon name="sparkles" size={20} /><span>Ask agent</span></button>
        <button type="button" className="round-btn" disabled title={SOON} aria-label="Notifications"><FigmaIcon name="bell" size={20} /></button>
        <button type="button" className="round-btn" disabled title={SOON} aria-label="Help"><FigmaIcon name="help" size={20} /></button>
        <span className="account" title="Demo User">DU</span>
      </header>
      <div className="frame">
        <Suspense fallback={null}><SideNav collapsed={collapsed} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} /></Suspense>
        {mobileOpen && <div className="scrim" onClick={() => setMobileOpen(false)} />}
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
