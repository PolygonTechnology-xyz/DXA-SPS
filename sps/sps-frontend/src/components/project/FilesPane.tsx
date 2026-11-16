import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { projectsApi, type ProjectFile, type WebSource } from '@/api/projects'
import { useProjectFiles, UPLOAD_ACCEPT } from '@/lib/files'
import { FileText, FileSpreadsheet, Image, File as FileIcon, Download, Trash2, ArrowRight, CircleCheck, Eye, TriangleAlert, RotateCw, Workflow, Plus, Upload, Search, Globe, Check, X, Undo2, ChevronDown, ExternalLink, Sparkles, FolderOpen, type LucideIcon } from 'lucide-react'
import { Button, IconButton, PageHeader, Spinner } from '@/components/ui'
import { useVersions, nextVersion, refreshAfterVersionChange } from '@/components/project/Versions'
import { useWebSources, useWebSourceActions, host } from '@/components/project/WebSources'
import AddSourcesDialog, { type SourceView } from '@/components/project/AddSourcesDialog'

function formatSize(bytes: number): string {
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
  return Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

function formatWhen(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return { Icon: FileText, color: '#dc2626', label: 'PDF', bg: '#fef2f2' }
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return { Icon: FileText, color: '#2563eb', label: 'Word', bg: '#eff6ff' }
  if (['txt', 'md'].includes(ext)) return { Icon: FileText, color: '#2563eb', label: 'Text', bg: '#eff6ff' }
  if (['xls', 'xlsx', 'xlsm', 'ods', 'csv'].includes(ext)) return { Icon: FileSpreadsheet, color: '#16a34a', label: 'Spreadsheet', bg: '#f0fdf4' }
  if (['ppt', 'pptx', 'odp'].includes(ext)) return { Icon: FileText, color: '#ea580c', label: 'Slides', bg: '#fff7ed' }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'bmp'].includes(ext)) return { Icon: Image, color: '#9333ea', label: 'Image', bg: '#faf5ff' }
  return { Icon: FileIcon, color: 'var(--muted)', label: ext.toUpperCase() || 'File', bg: '#f3f4f6' }
}

interface Props {
  projectId: string
  /** The shared Global Knowledge library (laws, rules, circulars used by every project) */
  library?: boolean
}

type Origin = 'all' | 'files' | 'web'

export default function FilesPane({ projectId, library }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  // "Go to AS-IS" asks first: it starts the AI on these documents
  const [confirmStart, setConfirmStart] = useState(false)
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState<string[]>([])
  const [uploadError, setUploadError] = useState('')
  const [addOpen, setAddOpen] = useState<SourceView | null>(null)
  const [filter, setFilter] = useState('')
  const [origin, setOrigin] = useState<Origin>('all')
  const [showRejected, setShowRejected] = useState(false)

  // files are converted and indexed in the background — the list refreshes until all are done
  const { files, isLoading, busy, busyLabel, failed } = useProjectFiles(projectId)
  const web = useWebSources(library ? '' : projectId)
  const ws = useWebSourceActions(library ? '' : projectId)
  const retry = (fileId: string) => projectsApi.retryFile(projectId, fileId).then(() => qc.invalidateQueries({ queryKey: ['files', projectId] }))

  // arriving from the Overview ("Add sources") or the AS-IS ("Let me search the web" / "Share a web page")
  const asked = location.state as { webSearch?: boolean; addLink?: boolean; addSources?: boolean } | null
  const started = useRef(false)
  useEffect(() => {
    if (library || started.current || !asked) return
    if (asked.webSearch && !web.defaultQuery) return   // the search waits for the service name
    // started on the next tick: React's development double-mount runs this effect, its cleanup
    // and the effect again — starting at once would cancel the search in that cleanup
    const t = window.setTimeout(() => {
      started.current = true
      if (asked.webSearch) ws.search(web.defaultQuery)
      if (asked.addLink) setAddOpen('link')
      if (asked.addSources) setAddOpen('menu')
      navigate(location.pathname, { replace: true, state: null })   // a reload does not search again
    }, 0)
    return () => clearTimeout(t)
  }, [asked, web.defaultQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => projectsApi.deleteFile(projectId, fileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['files', projectId] })
      qc.invalidateQueries({ queryKey: ['project', projectId] }) // AS-IS may now be out of date
    },
  })

  async function uploadFiles(raw: FileList | null) {
    if (!raw || raw.length === 0 || !projectId) return
    const list = Array.from(raw)
    setUploading(list.map((f) => f.name))
    setUploadError('')
    try {
      // each file on its own: one failed upload does not stop the others
      const results = await Promise.allSettled(list.map((f) => projectsApi.uploadFile(projectId, f)))
      const failedNames = list.filter((_, i) => results[i].status === 'rejected').map((f) => f.name)
      if (failedNames.length) setUploadError(`Could not upload: ${failedNames.join(', ')}. Check that the server is running and try again.`)
    } finally {
      qc.invalidateQueries({ queryKey: ['files', projectId] })
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      setUploading([])
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  if (!projectId) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>No project selected.</p>
  }

  // search box + origin filter apply to every list
  const needle = filter.trim().toLowerCase()
  const matchWeb = (s: WebSource) => origin !== 'files' && (!needle || `${s.title} ${s.summary} ${s.url}`.toLowerCase().includes(needle))
  const matchFile = (f: ProjectFile) => origin !== 'web' && (!needle || f.name.toLowerCase().includes(needle))
  const pending = web.pending.filter(matchWeb)
  const accepted = web.accepted.filter(matchWeb)
  const rejected = web.rejected.filter(matchWeb)
  const shownFiles = files.filter(matchFile)
  const docCount = files.length + web.accepted.length
  const shownCount = shownFiles.length + accepted.length

  return (
    <div
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); uploadFiles(e.dataTransfer.files) }}
      className={dragging ? 'kb-page kb-page--drop' : 'kb-page'}
    >
      <input ref={inputRef} type="file" multiple accept={UPLOAD_ACCEPT} hidden onChange={(e) => uploadFiles(e.target.files)} />
      <PageHeader
        title="Knowledge"
        subtitle={library
          ? 'Laws, rules, circulars and guidelines shared by every project (e.g. the SPS guideline, Secretariat Instructions, GRS). The agents search them for the legal basis and SPS rules, and cite them as K1, K2…'
          : undefined}
        actions={library
          ? <Button variant="primary" icon={Upload} onClick={() => inputRef.current?.click()}>Add files</Button>
          : <Button variant="primary" icon={Plus} onClick={() => setAddOpen('menu')}>Add sources</Button>}
      />

      {/* search + origin */}
      <div className="kb-tools">
        <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 0 }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input className="ui-input" value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder={library ? 'Search titles' : 'Search titles and summaries'} style={{ paddingLeft: 32 }} />
        </div>
        {!library && (
          <label className="kb-origin">
            <span>Origin</span>
            <select value={origin} onChange={(e) => setOrigin(e.target.value as Origin)}>
              <option value="all">All</option>
              <option value="files">Files</option>
              <option value="web">Web pages</option>
            </select>
            <ChevronDown size={14} />
          </label>
        )}
      </div>

      {/* what is happening now */}
      {uploading.length > 0 && (
        <div className="ws-status"><Spinner size={13} /> Uploading {uploading.length === 1 ? uploading[0] : `${uploading.length} files`}…</div>
      )}
      {uploadError && <div className="ws-status" style={{ color: 'var(--danger)' }}>{uploadError}</div>}
      {ws.searching && <div className="ws-status"><Spinner size={13} /> {ws.searching}</div>}
      {ws.note && !ws.searching && <div className="ws-status" style={{ color: ws.note.tone === 'danger' ? 'var(--danger)' : 'var(--ink-2)' }}>{ws.note.text}</div>}

      {/* sites the agent found — nothing is used until accepted */}
      {!library && pending.length > 0 && (
        <section className="ui-card kb-card kb-card--suggest">
          <CardHead icon={Sparkles} title="Suggested by the agent" count={pending.length} sub="Used only after you accept">
            {pending.length > 1 && <>
              <Button size="sm" variant="primary" icon={Check} onClick={() => ws.decide(pending, 'accepted')}>Accept all</Button>
              <Button size="sm" variant="danger" icon={X} onClick={() => ws.decide(pending, 'rejected')}>Reject all</Button>
            </>}
          </CardHead>
          <div className="kb-list">
            {pending.map((s) => (
              <WebRow key={s.id} source={s}>
                <Button size="sm" variant="primary" icon={Check} onClick={() => ws.decide([s], 'accepted')}>Accept</Button>
                <Button size="sm" variant="danger" icon={X} onClick={() => ws.decide([s], 'rejected')}>Reject</Button>
              </WebRow>
            ))}
          </div>
        </section>
      )}

      {/* everything the agents use */}
      <section className="ui-card kb-card">
        <CardHead icon={FolderOpen} title={library ? 'Library documents' : 'Your documents'}
          count={needle || origin !== 'all' ? `${shownCount} of ${docCount}` : docCount}
          sub={library ? undefined : 'What the agents read and cite'} />
        {isLoading ? (
          <p className="kb-empty">Loading…</p>
        ) : shownCount === 0 ? (
          <p className="kb-empty">
            {docCount ? 'Nothing matches your search.' : <>No documents yet. Select <strong>{library ? 'Add files' : 'Add sources'}</strong> to begin, or drop files anywhere on this page.</>}
          </p>
        ) : (
          <div className="kb-list">
            {shownFiles.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                projectId={projectId}
                onRetry={() => retry(f.id)}
                onDelete={() => {
                  if (confirm(`Delete "${f.name}"?`)) deleteMutation.mutate(f.id)
                }}
              />
            ))}
            {accepted.map((s) => (
              <WebRow key={s.id} source={s}>
                <Button size="sm" variant="ghost" icon={Undo2} onClick={() => ws.decide([s], 'pending')}>Undo</Button>
              </WebRow>
            ))}
          </div>
        )}

        {!library && rejected.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <button type="button" className="ws-toggle" onClick={() => setShowRejected((v) => !v)}>
              <ChevronDown size={14} style={{ transform: showRejected ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
              {rejected.length} rejected site{rejected.length > 1 ? 's' : ''}
            </button>
            {showRejected && (
              <div className="kb-list" style={{ marginTop: 6, opacity: .65 }}>
                {rejected.map((s) => (
                  <WebRow key={s.id} source={s}>
                    <Button size="sm" variant="ghost" icon={Undo2} onClick={() => ws.decide([s], 'pending')}>Restore</Button>
                  </WebRow>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Next step — only once every file is processed */}
      {!library && <div className="ui-card" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        padding: '14px 16px', margin: '8px 0 20px',
      }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{busy || uploading.length ? 'Preparing your documents…' : 'Ready to analyse?'}</p>
          {/* only progress and problems — no status summary */}
          {(busy || uploading.length > 0 || failed.length > 0) && (
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              {busy || uploading.length
                ? <><Spinner size={12} /> {uploading.length ? `Uploading ${uploading.length} file${uploading.length > 1 ? 's' : ''}…` : busyLabel}</>
                : `${failed.length} file${failed.length > 1 ? 's' : ''} could not be read and will be left out — retry or remove ${failed.length > 1 ? 'them' : 'it'}.`}
            </p>
          )}
        </div>
        <Button variant="primary" iconRight={ArrowRight} disabled={busy || uploading.length > 0} onClick={() => setConfirmStart(true)}>Go to AS-IS</Button>
      </div>}

      {addOpen && (
        <AddSourcesDialog
          initialView={addOpen}
          defaultQuery={web.defaultQuery}
          onClose={() => setAddOpen(null)}
          onFiles={uploadFiles}
          onSearch={ws.search}
          onLink={ws.addLink}
        />
      )}
      {confirmStart && <StartAsisDialog projectId={projectId} onClose={() => setConfirmStart(false)} />}
    </div>
  )
}

/** Card title row: icon, bold title, count badge, short note, actions on the right */
function CardHead({ icon: Icon, title, count, sub, children }: { icon: LucideIcon; title: string; count: number | string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="kb-card__head">
      <span className="kb-card__icon"><Icon size={16} strokeWidth={2} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 className="kb-card__title">{title} <span className="kb-badge">{count}</span></h3>
        {sub && <p className="kb-card__sub">{sub}</p>}
      </div>
      {children && <div className="kb-card__actions">{children}</div>}
    </div>
  )
}

/** A web page: suggested, accepted (used by the AS-IS) or rejected */
function WebRow({ source, children }: { source: WebSource; children: React.ReactNode }) {
  return (
    <div className="kb-row">
      <span className="kb-row__icon" style={{ color: 'var(--accent)', background: 'var(--accent-soft)' }}><Globe size={18} strokeWidth={1.8} /></span>
      <div className="kb-row__main">
        <a href={source.url} target="_blank" rel="noreferrer" className="kb-row__title" title={source.url}>
          {source.title || host(source.url)} <ExternalLink size={12} />
        </a>
        <p className="kb-row__sub"><span className="kb-row__host">{host(source.url)}.</span> {source.summary}</p>
      </div>
      <div className="kb-row__actions">{children}</div>
    </div>
  )
}

function FileRow({
  file,
  projectId,
  onRetry,
  onDelete,
}: {
  file: ProjectFile
  projectId: string
  onRetry: () => void
  onDelete: () => void
}) {
  const { Icon, color, label, bg } = fileIcon(file.name)
  return (
    <div className="kb-row">
      <span className="kb-row__icon" style={{ color, background: bg }}><Icon size={18} strokeWidth={1.8} /></span>
      <div className="kb-row__main">
        <p className="kb-row__title" style={{ margin: 0 }} title={file.name}>{file.name}</p>
        <p className="kb-row__meta">
          <span className="kb-tag"><FileIcon size={11} /> {label}</span>
          <span>{formatSize(file.size)} · {formatWhen(file.created_at)}</span>
        </p>
        <FileStatus file={file} />
      </div>
      <div className="kb-row__actions">
        {file.status === 'failed' && <Button size="sm" icon={RotateCw} onClick={onRetry}>Retry</Button>}
        <a
          href={projectsApi.downloadUrl(projectId, file.id)}
          download={file.name}
          className="ui-icon-btn"
          title="Download"
          aria-label="Download"
        >
          <Download size={17} strokeWidth={1.8} />
        </a>
        <IconButton icon={Trash2} label="Delete file" danger onClick={onDelete} />
      </div>
    </div>
  )
}

function FileStatus({ file }: { file: ProjectFile }) {
  if (!file.status) return null
  // ready ("1 page · searchable") and image-read ("scanned or legacy-font text…") notes — hidden for now; delete this line to show them again
  if (file.status === 'ready' || file.status === 'visual') return null
  const look = {
    processing: { Icon: null, color: 'var(--muted)' },
    ready: { Icon: CircleCheck, color: '#15803d' },
    visual: { Icon: Eye, color: 'var(--warn)' },
    failed: { Icon: TriangleAlert, color: 'var(--danger)' },
    unsupported: { Icon: TriangleAlert, color: 'var(--danger)' },
  }[file.status]
  return (
    <p style={{ margin: '3px 0 0', fontSize: 12, color: look.color, display: 'flex', alignItems: 'center', gap: 5 }}>
      {look.Icon ? <look.Icon size={13} strokeWidth={2} style={{ flexShrink: 0 }} /> : <Spinner size={12} />}
      <span>{file.status_note || file.status}</span>
    </p>
  )
}

/**
 * "Start the AS-IS?" from the Files page. No AS-IS yet → it starts. An approved AS-IS → a new
 * AS-IS version is made first (the approved one stays as it is). An AS-IS draft → it is made
 * again in place (there is only ever one draft).
 */
function StartAsisDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => projectsApi.get(projectId) })
  const { data: versions } = useVersions(projectId)
  const { files } = useProjectFiles(projectId)
  const accepted = useWebSources(projectId).accepted.length
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const hasAsis = (project?.asis_steps?.length ?? 0) > 0
  const open = project?.version
  const locked = !!open?.asis_locked
  const next = nextVersion(versions)

  function start() {
    setBusy(true)
    setError('')
    const ready = locked
      ? projectsApi.newVersion(projectId, 'asis').then(async () => {
          refreshAfterVersionChange(qc, projectId)
          await qc.refetchQueries({ queryKey: ['project', projectId] })
        })
      : Promise.resolve()
    ready
      // regenerate: start even though the (new or draft) version already has steps
      .then(() => navigate(`/projects/${projectId}/asis`, { state: { autostart: true, regenerate: hasAsis } }))
      .catch(() => { setError('The new version could not be created. Please try again.'); setBusy(false) })
  }

  return (
    <div onClick={() => { if (!busy) onClose() }} onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(17,24,39,.4)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="ui-card"
        style={{ position: 'relative', padding: 22, maxWidth: 440, width: '100%', boxShadow: '0 12px 40px rgba(16,24,40,.18)' }}>
        {/* close: nothing starts, the user stays on the Files page */}
        <IconButton icon={X} label="Close" size="sm" disabled={busy} onClick={onClose}
          style={{ position: 'absolute', top: 10, right: 10 }} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', paddingRight: 24 }}>
          <span style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Workflow size={17} strokeWidth={1.9} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: '2px 0 6px', fontSize: 16, fontWeight: 600 }}>Start the AS-IS?</h3>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
              {files.length || accepted
                ? <>The AI maps the current process from your {[files.length ? `${files.length} document${files.length === 1 ? '' : 's'}` : '', accepted ? `${accepted} accepted web source${accepted === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')}, with a reference for every step.</>
                : <>Nothing to map from yet — upload a document or accept a web source first.</>}
            </p>
            {hasAsis && locked && (
              <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                A new AS-IS version <strong>v{next.number}</strong> will be created; the approved v{open?.version} stays as it is.
                {next.replaces && <span style={{ display: 'block', color: '#b45309', marginTop: 4, fontSize: 13 }}>v{next.number} is an AS-IS draft that is not approved yet — it will be replaced.</span>}
              </p>
            )}
            {hasAsis && !locked && (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: '#b45309', lineHeight: 1.5 }}>
                The AS-IS draft v{open?.version} (not approved yet) will be made again from the documents.
              </p>
            )}
            {error && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <Button variant="primary" icon={Workflow} loading={busy} autoFocus onClick={start} disabled={!files.length && !accepted}>
            {hasAsis && locked ? `OK, create v${next.number} and start` : 'OK, start the AS-IS'}
          </Button>
        </div>
      </div>
    </div>
  )
}
