import { useState } from 'react'
// import SpsOverview from '@/components/project/SpsOverview'   // SPS section hidden for now (see below)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { projectsApi, type Project } from '@/api/projects'
import { runAsis } from '@/lib/asis'
import { useProjectFiles } from '@/lib/files'
import { stagesOf, pendingFindings, type Stage } from '@/lib/progress'
import type { LucideIcon } from 'lucide-react'
import { Paperclip, Link, Search, ArrowRight, Pencil, Sparkles, Workflow, PackageOpen, MessageSquare } from 'lucide-react'
import { Button, Spinner } from '@/components/ui'
import { useNavigation } from '@/stores/navigation'

/** Text that turns into an input (or a text area) on click; Enter / leaving saves, Esc cancels */
function Editable({ value, onSave, placeholder, multiline, big, ariaLabel }: {
  value: string
  onSave: (v: string) => void
  placeholder?: string
  multiline?: boolean
  big?: boolean
  ariaLabel: string
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  const font = { fontSize: big ? 20 : 15, fontWeight: big ? 600 : 400, lineHeight: 1.5, letterSpacing: big ? '-.01em' : undefined }
  const save = () => { setEditing(false); if (val.trim() !== value.trim()) onSave(val.trim()) }
  const cancel = () => { setEditing(false); setVal(value) }

  if (editing) {
    const common = {
      value: val,
      autoFocus: true,
      'aria-label': ariaLabel,
      onBlur: save,
      style: {
        // the font shorthand first: it would reset the size and weight that follow
        font: 'inherit', ...font, width: '100%', boxSizing: 'border-box' as const, padding: '4px 8px', margin: '-5px 0 -5px -9px',
        border: '1px solid var(--accent)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)',
        boxShadow: '0 0 0 3px var(--accent-soft)', outline: 'none', resize: 'vertical' as const,
      },
    }
    return multiline
      ? <textarea {...common} rows={2} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() } if (e.key === 'Escape') cancel() }} />
      : <input {...common} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }} />
  }
  return (
    <button className="ov-editable" onClick={() => { setVal(value); setEditing(true) }} aria-label={`${ariaLabel} — click to edit`} style={font}>
      {value || <span style={{ color: 'var(--muted)' }}>{placeholder ?? '—'}</span>}
      <Pencil size={13} className="ov-editable__pen" />
    </button>
  )
}

/** A labelled row of the details card */
function Field({ label, extra, children }: { label: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="ov-label">{label}{extra}</div>
      {children}
    </div>
  )
}

interface Props {
  projectId: string
}

export default function OverviewPane({ projectId }: Props) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: !!projectId,
  })

  const updateProject = useMutation({
    mutationFn: (patch: Parameters<typeof projectsApi.update>[1]) => projectsApi.update(projectId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const [savedMsg, setSavedMsg] = useState('Click any text to edit')

  const suggest = useMutation({
    mutationFn: () => projectsApi.suggestGoal(projectId),
    onSuccess: (p) => qc.setQueryData(['project', projectId], (old: Project | undefined) => (old ? { ...old, goal: p.goal, goal_by: p.goal_by } : old)),
  })

  function save(patch: Parameters<typeof projectsApi.update>[1]) {
    updateProject.mutate(patch)
    setSavedMsg('✓ Saved')
    setTimeout(() => setSavedMsg('Click any text to edit'), 1200)
  }

  if (!project) return <div style={{ padding: 20, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}><Spinner size={14} /> Loading…</div>

  const stages = stagesOf(project)

  return (
    <div>
      {/* project details — as before, with the goal apart from the description */}
      <div className="ui-card" style={{ padding: '20px 22px', marginBottom: 26 }}>
        <Field label="Project name">
          <Editable big ariaLabel="Project name" value={project.name} onSave={(v) => v && save({ name: v })} />
        </Field>
        <Field label="Goal" extra={project.goal && project.goal_by === 'assistant' && (
          <span className="ov-suggested" title="Written by the assistant from what you said — click the text to change it">
            <Sparkles size={11} /> Suggested by the assistant
          </span>
        )}>
          {project.goal
            ? <Editable multiline ariaLabel="Goal" value={project.goal} onSave={(v) => save({ goal: v })} />
            : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Editable multiline ariaLabel="Goal" value="" placeholder="What should the simplification achieve?" onSave={(v) => save({ goal: v })} />
                <Button size="sm" icon={Sparkles} loading={suggest.isPending} onClick={() => suggest.mutate()}>Suggest a goal</Button>
                {suggest.isError && <span style={{ fontSize: 12.5, color: 'var(--danger)' }}>No suggestion this time — please try again.</span>}
              </div>
            )}
        </Field>
        <Field label="Description">
          <Editable multiline ariaLabel="Description" value={project.description || ''} onSave={(v) => save({ description: v })} />
        </Field>
        {/* the AS-IS review searches this country's laws and government services */}
        <Field label="Country">
          <Editable ariaLabel="Country" value={project.country || 'Bangladesh'} onSave={(v) => save({ country: v || 'Bangladesh' })} />
        </Field>
        <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 4 }}>
          <Pencil size={12} /> {savedMsg}
        </div>
      </div>

      {/* SPS settings and matrices (cost per visit, Matrix-1/2/3, team) — hidden for now; uncomment (and the import) to show
      <SpsOverview project={project} />
      */}

      {/* ── What the user should do now ── */}
      <NextStep project={project} stages={stages} onNavigate={(pane, state) => navigate(`/projects/${projectId}/${pane}`, state ? { state } : undefined)} />
    </div>
  )
}

/** The one thing to do now — it changes as the project moves through the stages */
function NextStep({ project, stages, onNavigate }: {
  project: Project
  stages: Stage[]
  onNavigate: (pane: string, state?: Record<string, unknown>) => void
}) {
  const { files, busy: filesBusy, busyLabel, loaded } = useProjectFiles(project.id)
  const [urlOpen, setUrlOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [confirmWeb, setConfirmWeb] = useState(false)
  const openChat = () => useNavigation.getState().requestChatOpen()

  // the AS-IS run continues in the background; its progress shows on the AS-IS tab
  function startWeb(opts: { url?: string } = {}) {
    if (filesBusy || project.running) return
    runAsis({ projectId: project.id, name: project.name, description: project.description, ...opts })
    onNavigate('asis')
  }

  const pending = pendingFindings(project)
  const next = stages.find((s) => s.state !== 'done')

  // the AI is working on it right now
  if (project.running) {
    const what = project.running === 'asis' ? 'AS-IS' : 'TO-BE'
    return (
      <NextBox title={`I'm working on the ${what}…`} sub="Follow along live, or carry on with something else — I'll save it as soon as it's done.">
        <Button variant="primary" iconRight={ArrowRight} onClick={() => onNavigate(project.running === 'asis' ? 'asis' : 'tobe')}>Follow the {what}</Button>
      </NextBox>
    )
  }

  if (!next) {
    return (
      <NextBox done title="All done — great work!" sub="Your AS-IS and TO-BE are approved. Download them as Excel or BPMN from Outputs. Want to change something? Just ask me — I'll make a new version.">
        <Button variant="primary" icon={PackageOpen} onClick={() => onNavigate('outputs')}>Open Outputs</Button>
      </NextBox>
    )
  }

  if (next.key === 'asis_ok') {
    return (
      <NextBox title="Let's check today's AS-IS together" sub={pending
        ? `I have ${pending} question${pending === 1 ? '' : 's'} for you in the chat — things I found on the web or couldn't find a source for. Answer ${pending === 1 ? 'it' : 'them'}, then approve the AS-IS.`
        : "Have a look at the steps — change anything right in the table. When it looks right, approve it and we'll design the new process."}>
        <Button variant="primary" iconRight={ArrowRight} onClick={() => onNavigate('asis')}>Open the AS-IS</Button>
        {pending > 0 && <Button icon={MessageSquare} onClick={openChat}>Answer in the chat</Button>}
      </NextBox>
    )
  }
  if (next.key === 'tobe') {
    return (
      <NextBox title="Let's design the new process (TO-BE)" sub="Today's AS-IS is approved. I'll redesign it towards your goal — fewer steps, fewer visits, fewer days.">
        <Button variant="primary" iconRight={ArrowRight} onClick={() => onNavigate('tobe', { autostart: true })}>Design the TO-BE</Button>
      </NextBox>
    )
  }
  if (next.key === 'tobe_ok') {
    return (
      <NextBox title="Let's check the new process (TO-BE)" sub="Compare it with today's AS-IS and change anything in the table or tell me in the chat. When you're happy, approve it.">
        <Button variant="primary" iconRight={ArrowRight} onClick={() => onNavigate('tobe')}>Open the TO-BE</Button>
      </NextBox>
    )
  }

  // ── No AS-IS yet: the assistant needs a source ──
  if (loaded && filesBusy) {
    return (
      <NextBox title="Getting your documents ready…" sub="Hang on a moment — we can map today's AS-IS as soon as they're ready.">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--accent)' }}><Spinner size={14} /> {busyLabel}</span>
      </NextBox>
    )
  }
  if (files.length > 0) {
    return (
      <NextBox title="Let's Map How Your Service Works Today" sub={`Your ${files.length === 1 ? 'document is' : `${files.length} documents are`} ready. I'll read ${files.length === 1 ? 'it' : 'them'} and turn ${files.length === 1 ? 'it' : 'them'} into a clear, step-by-step picture of your current process (AS-IS) — with a reference for every step.`}>
        <Button variant="primary" icon={Workflow} onClick={() => onNavigate('asis', { autostart: true })}>Start the AS-IS</Button>
        <Button icon={Paperclip} onClick={() => onNavigate('files')}>Add more documents</Button>
      </NextBox>
    )
  }

  return (
    <NextBox title="Let's Map How Your Service Works Today" sub="Share what you have and I'll turn it into a clear, step-by-step picture of your current process (AS-IS). Where should I start?">
      <div className="ov-sources">
        <SourceButton icon={Paperclip} title="Upload your documents" sub="SOPs, forms, circulars, even scanned pages" onClick={() => onNavigate('files')} />
        <SourceButton icon={Search} title="Let me search the web" sub="I'll use official government sources" onClick={() => setConfirmWeb(true)} />
        <SourceButton icon={Link} title="Share a web page" sub="One page that explains the process" active={urlOpen} onClick={() => setUrlOpen((o) => !o)} />
      </div>
      {urlOpen && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, width: '100%' }}>
          <input className="ui-input" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus placeholder="https://…" aria-label="Page address"
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) startWeb({ url: url.trim() }) }} />
          <Button variant="primary" disabled={!url.trim()} onClick={() => startWeb({ url: url.trim() })}>Fetch &amp; analyse</Button>
        </div>
      )}
      <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <MessageSquare size={13} /> Or just tell me in the chat on the right — for example “start the AS-IS”.
      </p>

      {confirmWeb && (
        <div onClick={() => setConfirmWeb(false)} onKeyDown={(e) => { if (e.key === 'Escape') setConfirmWeb(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(17,24,39,.4)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="ui-card"
            style={{ padding: 22, maxWidth: 420, width: '100%', boxShadow: '0 12px 40px rgba(16,24,40,.18)' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>Do you want to start the simplification?</h3>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.55 }}>
              I'll search official sources online for “{project.name}” and map how it works today — with a reference for every step.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <Button onClick={() => setConfirmWeb(false)}>No</Button>
              <Button variant="primary" icon={Search} autoFocus onClick={() => { setConfirmWeb(false); startWeb() }}>Yes, start</Button>
            </div>
          </div>
        </div>
      )}
    </NextBox>
  )
}

function NextBox({ title, sub, done, children }: { title: string; sub: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className={`ov-next${done ? ' ov-next--done' : ''}`} aria-label="Next step">
      <div className="ov-next__eyebrow">{done ? 'Finished' : 'Next step'}</div>
      <h2 className="ov-next__title">{title}</h2>
      <p className="ov-next__sub">{sub}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
    </section>
  )
}

function SourceButton({ icon: Icon, title, sub, onClick, active }: {
  icon: LucideIcon; title: string; sub: string; onClick: () => void; active?: boolean
}) {
  return (
    <button className={`ov-source${active ? ' ov-source--active' : ''}`} onClick={onClick}>
      <span className="ov-source__icon"><Icon size={18} strokeWidth={1.8} /></span>
      <span style={{ minWidth: 0 }}>
        <span className="ov-source__title">{title}</span>
        <span className="ov-source__sub">{sub}</span>
      </span>
    </button>
  )
}
