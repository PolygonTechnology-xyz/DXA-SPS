import { useNavigate, useParams, useMatch, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { projectsApi } from '@/api/projects'
import { useNavigation } from '@/stores/navigation'
import { useToBeStore } from '@/stores/tobe'
import type { LucideIcon } from 'lucide-react'
import { Workflow, PanelLeft, Plus, FolderOpen, Globe, ChevronLeft, LayoutGrid, Target, Folder, LogOut, PackageCheck, FileCheck2 } from 'lucide-react'
import { IconButton } from '@/components/ui'

type Pane = 'overview' | 'asis' | 'tobe' | 'files' | 'outputs'

interface NavItemProps {
  icon: LucideIcon
  label: string
  active: boolean
  collapsed: boolean
  onClick: () => void
  sub?: boolean
}

function NavItem({ icon: Icon, label, active, collapsed, onClick, sub }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className="ui-nav"
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      style={{
        paddingLeft: collapsed ? 0 : sub ? 30 : 12,
        justifyContent: collapsed ? 'center' : 'flex-start',
        fontWeight: active ? 600 : sub ? 400 : 500,
        color: active ? 'var(--accent)' : 'var(--ink)',
      }}
    >
      <Icon size={17} strokeWidth={1.8} />
      {!collapsed && <span>{label}</span>}
    </button>
  )
}

export default function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, newProjectOpen, startNewProject } = useNavigation()
  const tobeRunning = useToBeStore(s => s.stage === 'generating')
  const collapsed = sidebarCollapsed
  const navigate = useNavigate()
  const { id, pane } = useParams<{ id?: string; pane?: string }>()

  const currentPane = (pane as Pane) ?? 'overview'
  const inProject = !!id
  const onKnowledge = !!useMatch('/knowledge')
  const [params] = useSearchParams()

  // approved TO-BE versions, listed under Outputs for a direct jump
  const { data: versions = [] } = useQuery({
    queryKey: ['versions', id],
    queryFn: () => projectsApi.versions(id!),
    enabled: inProject,
  })
  const approvedTobe = versions.filter((v) => v.tobe_steps.length > 0)
  const shortDate = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  return (
    <aside
      style={{
        width: collapsed ? 64 : 272,
        flexShrink: 0,
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width .2s ease',
        overflow: 'hidden',
      }}
    >
      {/* logo + toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: '14px 14px 10px',
          gap: 8,
        }}
      >
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 17, letterSpacing: '-.01em' }}>
            <span style={{
              width: 30, height: 30, borderRadius: 8, background: 'var(--accent)', color: 'var(--accent-ink)',
              display: 'grid', placeItems: 'center',
            }}>
              <Workflow size={17} strokeWidth={2} />
            </span>
            <span>SPS</span>
          </div>
        )}
        <IconButton icon={PanelLeft} label="Toggle sidebar" onClick={toggleSidebar} />
      </div>

      {/* New project */}
      <button
        onClick={() => { startNewProject(); navigate('/projects') }}
        className="ui-btn ui-btn--primary"
        title={collapsed ? 'New project' : undefined}
        style={{
          margin: '6px 14px 14px', height: 42, justifyContent: collapsed ? 'center' : 'flex-start',
          padding: collapsed ? 0 : '0 14px', fontWeight: 600,
        }}
      >
        <Plus size={17} strokeWidth={2} />
        {!collapsed && <span>New project</span>}
      </button>

      {/* nav list */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 10px' }}>
        {!inProject ? (
          <>
            <NavItem
              icon={FolderOpen}
              label="All Projects"
              active={!id && !onKnowledge}
              collapsed={collapsed}
              onClick={() => navigate('/projects/list')}
            />
            <NavItem
              icon={Globe}
              label="Global Knowledge"
              active={onKnowledge}
              collapsed={collapsed}
              onClick={() => navigate('/knowledge')}
            />
          </>
        ) : (
          <>
            <button
              onClick={() => navigate('/projects/list')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                textAlign: 'left',
                border: 0,
                background: 'transparent',
                color: 'var(--muted)',
                fontSize: 13,
                padding: '6px 12px',
                borderRadius: 9,
                cursor: 'pointer',
              }}
            >
              <ChevronLeft size={14} strokeWidth={2} />
              {!collapsed && <span>All projects</span>}
            </button>
            <NavItem
              icon={LayoutGrid}
              label="Overview"
              active={currentPane === 'overview'}
              collapsed={collapsed}
              onClick={() => navigate(`/projects/${id}/overview`)}
            />
            <NavItem
              icon={Workflow}
              label="AS-IS process"
              active={currentPane === 'asis'}
              collapsed={collapsed}
              onClick={() => navigate(`/projects/${id}/asis`)}
            />
            <div style={{ position: 'relative' }}>
              <NavItem
                icon={Target}
                label="TO-BE process"
                active={currentPane === 'tobe'}
                collapsed={collapsed}
                onClick={() => navigate(`/projects/${id}/tobe`)}
              />
              {tobeRunning && currentPane !== 'tobe' && (
                <span style={{
                  position: 'absolute', top: 15, right: 12,
                  width: 7, height: 7, borderRadius: '50%',
                  background: 'var(--accent)', animation: 'pulse 1.5s infinite',
                  display: 'block',
                }} />
              )}
            </div>
            <NavItem
              icon={Folder}
              label="Files & records"
              active={currentPane === 'files'}
              collapsed={collapsed}
              onClick={() => navigate(`/projects/${id}/files`)}
            />
            <NavItem
              icon={PackageCheck}
              label="Outputs"
              active={currentPane === 'outputs' && !params.get('v')}
              collapsed={collapsed}
              onClick={() => navigate(`/projects/${id}/outputs`)}
            />
            {!collapsed && approvedTobe.map((v) => (
              <NavItem
                key={v.id}
                sub
                icon={FileCheck2}
                label={`TO-BE v${v.version} · ${shortDate(v.approved_at)}`}
                active={currentPane === 'outputs' && params.get('v') === String(v.id)}
                collapsed={collapsed}
                onClick={() => navigate(`/projects/${id}/outputs?v=${v.id}`)}
              />
            ))}
          </>
        )}
      </nav>

      {/* user */}
      <div
        style={{
          borderTop: '1px solid var(--line)',
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          D
        </div>
        {!collapsed && (
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
            <div>Demo User</div>
            <small style={{ color: 'var(--muted)' }}>demo@dxa-sps.com</small>
          </div>
        )}
        {!collapsed && <IconButton icon={LogOut} label="Log out" onClick={() => navigate('/landing')} />}
      </div>
    </aside>
  )
}
