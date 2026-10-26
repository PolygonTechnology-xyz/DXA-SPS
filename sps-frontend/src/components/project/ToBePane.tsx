import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { useNavigation } from '@/stores/navigation'
import { useToBeStore } from '@/stores/tobe'
import { useSession } from '@/stores/session'
import { liveTobeSteps } from '@/lib/liveSteps'
import { Spinner } from '@/components/ui'
import { editTobeCell, newTobeStep } from '@/lib/tableEdit'
import { VersionSwitcher, NewVersionDialog, LockHint } from '@/components/project/Versions'
import { projectsApi, type ToBeStep } from '@/api/projects'
import { analyzeApi } from '@/api/analyze'
import TableViewer from '@/components/viewer/TableViewer'
import CompareTable from '@/components/viewer/CompareTable'
import ViewerToolbar from '@/components/viewer/ViewerToolbar'
import BpmnViewer from '@/components/viewer/BpmnViewer'
import type { AsIsStep } from '@/api/projects'
import { downloadSvg, downloadPng } from '@/utils/download'
import { BASE } from '@/api/client'
import { Download, FileSpreadsheet, RotateCw, ArrowLeftRight, CircleCheck, X, TriangleAlert, Table2, Waypoints, ChevronRight, Search, Check, Undo2, ClipboardCheck } from 'lucide-react'
import { coverage } from '@/lib/asisReview'
import { waitForServer } from '@/lib/asis'
import { GitBranch, ClipboardList } from 'lucide-react'
import SpsFlowchart from '@/components/viewer/SpsFlowchart'
import { TcvqBar, MappingTable } from '@/components/project/SpsPanels'
// TcvqTable, ChecksList, ProblemsTable: hidden from Analysis for now (see the Analysis view below)
import { STEP_TYPE_LABEL } from '@/lib/sps'

/** The failed checks the server returns with a refused approval (409) */
function parseFailed(err: unknown): string[] {
  try {
    const body = JSON.parse(String((err as Error).message).replace(/^[^{]*/, '')) as { failed?: string[] }
    return body.failed?.length ? body.failed : ['see the SPS checks']
  } catch { return ['see the SPS checks'] }
}
import { Button, IconButton, Segmented, Notice, RichText, collectSources } from '@/components/ui'

interface Props {
  projectId: string
  pane: string
}

export default function ToBePane({ projectId, pane }: Props) {
  const navigate = useNavigate()
  const { pendingAction, setPendingAction } = useNavigation()
  const qc = useQueryClient()
  const tobe = useToBeStore()
  const logEndRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'table' | 'bpmn' | 'flow' | 'compare'>('table')
  // failed SPS checks reported by the server when approving
  const [approveError, setApproveError] = useState<string[] | null>(null)
  const [expanded, setExpanded] = useState(false)
  // the activity log while generating (hidden by default — the live table shows progress)
  const [showLog, setShowLog] = useState(false)
  // the last deleted TO-BE step, for Undo
  const [deleted, setDeleted] = useState<{ name: string; before: ToBeStep[] } | null>(null)
  const bpmnRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<HTMLDivElement>(null)

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: !!projectId,
    // a run on the server (e.g. started before a reload): check until it ends
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  })

  const updateProject = useMutation({
    mutationFn: (patch: Parameters<typeof projectsApi.update>[1]) =>
      projectsApi.update(projectId, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  })

  const tobeSteps: ToBeStep[] = project?.tobe_steps ?? []
  const asisSteps = project?.asis_steps ?? []
  // TO-BE is designed only from an approved AS-IS (every web finding decided)
  const asisApproved = ['asis_approved', 'tobe_complete', 'tobe_approved'].includes(project?.status ?? '')
  const cov = coverage(asisSteps, project?.asis_findings)
  // The TO-BE waits while the AS-IS is being analysed (mapping + review)
  const asisRunning = project?.running === 'asis' || useSession((st) => st.isRunning)
  // A TO-BE run the server is doing that this page did not start (the page was reloaded)
  const serverTobe = project?.running === 'tobe' && tobe.stage !== 'generating'

  // Init store for this project
  useEffect(() => {
    if (projectId) tobe.initForProject(projectId)
  }, [projectId])

  // Sync with the project: a TO-BE exists → done; it was cleared (a new AS-IS was generated)
  // → back to idle, so the next approved AS-IS gets a fresh TO-BE
  useEffect(() => {
    if (tobeSteps.length > 0) tobe.setStage('done')
    else if (useToBeStore.getState().stage === 'done') tobe.setStage('idle')
  }, [tobeSteps.length])

  // Auto-scroll the progress log
  useEffect(() => {
    if (pane === 'tobe') logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [tobe.log.length, pane])

  // Generate right after "Approve & continue" on the AS-IS (and only then — opening the
  // project from the list shows a Start button). Read the live store (not this render's
  // copy) so a StrictMode double-run doesn't start it twice.
  const location = useLocation()
  const askedToStart = !!(location.state as { autostart?: boolean } | null)?.autostart
  useEffect(() => {
    const live = useToBeStore.getState()
    if (askedToStart && live.stage === 'idle' && !live.genError && asisApproved && asisSteps.length > 0 && tobeSteps.length === 0 && !project?.running) {
      startTobeGeneration()
      navigate(location.pathname, { replace: true, state: null })   // a reload does not start it again
    }
  }, [askedToStart, tobe.stage, asisApproved, asisSteps.length, project?.running])

  // ChatRail "generate the TO-BE" — read the live store value (StrictMode runs effects twice)
  useEffect(() => {
    const action = useNavigation.getState().pendingAction
    if (action?.type === 'generate_tobe') {
      setPendingAction(null)
      if (asisApproved && useToBeStore.getState().stage !== 'generating' && !project?.running) regenerate()
    }
  }, [pendingAction])

  // the open version's TO-BE is approved: view only — a change makes a new version first
  const tobeFrozen = !!project?.version?.tobe_locked
  const [askNewVersion, setAskNewVersion] = useState(false)
  const regenerateTobe = () => (tobeFrozen ? setAskNewVersion(true) : regenerate())

  // Clears the current TO-BE and designs it again
  function regenerate() {
    tobe.reset()
    qc.setQueryData(['project', projectId], (old: typeof project) => old ? { ...old, tobe_steps: [] } : old)
    projectsApi.update(projectId, { tobe_steps: [], status: 'asis_approved' }).catch(() => { /* regenerated anyway */ })
    startTobeGeneration()
  }

  // Runs inside the progress panel (no full-page overlay). The backend reads the approved
  // AS-IS and saves the steps; everything here is a global store or the query client, so
  // it finishes even if the user switches tabs while it is running.
  function startTobeGeneration() {
    tobe.setGenError(null)
    tobe.setLiveSteps([])
    tobe.setStage('generating')
    tobe.addLog({ kind: 'progress', text: 'Designing the simplified TO-BE process from the approved AS-IS…' })
    let accumulated = ''
    let stepsSeen = 0

    const fail = (msg: string) => {
      tobe.setGenError(msg)
      tobe.setLiveSteps([])
      tobe.setStage('idle')
    }

    const stop = analyzeApi.tobe(projectId, (e) => {
      if (e.type === 'progress' && e.text) tobe.addLog({ kind: 'progress', text: e.text })
      if (e.type === 'text') {
        accumulated += e.text
        // every complete step is shown in the table straight away
        const live = liveTobeSteps(accumulated)
        if (live.length > stepsSeen) {
          stepsSeen = live.length
          tobe.setLiveSteps(live)
          tobe.addLog({ kind: 'progress', text: `Drafting TO-BE step ${live.length}…` })
        }
      }
      if (e.type === 'done') {
        let steps: ToBeStep[] = []
        try { steps = (JSON.parse(e.text) as { tobe_steps?: ToBeStep[] }).tobe_steps ?? [] } catch { /* handled below */ }
        if (!steps.length) { fail('AI did not return structured TO-BE steps. Please try again.'); return }
        qc.setQueryData(['project', projectId], (old: typeof project) =>
          old ? { ...old, tobe_steps: steps, status: 'tobe_complete' } : old)
        qc.invalidateQueries({ queryKey: ['project', projectId] })
        qc.invalidateQueries({ queryKey: ['projects'] })
        tobe.setLiveSteps([])
        tobe.setStage('done')
      }
      // the connection dropped but the server goes on: follow the run there (shown as running)
      if (e.type === 'error' && e.network) {
        tobe.setLiveSteps([])
        tobe.setStage('idle')
        qc.invalidateQueries({ queryKey: ['project', projectId] })
        waitForServer(projectId).then((p) => {
          qc.invalidateQueries({ queryKey: ['projects'] })
          if (p && !p.tobe_steps?.length) fail('The TO-BE could not be finished. Please try again.')
        })
        return
      }
      if (e.type === 'error') fail(e.message)
      // a run is already going on the server: follow it (the page shows it as running)
      if (e.type === 'busy') {
        tobe.setLiveSteps([])
        // mark it at once, so the auto-start does not try again before the refresh
        qc.setQueryData(['project', projectId], (old: typeof project) => (old ? { ...old, running: e.running } : old))
        tobe.setStage('idle')
        qc.invalidateQueries({ queryKey: ['project', projectId] })
      }
    })
    tobe.setStopFn(stop)
  }

  // Deleting a row deletes the TO-BE step; the rest are renumbered
  function saveTobe(next: ToBeStep[]) {
    qc.setQueryData(['project', projectId], (old: typeof project) => (old ? { ...old, tobe_steps: next } : old))
    updateProject.mutate({ tobe_steps: next })
  }
  // Every edit in the table is saved right away
  function editCell(ri: number, ci: number, value: string) {
    if (!tobeSteps[ri]) return
    saveTobe(tobeSteps.map((s, i) => (i === ri ? editTobeCell(s, ci, value) : s)))
  }
  function addStep() {
    saveTobe([...tobeSteps, newTobeStep(tobeSteps.length + 1)])
  }
  function deleteStep(ri: number) {
    const step = tobeSteps[ri]
    if (!step) return
    setDeleted({ name: `Step ${step.step_number} “${step.step_name}”`, before: tobeSteps })
    saveTobe(tobeSteps.filter((_, i) => i !== ri).map((s, i) => ({ ...s, step_number: i + 1 })))
  }

  const fileBase = (project?.name ?? 'tobe').replace(/\s+/g, '-')
  const tobeColumns = ['Step', 'Actor', 'Action', 'Channel', 'Time', 'Rationale', 'Legal basis']
  const toRows = (list: ToBeStep[]) => list.map((s) => {
    const type = s.step_type && s.step_type !== 'activity' ? `${STEP_TYPE_LABEL[s.step_type]?.icon ?? ''} ` : ''
    const time = [s.time_days != null && String(s.time_days) !== '' ? `${s.time_days}d` : '', s.visit ? '🚶' : '', s.fee ? `৳${s.fee}` : ''].filter(Boolean).join(' · ') || '—'
    return [`${type}${s.step_number}`, s.actor, s.action, s.channel, time, s.simplification_rationale ?? '—', s.legal_basis || '—']
  })
  const tobeRows = toRows(tobeSteps)
  // an approved TO-BE is view only
  const tobeEditProps = project?.version?.tobe_locked ? { readOnly: true } : { onDeleteRow: deleteStep, onCellChange: editCell, onAddRow: addStep }
  const tobeSources = collectSources(tobeSteps)
  const tobeAsBpmn = tobeSteps.map((s) => ({ ...s, pain_points: undefined } as unknown as AsIsStep))
  const viewOptions = [
    { value: 'table' as const, label: 'Table', icon: Table2 },
    { value: 'bpmn' as const, label: 'BPMN', icon: Waypoints },
  ]
  const busy = tobe.stage === 'generating'

  // ── Guards ────────────────────────────────────────────────────────────────────

  if (asisRunning && !busy) {
    return (
      <div>
        <div className="ui-card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'inline-grid', placeItems: 'center', marginBottom: 14 }}>
            <Spinner size={22} />
          </span>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>The AS-IS is still being analysed</h3>
          <p style={{ color: 'var(--muted)', margin: '0 auto 16px', fontSize: 14, maxWidth: 480, lineHeight: 1.6 }}>
            The TO-BE opens when the AS-IS mapping and review are finished and the AS-IS is approved.
          </p>
          <Button iconRight={ChevronRight} onClick={() => navigate(`/projects/${projectId}/asis`)}>Watch the AS-IS</Button>
        </div>
      </div>
    )
  }

  // Not loaded yet (reload): wait instead of flashing the "no AS-IS" screen
  if (!project && tobe.stage !== 'generating') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '28px 4px', color: 'var(--muted)', fontSize: 13.5 }}>
        <Spinner size={14} /> Loading the TO-BE…
      </div>
    )
  }

  if (asisSteps.length > 0 && !asisApproved && tobeSteps.length === 0) {
    return (
      <div>
        <div className="ui-card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'inline-grid', placeItems: 'center', marginBottom: 14 }}>
            <ClipboardCheck size={22} strokeWidth={1.8} />
          </span>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>Approve the AS-IS first</h3>
          <p style={{ color: 'var(--muted)', margin: '0 auto 16px', fontSize: 14, maxWidth: 480, lineHeight: 1.6 }}>
            The TO-BE is designed only from a reviewed and approved AS-IS — its pain points, digital status and laws.
            {cov.pending > 0 && <> {cov.pending} item{cov.pending > 1 ? 's' : ''} found on the web still need your decision in the chat.</>}
          </p>
          <Button variant="primary" iconRight={ChevronRight} onClick={() => navigate(`/projects/${projectId}/asis`)}>Review the AS-IS</Button>
        </div>
      </div>
    )
  }

  if (asisSteps.length === 0 && tobe.stage !== 'done') {
    return (
      <div>
        <div className="ui-card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--warn-soft)', color: 'var(--warn)', display: 'inline-grid', placeItems: 'center', marginBottom: 14 }}>
            <TriangleAlert size={22} strokeWidth={1.8} />
          </span>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>AS-IS process required first</h3>
          <p style={{ color: 'var(--muted)', margin: '0 0 16px', fontSize: 14 }}>Generate and approve the AS-IS process before creating the simplified TO-BE design.</p>
          <Button iconRight={ChevronRight} onClick={() => navigate(`/projects/${projectId}/asis`)}>Go to AS-IS</Button>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>

      {/* Approved AS-IS, no TO-BE yet: the user starts it */}
      {tobe.stage === 'idle' && !serverTobe && !tobe.genError && asisApproved && tobeSteps.length === 0 && (
        <div className="ui-card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'inline-grid', placeItems: 'center', marginBottom: 14 }}>
            <CircleCheck size={22} strokeWidth={1.8} />
          </span>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>The AS-IS is approved — ready for the TO-BE</h3>
          <p style={{ color: 'var(--muted)', margin: '0 auto 16px', fontSize: 14, maxWidth: 480, lineHeight: 1.6 }}>
            The AI designs the simplified TO-BE process from the {asisSteps.length} approved AS-IS steps — their pain points, digital status and laws.
          </p>
          <Button variant="primary" iconRight={ChevronRight} onClick={startTobeGeneration} style={{ height: 42, padding: '0 20px' }}>Start TO-BE</Button>
        </div>
      )}

      {tobe.genError && (
        <Notice action={<Button size="sm" variant="danger" icon={Undo2} onClick={regenerate}>Retry</Button>}>
          <TriangleAlert size={16} /> {tobe.genError}
        </Notice>
      )}

      {/* ── Generating: the steps appear in the table as they are written; locked until done ── */}
      {(busy || serverTobe) && (
        <>
          <div className="ui-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', marginBottom: 10, borderColor: '#c7d2fe', background: 'var(--accent-soft)' }}>
            <Spinner size={16} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                Designing the TO-BE from {asisSteps.length} approved AS-IS steps{tobe.liveSteps.length ? ` · ${tobe.liveSteps.length} step${tobe.liveSteps.length > 1 ? 's' : ''} so far` : ''}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {serverTobe
                  ? 'Running on the server — the TO-BE appears here when it is finished.'
                  : <>You can review, edit and approve it when it is finished. {tobe.log.length ? <>· <RichText text={tobe.log[tobe.log.length - 1].kind === 'progress' ? (tobe.log[tobe.log.length - 1] as { text: string }).text : ''} /></> : null}</>}
              </div>
            </div>
            {busy && <Button size="sm" variant="ghost" onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide log' : 'Show log'}</Button>}
          </div>
          {busy && (tobe.liveSteps.length > 0
            ? <TableViewer boldColumns={[2]} columns={tobeColumns} rows={toRows(tobe.liveSteps)} readOnly />
            : <div className="ui-card" style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13.5 }}>The first TO-BE steps will appear here in a moment…</div>)}
        </>
      )}
      {tobe.stage === 'generating' && showLog && (
        <div className="ui-card" style={{ overflow: 'hidden', marginTop: 10 }}>
          <style>{`
            @keyframes logFadeIn {
              from { opacity: 0; transform: translateY(6px); }
              to   { opacity: 1; transform: translateY(0); }
            }
            @keyframes blink {
              0%, 100% { opacity: 1; }
              50%       { opacity: 0; }
            }
            .log-line { animation: logFadeIn 0.18s ease both; }
          `}</style>

          <div style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: tobe.log.length > 0 ? 12 : 0 }}>
              {busy && (
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1.5s infinite', flexShrink: 0 }} />
              )}
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                Designing the TO-BE from {asisSteps.length} approved AS-IS steps…
              </span>
            </div>

            {tobe.log.length > 0 && (
              <div style={{
                maxHeight: 360, overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: 4,
                fontFamily: 'var(--mono)', fontSize: 12.5,
                background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
                padding: '12px 14px', border: '1px solid var(--line)',
              }}>
                {tobe.log.map((item, i) => (
                  <div key={i} className="log-line" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.6 }}>
                    {item.kind === 'progress' && (
                      <>
                        <ChevronRight size={14} strokeWidth={2.2} style={{ color: 'var(--accent)', marginTop: 3 }} />
                        <span style={{ color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}><RichText text={item.text} /></span>
                      </>
                    )}
                    {item.kind === 'searching' && (
                      <>
                        <Search size={13} strokeWidth={2.2} style={{ color: '#d97706', marginTop: 4 }} />
                        <span style={{ color: 'var(--muted)' }}>
                          {item.step != null ? <span style={{ color: 'var(--ink)' }}>step {item.step} </span> : null}
                          <em>{item.query}</em>
                        </span>
                      </>
                    )}
                    {item.kind === 'search_result' && (
                      <>
                        <Check size={14} strokeWidth={2.4} style={{ color: '#16a34a', marginTop: 3 }} />
                        <span style={{ color: 'var(--muted)' }}>
                          {item.step != null ? <span style={{ color: 'var(--ink)' }}>step {item.step} </span> : null}
                          {item.summary}
                        </span>
                      </>
                    )}
                  </div>
                ))}

                {/* Blinking cursor while running */}
                {busy && (
                  <span style={{ color: 'var(--accent)', animation: 'blink 1s step-start infinite', userSelect: 'none', marginTop: 2 }}>▌</span>
                )}

                <div ref={logEndRef} />
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── Done stage ────────────────────────────────────────────────────────── */}
      {tobe.stage === 'done' && tobeSteps.length > 0 && (
        <>
          <ViewerToolbar
            tab={tab}
            onTabChange={setTab}
            tabs={[...viewOptions,
              // { value: 'flow' as const, label: 'Flowchart', icon: GitBranch },   // hidden for now
              { value: 'compare' as const, label: 'Compare', icon: ArrowLeftRight }]}
            versionSlot={<>
              <VersionSwitcher projectId={projectId} disabled={busy || !!project?.running} />
              {tobeFrozen && <LockHint text={`TO-BE v${project?.version?.version} is approved — view only. To change it, press Regenerate or ask in the chat: a new version is created with the same AS-IS, and this one stays as it is.`} />}
            </>}
            info={`${tobeSteps.length} steps · from ${asisSteps.length} AS-IS`}
            actions={<>
              <a className="ui-btn ui-btn--sm" href={BASE + projectsApi.currentExportUrl(projectId, 'tobe')} download>
                <FileSpreadsheet size={15} strokeWidth={1.8} /> Excel
              </a>
              <Button size="sm" icon={Download} onClick={() => {
                if (tab === 'flow' && flowRef.current) downloadSvg(flowRef.current, `${fileBase}-tobe-flowchart.svg`)
                else if (bpmnRef.current) downloadPng(bpmnRef.current, `${fileBase}-tobe-bpmn.png`)
              }}>{tab === 'flow' ? 'Flowchart' : 'BPMN'}</Button>
              <Button size="sm" icon={RotateCw} onClick={regenerateTobe}>Regenerate</Button>
            </>}
            onExpandToggle={tab === 'table' || tab === 'bpmn' ? () => setExpanded(true) : undefined}
            // approved: the switcher already says so (v2 · Approved) — no button
            primary={tobeFrozen ? undefined :
              <Button size="sm" variant="success" icon={CircleCheck}
                onClick={() => {
                  setApproveError(null)
                  updateProject.mutate({ status: 'tobe_approved' }, {
                    onSuccess: () => { qc.invalidateQueries({ queryKey: ['versions', projectId] }); qc.invalidateQueries({ queryKey: ['versions-all', projectId] })},
                    // the server refuses while an SPS check fails
                    onError: (err) => setApproveError(parseFailed(err)),
                  })
                }}>
                Approve
              </Button>
            }
          />

          {askNewVersion && project?.version && (
            <NewVersionDialog
              projectId={projectId}
              what="tobe"
              version={project.version.version}
              onCancel={() => setAskNewVersion(false)}
              onCreated={() => { setAskNewVersion(false); regenerate() }}
            />
          )}

          {deleted && (
            <Notice tone="info" action={
              <span style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" icon={Undo2} onClick={() => { saveTobe(deleted.before); setDeleted(null) }}>Undo</Button>
                <Button size="sm" variant="ghost" icon={X} onClick={() => setDeleted(null)}>Close</Button>
              </span>
            }>
              <TriangleAlert size={16} style={{ flexShrink: 0 }} />
              <span>{deleted.name} deleted.</span>
            </Notice>
          )}

          {approveError && (
            <Notice tone="danger" action={<IconButton icon={X} label="Dismiss" size="sm" onClick={() => setApproveError(null)} />}>
              <TriangleAlert size={16} style={{ flexShrink: 0 }} />
              <span>Not approved — the TO-BE fails the guideline: {approveError.join(' · ')}. Fix it in the chat or regenerate.</span>
            </Notice>
          )}

          {project && <TcvqBar project={project} onOpen={() => setTab('compare')} />}



          {/* ── Table / BPMN views ── */}
          {tab === 'table' && (
            <div style={{ marginTop: 10 }}>
              <TableViewer boldColumns={[2]} columns={tobeColumns} rows={tobeRows} sources={tobeSources} {...tobeEditProps} />
            </div>
          )}
          {tab === 'bpmn' && (
            <div style={{ marginTop: 10 }}>
              <BpmnViewer steps={tobeAsBpmn} />
            </div>
          )}

          {tab === 'flow' && (
            <div style={{ marginTop: 10 }} ref={flowRef}>
              <SpsFlowchart steps={tobeSteps} title={`${project?.name ?? ''} — TO-BE · প্রস্তাবিত প্রসেস ম্যাপ`} />
            </div>
          )}

          {/* ── Compare view ── */}
          {/* ── Compare: one table, each TO-BE step next to the AS-IS steps it replaces ── */}
          {tab === 'compare' && (
            <div style={{ marginTop: 4 }}>
              <CompareTable asis={asisSteps as AsIsStep[]} tobe={tobeSteps} />
              {/* the guideline's sheet 6, with the reason for every change — open on request */}
              {project && <div style={{ marginTop: 14 }}><MappingTable project={project} collapsed /></div>}
            </div>
          )}

          {/* Full-screen overlay via portal — table or BPMN based on active tab */}
          {expanded && createPortal(
            <div style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'var(--bg)', display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
                padding: '10px 20px', borderBottom: '1px solid var(--line)',
                background: 'var(--surface)',
              }}>
                <strong style={{ fontSize: 15, fontWeight: 600 }}>TO-BE Process</strong>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>{tobeSteps.length} steps</span>
                <Segmented value={tab === 'bpmn' ? 'bpmn' : 'table'} onChange={setTab} options={viewOptions} />
                <div style={{ flex: 1 }} />
                <Button size="sm" icon={X} onClick={() => setExpanded(false)}>Close</Button>
              </div>
              {tab === 'table' && (
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <TableViewer boldColumns={[2]} columns={tobeColumns} rows={tobeRows} sources={tobeSources} {...tobeEditProps} fullScreen />
                </div>
              )}
              {tab === 'bpmn' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                  <BpmnViewer steps={tobeAsBpmn} fullScreen />
                </div>
              )}
            </div>,
            document.body
          )}
        </>
      )}

      {/* Hidden off-screen BpmnViewer — always mounted so TO-BE BPMN SVG is available for download */}
      {tobeSteps.length > 0 && (
        <div
          ref={bpmnRef}
          style={{ position: 'fixed', left: '-9999px', top: 0, width: 800, opacity: 0, pointerEvents: 'none', overflow: 'hidden' }}
        >
          <BpmnViewer steps={tobeAsBpmn} />
        </div>
      )}
    </div>
  )
}
