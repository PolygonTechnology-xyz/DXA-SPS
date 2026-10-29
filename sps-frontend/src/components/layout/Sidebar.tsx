import { useEffect, useState } from 'react'
import { useNavigate, useParams, useMatch, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { projectsApi, type Project } from '@/api/projects'
import { ASIS_APPROVED } from '@/lib/progress'
import { useNavigation } from '@/stores/navigation'
import { useToBeStore } from '@/stores/tobe'
import type { LucideIcon } from 'lucide-react'
import { Workflow, PanelLeft, Plus, FolderOpen, Globe, ChevronLeft, LayoutGrid, Target, BookOpen, LogOut, PackageCheck, FileCheck2, Lock, BarChart3, Timer, QrCode } from 'lucide-react'
import { IconButton } from '@/components/ui'

type Pane = 'overview' | 'asis' | 'tobe' | 'files' | 'outputs'

// The project's pages in working order: each opens once the one before it has been visited
// (or the project's progress has already reached it)
const PANE_ORDER: Pane[] = ['overview', 'files', 'asis', 'tobe', 'outputs']

const visitedKey = (id: string) => `sps.visited.${id}`
function readVisited(id: string): Pane[] {
  try { return JSON.parse(localStorage.getItem(visitedKey(id)) ?? '[]') } catch { return [] }
}

/** Pages the progress has unlocked, whatever this browser remembers */
function reachedByProgress(p: Project | undefined, hasVersions: boolean): Set<Pane> {
  const reached = new Set<Pane>(['overview'])
  if (!p) return reached
  const asis = (p.asis_steps?.length ?? 0) > 0 || p.status !== 'draft'
  const tobe = (p.tobe_steps?.length ?? 0) > 0 || ASIS_APPROVED.includes(p.status)
  if (asis) ['files', 'asis'].forEach((x) => reached.add(x as Pane))
  if (tobe) reached.add('tobe')
  if (hasVersions || p.status === 'tobe_approved') reached.add('outputs')
  return reached
}

interface NavItemProps {
  icon: LucideIcon
  label: string
  active: boolean
  collapsed: boolean
  onClick: () => void
  /** indented under the item above it: true (one level) or how many levels */
  sub?: boolean | number
  /** not reached yet: shown, but cannot be opened */
  disabled?: boolean
  /** why it is locked (the tooltip) */
  lockedNote?: string
}

function NavItem({ icon: Icon, label, active, collapsed, onClick, sub, disabled, lockedNote = 'open the step before it first' }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className="ui-nav"
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      title={disabled ? `${label} — ${lockedNote}` : collapsed ? label : undefined}
      style={{
        paddingLeft: collapsed ? 0 : 12 + 18 * Number(sub ?? 0),
        justifyContent: collapsed ? 'center' : 'flex-start',
        fontWeight: active ? 600 : sub ? 400 : 500,
        color: active ? 'var(--accent)' : 'var(--ink)',
      }}
    >
      <Icon size={17} strokeWidth={1.8} />
      {!collapsed && <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>}
      {!collapsed && disabled && <Lock size={13} strokeWidth={1.9} style={{ color: 'var(--muted)' }} />}
    </button>
  )
}

export default function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, newProjectOpen, startNewProject } = useNavigation()
  const tobeRunning = useToBeStore(s => s.stage === 'generating')
  const collapsed = sidebarCollapsed
  const navigate = useNavigate()
  const { id, pane, vid, tab } = useParams<{ id?: string; pane?: string; vid?: string; tab?: string }>()

  const currentPane = (pane as Pane) ?? 'overview'
  const inProject = !!id
  const onKnowledge = !!useMatch('/knowledge')
  const [params] = useSearchParams()

  // approved versions (AS-IS on its own, or AS-IS and TO-BE), listed under Outputs for a direct jump
  const { data: versions = [] } = useQuery({
    queryKey: ['versions', id],
    queryFn: () => projectsApi.versions(id!),
    enabled: inProject,
  })
  const shortDate = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: inProject,
  })

  // remember the pages opened in this project (also when the chat or a button navigates)
  const [visited, setVisited] = useState<Pane[]>([])
  useEffect(() => {
    if (!id) return
    const seen = readVisited(id)
    if (!seen.includes(currentPane)) {
      seen.push(currentPane)
      try { localStorage.setItem(visitedKey(id), JSON.stringify(seen)) } catch { /* private window */ }
    }
    setVisited(seen)
  }, [id, currentPane])

  const reached = reachedByProgress(project, versions.length > 0)
  const isOpen = (p: Pane) => reached.has(p) || visited.includes(p) || p === currentPane
  // a page opens once the page before it has been opened
  const canOpen = (p: Pane) => {
    const i = PANE_ORDER.indexOf(p)
    return i <= 0 || isOpen(p) || isOpen(PANE_ORDER[i - 1])
  }
  const go = (p: Pane) => { if (canOpen(p)) navigate(`/projects/${id}/${p}`) }

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
              onClick={() => go('overview')}
            />
            <NavItem
              icon={BookOpen}
              label="Knowledge"
              active={currentPane === 'files'}
              collapsed={collapsed}
              disabled={!canOpen('files')}
              onClick={() => go('files')}
            />
            <NavItem
              icon={Workflow}
              label="AS-IS process"
              active={currentPane === 'asis'}
              collapsed={collapsed}
              disabled={!canOpen('asis')}
              onClick={() => go('asis')}
            />
            <div style={{ position: 'relative' }}>
              <NavItem
                icon={Target}
                label="TO-BE process"
                active={currentPane === 'tobe'}
                collapsed={collapsed}
                disabled={!canOpen('tobe')}
                onClick={() => go('tobe')}
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
              icon={PackageCheck}
              label="Outputs"
              active={currentPane === 'outputs' && !params.get('v') && !vid}
              collapsed={collapsed}
              disabled={!canOpen('outputs')}
              onClick={() => go('outputs')}
            />
            {!collapsed && versions.map((v) => {
              const open = currentPane === 'outputs' && (params.get('v') ?? vid) === String(v.id)
              const go = (t: string) => navigate(`/projects/${id}/outputs/${v.id}/${t}`)
              // the TO-BE items wait for the version's TO-BE approval
              const noTobe = v.tobe_steps.length === 0
              return (
                <div key={v.id}>
                  <NavItem
                    sub
                    icon={FileCheck2}
                    label={`Version ${v.version} · ${shortDate(v.approved_at)}`}
                    active={open && !vid}
                    collapsed={collapsed}
                    onClick={() => navigate(`/projects/${id}/outputs?v=${v.id}`)}
                  />
                  {open && <>
                    <NavItem sub={2} icon={Workflow} label="AS-IS Analysis" active={tab === 'asis'} collapsed={collapsed} onClick={() => go('asis')} />
                    <NavItem sub={2} icon={Target} label="TO-BE Analysis" active={tab === 'tobe'} collapsed={collapsed} disabled={noTobe} lockedNote="approve this version's TO-BE first" onClick={() => go('tobe')} />
                    <NavItem sub={2} icon={BarChart3} label="TO-BE Impact Analysis" active={tab === 'impact'} collapsed={collapsed} disabled={noTobe} lockedNote="approve this version's TO-BE first" onClick={() => go('impact')} />
                    <NavItem sub={3} icon={Timer} label="TCV" active={tab === 'tcv'} collapsed={collapsed} disabled={noTobe} lockedNote="approve this version's TO-BE first" onClick={() => go('tcv')} />
                    <NavItem sub={3} icon={QrCode} label="Digitalization Analysis" active={tab === 'digital'} collapsed={collapsed} disabled={noTobe} lockedNote="approve this version's TO-BE first" onClick={() => go('digital')} />
                  </>}
                </div>
              )
            })}
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
