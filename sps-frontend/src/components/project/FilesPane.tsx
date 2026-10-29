import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { projectsApi, type ProjectFile } from '@/api/projects'
import { useProjectFiles, UPLOAD_ACCEPT } from '@/lib/files'
import { FileText, FileSpreadsheet, Image, File as FileIcon, UploadCloud, Download, Trash2, ArrowRight, CircleCheck, Eye, TriangleAlert, RotateCw, Workflow } from 'lucide-react'
import { Button, IconButton, PageHeader, Spinner } from '@/components/ui'
import { useVersions, nextVersion, refreshAfterVersionChange } from '@/components/project/Versions'
import WebSources, { useWebSources } from '@/components/project/WebSources'

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
  if (ext === 'pdf') return { Icon: FileText, color: '#dc2626', bg: '#fef2f2' }
  if (['doc', 'docx', 'txt', 'md'].includes(ext)) return { Icon: FileText, color: '#2563eb', bg: '#eff6ff' }
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { Icon: FileSpreadsheet, color: '#16a34a', bg: '#f0fdf4' }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return { Icon: Image, color: '#9333ea', bg: '#faf5ff' }
  return { Icon: FileIcon, color: 'var(--muted)', bg: '#f3f4f6' }
}

interface Props {
  projectId: string
  /** The shared Global Knowledge library (laws, rules, circulars used by every project) */
  library?: boolean
}

export default function FilesPane({ projectId, library }: Props) {
  const navigate = useNavigate()
  // "Go to AS-IS" asks first: it starts the AI on these documents
  const [confirmStart, setConfirmStart] = useState(false)
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState<string[]>([])
  const [uploadError, setUploadError] = useState('')

  // files are converted and indexed in the background — the list refreshes until all are done
  const { files, isLoading, busy, busyLabel, failed } = useProjectFiles(projectId)
  const counts = {
    ready: files.filter((f) => f.status === 'ready').length,
    visual: files.filter((f) => f.status === 'visual').length,
    processing: files.filter((f) => !f.status || f.status === 'processing').length,
    failed: files.filter((f) => f.status === 'failed' || f.status === 'unsupported').length,
  }
  const retry = (fileId: string) => projectsApi.retryFile(projectId, fileId).then(() => qc.invalidateQueries({ queryKey: ['files', projectId] }))

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

  return (
    <div>
      <PageHeader
        title={library ? 'Global Knowledge' : 'Knowledge'}
        subtitle={library
          ? 'Laws, rules, circulars and guidelines shared by every project (e.g. the SPS guideline, Secretariat Instructions, GRS). The agents search them for the legal basis and SPS rules, and cite them as K1, K2…'
          : undefined}
      />

      {/* documents and web sources side by side, then the AS-IS button below both */}
      <div className={library ? undefined : 'kb-cols'}>
        <section className={library ? undefined : 'ui-card kb-docs kb-col'}>
          {!library && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <FileText size={16} strokeWidth={1.9} />
              </span>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Documents</h3>
            </div>
          )}

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); uploadFiles(e.dataTransfer.files) }}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `1.5px dashed ${dragging ? 'var(--accent)' : 'var(--line-strong)'}`,
              borderRadius: 'var(--radius)',
              padding: '22px 16px',
              background: dragging ? 'var(--accent-soft)' : 'var(--surface)',
              cursor: 'pointer',
              textAlign: 'center',
              marginBottom: 14,
              transition: 'border-color .15s, background .15s',
            }}
          >
            <input ref={inputRef} type="file" multiple accept={UPLOAD_ACCEPT} hidden onChange={(e) => uploadFiles(e.target.files)} />
            <span style={{ width: 42, height: 42, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'inline-grid', placeItems: 'center', marginBottom: 10 }}>
              <UploadCloud size={21} strokeWidth={1.8} />
            </span>
            <p style={{ margin: 0, color: 'var(--ink)', fontSize: 14, fontWeight: 500 }}>
              Drop files here or <span style={{ color: 'var(--accent)' }}>click to upload</span>
            </p>
            <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12 }}>
              PDF, Word, Excel, PowerPoint, text and images (photos, screenshots, flowcharts) — scanned pages and Bangla are read too
            </p>
          </div>

          {/* uploads and the file list scroll inside the box; the drop zone stays */}
          <div className={library ? undefined : 'kb-scroll'}>
          {/* Upload progress */}
          {uploading.length > 0 && (
            <div className="ui-card" style={{ padding: '12px 16px', marginBottom: 12 }}>
              <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>
                Uploading {uploading.length} file{uploading.length > 1 ? 's' : ''}…
              </p>
              {uploading.map((name) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 0' }}>
                  <Spinner size={13} />
                  <span>{name}</span>
                </div>
              ))}
            </div>
          )}

          {uploadError && (
            <div className="ui-card" style={{ padding: '10px 14px', marginBottom: 12, borderColor: 'var(--danger-line)', background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 13 }}>
              {uploadError}
            </div>
          )}
          {/* File list */}
          {isLoading ? (
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>Loading files…</p>
          ) : files.length === 0 ? null : (
            <>
            {/* how many files, and what the AI can do with them */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '0 0 10px', fontSize: 13 }}>
              <strong style={{ fontSize: 14 }}>{files.length} file{files.length === 1 ? '' : 's'} uploaded</strong>
              <span style={{ color: 'var(--muted)' }}>
                {[
                  counts.ready && `${counts.ready} ready`,
                  counts.visual && `${counts.visual} read as images`,
                  counts.processing && `${counts.processing} processing`,
                  counts.failed && `${counts.failed} failed`,
                ].filter(Boolean).join(' · ')}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {files.map((f) => (
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
            </div>
            </>
          )}
          </div>
        </section>
        {!library && <WebSources projectId={projectId} />}
      </div>

      {/* Next step — only once every file is processed */}
      {!library && <div className="ui-card" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        padding: '14px 16px', marginBottom: 20,
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

      {confirmStart && <StartAsisDialog projectId={projectId} onClose={() => setConfirmStart(false)} />}

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
  const { Icon, color, bg } = fileIcon(file.name)
  return (
    <div className="ui-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px 10px 14px' }}>
      <span style={{ width: 36, height: 36, borderRadius: 8, background: bg, color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.name}
        </p>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
          {formatSize(file.size)} · {formatWhen(file.created_at)}
        </p>
        <FileStatus file={file} />
      </div>
      {file.status === 'failed' && <Button size="sm" icon={RotateCw} onClick={onRetry}>Retry</Button>}
      <a
        href={projectsApi.downloadUrl(projectId, file.id)}
        download={file.name}
        className="ui-icon-btn"
        title="Download"
        aria-label="Download"
        onClick={(e) => e.stopPropagation()}
      >
        <Download size={17} strokeWidth={1.8} />
      </a>
      <IconButton icon={Trash2} label="Delete file" danger onClick={onDelete} />
    </div>
  )
}

// What the AI can do with the file: searchable, read as page images, or not usable
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
        style={{ padding: 22, maxWidth: 440, width: '100%', boxShadow: '0 12px 40px rgba(16,24,40,.18)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <Button disabled={busy} onClick={() => { onClose(); navigate(`/projects/${projectId}/asis`) }}>No, just open the AS-IS</Button>
          <Button variant="primary" icon={Workflow} loading={busy} autoFocus onClick={start} disabled={!files.length && !accepted}>
            {hasAsis && locked ? `Yes, create v${next.number}` : 'Yes, start'}
          </Button>
        </div>
      </div>
    </div>
  )
}
