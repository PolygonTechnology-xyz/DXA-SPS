import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { useNavigation } from '@/stores/navigation'
import { useSession } from '@/stores/session'
import { useToBeStore } from '@/stores/tobe'
import { projectsApi, REVIEW_FIELDS, type AsIsStep } from '@/api/projects'
import TableViewer from '@/components/viewer/TableViewer'
import ViewerToolbar from '@/components/viewer/ViewerToolbar'
import BpmnViewer from '@/components/viewer/BpmnViewer'
import { downloadSvg, downloadPng } from '@/utils/download'
import DownloadMenu from '@/components/viewer/DownloadMenu'
import { useWebSources } from '@/components/project/WebSources'
import { BASE } from '@/api/client'
import { runAsis, runReview } from '@/lib/asis'
import { coverage, reviewCellMeta, DIGITAL_LABEL } from '@/lib/asisReview'
// import AsIsReadiness from '@/components/project/AsIsReadiness'   // review panel hidden for now (see below)
import { GitBranch, ClipboardList, MessageSquare } from 'lucide-react'
import SpsFlowchart from '@/components/viewer/SpsFlowchart'
import { ProfileSheet, DocumentsSheet } from '@/components/project/SpsPanels'
import { STEP_TYPE_LABEL } from '@/lib/sps'
import { Download, FileSpreadsheet, RotateCw, RotateCcw, ArrowRight, Paperclip, Link, Search, Workflow, X, TriangleAlert, Table2, Waypoints, ChevronRight, CircleCheck, Trash2, Undo2 } from 'lucide-react'
import { Button, IconButton, Segmented, Notice, Spinner, collectSources } from '@/components/ui'
import { useProjectFiles } from '@/lib/files'
import { editAsisCell, newAsisStep } from '@/lib/tableEdit'
import { VersionSwitcher, NewVersionDialog, LockHint } from '@/components/project/Versions'

type InputMethod = 'none' | 'url' | 'search'

interface Props {
  projectId: string
}

export default function AsIsPane({ projectId }: Props) {
  const navigate = useNavigate()
  const { pendingAction, setPendingAction } = useNavigation()
  const qc = useQueryClient()
  const { isRunning, liveAsis, progressText } = useSession()

  const [inputMethod, setInputMethod] = useState<InputMethod>('none')
  const [url, setUrl] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [tab, setTab] = useState<'table' | 'bpmn' | 'flow' | 'sheets'>('table')
  const [parseError, setParseError] = useState<string | null>(null)
  const [showNoSourceWarning, setShowNoSourceWarning] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // approval gate: pending web findings block it, missing values ask for confirmation
  const [gate, setGate] = useState<null | 'pending' | 'missing'>(null)
  // the last deleted step, for Undo
  const [deleted, setDeleted] = useState<{ name: string; before: AsIsStep[] } | null>(null)
  // the project the AS-IS was auto-started for (once per project — React dev mode runs effects twice)
  const autoStarted = useRef<string | null>(null)
  // the last run's options, for "Try again" after a failure
  const lastRun = useRef<{ url?: string; query?: string; extra?: string } | null>(null)
  // a run that failed while started elsewhere (Overview, chat): show it here with "Try again"
  // instead of the source picker, which looks as if nothing had happened
  const asisError = useSession((st) => (st.asisError?.projectId === projectId ? st.asisError : null))
  useEffect(() => {
    if (!asisError) return
    lastRun.current = asisError.opts
    setParseError(asisError.message)
  }, [asisError])
  const bpmnRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<HTMLDivElement>(null)

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: !!projectId,
    // a run on the server (e.g. started before a reload): check until it ends
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  })

  // An AS-IS run the server is doing that this page did not start (the page was reloaded)
  const serverAsis = project?.running === 'asis' && !isRunning
  // While the TO-BE is being designed from this AS-IS, the AS-IS is read-only
  const tobeGenerating = useToBeStore((st) => st.stage === 'generating' && st.projectId === projectId)
  const tobeLocked = project?.running === 'tobe' || tobeGenerating
  // when a server run ends, show its consent card and questions in the chat
  const wasRunning = useRef(project?.running)
  useEffect(() => {
    if (wasRunning.current && !project?.running) qc.invalidateQueries({ queryKey: ['chat-messages', projectId] })
    wasRunning.current = project?.running
  }, [project?.running])

  // The AS-IS waits until every uploaded file is processed (busy = still converting / indexing)
  const { files: uploadedFiles, loaded: filesLoaded, busy: filesBusy, busyLabel } = useProjectFiles(projectId)

  const updateProject = useMutation({
    mutationFn: (patch: Parameters<typeof projectsApi.update>[1]) =>
      projectsApi.update(projectId, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  })

  const steps: AsIsStep[] = project?.asis_steps ?? []
  const hasFiles = uploadedFiles.length > 0
  // web sites the user accepted on the Knowledge page count as a source too
  const acceptedWeb = useWebSources(projectId).accepted.length
  const hasSources = hasFiles || acceptedWeb > 0
  // Until the project and its file list have arrived, "no steps" / "no files" mean "not loaded
  // yet" — showing the empty screens then makes them flash on every reload
  const loaded = !!project && filesLoaded
  const findings = project?.asis_findings ?? []
  const reviewed = !!project?.asis_review
  const cov = coverage(steps, findings)
  const isApproved = ['asis_approved', 'tobe_complete', 'tobe_approved'].includes(project?.status ?? '')
  // the open version's AS-IS is approved: view only — a change makes a new version first
  const asisFrozen = !!project?.version?.asis_locked
  const [askNewVersion, setAskNewVersion] = useState(false)
  // the table shows the review columns (pain point, digital, law) only on request
  const regenerateAsis = () => (asisFrozen ? setAskNewVersion(true) : startAnalysis())

  // Auto-start only when the user asked for it ("Go to AS-IS" on Files) — opening a project
  // from the list shows its state and a Generate button instead
  const location = useLocation()
  const askedToStart = !!(location.state as { autostart?: boolean } | null)?.autostart
  // from the Files page's "Start the AS-IS?" — make it again even though there are steps
  const askedToRegenerate = !!(location.state as { regenerate?: boolean } | null)?.regenerate
  useEffect(() => {
    if (
      askedToStart &&
      !!project &&
      filesLoaded &&
      hasSources &&
      !filesBusy &&
      (steps.length === 0 || (askedToRegenerate && !project?.version?.asis_locked)) &&
      !isRunning &&
      !project?.running &&
      autoStarted.current !== projectId
    ) {
      autoStarted.current = projectId
      startAnalysis()
      navigate(location.pathname, { replace: true, state: null })   // a reload does not start it again
    }
  }, [askedToStart, askedToRegenerate, !!project, project?.version?.asis_locked, filesLoaded, hasSources, filesBusy, steps.length, project?.running])

  // Execute action dispatched from ChatRail. Read the live store value so a
  // StrictMode double-run (which sees the same captured value) doesn't start it twice.
  // While files are still processing the request waits, then starts by itself.
  useEffect(() => {
    const action = useNavigation.getState().pendingAction
    if (action?.type === 'generate_asis' && !filesBusy) {
      setPendingAction(null)
      startAnalysis({ extra: action.input })
    }
  }, [pendingAction, filesBusy])

  // One entry point for every AS-IS run (web search + documents, cited). The shared
  // runner keeps going and saves even if the user leaves this tab.
  function startAnalysis(opts: { url?: string; query?: string; extra?: string } = {}) {
    if (!project) return
    // say why nothing starts instead of silently staying on this screen
    if (filesBusy) { setParseError('Your documents are still being processed — the AS-IS can start when they are ready.'); return }
    if (project.running || tobeLocked) { setParseError('Another analysis is running on this project — wait until it is finished.'); return }
    lastRun.current = opts
    setParseError(null)
    setShowNoSourceWarning(false)
    setInputMethod('none')
    runAsis({ projectId, name: project.name, description: project.description, ministry: project.ministry, department: project.department, ...opts })
      .then((r) => { if (!r.ok) setParseError(r.error ?? 'Analysis failed. Please try again.') })
  }

  function handleGenerate() {
    // no documents and no accepted web sites: the sources are chosen on the Knowledge page
    if (!hasSources && inputMethod === 'none') {
      setShowNoSourceWarning(true)
      return
    }
    startAnalysis(inputMethod === 'search' && searchQuery.trim() ? { query: searchQuery.trim() } : {})
  }

  // every column always shows — the review's pain point, digital status and law included
  const columns = ['Step', 'Actor', 'Action', 'Input', 'Time', 'Pain Point', 'Digital', 'Law (Government Order / Regulation / Judgement)']
  const REVIEW_COLUMN: Record<number, (typeof REVIEW_FIELDS)[number]> = { 5: 'pain_points', 6: 'digital_status', 7: 'legal_basis' }
  const toRows = (list: AsIsStep[], blank: string) => list.map((s) => {
    const pain = Array.isArray(s.pain_points)
      ? (s.pain_points as string[]).join('; ')
      : (s.pain_points ?? '')
    const digital = s.digital_status
      ? `${DIGITAL_LABEL[s.digital_status] ?? s.digital_status}${s.digital_note ? ` — ${s.digital_note}` : ''}`
      : ''
    // the guideline's step fields: type in the step badge; visit and fee next to the time
    const type = s.step_type && s.step_type !== 'activity' ? `${STEP_TYPE_LABEL[s.step_type]?.icon ?? ''} ` : ''
    const time = [s.time_days != null && String(s.time_days) !== '' ? `${s.time_days}d` : '', s.visit ? '🚶' : '', s.fee ? `৳${s.fee}` : ''].filter(Boolean).join(' · ') || '—'
    return [`${type}${s.step_number}`, s.actor, s.action, s.input ?? '—', time, pain || blank, digital || blank, s.legal_basis || blank]
  })
  const rows = toRows(steps, reviewed ? '' : '—')
  const cellMeta = (ri: number, ci: number) => {
    const field = REVIEW_COLUMN[ci]
    return field && steps[ri] ? reviewCellMeta(steps[ri], field, findings, reviewed) : undefined
  }

  const fileBase = (project?.name ?? 'asis').replace(/\s+/g, '-')
  const sources = collectSources(steps)

  // Approve: every web finding decided first; missing values only need a confirmation
  function approve(force = false) {
    if (isApproved) { navigate(`/projects/${projectId}/tobe`); return }
    if (cov.pending > 0) { setGate('pending'); return }
    if (cov.missing > 0 && !force) { setGate('missing'); return }
    setGate(null)
    updateProject.mutate({ status: 'asis_approved' }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['versions', projectId] }); qc.invalidateQueries({ queryKey: ['versions-all', projectId] })   // saved as a version in Outputs
        navigate(`/projects/${projectId}/tobe`, { state: { autostart: true } })
      },
      onError: () => setGate('pending'),   // the server found pending findings
    })
  }
  // Deleting a row deletes the step; the rest are renumbered (the server also closes
  // pending findings of that step)
  function saveSteps(next: AsIsStep[]) {
    qc.setQueryData(['project', projectId], (old: typeof project) => (old ? { ...old, asis_steps: next } : old))
    updateProject.mutate({ asis_steps: next })
  }
  function deleteStep(ri: number) {
    const step = steps[ri]
    if (!step) return
    setDeleted({ name: `Step ${step.step_number} “${step.step_name}”`, before: steps })
    saveSteps(steps.filter((_, i) => i !== ri).map((s, i) => ({ ...s, step_number: i + 1 })))
  }
  // Every edit in the table is saved right away
  function editCell(ri: number, ci: number, value: string) {
    if (!steps[ri]) return
    saveSteps(steps.map((s, i) => (i === ri ? editAsisCell(s, ci, value) : s)))
  }
  function addStep() {
    saveSteps([...steps, newAsisStep(steps.length + 1)])
  }
  function undoDelete() {
    if (!deleted) return
    saveSteps(deleted.before)
    setDeleted(null)
  }

  const openChat = () => useNavigation.getState().focusReview()
  // review questions waiting in the chat rail
  const reviewWaiting = useNavigation((s) => (s.reviewWaiting?.projectId === projectId ? s.reviewWaiting : null))
  const review = () => {
    setParseError(null)
    runReview(projectId).then((r) => { if (!r.ok) setParseError(r.error ?? 'Review failed. Please try again.') })
  }

  const sourceOptions = [
    { id: 'files' as const, icon: Paperclip, title: 'Upload a document', sub: 'PDF, Word, Excel, scans, images — go to Knowledge' },
    { id: 'url' as const, icon: Link, title: 'Add a web page', sub: 'A link with a short note of what to take from it' },
    { id: 'search' as const, icon: Search, title: 'Search the web', sub: 'Official sites are listed — you accept or reject each' },
  ]

  return (
    <div>

      {/* Error banner */}
      {parseError && !(steps.length === 0 && !hasSources && lastRun.current) && (
        <Notice action={
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {lastRun.current && steps.length === 0 && !isRunning && (
              <Button size="sm" variant="primary" icon={RotateCcw} onClick={() => startAnalysis(lastRun.current ?? {})}>Try again</Button>
            )}
            <IconButton icon={X} label="Dismiss" size="sm" onClick={() => setParseError(null)} />
          </span>
        }>
          <TriangleAlert size={16} /> {parseError}
        </Notice>
      )}

      {/* ── Running: the table fills in as the AI writes the steps, then the review columns.
             Nothing can be changed until it is finished. ── */}
      {isRunning && liveAsis && (
        <>
          <div className="ui-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', marginBottom: 10, borderColor: '#c7d2fe', background: 'var(--accent-soft)' }}>
            <Spinner size={16} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {liveAsis.phase === 'mapping'
                  ? `Mapping the AS-IS${liveAsis.steps.length ? ` · ${liveAsis.steps.length} step${liveAsis.steps.length > 1 ? 's' : ''} so far` : ''}`
                  : `Reviewing the AS-IS · ${liveAsis.reviewed} of ${liveAsis.steps.length} steps checked`}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                You can review, edit and approve it when it is finished{progressText ? ` · ${progressText}` : ''}
              </div>
            </div>
          </div>
          {liveAsis.steps.length > 0
            ? <TableViewer boldColumns={[2]} columns={columns} rows={toRows(liveAsis.steps, liveAsis.phase === 'review' ? '…' : '')} readOnly />
            : <div className="ui-card" style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13.5 }}>
                Reading your documents — the steps appear here as soon as they are written…
              </div>}
        </>
      )}

      {/* No-source warning modal */}
      {showNoSourceWarning && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(17,24,39,.4)',
          display: 'grid', placeItems: 'center', zIndex: 1000,
        }} onClick={() => setShowNoSourceWarning(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="ui-card"
            style={{ padding: 24, maxWidth: 440, width: '90%', boxShadow: '0 12px 40px rgba(16,24,40,.18)' }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 600 }}>No source provided</h3>
            <p style={{ margin: '0 0 18px', fontSize: 14, color: 'var(--muted)', lineHeight: 1.6 }}>
              To generate the AS-IS process the AI needs at least one source. Please choose one:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {sourceOptions.map(({ id, icon: Icon, title, sub }) => (
                <button
                  key={id}
                  className="ui-card ui-card--hover"
                  onClick={() => {
                    setShowNoSourceWarning(false)
                    navigate(`/projects/${projectId}/files`, { state: id === 'search' ? { webSearch: true } : id === 'url' ? { addLink: true } : null })
                  }}
                  style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px' }}
                >
                  <Icon size={18} strokeWidth={1.8} style={{ color: 'var(--accent)', marginTop: 2 }} />
                  <span>
                    <strong style={{ fontWeight: 600, fontSize: 14 }}>{title}</strong>
                    <span style={{ display: 'block', color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>{sub}</span>
                  </span>
                </button>
              ))}
            </div>
            <Button style={{ width: '100%' }} onClick={() => setShowNoSourceWarning(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Input area — only when no files uploaded and no steps yet */}
      {!loaded && !isRunning && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '28px 4px', color: 'var(--muted)', fontSize: 13.5 }}>
          <Spinner size={14} /> Loading the AS-IS…
        </div>
      )}

      {/* A run that just failed: say so here (with Try again) instead of falling back to
          the source picker, which looks as if nothing had happened */}
      {loaded && steps.length === 0 && !isRunning && !serverAsis && !hasSources && parseError && lastRun.current && (
        <div className="ui-card" style={{ padding: '32px 24px', textAlign: 'center' }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--danger-soft)', color: 'var(--danger)', display: 'inline-grid', placeItems: 'center', marginBottom: 12 }}>
            <TriangleAlert size={22} strokeWidth={1.8} />
          </span>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>The AS-IS could not be built from the web</h3>
          <p style={{ color: 'var(--muted)', margin: '0 auto 16px', fontSize: 14, maxWidth: 480, lineHeight: 1.6 }}>
            The search did not give a usable process this time, so nothing was saved. Try again, or upload the process documents.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="primary" icon={RotateCcw} onClick={() => startAnalysis(lastRun.current ?? {})}>Try again</Button>
            <Button icon={Paperclip} onClick={() => navigate(`/projects/${projectId}/files`)}>Upload documents</Button>
            <Button variant="ghost" onClick={() => { setParseError(null); lastRun.current = null; useSession.getState().setAsisError(null) }}>Choose another source</Button>
          </div>
        </div>
      )}

      {/* No sources yet: they are chosen on the Knowledge page — nothing is mapped until the user starts it */}
      {loaded && steps.length === 0 && !isRunning && !serverAsis && !hasSources && !(parseError && lastRun.current) && (
        <div className="ui-card" style={{ padding: '28px 24px', textAlign: 'center' }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'inline-grid', placeItems: 'center', marginBottom: 12 }}>
            <Workflow size={22} strokeWidth={1.8} />
          </span>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>No sources yet</h3>
          <p style={{ color: 'var(--muted)', margin: '0 auto 16px', fontSize: 14, maxWidth: 480, lineHeight: 1.6 }}>
            The AS-IS is made from the documents you upload and the web sites you accept on the Knowledge page.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, textAlign: 'left' }}>
            {sourceOptions.map(({ id, icon: Icon, title, sub }) => (
              <button key={id} className="ui-card ui-card--hover"
                onClick={() => navigate(`/projects/${projectId}/files`, { state: id === 'search' ? { webSearch: true } : id === 'url' ? { addLink: true } : null })}
                style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
                  <Icon size={17} strokeWidth={1.8} />
                </span>
                <strong style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{title}</strong>
                <small style={{ color: 'var(--muted)', fontSize: 12.5 }}>{sub}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Files still being processed: the AS-IS waits for all of them */}
      {filesBusy && !isRunning && (
        <Notice tone="info">
          <Spinner size={14} />
          <span>{busyLabel}</span>
        </Notice>
      )}

      {/* A run the server is still doing (this page was reloaded): wait for it */}
      {serverAsis && (
        <Notice tone="info">
          <Spinner size={14} />
          <span>The AS-IS is being analysed on the server — it appears here when it is finished.</span>
        </Notice>
      )}

      {/* While the TO-BE is designed from this AS-IS, the AS-IS can't change */}
      {tobeLocked && steps.length > 0 && (
        <Notice tone="info">
          <Spinner size={14} />
          <span>The TO-BE is being designed from this AS-IS — the AS-IS is read-only until it is finished.</span>
        </Notice>
      )}

      {/* No AS-IS yet, documents ready: the user starts it */}
      {steps.length === 0 && !isRunning && !serverAsis && hasSources && filesLoaded && !filesBusy && (
        <div className="ui-card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'inline-grid', placeItems: 'center', marginBottom: 14 }}>
            <Workflow size={22} strokeWidth={1.8} />
          </span>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>No AS-IS process yet</h3>
          <p style={{ color: 'var(--muted)', margin: '0 auto 16px', fontSize: 14, maxWidth: 460, lineHeight: 1.6 }}>
            {[hasFiles ? `${uploadedFiles.length} document${uploadedFiles.length > 1 ? 's' : ''}` : '', acceptedWeb ? `${acceptedWeb} accepted web source${acceptedWeb > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ')} ready. The AI maps the current process from them, step by step, with a reference for every step.
          </p>
          <Button variant="primary" icon={Workflow} onClick={() => startAnalysis()} style={{ height: 42, padding: '0 20px' }}>Generate AS-IS process</Button>
        </div>
      )}

      {steps.length > 0 && !isRunning && !serverAsis && (
        <>
          <ViewerToolbar
            tab={tab}
            onTabChange={setTab}
            versionSlot={<>
              <VersionSwitcher projectId={projectId} disabled={isRunning || !!project?.running || tobeLocked} />
              {asisFrozen && <LockHint text={`AS-IS v${project?.version?.version} is approved — view only. To change it, press Regenerate or ask in the chat: a new version is created and this one stays as it is.`} />}
            </>}
            tabs={[
              { value: 'table', label: 'Table', icon: Table2 },
              { value: 'bpmn', label: 'BPMN', icon: Waypoints },
              // hidden for now — uncomment to show the guideline flowchart and the SPS sheets again
              // { value: 'flow', label: 'Flowchart', icon: GitBranch },
              // { value: 'sheets', label: 'Sheets', icon: ClipboardList },
            ]}
            actions={<>
              <DownloadMenu items={[
                { label: 'Excel (table)', icon: FileSpreadsheet, href: BASE + projectsApi.currentExportUrl(projectId, 'asis') },
                { label: 'BPMN diagram (PNG)', icon: Waypoints, onClick: () => { if (bpmnRef.current) downloadPng(bpmnRef.current, `${fileBase}-bpmn.png`) } },
                ...(tab === 'flow' ? [{ label: 'Flowchart (SVG)', icon: Download, onClick: () => { if (flowRef.current) downloadSvg(flowRef.current, `${fileBase}-flowchart.svg`) } }] : []),
              ]} />
              <Button size="sm" icon={RotateCw} disabled={filesBusy || tobeLocked} title={filesBusy ? busyLabel : undefined} onClick={regenerateAsis}>Regenerate</Button>
            </>}
            onExpandToggle={() => { if (tab === 'flow' || tab === 'sheets') setTab('table'); setExpanded(true) }}
            // approved: the TO-BE is in the left menu — no button here
            primary={isApproved ? undefined
              : <Button size="sm" variant="primary" icon={CircleCheck} disabled={tobeLocked} onClick={() => approve()}>Approve &amp; continue</Button>}
          />

          {askNewVersion && project?.version && (
            <NewVersionDialog
              projectId={projectId}
              what="asis"
              version={project.version.version}
              onCancel={() => setAskNewVersion(false)}
              onCreated={() => { setAskNewVersion(false); startAnalysis(lastRun.current ?? {}) }}
            />
          )}

          {reviewWaiting && !isApproved && gate !== 'pending' && (
            <button type="button" className="rv-banner" onClick={openChat}>
              <span className="rv-banner__icon"><MessageSquare size={17} strokeWidth={2} /><span className="rv-banner__count">{reviewWaiting.open}</span></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>The assistant has {reviewWaiting.open} question{reviewWaiting.open > 1 ? 's' : ''} about this AS-IS</strong>
                <small>{reviewWaiting.topic ? `Starting with ${reviewWaiting.topic.toLowerCase()} — ` : ''}your answers fill the empty cells in the table.</small>
              </span>
              <span className="rv-banner__go">Answer in chat <ArrowRight size={15} /></span>
            </button>
          )}
          {gate === 'pending' && (
            <Notice tone="warn" action={<Button size="sm" variant="primary" icon={ArrowRight} onClick={openChat}>Answer in chat</Button>}>
              <TriangleAlert size={16} style={{ flexShrink: 0 }} />
              <span>Answer the {cov.pending} open item{cov.pending > 1 ? 's' : ''} in the chat (web suggestions: Use / Don't use · values with no source: Yes / No / Skip) before approving the AS-IS.</span>
            </Notice>
          )}
          {gate === 'missing' && (
            <Notice tone="warn" action={
              <span style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" variant="primary" onClick={() => approve(true)}>Approve anyway</Button>
                <Button size="sm" variant="ghost" onClick={() => setGate(null)}>Cancel</Button>
              </span>
            }>
              <TriangleAlert size={16} style={{ flexShrink: 0 }} />
              <span>{cov.missing} value{cov.missing > 1 ? 's are' : ' is'} still not found (pain point, digital status or law). The TO-BE will be designed without {cov.missing > 1 ? 'them' : 'it'}. Approve anyway?</span>
            </Notice>
          )}

          {deleted && (
            <Notice tone="info" action={
              <span style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" icon={Undo2} onClick={undoDelete}>Undo</Button>
                <IconButton icon={X} label="Dismiss" size="sm" onClick={() => setDeleted(null)} />
              </span>
            }>
              <Trash2 size={16} style={{ flexShrink: 0 }} />
              <span>{deleted.name} deleted.</span>
            </Notice>
          )}

          {/* AS-IS review panel — hidden for now; uncomment (and its import) to bring it back
          {project && <AsIsReadiness project={project} steps={steps} onReview={review} onOpenChat={openChat} />}
          */}

          <div style={{ marginTop: 10 }}>
            {tab === 'table' && (
              <TableViewer boldColumns={[2]}
                columns={columns}
                rows={rows}
                sources={sources}
                cellMeta={cellMeta}
                onDeleteRow={tobeLocked || asisFrozen ? undefined : deleteStep}
                    onCellChange={editCell}
                    onAddRow={addStep}
                readOnly={tobeLocked || asisFrozen}
              />
            )}
            {tab === 'bpmn' && <BpmnViewer steps={steps} />}
            {tab === 'flow' && <div ref={flowRef}><SpsFlowchart steps={steps} title={`${project?.name ?? ''} — AS-IS · বিদ্যমান প্রসেস ম্যাপ`} /></div>}
            {tab === 'sheets' && project && <><ProfileSheet project={project} /><DocumentsSheet project={project} /></>}
          </div>

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
                <strong style={{ fontSize: 15, fontWeight: 600 }}>AS-IS Process</strong>
                <Segmented value={tab === 'bpmn' ? 'bpmn' : 'table'} onChange={setTab} options={[
                  { value: 'table', label: 'Table', icon: Table2 },
                  { value: 'bpmn', label: 'BPMN', icon: Waypoints },
                ]} />
                <div style={{ flex: 1 }} />
                <Button size="sm" icon={X} onClick={() => setExpanded(false)}>Close</Button>
              </div>
              {tab === 'table' && (
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <TableViewer boldColumns={[2]}
                    columns={columns}
                    rows={rows}
                    sources={sources}
                    cellMeta={cellMeta}
                    onDeleteRow={tobeLocked || asisFrozen ? undefined : deleteStep}
                    onCellChange={editCell}
                    onAddRow={addStep}
                    readOnly={tobeLocked || asisFrozen}
                    fullScreen
                  />
                </div>
              )}
              {tab === 'bpmn' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                  <BpmnViewer steps={steps} fullScreen />
                </div>
              )}
            </div>,
            document.body
          )}
        </>
      )}

      {/* Hidden off-screen BpmnViewer — always mounted so BPMN SVG is available for download */}
      {steps.length > 0 && (
        <div
          ref={bpmnRef}
          style={{ position: 'fixed', left: '-9999px', top: 0, width: 800, opacity: 0, pointerEvents: 'none', overflow: 'hidden' }}
        >
          <BpmnViewer steps={steps} />
        </div>
      )}
    </div>
  )
}
