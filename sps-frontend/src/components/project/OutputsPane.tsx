import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FileSpreadsheet, Waypoints, FileCode2, PackageOpen, ChevronRight, GitBranch, FileStack, Sparkles, ChevronLeft, Workflow, Target, Table2, BarChart3, Columns2 } from 'lucide-react'
import { projectsApi, type AsIsStep, type ProcessVersion, type CostHead, type DigitalComponent } from '@/api/projects'
import BpmnViewer from '@/components/viewer/BpmnViewer'
import TableViewer from '@/components/viewer/TableViewer'
import SpsFlowchart from '@/components/viewer/SpsFlowchart'
import { analyzeApi } from '@/api/analyze'
import type { Project } from '@/api/projects'
import { Button, PageHeader, ReferenceList, Segmented, Spinner, collectSources } from '@/components/ui'
import { TcvqTable } from '@/components/project/SpsPanels'
import CompareTable from '@/components/viewer/CompareTable'
import { DIGITAL_LABEL } from '@/lib/asisReview'
import { BASE } from '@/api/client'
import { downloadSvg, downloadPng, downloadText } from '@/utils/download'
import { toBpmnXml } from '@/utils/bpmnXml'

interface Props {
  projectId: string
}

const fileSafe = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')

/**
 * Every approved version: its approved AS-IS, and the TO-BE designed from it once that is approved too.
 * Downloads: Excel (made on the server), BPMN diagram (SVG) and BPMN file (.bpmn).
 */
export default function OutputsPane({ projectId }: Props) {
  const navigate = useNavigate()
  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['versions', projectId],
    queryFn: () => projectsApi.versions(projectId),
    enabled: !!projectId,
  })

  // ?v=<id> (from the sidebar) opens one version; /outputs/<id>/<tab> one analysis of it, on its own
  const [params, setParams] = useSearchParams()
  const selected = versions.find((v) => v.id === Number(params.get('v')))
  const { vid, tab } = useParams<{ vid?: string; tab?: string }>()
  const only = versions.find((v) => v.id === Number(vid))
  const onlyTab = TABS.find((t) => t === tab)

  // The SVG diagram is drawn by the same viewer as on screen, off-screen, then saved
  const [svgJob, setSvgJob] = useState<{ steps: AsIsStep[]; filename: string; kind: 'bpmn' | 'flow'; title?: string } | null>(null)
  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => projectsApi.get(projectId), enabled: !!projectId })
  const svgRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!svgJob) return
    const raf = requestAnimationFrame(() => {
      // BPMN as PNG; the flowchart stays SVG
      if (svgRef.current) (svgJob.kind === 'bpmn' ? downloadPng : downloadSvg)(svgRef.current, svgJob.filename)
      setSvgJob(null)
    })
    return () => cancelAnimationFrame(raf)
  }, [svgJob])

  if (vid && onlyTab) {
    if (isLoading) return <p style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</p>
    if (!only) return <p style={{ color: 'var(--muted)', fontSize: 14 }}>This version is not in Outputs.</p>
    return (
      <div>
        <PageHeader title={TAB_TITLE[onlyTab]} subtitle={`Version ${only.version} · approved ${new Date(only.approved_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${only.asis_steps.length} AS-IS steps${only.tobe_steps.length ? ` → ${only.tobe_steps.length} TO-BE steps` : ''}`} />
        <Analysis key={`${only.id}-${onlyTab}`} v={only} tab={onlyTab} projectId={projectId} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Outputs" subtitle="Every approved version — the AS-IS as soon as it is approved, then the TO-BE designed from it." />

      {/* Implementation plan card — hidden for now; uncomment to show
      {project && versions.length > 0 && <PlanCard project={project} />}
      */}

      {isLoading ? (
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</p>
      ) : versions.length === 0 ? (
        <div className="ui-card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'inline-grid', placeItems: 'center', marginBottom: 14 }}>
            <PackageOpen size={22} strokeWidth={1.8} />
          </span>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>Nothing approved yet</h3>
          <p style={{ color: 'var(--muted)', margin: '0 auto 16px', fontSize: 14, maxWidth: 440, lineHeight: 1.6 }}>
            When you approve the AS-IS it is saved here as a version, and the TO-BE joins it once approved — ready to download as Excel and BPMN.
          </p>
          <Button iconRight={ChevronRight} onClick={() => navigate(`/projects/${projectId}/asis`)}>Go to AS-IS</Button>
        </div>
      ) : selected ? (
        // one version opened from the sidebar: its card, open
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button onClick={() => setParams({})} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 4, border: 0, background: 'transparent', color: 'var(--accent)', fontSize: 13, cursor: 'pointer', padding: 0 }}>
            <ChevronLeft size={14} strokeWidth={2} /> All versions
          </button>
          <VersionCard v={selected} defaultOpen latest={selected.id === versions[0].id} projectId={projectId} onSvg={(steps, filename, kind, title) => setSvgJob({ steps, filename, kind, title })} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {versions.map((v, i) => (
            <VersionCard key={v.id} v={v} latest={i === 0} projectId={projectId} onSvg={(steps, filename, kind, title) => setSvgJob({ steps, filename, kind, title })} />
          ))}
        </div>
      )}

      {svgJob && (
        <div ref={svgRef} style={{ position: 'fixed', left: '-9999px', top: 0, width: 800, opacity: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          {svgJob.kind === 'flow' ? <SpsFlowchart steps={svgJob.steps} title={svgJob.title} /> : <BpmnViewer steps={svgJob.steps} />}
        </div>
      )}
    </div>
  )
}

function VersionCard({ v, latest, projectId, onSvg, defaultOpen = false }: {
  v: ProcessVersion
  latest: boolean
  /** collapsed by default in the list; open when the version is opened on its own */
  defaultOpen?: boolean
  projectId: string
  onSvg: (steps: AsIsStep[], filename: string, kind: 'bpmn' | 'flow', title?: string) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const base = `${fileSafe(v.project_name)}-v${v.version}`
  // TO-BE steps drawn like AS-IS steps (lanes by actor), without pain points
  const tobeAsSteps = v.tobe_steps.map((s) => ({ ...s, pain_points: undefined } as unknown as AsIsStep))
  const when = new Date(v.approved_at * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  // Every source (uploaded document or web page) the steps of that process cite
  const asisSources = collectSources(v.asis_steps)
  const tobeSources = collectSources(v.tobe_steps)
  const refs = (sources: ReturnType<typeof collectSources>, title: string) =>
    sources.size > 0 && <div style={{ marginTop: -4, marginBottom: 10 }}><ReferenceList sources={sources} title={`${title} · ${sources.size}`} /></div>

  const row = (label: string, count: number, kind: 'asis' | 'tobe', steps: AsIsStep[]) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{count} steps</div>
      </div>
      <a className="ui-btn ui-btn--sm" href={BASE + projectsApi.exportUrl(projectId, v.id, kind)} download>
        <FileSpreadsheet size={15} strokeWidth={1.8} /> Excel
      </a>
      <Button size="sm" icon={GitBranch} onClick={() => onSvg(steps, `${base}-${kind === 'asis' ? 'AS-IS' : 'TO-BE'}-flowchart.svg`, 'flow', `${v.project_name} — ${kind === 'asis' ? 'AS-IS · বিদ্যমান' : 'TO-BE · প্রস্তাবিত'}`)}>Flowchart</Button>
      <Button size="sm" icon={Waypoints} onClick={() => onSvg(steps, `${base}-${kind === 'asis' ? 'AS-IS' : 'TO-BE'}-bpmn.png`, 'bpmn')}>BPMN diagram</Button>
      <Button size="sm" icon={FileCode2} onClick={() => downloadText(toBpmnXml(steps, `${v.project_name} — ${kind === 'asis' ? 'AS-IS' : 'TO-BE'}`), `${base}-${kind === 'asis' ? 'AS-IS' : 'TO-BE'}.bpmn`)}>
        BPMN file
      </Button>
    </div>
  )

  return (
    <div className="ui-card" style={{ padding: open ? '0 16px 6px' : '0 16px' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '12px 0', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'inherit',
        }}
      >
        <ChevronRight size={16} style={{ color: 'var(--muted)', transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s', flexShrink: 0 }} />
        <span className="ui-pill">Version {v.version}</span>
        {latest && <span style={{ fontSize: 12, fontWeight: 600, color: '#15803d' }}>Latest</span>}
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{v.tobe_steps.length ? 'AS-IS and TO-BE approved' : 'AS-IS approved'} · {when} · {v.country}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--muted)' }}>
          {v.asis_steps.length} AS-IS steps{v.tobe_steps.length ? ` → ${v.tobe_steps.length} TO-BE steps` : ''}
        </span>
      </button>
      {open && <>
      {/* SPS proposal (full report workbook) — hidden for now; uncomment to show
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>SPS proposal · সেবা সহজীকরণ প্রস্তাব</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Matrices 1–3, sheets 1–7 (incl. TCVQ), checks, implementation plan — one workbook</div>
        </div>
        <a className="ui-btn ui-btn--sm ui-btn--primary" href={BASE + projectsApi.exportUrl(projectId, v.id, 'report')} download>
          <FileStack size={15} strokeWidth={1.8} /> SPS report (Excel)
        </a>
      </div>
      */}
      {row('AS-IS process (approved)', v.asis_steps.length, 'asis', v.asis_steps)}
      {refs(asisSources, 'AS-IS references')}
      {v.tobe_steps.length > 0
        ? <>{row('TO-BE process', v.tobe_steps.length, 'tobe', tobeAsSteps)}{refs(tobeSources, 'TO-BE references')}</>
        :  <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)', fontSize: 13, color: 'var(--muted)' }}>TO-BE process — not approved yet for this AS-IS</div>}
      <Analysis v={v} projectId={projectId} />
      </>}
    </div>
  )
}

const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']

/** The implementation plan (strategic plan + time-based work plan), drafted by the agent */
function PlanCard({ project }: { project: Project }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const plan = project.sps?.plan

  function draft() {
    setBusy(true)
    setError('')
    analyzeApi.spsPlan(project.id, (e) => {
      if (e.type === 'done') { setBusy(false); qc.invalidateQueries({ queryKey: ['project', project.id] }) }
      if (e.type === 'error') { setBusy(false); setError(e.network ? 'The connection was interrupted — please try again.' : e.message) }
    })
  }

  return (
    <div className="ui-card" style={{ padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: plan ? 10 : 0 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Implementation plan · বাস্তবায়নের কর্মপরিকল্পনা</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Strategic plan and time-based work plan — included in the SPS report</div>
        </div>
        <Button size="sm" icon={Sparkles} loading={busy} onClick={draft}>{plan ? 'Redraft' : 'Draft plan'}</Button>
      </div>
      {error && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}
      {plan && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px 16px', fontSize: 12.5, marginBottom: 10 }}>
            {([['Challenges', plan.challenges], ['Measures', plan.measures], ['Publicity', plan.publicity], ['Monitoring', plan.monitoring]] as const).map(([k, v]) => (
              <div key={k}><strong>{k}</strong><div style={{ color: 'var(--ink-2)' }}>{v || '—'}</div></div>
            ))}
          </div>
          {!!plan.workplan?.length && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 620, width: '100%' }}>
                <thead><tr><th style={{ textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--line)' }}>Activity</th>{MONTHS.map((m) => <th key={m} style={{ padding: '4px 2px', borderBottom: '1px solid var(--line)', fontWeight: 600, color: 'var(--muted)' }}>{m}</th>)}</tr></thead>
                <tbody>
                  {plan.workplan.map((w, i) => (
                    <tr key={i}>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--line)' }}>{w.activity}</td>
                      {MONTHS.map((m) => <td key={m} style={{ padding: 2, borderBottom: '1px solid var(--line)' }}><div style={{ height: 14, background: w.months.includes(m) ? 'var(--accent)' : 'transparent', borderRadius: 2, opacity: 0.75 }} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const time = (s: { time_days?: number; visit?: boolean; fee?: number }) =>
  [s.time_days != null && String(s.time_days) !== '' ? `${s.time_days}d` : '', s.visit ? '🚶' : '', s.fee ? `৳${s.fee}` : ''].filter(Boolean).join(' · ') || '—'

const TABS = ['asis', 'tobe', 'impact', 'tcv', 'digital'] as const
type Tab = (typeof TABS)[number]
const TAB_TITLE: Record<Tab, string> = {
  asis: 'AS-IS Analysis', tobe: 'TO-BE Analysis', impact: 'TO-BE Impact Analysis',
  tcv: 'TO-BE Impact Analysis · TCV', digital: 'TO-BE Impact Analysis · Digitalization Analysis',
}

/**
 * The version's analysis, view only: the AS-IS (analysis columns on request), the TO-BE step
 * by step against the AS-IS, and the TO-BE's impact (TCV, digitalization analysis). The TO-BE tabs
 * wait for its approval. One of them alone (tab: its own page from the left menu), or all with tabs.
 */
function Analysis({ v, tab, projectId }: { v: ProcessVersion; tab?: Tab; projectId: string }) {
  const hasTobe = v.tobe_steps.length > 0
  const [picked, setTab] = useState<Tab>(hasTobe ? 'tobe' : 'asis')
  const shown = tab ?? picked
  const [asisView, setAsisView] = useState<'table' | 'bpmn'>('table')
  const [tobeView, setTobeView] = useState<'compare' | 'table' | 'bpmn'>('compare')
  // pain point, digital and law: the AS-IS review's columns, hidden until asked for
  const [showReview, setShowReview] = useState(false)

  const asis = v.asis_steps
  const tobe = v.tobe_steps
  const notYet = <div style={{ fontSize: 13, color: 'var(--muted)', padding: '6px 0' }}>Shown once the TO-BE of this version is approved.</div>

  return (
    <div style={tab ? undefined : { borderTop: '1px solid var(--line)', padding: '12px 0 10px' }}>
      {!tab && (
        <div style={{ marginBottom: 12 }}>
          <Segmented value={shown === 'tcv' || shown === 'digital' ? 'impact' : shown} onChange={setTab} options={[
            { value: 'asis', label: 'AS-IS Analysis', icon: Workflow },
            { value: 'tobe', label: 'TO-BE Analysis', icon: Target },
            { value: 'impact', label: 'TO-BE Impact Analysis', icon: BarChart3 },
          ]} />
        </div>
      )}

      {shown === 'asis' && <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <strong style={{ fontSize: 14, fontWeight: 600 }}>AS-IS process · {asis.length} steps</strong>
          <Segmented value={asisView} onChange={setAsisView} options={[
            { value: 'table', label: 'Table', icon: Table2 },
            { value: 'bpmn', label: 'BPMN', icon: Waypoints },
          ]} />
          {asisView === 'table' && (
            <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={showReview} onChange={(e) => setShowReview(e.target.checked)} />
              Show pain point, digital and law
            </label>
          )}
        </div>
        {asisView === 'table'
          ? (
            <TableViewer
              readOnly
              boldColumns={[2]}
              sources={collectSources(asis)}
              columns={['Step', 'Actor', 'Action', 'Input', 'Time', ...(showReview ? ['Pain Point', 'Digital', 'Law (Government Order / Regulation / Judgement)'] : [])]}
              rows={asis.map((s) => [
                String(s.step_number), s.actor, s.action, s.input || '—', time(s),
                ...(showReview ? [
                  s.pain_points || '—',
                  s.digital_status ? `${DIGITAL_LABEL[s.digital_status] ?? s.digital_status}${s.digital_note ? ` — ${s.digital_note}` : ''}` : '—',
                  s.legal_basis || '—',
                ] : []),
              ])}
            />
          )
          : <BpmnViewer steps={asis} />}
      </>}

      {shown === 'tobe' && (hasTobe ? <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <strong style={{ fontSize: 14, fontWeight: 600 }}>{asis.length} AS-IS steps → {tobe.length} TO-BE steps</strong>
          <Segmented value={tobeView} onChange={setTobeView} options={[
            { value: 'compare', label: 'Step comparison', icon: Columns2 },
            { value: 'table', label: 'TO-BE table', icon: Table2 },
            { value: 'bpmn', label: 'BPMN', icon: Waypoints },
          ]} />
        </div>
        {tobeView === 'compare' && <CompareTable asis={asis} tobe={tobe} />}
        {tobeView === 'table' && (
          <TableViewer
            readOnly
            boldColumns={[2]}
            sources={collectSources(tobe)}
            columns={['Step', 'Actor', 'Action', 'Channel', 'How it is digitalized', 'If rejected / returned', 'Time', 'Rationale', 'Legal basis', 'World best practice']}
            rows={tobe.map((s) => [String(s.step_number), s.actor, s.action, s.channel, s.digital_how || '—', s.if_rejected || '—', time(s), s.simplification_rationale || '—', s.legal_basis || '—', s.best_practice || '—'])}
          />
        )}
        {tobeView === 'bpmn' && <BpmnViewer steps={tobe.map((s) => ({ ...s, pain_points: undefined } as unknown as AsIsStep))} />}
      </> : notYet)}

      {(shown === 'impact' || shown === 'tcv' || shown === 'digital') && (hasTobe ? <>
        {/* TCV: time, cost and visits of the TO-BE against its AS-IS */}
        {shown !== 'digital' && v.tcvq && <>
          {shown === 'impact' && <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>TCV — time, cost and visits</div>}
          <TcvqTable tcvq={v.tcvq} />
        </>}
        {shown !== 'tcv' && <>
          {shown === 'impact' && <div style={{ fontWeight: 600, fontSize: 14, margin: '16px 0 8px' }}>Digitalization Analysis</div>}
          <DigitalInfra v={v} projectId={projectId} />
        </>}
      </> : notYet)}
    </div>
  )
}

const EFFORT: Record<string, string> = { quick: 'Quick win (< 3 months)', medium: '3–12 months', long: 'Over a year' }

const COST_HEAD: Record<CostHead, string> = {
  software_development: 'Software development', integration: 'Integration / API', hosting: 'Server & hosting',
  maintenance: 'Maintenance & support (yearly)', licence: 'Licence / subscription', hardware: 'Hardware & devices',
  security: 'Security & digital signature', sms_payment: 'SMS / payment gateway charges',
  data_agreement: 'Data-sharing agreement (MoU)', training: 'Training & change management',
}
const KIND: Record<DigitalComponent['kind'], string> = {
  website: 'Website / portal', portal_module: 'Portal module', mobile_app: 'Mobile app', integration: 'Data link / API',
  system: 'Government system', hardware: 'Hardware', other: 'Other',
}
const STATUS = {
  existing: { label: 'Already have', note: 'used as it is', color: '#15803d', bg: 'rgba(21,128,61,.09)' },
  upgrade: { label: 'Needs upgrade', note: 'have it, needs work', color: '#b45309', bg: 'rgba(180,83,9,.09)' },
  new: { label: 'Need to build', note: 'build or procure', color: '#1d4ed8', bg: 'rgba(29,78,216,.08)' },
} as const
const STATUS_ORDER = ['new', 'upgrade', 'existing'] as const

/**
 * Digitalization Analysis: the digital infrastructure the TO-BE relies on — already have,
 * needs upgrade, need to build — how each is built, and the high-level cost heads it needs.
 * Drafted by the AI in the background once the TO-BE is generated; the step-by-step detail below it.
 */
function DigitalInfra({ v, projectId }: { v: ProcessVersion; projectId: string }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showSteps, setShowSteps] = useState(false)
  const plan = v.digital_plan
  const tobe = v.tobe_steps
  const steps = tobe.filter((s) => (s.digital_how ?? '').trim())

  // not there yet: being drafted on the server — look again until it arrives
  useEffect(() => {
    if (plan) return
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ['versions', projectId] }), 8000)
    return () => clearInterval(t)
  }, [plan, qc, projectId])

  function draft() {
    setBusy(true)
    setError('')
    projectsApi.digitalPlan(projectId, v.id)
      .then(() => qc.invalidateQueries({ queryKey: ['versions', projectId] }))
      .catch(() => setError('The plan could not be drafted — please try again.'))
      .finally(() => setBusy(false))
  }

  if (!steps.length) return <div style={{ fontSize: 13, color: 'var(--muted)', padding: '6px 0' }}>This TO-BE proposes no digital infrastructure.</div>

  const items = plan?.components ?? []
  const heads = (Object.keys(COST_HEAD) as CostHead[])
    .map((h) => ({ h, items: items.filter((c) => c.cost_heads.includes(h)) }))
    .filter((x) => x.items.length)
    .sort((a, b) => b.items.length - a.items.length)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)', flex: 1, minWidth: 220 }}>
          {plan
            ? `${items.length} pieces of digital infrastructure behind ${steps.length} of ${tobe.length} TO-BE steps · drafted ${new Date(plan.drafted_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
            : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Spinner size={13} /> Preparing the digital plan from the TO-BE — this takes about a minute…</span>}
        </span>
        {plan && (
          <Button size="sm" icon={Sparkles} loading={busy} onClick={draft}>{busy ? 'Redrafting…' : 'Redraft'}</Button>
        )}
      </div>
      {error && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}

      {plan && <>
        {/* have / upgrade / build, side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          {STATUS_ORDER.map((st) => {
            const list = items.filter((c) => c.status === st)
            const S = STATUS[st]
            return (
              <div key={st} style={{ border: '1px solid var(--line)', borderTop: `3px solid ${S.color}`, borderRadius: 10, padding: 10, background: 'var(--surface)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: S.color, fontVariantNumeric: 'tabular-nums' }}>{list.length}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{S.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{S.note}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {list.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>None</div>}
                  {list.map((c) => (
                    <div key={c.name} style={{ background: S.bg, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, lineHeight: 1.5 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>
                        {KIND[c.kind]}{c.steps.length ? ` · step${c.steps.length > 1 ? 's' : ''} ${c.steps.join(', ')}` : ''}
                      </div>
                      {c.purpose && <div style={{ color: 'var(--ink-2)' }}>{c.purpose}</div>}
                      {c.build && <div style={{ marginTop: 4 }}><strong>How:</strong> {c.build}</div>}
                      {c.cost_heads.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                          {c.cost_heads.map((h) => (
                            <span key={h} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999, border: `1px solid ${S.color}`, color: S.color, background: 'var(--surface)' }}>{COST_HEAD[h]}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* cost heads: the budget lines, and which infrastructure needs each */}
        {heads.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Cost heads</div>
            <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5, minWidth: 560 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2, var(--surface))' }}>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--line)', width: 230 }}>Cost head</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>Needed for</th>
                  </tr>
                </thead>
                <tbody>
                  {heads.map(({ h, items: list }) => (
                    <tr key={h}>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)', fontWeight: 600, verticalAlign: 'top' }}>
                        {COST_HEAD[h]} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {list.length}</span>
                      </td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {STATUS_ORDER.flatMap((st) => list.filter((c) => c.status === st)).map((c) => (
                            <span key={c.name} title={STATUS[c.status].label}
                              style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 999, background: STATUS[c.status].bg, color: STATUS[c.status].color }}>
                              {c.name}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              {STATUS_ORDER.map((st) => (
                <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: STATUS[st].color }} /> {STATUS[st].label}
                </span>
              ))}
              <span>High-level heads only — no amounts.</span>
            </div>
          </div>
        )}
      </>}

      {/* step by step: how each TO-BE step is digitalized and what must be put in place */}
      <div>
        <Button size="sm" variant={showSteps || !plan ? 'active' : 'default'} aria-expanded={showSteps || !plan}
          onClick={() => setShowSteps((o) => !o)} disabled={!plan}>
          Step by step · {steps.length} steps
        </Button>
        {(showSteps || !plan) && (
          <div style={{ marginTop: 10 }}>
            <TableViewer
              readOnly
              chipColumns={[]}
              boldColumns={[1]}
              sources={collectSources(steps)}
              columns={['Step', 'Step name', 'Channel', 'Digital infrastructure (how it is digitalized)', 'To put in place', 'Effort']}
              rows={steps.map((s) => [
                String(s.step_number), s.step_name, s.channel, s.digital_how ?? '',
                s.implementation?.prerequisites || '—',
                (s.implementation?.effort && EFFORT[s.implementation.effort]) || '—',
              ])}
            />
          </div>
        )}
      </div>
    </div>
  )
}
