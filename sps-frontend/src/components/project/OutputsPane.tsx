import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileSpreadsheet, Waypoints, FileCode2, PackageOpen, ChevronRight, GitBranch, FileStack, Sparkles, ChevronLeft, Workflow, Target, Table2, Calculator } from 'lucide-react'
import { projectsApi, type AsIsStep, type ProcessVersion } from '@/api/projects'
import BpmnViewer from '@/components/viewer/BpmnViewer'
import TableViewer from '@/components/viewer/TableViewer'
import SpsFlowchart from '@/components/viewer/SpsFlowchart'
import { analyzeApi } from '@/api/analyze'
import type { Project } from '@/api/projects'
import { Button, PageHeader, ReferenceList, Segmented, collectSources } from '@/components/ui'
import { TcvqTable } from '@/components/project/SpsPanels'
import { DIGITAL_LABEL } from '@/lib/asisReview'
import { BASE } from '@/api/client'
import { downloadSvg, downloadPng, downloadText } from '@/utils/download'
import { toBpmnXml } from '@/utils/bpmnXml'

interface Props {
  projectId: string
}

const fileSafe = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')

/**
 * Every approved TO-BE version, each with the approved AS-IS it was designed from.
 * Downloads: Excel (made on the server), BPMN diagram (SVG) and BPMN file (.bpmn).
 */
export default function OutputsPane({ projectId }: Props) {
  const navigate = useNavigate()
  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['versions', projectId],
    queryFn: () => projectsApi.versions(projectId),
    enabled: !!projectId,
  })

  // ?v=<id> (from the sidebar) opens one version
  const [params, setParams] = useSearchParams()
  const selected = versions.find((v) => v.id === Number(params.get('v')))

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

  return (
    <div>
      <PageHeader title="Outputs" subtitle="Every approved TO-BE version, with the approved AS-IS it was designed from." />

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
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>No approved TO-BE yet</h3>
          <p style={{ color: 'var(--muted)', margin: '0 auto 16px', fontSize: 14, maxWidth: 440, lineHeight: 1.6 }}>
            When you approve a TO-BE it is saved here as a version — with its AS-IS — ready to download as Excel and BPMN.
          </p>
          <Button iconRight={ChevronRight} onClick={() => navigate(`/projects/${projectId}/tobe`)}>Go to TO-BE</Button>
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
  // the TCVQ comparison (time, cost, visits) shows on request
  const [showTcvq, setShowTcvq] = useState(false)
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
      {/* TCV analysis (time, cost, visits) of this approved TO-BE against its AS-IS */}
      {v.tobe_steps.length > 0 && v.tcvq && (
        <div style={{ borderTop: '1px solid var(--line)', padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button size="sm" icon={Calculator} variant={showTcvq ? 'active' : 'default'} aria-expanded={showTcvq}
            style={{ alignSelf: 'flex-start' }} onClick={() => setShowTcvq((o) => !o)}>
            {showTcvq ? 'Hide TCVQ comparison' : 'Show TCVQ comparison'}
          </Button>
          {showTcvq && <TcvqTable tcvq={v.tcvq} />}
        </div>
      )}
      <ProcessView v={v} />
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

/** The version's approved AS-IS and TO-BE, as a table or a BPMN diagram (view only) */
function ProcessView({ v }: { v: ProcessVersion }) {
  const hasTobe = v.tobe_steps.length > 0
  const [process, setProcess] = useState<'asis' | 'tobe'>(hasTobe ? 'tobe' : 'asis')
  const [view, setView] = useState<'table' | 'bpmn'>('table')
  const showTobe = process === 'tobe' && hasTobe

  const asis = v.asis_steps
  const tobe = v.tobe_steps
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '12px 0 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {hasTobe && (
          <Segmented value={process} onChange={setProcess} options={[
            { value: 'asis', label: `AS-IS · ${asis.length}`, icon: Workflow },
            { value: 'tobe', label: `TO-BE · ${tobe.length}`, icon: Target },
          ]} />
        )}
        {!hasTobe && <strong style={{ fontSize: 14, fontWeight: 600 }}>AS-IS process · {asis.length} steps</strong>}
        <Segmented value={view} onChange={setView} options={[
          { value: 'table', label: 'Table', icon: Table2 },
          { value: 'bpmn', label: 'BPMN', icon: Waypoints },
        ]} />
      </div>

      {view === 'table' && !showTobe && (
        <TableViewer
          readOnly
          boldColumns={[2]}
          sources={collectSources(asis)}
          columns={['Step', 'Actor', 'Action', 'Input', 'Time', 'Pain Point', 'Digital', 'Law / regulation']}
          rows={asis.map((s) => [
            String(s.step_number), s.actor, s.action, s.input || '—', time(s), s.pain_points || '—',
            s.digital_status ? `${DIGITAL_LABEL[s.digital_status] ?? s.digital_status}${s.digital_note ? ` — ${s.digital_note}` : ''}` : '—',
            s.legal_basis || '—',
          ])}
        />
      )}
      {view === 'table' && showTobe && (
        <TableViewer
          readOnly
          boldColumns={[2]}
          sources={collectSources(tobe)}
          columns={['Step', 'Actor', 'Action', 'Channel', 'Time', 'Rationale', 'Legal basis']}
          rows={tobe.map((s) => [String(s.step_number), s.actor, s.action, s.channel, time(s), s.simplification_rationale || '—', s.legal_basis || '—'])}
        />
      )}
      {view === 'bpmn' && (
        <BpmnViewer steps={showTobe
          ? tobe.map((s) => ({ ...s, pain_points: undefined } as unknown as AsIsStep))
          : asis} />
      )}
    </div>
  )
}
