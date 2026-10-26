import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { projectsApi, type Project } from '@/api/projects'
import { Plus, Trash2, FolderOpen, ArrowRight, Search, Check, CircleDashed, CircleDot } from 'lucide-react'
import { Button, IconButton, PageHeader, Segmented } from '@/components/ui'
import { stagesOf, needsOf } from '@/lib/progress'

function info(p: Project) {
  const stages = stagesOf(p)
  const doneCount = stages.filter((s) => s.state === 'done').length
  return { stages, doneCount, pct: Math.round((doneCount / stages.length) * 100), needs: needsOf(p, stages), finished: doneCount === stages.length }
}

function edited(p: Project): string {
  const created = p.updated_at <= p.created_at + 5
  const ts = created ? p.created_at : p.updated_at
  const days = Math.floor((Date.now() / 1000 - ts) / 86400)
  const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? `${days} days ago` : days < 14 ? 'a week ago' : days < 60 ? `${Math.floor(days / 7)} weeks ago` : new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${created ? 'Created' : 'Edited'} ${when}`
}

type Filter = 'all' | 'needs' | 'finished'

export default function ProjectsList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const { data: projects = [], isFetched } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })

  const trashProject = useMutation({
    mutationFn: (id: string) => projectsApi.trash(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      setDeleteConfirm(null)
    },
  })

  const all = projects.map((p) => ({ p, ...info(p) }))
  const needTotal = all.reduce((n, x) => n + x.needs, 0)
  const needProjects = all.filter((x) => x.needs > 0).length
  const shown = all
    .filter((x) => !query.trim() || x.p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((x) => filter === 'all' || (filter === 'needs' ? x.needs > 0 : x.finished))

  const open = (p: Project) => navigate(`/projects/${p.id}/overview`)

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 28px 40px' }}>
      <div style={{ width: '100%', maxWidth: 1120, margin: '0 auto', boxSizing: 'border-box' }}>

        <PageHeader
          title="All projects"
          subtitle={isFetched
            ? needTotal > 0
              ? `${needTotal} item${needTotal === 1 ? '' : 's'} waiting for you, across ${needProjects} project${needProjects === 1 ? '' : 's'}.`
              : `${projects.length} project${projects.length === 1 ? '' : 's'}`
            : undefined}
          actions={<Button variant="primary" icon={Plus} onClick={() => navigate('/projects')}>New project</Button>}
        />

        {/* Delete confirmation modal */}
        {deleteConfirm && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(17,24,39,.4)', display: 'grid', placeItems: 'center', padding: 16 }}
            onClick={() => setDeleteConfirm(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="ui-card"
              style={{ padding: '24px 24px 20px', width: 400, maxWidth: '100%', boxShadow: '0 12px 40px rgba(16,24,40,.18)' }}
            >
              <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 600 }}>Delete project?</h3>
              <p style={{ margin: '0 0 22px', color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
                <strong>"{deleteConfirm.name}"</strong> and all its data will be deleted. This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
                <Button
                  icon={Trash2}
                  loading={trashProject.isPending}
                  onClick={() => trashProject.mutate(deleteConfirm.id)}
                  disabled={trashProject.isPending}
                  style={{ background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}
                >
                  {trashProject.isPending ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {!isFetched && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)', fontSize: 14 }}>Loading…</div>
        )}

        {isFetched && projects.length === 0 && (
          <div className="ui-card" style={{ textAlign: 'center', padding: '56px 20px' }}>
            <span style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'inline-grid', placeItems: 'center', marginBottom: 14 }}>
              <FolderOpen size={24} strokeWidth={1.7} />
            </span>
            <p style={{ color: 'var(--muted)', fontSize: 14.5, marginBottom: 18 }}>No projects yet.</p>
            <Button variant="primary" iconRight={ArrowRight} onClick={() => navigate('/projects')}>Create your first project</Button>
          </div>
        )}

        {isFetched && projects.length > 0 && (
          <>
            {/* ── Search and filter ── */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
              <label className="pl-search">
                <Search size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a project" aria-label="Find a project" />
              </label>
              <Segmented value={filter} onChange={setFilter} options={[
                { value: 'all', label: `All · ${all.length}` },
                { value: 'needs', label: `Needs you · ${needProjects}` },
                { value: 'finished', label: `Finished · ${all.filter((x) => x.finished).length}` },
              ]} />
            </div>

            {/* ── Project cards ── */}
            {shown.length === 0 ? (
              <div className="ui-card" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
                No project matches{query.trim() ? ` “${query.trim()}”` : ''}.
              </div>
            ) : (
              <div className="pl-grid">
                {shown.map(({ p, doneCount, stages, pct, needs, finished }) => {
                  const started = doneCount > 0
                  return (
                    <article key={p.id} className="ui-card pl-card" onClick={() => open(p)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <StatusChip finished={finished} needs={needs} started={started} />
                        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{edited(p)}</span>
                      </div>
                      <h4 className="pl-card__title">{p.name}</h4>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                        <span className="pl-tag">{p.country || 'Bangladesh'}</span>
                        {(p.asis_steps?.length ?? 0) > 0 && (
                          <span className="pl-tag">{p.asis_steps.length} AS-IS{(p.tobe_steps?.length ?? 0) > 0 ? ` → ${p.tobe_steps.length} TO-BE` : ''} steps</span>
                        )}
                      </div>

                      {started ? (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ display: 'flex', fontSize: 12.5, marginBottom: 6 }}>
                            <span style={{ color: 'var(--ink-2)' }}>{doneCount} of {stages.length} steps done</span>
                            <span style={{ marginLeft: 'auto', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                          </div>
                          <div className="pl-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name} progress`}>
                            <i style={{ width: `${pct}%`, background: finished ? 'var(--success)' : 'var(--accent)' }} />
                          </div>
                        </div>
                      ) : (
                        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--muted)' }}>No steps yet. Open it to begin.</p>
                      )}

                      <div className="pl-card__foot">
                        <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}>Open project</span>
                        <IconButton
                          icon={Trash2}
                          label="Delete project"
                          size="sm"
                          danger
                          style={{ marginLeft: 'auto', color: 'var(--muted)' }}
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ id: p.id, name: p.name }) }}
                        />
                        <ArrowRight size={16} style={{ color: 'var(--accent)' }} />
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** "2 need you" / "Finished" / "Not started" / "In progress" — always an icon and words, never colour alone */
function StatusChip({ finished, needs, started }: { finished: boolean; needs: number; started: boolean }) {
  const s = finished
    ? { icon: <Check size={12} strokeWidth={2.4} />, text: 'Finished', color: 'var(--success)', bg: 'var(--success-soft)' }
    : needs > 0
      ? { icon: <i style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />, text: `${needs} need${needs === 1 ? 's' : ''} you`, color: 'var(--warn)', bg: 'var(--warn-soft)' }
      : started
        ? { icon: <CircleDot size={12} />, text: 'In progress', color: 'var(--accent)', bg: 'var(--accent-soft)' }
        : { icon: <CircleDashed size={12} />, text: 'Not started', color: 'var(--ink-2)', bg: '#f1f5f9' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: s.color, background: s.bg }}>
      {s.icon}{s.text}
    </span>
  )
}
