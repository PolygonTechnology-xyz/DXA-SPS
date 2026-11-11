import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ChevronDown, Check, GitBranchPlus, Lock } from 'lucide-react'
import { projectsApi, type VersionInfo, type VersionList } from '@/api/projects'
import { useToBeStore } from '@/stores/tobe'
import { Button } from '@/components/ui'

// Versions: every AS-IS (with the TO-BE designed from it) is a version. The open one is what
// the AS-IS and TO-BE pages show; an approved AS-IS or TO-BE can't change in place — changing
// it makes a new version (one AS-IS draft at most, always the latest).

export function useVersions(projectId: string) {
  return useQuery({
    queryKey: ['versions-all', projectId],
    queryFn: () => projectsApi.allVersions(projectId),
    enabled: !!projectId,
  })
}

/** After opening or creating a version: everything on screen belongs to another version now */
export function refreshAfterVersionChange(qc: QueryClient, projectId: string) {
  useToBeStore.getState().reset()
  for (const key of ['project', 'versions-all', 'versions', 'chat-messages']) qc.invalidateQueries({ queryKey: [key, projectId] })
  qc.invalidateQueries({ queryKey: ['projects'] })
}

export function statusLabel(v: VersionInfo): { text: string; color: string } {
  if (v.tobe_locked) return { text: 'Approved', color: '#15803d' }
  if (v.asis_locked) return { text: v.tobe_count ? 'AS-IS approved · TO-BE draft' : 'AS-IS approved', color: 'var(--accent)' }
  return { text: 'Draft', color: '#b45309' }
}

/** The number a new version gets, and whether it replaces the unapproved AS-IS draft */
export function nextVersion(list: VersionList | undefined): { number: number; replaces: boolean } {
  const latest = list?.versions[0]
  if (!latest) return { number: 1, replaces: false }
  if (!latest.asis_locked && latest.id !== list?.active) return { number: latest.version, replaces: true }
  return { number: latest.version + 1, replaces: false }
}

/** "v2 · AS-IS approved ▾" — picks the version the AS-IS and TO-BE pages show */
export function VersionSwitcher({ projectId, disabled }: { projectId: string; disabled?: boolean }) {
  const qc = useQueryClient()
  const { data } = useVersions(projectId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const versions = data?.versions ?? []
  const current = versions.find((v) => v.id === data?.active)
  if (!current) return null
  const label = statusLabel(current)

  function pick(v: VersionInfo) {
    setOpen(false)
    if (v.id === data?.active) return
    setBusy(true)
    projectsApi.openVersion(projectId, v.id)
      .then(() => refreshAfterVersionChange(qc, projectId))
      .finally(() => setBusy(false))
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="ui-btn ui-btn--sm"
        disabled={disabled || busy}
        onClick={() => setOpen((o) => !o)}
        title={disabled ? 'Wait until the AI has finished' : 'Switch version'}
        style={{ gap: 6 }}
      >
        <strong style={{ fontWeight: 600 }}>v{current.version}</strong>
        <span style={{ color: label.color, fontSize: 12 }}>{label.text}</span>
        {versions.length > 1 && <ChevronDown size={14} style={{ color: 'var(--muted)', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />}
      </button>
      {open && versions.length > 1 && (
        <div className="ui-card" style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50, minWidth: 260, padding: 4,
          boxShadow: '0 12px 32px rgba(16,24,40,.14)',
        }}>
          {versions.map((v) => {
            const l = statusLabel(v)
            const active = v.id === data?.active
            return (
              <button
                key={v.id}
                onClick={() => pick(v)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  border: 0, borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                  background: active ? 'var(--accent-soft)' : 'transparent', color: 'var(--ink)', fontSize: 13,
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg)' }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                <strong style={{ fontWeight: 600, minWidth: 26 }}>v{v.version}</strong>
                <span style={{ flex: 1, color: l.color, fontSize: 12.5 }}>{l.text}</span>
                <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{v.asis_count} → {v.tobe_count || '–'}</span>
                {active ? <Check size={14} style={{ color: 'var(--accent)' }} /> : <span style={{ width: 14 }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * "AS-IS v1 is approved and can't be changed. A new version (v4) will be created." Creates it
 * on Yes, opens it, then runs onCreated (the change the user asked for: regenerate, an edit).
 */
export function NewVersionDialog({ projectId, what, version, onCreated, onCancel }: {
  projectId: string
  what: 'asis' | 'tobe'
  /** the approved version that is open */
  version: number
  onCreated: () => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const { data } = useVersions(projectId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const next = nextVersion(data)
  const name = what === 'asis' ? 'AS-IS' : 'TO-BE'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  function create() {
    setBusy(true)
    setError('')
    projectsApi.newVersion(projectId, what)
      .then(async () => {
        refreshAfterVersionChange(qc, projectId)
        await qc.refetchQueries({ queryKey: ['project', projectId] })
        onCreated()
      })
      .catch(() => { setError('The new version could not be created. Please try again.'); setBusy(false) })
  }

  return createPortal(
    <div onClick={() => { if (!busy) onCancel() }} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(17,24,39,.4)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="ui-card"
        style={{ padding: 22, maxWidth: 440, width: '100%', boxShadow: '0 12px 40px rgba(16,24,40,.18)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Lock size={17} strokeWidth={1.9} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: '2px 0 6px', fontSize: 16, fontWeight: 600 }}>{name} v{version} is approved</h3>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55 }}>
              It can't be changed. A new version <strong>v{next.number}</strong> will be created
              {what === 'asis' ? ` from this AS-IS, as a draft` : ` with the same approved AS-IS and this TO-BE as a draft`}; v{version} stays as it is.
            </p>
            {next.replaces && (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: '#b45309', lineHeight: 1.5 }}>
                v{next.number} is an AS-IS draft that is not approved yet — it will be replaced.
              </p>
            )}
            {error && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon={GitBranchPlus} loading={busy} autoFocus onClick={create}>Create v{next.number}</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** A lock next to the version switcher: the version's approved part is view only (the reason on hover) */
export function LockHint({ text }: { text: string }) {
  return (
    <span className="ui-lock-hint" tabIndex={0} aria-label={text}>
      <Lock size={15} strokeWidth={2} />
      <span role="tooltip" className="ui-lock-hint__tip">{text}</span>
    </span>
  )
}
