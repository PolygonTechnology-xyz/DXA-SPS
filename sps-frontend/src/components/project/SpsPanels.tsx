import { useState, useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, TriangleAlert, CircleX, Pencil, Plus, Trash2, ChevronRight } from 'lucide-react'
import { projectsApi, type Project, type SpsData, type SpsDocument, type SpsProblem, type AsIsStep, type ToBeStep } from '@/api/projects'
import { Button, IconButton } from '@/components/ui'
import { useSpsMeta, taka } from '@/lib/sps'

// The guideline's worksheets as panels: TCVQ (ছক-৭), checks, problems (ছক-৫),
// step comparison (ছক-৬), service profile (ছক-১) and documents (ছক-৩).

const card = { padding: '12px 14px', marginBottom: 12 } as const
const th = { textAlign: 'left' as const, padding: '6px 8px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.04em', color: 'var(--muted)', borderBottom: '1px solid var(--line)' }
const td = { padding: '6px 8px', fontSize: 12.5, borderBottom: '1px solid var(--line)', verticalAlign: 'top' as const }

function Section({ title, sub, action, children, collapsible, defaultOpen = true }: {
  title: string; sub?: string; action?: ReactNode; children: ReactNode
  /** a header that opens and closes the section */
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const shown = !collapsible || open
  const head = (
    <>
      {collapsible && <ChevronRight size={15} style={{ color: 'var(--muted)', alignSelf: 'center', transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s', flexShrink: 0 }} />}
      <strong style={{ fontSize: 13.5 }}>{title}</strong>
      {sub && <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>{sub}</span>}
    </>
  )
  return (
    <div className="ui-card" style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: shown ? 8 : 0, flexWrap: 'wrap' }}>
        {collapsible
          ? <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
              style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 8, border: 0, padding: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'inherit', flexWrap: 'wrap' }}>
              {head}
            </button>
          : head}
        {action}
      </div>
      {shown && children}
    </div>
  )
}

/** Saves part of the SPS data and refreshes the project */
function useSaveSps(projectId: string) {
  const qc = useQueryClient()
  return (patch: Partial<SpsData>) => projectsApi.update(projectId, { sps: patch } as never).then((p) => {
    qc.setQueryData(['project', projectId], p)
    return p
  })
}

// ── TCVQ summary bar (compact, above the TO-BE table) ─────────────────────────

export function TcvqBar({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const c = project.tcvq
  if (!c?.tobe) return null
  // only the step reduction for now (time / visits / cost / documents and the checks are hidden)
  return (
    <button onClick={onOpen} className="ui-card" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '8px 12px', marginBottom: 10, fontSize: 12.5, cursor: 'pointer', textAlign: 'left', border: '1px solid var(--line)' }}>
      <span style={{ whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--muted)' }}>Steps</span> <strong>{c.asis.steps}</strong> → <strong style={{ color: '#15803d' }}>{c.tobe.steps}</strong>
        {c.diff?.steps ? <span style={{ color: 'var(--muted)' }}> · {c.diff.steps} fewer</span> : null}
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Step comparison →</span>
    </button>
  )
}

// ── TCVQ table (the guideline's sheet 7) ──────────────────────────────────────────────────────────

export function TcvqTable({ project, tcvq }: { project?: Project; tcvq?: Project['tcvq'] }) {
  // a project's current TO-BE, or an approved version's (Outputs)
  const c = tcvq ?? project?.tcvq
  if (!c) return null
  const t = c.tobe
  const row = (label: string, a: ReactNode, b: ReactNode, d: ReactNode) => (
    <tr><td style={td}>{label}</td><td style={td}>{a}</td><td style={td}>{b}</td><td style={{ ...td, fontWeight: 600, color: '#15803d' }}>{d}</td></tr>
  )
  return (
    <Section title="TCVQ comparison" sub={`Citizen cost per visit ${taka(c.per_visit)} (fare + food + lost wage — set on Overview)`}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Area</th><th style={th}>Existing</th><th style={th}>Proposed</th><th style={th}>Difference</th></tr></thead>
          <tbody>
            {row('Time (working days)', c.asis.time_days, t?.time_days ?? '—', c.diff?.time_days ?? '—')}
            {row('Visits', c.asis.visits, t?.visits ?? '—', c.diff?.visits ?? '—')}
            {row('Citizen cost', taka(c.asis.citizen_cost), taka(t?.citizen_cost), taka(c.diff?.citizen_cost))}
            {row('Documents', c.asis.documents ?? '—', t?.documents ?? '—', c.diff?.documents ?? '—')}
            {row('Office cost', taka(c.asis.office_cost), taka(t?.office_cost), taka(c.diff?.office_cost))}
            {row('Steps', c.asis.steps, t?.steps ?? '—', c.diff?.steps ?? '—')}
            {row('Staff', c.asis.staff, t?.staff ?? '—', c.diff?.staff ?? '—')}
          </tbody>
        </table>
      </div>
      {c.annual && (
        <div style={{ marginTop: 8, fontSize: 13 }}>
          <strong>Annual saving</strong> for {c.annual.users.toLocaleString('en-IN')} users:{' '}
          <strong>{c.annual.days.toLocaleString('en-IN')}</strong> days · <strong>{c.annual.visits.toLocaleString('en-IN')}</strong> visits · <strong>{taka(c.annual.taka)}</strong>
        </div>
      )}
    </Section>
  )
}

// ── SPS checks ────────────────────────────────────────────────────────────────

export function ChecksList({ project }: { project: Project }) {
  const checks = project.sps_checks ?? []
  if (!checks.length) return null
  const icon = { pass: <CircleCheck size={15} color="#15803d" />, warn: <TriangleAlert size={15} color="#b45309" />, fail: <CircleX size={15} color="var(--danger)" /> }
  return (
    <Section title="SPS checks" sub="The guideline's rules. Failed checks block approval; warnings are improvements.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[...checks].sort((a, b) => ({ fail: 0, warn: 1, pass: 2 }[a.status] - { fail: 0, warn: 1, pass: 2 }[b.status])).map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5 }}>
            <span style={{ marginTop: 1, flexShrink: 0 }}>{icon[c.status]}</span>
            <span><strong style={{ fontWeight: 600 }}>{c.label}</strong> <span style={{ color: 'var(--muted)' }}>— {c.detail}</span></span>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── ছক-৫ problems and proposals (editable) ───────────────────────────────────

export function ProblemsTable({ project }: { project: Project }) {
  const { data: meta } = useSpsMeta()
  const save = useSaveSps(project.id)
  const problems = project.sps?.problems ?? []
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<SpsProblem[]>(problems)
  useEffect(() => { if (!editing) setDraft(problems) }, [JSON.stringify(problems), editing]) // eslint-disable-line react-hooks/exhaustive-deps
  const label = (k: string) => meta?.aspects.find((a) => a.key === k)
  const cell = (v: string, on: (t: string) => void) => editing
    ? <textarea className="ui-input" value={v} onChange={(e) => on(e.target.value)} style={{ width: '100%', minHeight: 54, fontSize: 12, padding: 6, resize: 'vertical' }} />
    : v || '—'
  const set = (i: number, k: keyof SpsProblem, v: string) => setDraft((d) => d.map((p, j) => (j === i ? { ...p, [k]: v } : p)))

  return (
    <Section
      title="Problems and proposals · ছক-৫"
      sub={project.sps?.problems_edited ? 'Edited by you — the next TO-BE is designed from this' : 'The 20 aspects of the guideline'}
      action={editing
        ? <span style={{ display: 'flex', gap: 6 }}>
            <Button size="sm" variant="primary" onClick={() => save({ problems: draft, problems_edited: true }).then(() => setEditing(false))}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </span>
        : <Button size="sm" icon={Pencil} onClick={() => setEditing(true)} disabled={!problems.length && !meta}>Edit</Button>}
    >
      {!draft.length && !editing ? <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0 }}>Generated with the TO-BE.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr><th style={th}>Aspect · বিষয়</th><th style={th}>Problem · সমস্যা</th><th style={th}>Citizen demand · চাহিদা</th><th style={th}>Proposal · প্রস্তাবনা</th><th style={th}>Rationale · যৌক্তিকতা</th>{editing && <th style={th} />}</tr></thead>
            <tbody>
              {draft.map((p, i) => (
                <tr key={i}>
                  <td style={{ ...td, width: '18%' }}>
                    {editing
                      ? <select className="ui-input" value={p.aspect} onChange={(e) => set(i, 'aspect', e.target.value)} style={{ width: '100%', fontSize: 12 }}>
                          {meta?.aspects.map((a) => <option key={a.key} value={a.key}>{a.en}</option>)}
                        </select>
                      : <><div style={{ fontWeight: 600 }}>{label(p.aspect)?.en ?? p.aspect}</div><div style={{ color: 'var(--muted)', fontSize: 11.5 }}>{label(p.aspect)?.bn}</div></>}
                  </td>
                  <td style={td}>{cell(p.problem, (v) => set(i, 'problem', v))}</td>
                  <td style={td}>{cell(p.demand, (v) => set(i, 'demand', v))}</td>
                  <td style={{ ...td, width: '26%' }}>{cell(p.proposal, (v) => set(i, 'proposal', v))}</td>
                  <td style={td}>{cell(p.rationale, (v) => set(i, 'rationale', v))}</td>
                  {editing && <td style={td}><IconButton icon={Trash2} label="Remove" size="sm" danger onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {editing && <Button size="sm" icon={Plus} style={{ marginTop: 8 }} onClick={() => setDraft((d) => [...d, { aspect: meta?.aspects[0]?.key ?? 'info', problem: '', demand: '', proposal: '', rationale: '' }])}>Add aspect</Button>}
        </div>
      )}
    </Section>
  )
}

// ── ছক-৬ step-by-step comparison ─────────────────────────────────────────────

export function MappingTable({ project, collapsed }: { project: Project; collapsed?: boolean }) {
  const mapping = project.sps?.mapping ?? []
  const asis = project.asis_steps ?? []
  const tobe = project.tobe_steps ?? []
  if (!mapping.length) return null
  const plain = (t: unknown) => String(t ?? '').replace(/\[[^\]]*\]/g, '').trim()
  const color = { kept: 'var(--ink)', merged: '#1d4ed8', removed: 'var(--danger)' }
  return (
    <Section title="Step-by-step comparison" sub="What happened to every AS-IS step" collapsible={collapsed !== undefined} defaultOpen={!collapsed}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead><tr><th style={th}>#</th><th style={th}>Existing</th><th style={th}>#</th><th style={th}>Proposed</th><th style={th}>Change</th></tr></thead>
          <tbody>
            {asis.map((s: AsIsStep) => {
              const m = mapping.find((x) => x.asis === s.step_number)
              const t: ToBeStep | undefined = m?.tobe ? tobe.find((x) => x.step_number === m.tobe) : undefined
              return (
                <tr key={s.step_number}>
                  <td style={td}>{s.step_number}</td>
                  <td style={{ ...td, width: '36%' }}>{plain(s.action)}</td>
                  <td style={td}>{m?.tobe ?? ''}</td>
                  <td style={{ ...td, width: '32%' }}>{t ? plain(t.action) : m?.disposition === 'removed' ? <em style={{ color: 'var(--muted)' }}>Not needed</em> : ''}</td>
                  <td style={td}>{m ? <><strong style={{ color: color[m.disposition] }}>{m.disposition}</strong>{m.reason ? ` — ${m.reason}` : ''}</> : <span style={{ color: '#b45309' }}>not accounted for</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

// ── ছক-১ service profile (editable) ──────────────────────────────────────────

export function ProfileSheet({ project }: { project: Project }) {
  const { data: meta } = useSpsMeta()
  const save = useSaveSps(project.id)
  const profile = project.sps?.profile ?? {}
  if (!meta) return null
  return (
    <Section title="Service delivery profile · ছক-১" sub="Filled by the review from your documents; change any value — yours is kept">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '6px 16px' }}>
        {meta.profile.map((p) => {
          const v = profile[p.key]
          return (
            <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, minWidth: 0 }}>
              <span style={{ flex: 1, minWidth: 0 }} title={p.bn}>{p.en}</span>
              <select className="ui-input" value={v?.value ?? ''} style={{ width: 140, fontSize: 12, padding: '3px 6px', borderColor: v?.source === 'web' ? '#f59e0b' : undefined }}
                onChange={(e) => save({ profile: { ...profile, [p.key]: { value: e.target.value, source: 'user' } } })}>
                <option value="">—</option>
                {p.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          )
        })}
      </div>
    </Section>
  )
}

// ── ছক-৩ documents (editable) ────────────────────────────────────────────────

export function DocumentsSheet({ project }: { project: Project }) {
  const save = useSaveSps(project.id)
  const docs = project.sps?.documents ?? []
  const [name, setName] = useState('')
  const update = (i: number, patch: Partial<SpsDocument>) =>
    save({ documents: docs.map((d, j) => (j === i ? { ...d, ...patch, user: true } as SpsDocument : d)) })
  const sel = (value: string, options: Array<[string, string]>, on: (v: string) => void) => (
    <select className="ui-input" value={value} onChange={(e) => on(e.target.value)} style={{ fontSize: 12, padding: '3px 6px', width: '100%' }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
  return (
    <Section title="Documents · ছক-৩" sub="What the citizen submits and how the office checks it — used for TCVQ and the never-ask-twice check">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead><tr><th style={th}>Document · কাগজপত্র</th><th style={th}>Citizen gets it</th><th style={th}>Office checks it</th><th style={th}>In the TO-BE</th><th style={th} /></tr></thead>
          <tbody>
            {docs.map((d, i) => (
              <tr key={i}>
                <td style={td}>{d.name}</td>
                <td style={td}>{sel(d.source, [['citizen_own', 'Has it · নিজের কাছে'], ['other_office', 'From another office']], (v) => update(i, { source: v as SpsDocument['source'] }))}</td>
                <td style={td}>{sel(d.verify, [['none', 'Not checked'], ['own', 'Own records'], ['other_office', 'With another office']], (v) => update(i, { verify: v as SpsDocument['verify'] }))}</td>
                <td style={td}>{sel(d.tobe ?? 'submit', [['submit', 'Still submitted'], ['auto', 'Fetched / verified automatically'], ['removed', 'Not needed']], (v) => update(i, { tobe: v as SpsDocument['tobe'] }))}</td>
                <td style={td}><IconButton icon={Trash2} label="Remove" size="sm" danger onClick={() => save({ documents: docs.filter((_, j) => j !== i) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input className="ui-input" placeholder="Add a document, e.g. National ID" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, maxWidth: 320, fontSize: 12.5, padding: '4px 8px' }} />
        <Button size="sm" icon={Plus} disabled={!name.trim()} onClick={() => { save({ documents: [...docs, { name: name.trim(), source: 'citizen_own', verify: 'none', user: true } as SpsDocument] }); setName('') }}>Add</Button>
      </div>
    </Section>
  )
}
