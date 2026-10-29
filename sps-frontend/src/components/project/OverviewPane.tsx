import { useState } from 'react'
// import SpsOverview from '@/components/project/SpsOverview'   // SPS section hidden for now (see below)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { projectsApi, type Project } from '@/api/projects'
import { useProjectFiles } from '@/lib/files'
import { stagesOf, pendingFindings, type Stage } from '@/lib/progress'
import type { LucideIcon } from 'lucide-react'
import { Paperclip, Link, Search, ArrowRight, Pencil, Sparkles, Workflow, PackageOpen, MessageSquare, BookOpen } from 'lucide-react'
import { Button, Spinner } from '@/components/ui'
import { useNavigation } from '@/stores/navigation'
import { useWebSources } from '@/components/project/WebSources'

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
      {/* project details — as before, the service summary, then the goal */}
      <div className="ui-card" style={{ padding: '20px 22px', marginBottom: 26 }}>
        <Field label="Project name">
          <Editable big ariaLabel="Project name" value={project.name} onSave={(v) => v && save({ name: v })} />
        </Field>
        <Field label="Service summary">
          <Editable multiline ariaLabel="Service summary" value={project.description || ''} placeholder="What the service is, who applies, how it works today and the known problems" onSave={(v) => save({ description: v })} />
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
        {/* the AS-IS review searches this country's laws and government services */}
        <Field label="Country">
          <Editable ariaLabel="Country" value={project.country || 'Bangladesh'} onSave={(v) => save({ country: v || 'Bangladesh' })} />
        </Field>
        <Field label="Ministry">
          <Editable ariaLabel="Ministry" value={project.ministry || ''} placeholder="Ministry responsible for the service" onSave={(v) => save({ ministry: v })} />
        </Field>
        <Field label="Department of the ministry">
          <Editable ariaLabel="Department of the ministry" value={project.department || ''} placeholder="Department / directorate that delivers the service" onSave={(v) => save({ department: v })} />
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
  const { accepted } = useWebSources(project.id)
  const openChat = () => useNavigation.getState().requestChatOpen()

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
  // sources chosen (documents and / or accepted web sites): the user starts the AS-IS
  if (files.length > 0 || accepted.length > 0) {
    const parts = [
      files.length ? `${files.length} document${files.length === 1 ? '' : 's'}` : '',
      accepted.length ? `${accepted.length} accepted web source${accepted.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ')
    return (
      <NextBox title="Let's Map How Your Service Works Today" sub={`Your ${parts} ${files.length + accepted.length === 1 ? 'is' : 'are'} ready. I'll turn them into a clear, step-by-step picture of your current process (AS-IS) — with a reference for every step.`}>
        <Button variant="primary" icon={Workflow} onClick={() => onNavigate('asis', { autostart: true })}>Start the AS-IS</Button>
        <Button icon={BookOpen} onClick={() => onNavigate('files')}>Add more in Knowledge</Button>
      </NextBox>
    )
  }

  // No sources yet: every choice leads to the Knowledge page — nothing is mapped until the user starts it
  return (
    <NextBox title="Let's Map How Your Service Works Today" sub="Choose what I should use. Everything is collected on the Knowledge page — I only map the AS-IS when you say so.">
      <div className="ov-sources">
        <SourceButton icon={Paperclip} title="Upload your documents" sub="SOPs, forms, circulars, even scanned pages" onClick={() => onNavigate('files')} />
        <SourceButton icon={Search} title="Let me search the web" sub="I'll list official sites — you accept or reject each" onClick={() => onNavigate('files', { webSearch: true })} />
        <SourceButton icon={Link} title="Share a web page" sub="Add a link, with a short note of what to take from it" onClick={() => onNavigate('files', { addLink: true })} />
      </div>
      <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <MessageSquare size={13} /> Or just tell me in the chat on the right.
      </p>
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
