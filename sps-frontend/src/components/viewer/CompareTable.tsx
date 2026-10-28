import type { AsIsStep, ToBeStep } from '@/api/projects'
import { CitedText } from '@/components/viewer/ImplementationPlan'

type Change = 'kept' | 'improved' | 'merged' | 'new' | 'removed'

interface CompareRow {
  change: Change
  asis: AsIsStep[]
  tobe: ToBeStep | null
}

const CHANGE: Record<Change, { label: string; color: string; bg: string; title: string }> = {
  kept: { label: 'Kept', color: '#475569', bg: '#f1f5f9', title: 'One AS-IS step, carried over as it is' },
  improved: { label: 'Improved', color: '#1d4ed8', bg: '#eff6ff', title: 'One AS-IS step, made faster or with fewer visits' },
  merged: { label: 'Merged', color: '#6d28d9', bg: '#f5f3ff', title: 'Several AS-IS steps combined into one' },
  new: { label: 'New', color: '#047857', bg: '#ecfdf5', title: 'A step the TO-BE adds' },
  removed: { label: 'Removed', color: '#b91c1c', bg: '#fef2f2', title: 'An AS-IS step the TO-BE drops' },
}

/** "Label: long description [1]" → "Label" (the short name used on the BPMN) */
const shortName = (s: { action?: string; step_name?: string }) => {
  const text = String(s.action ?? '').replace(/\[\d+\]/g, '').trim()
  const i = text.indexOf(':')
  return (i > 0 && i <= 40 ? text.slice(0, i) : text) || s.step_name || '—'
}

/** "Label: long description [1]" → "long description" (what the step does) */
const detail = (s: { action?: string }) => {
  const text = String(s.action ?? '').replace(/\s*\[\d+\]/g, '').trim()
  const i = text.indexOf(':')
  return i > 0 && i <= 40 ? text.slice(i + 1).trim() : ''
}
const EFFORT = { quick: 'Quick win', medium: '3–12 months', long: 'Over a year' } as const
const CHANNEL: Record<ToBeStep['channel'], string> = { digital: 'Digital', in_person: 'In person', hybrid: 'Hybrid' }

// "Improved" = one AS-IS step made faster, with fewer visits or cheaper
const days = (list: Array<{ time_days?: number }>) => list.reduce((n, s) => n + (Number(s.time_days) || 0), 0)
const visits = (list: Array<{ visit?: boolean }>) => list.filter((s) => s.visit).length
const fee = (list: Array<{ fee?: number }>) => list.reduce((n, s) => n + (Number(s.fee) || 0), 0)

/**
 * One row per TO-BE step, in TO-BE order, next to the AS-IS steps it replaces. AS-IS steps
 * no TO-BE step came from appear as "Removed", right after the row of the AS-IS step before them.
 */
export function compareRows(asis: AsIsStep[], tobe: ToBeStep[]): CompareRow[] {
  const byUid = new Map(asis.filter((s) => s.uid).map((s) => [s.uid!, s]))
  const byNumber = new Map(asis.map((s) => [Number(s.step_number), s]))
  const used = new Set<AsIsStep>()

  const rows: CompareRow[] = tobe.map((t) => {
    // the fixed uids first; older TO-BEs only have the AS-IS step numbers
    const fromUids = (t.merged_from_uids ?? []).map((u) => byUid.get(u)).filter((s): s is AsIsStep => !!s)
    const from = fromUids.length ? fromUids
      : (t.merged_from ?? []).map((n) => byNumber.get(Number(n))).filter((s): s is AsIsStep => !!s)
    const sources = [...new Set(from)].sort((a, b) => a.step_number - b.step_number)
    sources.forEach((s) => used.add(s))
    const change: Change = sources.length === 0 ? 'new'
      : sources.length > 1 ? 'merged'
      : (Number(t.time_days) || 0) < days(sources) || visits([t]) < visits(sources) || fee([t]) < fee(sources) ? 'improved'
      : 'kept'
    return { change, asis: sources, tobe: t }
  })

  // place each removed AS-IS step after the row holding the AS-IS step just before it
  const ordered = [...asis].sort((a, b) => a.step_number - b.step_number)
  const removedAfter = new Map<number, AsIsStep[]>()   // row index (-1 = top) → removed steps
  ordered.forEach((s, i) => {
    if (used.has(s)) return
    let at = -1
    for (let j = i - 1; j >= 0 && at === -1; j--) {
      const prev = ordered[j]
      if (!used.has(prev)) continue
      at = rows.findIndex((r) => r.asis.includes(prev))
    }
    removedAfter.set(at, [...(removedAfter.get(at) ?? []), s])
  })
  const out: CompareRow[] = []
  const pushRemoved = (at: number) => (removedAfter.get(at) ?? []).forEach((s) => out.push({ change: 'removed', asis: [s], tobe: null }))
  pushRemoved(-1)
  rows.forEach((r, i) => { out.push(r); pushRemoved(i) })
  return out
}

export default function CompareTable({ asis, tobe }: { asis: AsIsStep[]; tobe: ToBeStep[] }) {
  const rows = compareRows(asis, tobe)
  const counts = rows.reduce((m, r) => ({ ...m, [r.change]: (m[r.change] ?? 0) + 1 }), {} as Partial<Record<Change, number>>)

  const th: React.CSSProperties = {
    position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)', textAlign: 'left',
    padding: '7px 9px', borderBottom: '1px solid var(--line)', fontSize: 10.5, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = { padding: '7px 9px', borderBottom: '1px solid var(--line)', verticalAlign: 'top', lineHeight: 1.45 }

  const stepLine = (n: number, name: string, struck = false) => (
    <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
      <span className="ui-step" style={{ flexShrink: 0 }}>{n}</span>
      <span style={{ textDecoration: struck ? 'line-through' : undefined, overflowWrap: 'anywhere' }}>{name}</span>
    </div>
  )

  return (
    <div>
      {/* summary of what happened to the process */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {(Object.keys(CHANGE) as Change[]).filter((c) => counts[c]).map((c) => (
          <span key={c} title={CHANGE[c].title} style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999, color: CHANGE[c].color, background: CHANGE[c].bg }}>
            {counts[c]} {CHANGE[c].label.toLowerCase()}
          </span>
        ))}
      </div>

      <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'auto', background: 'var(--surface)' }}>
        <table className="ui-table" style={{ width: '100%', minWidth: 720, borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: '30%' }}>AS-IS (what it replaces)</th>
              <th style={{ ...th, width: '58%' }}>TO-BE</th>
              <th style={th}>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const removed = r.change === 'removed'
              return (
                <tr key={i} style={{ background: removed ? '#fafafa' : undefined, color: removed ? 'var(--muted)' : undefined }}>
                  <td style={td}>
                    {r.asis.length
                      ? <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{r.asis.map((s) => <div key={s.uid ?? s.step_number}>{stepLine(s.step_number, shortName(s), removed)}</div>)}</div>
                      : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={td}>
                    {r.tobe ? (
                      <div className="cmp-tobe">
                        <div className="cmp-tobe__name">{stepLine(r.tobe.step_number, shortName(r.tobe))}</div>
                        {detail(r.tobe) && <div className="cmp-tobe__action">{detail(r.tobe)}</div>}
                        <div className="cmp-tobe__meta">
                          {r.tobe.actor && <span>{r.tobe.actor}</span>}
                          {r.tobe.channel && <span className={`cmp-ch cmp-ch--${r.tobe.channel}`}>{CHANNEL[r.tobe.channel] ?? r.tobe.channel}</span>}
                          {r.tobe.time_days != null && <span>{r.tobe.time_days === 0 ? 'Same day' : `${r.tobe.time_days} day${r.tobe.time_days === 1 ? '' : 's'}`}</span>}
                          {r.tobe.visit && <span>Office visit</span>}
                          {!!r.tobe.fee && <span>Fee {r.tobe.fee}</span>}
                          {r.tobe.implementation && <span className={`ip-chip--${r.tobe.implementation.effort}`}>{EFFORT[r.tobe.implementation.effort]}</span>}
                        </div>
                        {r.tobe.digital_how && (
                          <div className="cmp-tobe__note cmp-tobe__note--digital"><strong>How it is digitalized:</strong> {r.tobe.digital_how.replace(/\s*\[\d+\]/g, '')}</div>
                        )}
                        {r.tobe.best_practice && (
                          <div className="cmp-tobe__note cmp-tobe__note--bp"><strong>World best practice:</strong> <CitedText text={r.tobe.best_practice} step={r.tobe} /></div>
                        )}
                        {r.tobe.if_rejected && (
                          <div className="cmp-tobe__note cmp-tobe__note--reject">
                            <strong>If rejected{r.tobe.no_goto ? ` → back to step ${r.tobe.no_goto}` : ''}:</strong> {r.tobe.if_rejected.replace(/\s*\[\d+\]/g, '')}
                          </div>
                        )}
                        {r.tobe.checks?.map((c, ci) => (
                          <div key={ci} className={`ip-check ip-check--${c.severity}`} style={{ marginLeft: 27 }}>⚠ {c.issue}</div>
                        ))}
                        {r.tobe.simplification_rationale && (
                          <div className="cmp-tobe__why"><strong>Why:</strong> {r.tobe.simplification_rationale.replace(/\s*\[\d+\]/g, '')}</div>
                        )}
                      </div>
                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={td}>
                    <span title={CHANGE[r.change].title} style={{ fontSize: 11.5, fontWeight: 600, padding: '1px 7px', borderRadius: 4, color: CHANGE[r.change].color, background: CHANGE[r.change].bg, whiteSpace: 'nowrap' }}>
                      {CHANGE[r.change].label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 600 }}>
              <td style={{ ...td, borderBottom: 0 }}>{asis.length} steps</td>
              <td style={{ ...td, borderBottom: 0 }}>{tobe.length} steps</td>
              <td style={{ ...td, borderBottom: 0 }} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p style={{ margin: '8px 2px 0', fontSize: 12, color: 'var(--muted)' }}>
        View only — edit the steps in the AS-IS and TO-BE tabs.
      </p>
    </div>
  )
}
