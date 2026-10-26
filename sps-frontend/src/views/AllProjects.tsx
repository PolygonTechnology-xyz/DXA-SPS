import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useNavigation } from '@/stores/navigation'
import { projectsApi, type Project } from '@/api/projects'
import { analyzeApi } from '@/api/analyze'
import type { SseEvent } from '@/api/client'
import { Folder, Workflow, Target, FolderOpen, ChevronDown, Search, Plus, SendHorizontal, Check, X } from 'lucide-react'
import { Button, Spinner, AssistantAvatar, RichText } from '@/components/ui'

function StatusIcon({ status }: { status: string }) {
  if (status === 'tobe_approved' || status === 'tobe_complete') return <Target size={16} strokeWidth={1.8} style={{ color: '#16a34a' }} />
  if (status === 'asis_complete' || status === 'asis_approved') return <Workflow size={16} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
  return <Folder size={16} strokeWidth={1.8} style={{ color: 'var(--muted)' }} />
}

type Stage = 'idle' | 'thinking' | 'creating'
/** A project the agent proposed; created only when the user presses Yes */
interface Proposal { name: string; description: string; goal: string; answer?: 'yes' | 'no' }
interface Msg { role: 'user' | 'assistant'; content: string; proposal?: Proposal }

/** What the agent sees of a message in the history (the card becomes plain text) */
function toHistory(m: Msg): { role: 'user' | 'assistant'; content: string } {
  if (!m.proposal) return { role: m.role, content: m.content }
  const { name, answer } = m.proposal
  const outcome = answer === 'no' ? 'The user pressed No — the project was not created.'
    : answer === 'yes' ? 'The user pressed Yes — the project was created.'
    : 'The user has not answered yet.'
  return { role: 'assistant', content: `${m.content ? m.content + '\n\n' : ''}[Proposed creating the project "${name}". ${outcome}]` }
}

export default function AllProjects() {
  const { newProjectOpen, closeNewProject } = useNavigation()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [input, setInput] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [messages, setMessages] = useState<Msg[]>([])

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const { data: projects = [], isFetched } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })

  function openProject(project: Project) {
    qc.invalidateQueries({ queryKey: ['projects'] })
    navigate(`/projects/${project.id}/overview`)
  }

  // Dropdown "No match → Enter" path: the name is explicit, create directly
  const createProject = useMutation({
    mutationFn: (name: string) => projectsApi.create({ name }),
    onSuccess: openProject,
    onError: () => setStage('idle'),
  })

  // Yes / No on the agent's project card
  const confirmProposal = useMutation({
    mutationFn: (p: Proposal) => projectsApi.create({ name: p.name, description: p.description, goal: p.goal }),
    onSuccess: openProject,
    onError: () => {
      setStage('idle')
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Sorry, the project could not be created. Please try again.' }])
    },
  })

  function answerProposal(index: number, answer: 'yes' | 'no') {
    const msg = messages[index]
    if (!msg?.proposal || msg.proposal.answer || stage !== 'idle') return
    setMessages((prev) => prev.map((m, i) => (i === index && m.proposal ? { ...m, proposal: { ...m.proposal, answer } } : m)))
    if (answer === 'yes') {
      setStage('creating')
      confirmProposal.mutate(msg.proposal)
    } else {
      setTimeout(() => inputRef.current?.focus(), 60)
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [dropdownOpen])

  useEffect(() => {
    if (newProjectOpen) {
      closeNewProject()
      stopRef.current?.()
      setStage('idle')
      setInput('')
      setMessages([])
      setDropdownOpen(false)
      setTimeout(() => inputRef.current?.focus(), 60)
    }
  }, [newProjectOpen, closeNewProject])

  useEffect(() => {
    if (stage === 'idle') setTimeout(() => inputRef.current?.focus(), 60)
  }, [stage])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  useEffect(() => () => stopRef.current?.(), [])

  const filtered = projects.filter((p) =>
    search.trim() === '' || p.name.toLowerCase().includes(search.toLowerCase()),
  )

  function handleSubmit() {
    const text = input.trim()
    if (!text || stage !== 'idle') return

    // Typing instead of pressing a button counts as "not answered" — close the open card
    const closed = messages.map((m) => (m.proposal && !m.proposal.answer ? { ...m, proposal: { ...m.proposal, answer: 'no' as const } } : m))
    const history: Msg[] = [...closed, { role: 'user', content: text }]
    setInput('')
    setStage('thinking')
    setMessages([...history, { role: 'assistant', content: '' }])

    // The home agent decides: answer normally, ask a clarifying question, or call create_project
    stopRef.current = analyzeApi.homeChat(history.map(toHistory), (e: SseEvent) => {
      if (e.type === 'text') {
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          next[next.length - 1] = { ...last, content: last.content + e.text }
          return next
        })
      }
      if (e.type === 'project_proposed') {
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          next[next.length - 1] = { ...last, proposal: { name: e.name, description: e.description ?? '', goal: e.goal ?? '' } }
          return next
        })
      }
      if (e.type === 'done') setStage('idle')
      if (e.type === 'error') {
        setMessages((prev) => {
          const next = [...prev]
          // never the technical text (e.g. "TypeError: network error")
          next[next.length - 1] = { role: 'assistant', content: e.network
            ? 'The connection was interrupted before my answer arrived. Please send your message again.'
            : 'Sorry, something went wrong. Please try again.' }
          return next
        })
        setStage('idle')
      }
    })
  }

  const isSpinning = stage !== 'idle'
  const spinLabel = stage === 'creating' ? 'Creating project…' : 'Thinking…'

  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: messages.length ? 'flex-start' : 'center',
        padding: '40px 24px 48px', minHeight: 0, overflowY: 'auto',
        background: 'var(--bg)',
      }}
    >
      {/* Greeting */}
      <h1 style={{
        fontSize: 'clamp(26px, 3.6vw, 36px)', fontWeight: 600,
        letterSpacing: '-.02em', color: 'var(--ink)',
        margin: '0 0 8px', textAlign: 'center',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <AssistantAvatar size={40} />
        Hello, Demo User
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: 14.5, margin: '0 0 26px', textAlign: 'center' }}>
        Start a service simplification project, or ask anything about SPS.
      </p>

      {/* Conversation with the home agent */}
      {messages.length > 0 && (
        <div style={{ width: '100%', maxWidth: 640, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map((m, i) => m.role === 'user' ? (
            <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{
                background: 'var(--accent)', color: 'var(--accent-ink)',
                borderRadius: 12, borderTopRightRadius: 4,
                padding: '10px 14px', fontSize: 14, maxWidth: '80%', lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
              }}>
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AssistantAvatar />
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderRadius: 12, borderTopLeftRadius: 4,
                padding: '11px 14px', fontSize: 14, lineHeight: 1.65,
                color: 'var(--ink-2)', maxWidth: 'calc(100% - 38px)', whiteSpace: 'pre-wrap',
              }}>
                {m.content ? <RichText text={m.content} /> : !m.proposal && (
                  <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Spinner size={13} /> {spinLabel}
                  </span>
                )}
                {m.proposal && (
                  <ProposalCard
                    proposal={m.proposal}
                    spaced={!!m.content}
                    busy={stage !== 'idle'}
                    onAnswer={(a) => answerProposal(i, a)}
                  />
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {/* Main box — pinned to the bottom once a conversation is running */}
      <div style={{
        width: '100%', maxWidth: 640, marginBottom: 10,
        ...(messages.length ? { position: 'sticky', bottom: 0, marginTop: 'auto', paddingBottom: 12, background: 'var(--bg)' } : {}),
      }}>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 14, padding: '14px 14px 10px',
          boxShadow: '0 4px 20px rgba(16,24,40,.06)',
        }}>
          <textarea
            ref={inputRef}
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
            }}
            placeholder={messages.length ? 'Reply…' : 'Describe the service you want to simplify, or ask anything about SPS…'}
            disabled={isSpinning}
            style={{
              width: '100%', boxSizing: 'border-box',
              border: 0, background: 'transparent',
              color: 'var(--ink)', resize: 'none',
              outline: 'none', fontSize: 14.5, lineHeight: 1.55,
              opacity: isSpinning ? 0.5 : 1,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <Button
              variant="primary"
              icon={SendHorizontal}
              loading={isSpinning}
              onClick={handleSubmit}
              disabled={!input.trim() || isSpinning}
            >
              {isSpinning ? spinLabel : 'Send'}
            </Button>
          </div>
        </div>
      </div>

      {/* Project picker row — below input */}
      <div style={{ width: '100%', maxWidth: 640, position: 'relative' }} ref={dropdownRef}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            size="sm"
            variant={dropdownOpen ? 'active' : 'default'}
            icon={FolderOpen}
            onClick={() => { setDropdownOpen((o) => !o); setSearch('') }}
          >
            Project
            <ChevronDown size={14} style={{ transform: dropdownOpen ? 'rotate(180deg)' : undefined, transition: 'transform .15s', color: 'var(--muted)' }} />
          </Button>
        </div>

        {/* Dropdown panel */}
        {dropdownOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0,
            width: 300, zIndex: 100,
            background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 12, boxShadow: '0 12px 32px rgba(16,24,40,.14)',
            overflow: 'hidden',
          }}>
            {/* Search input */}
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Search size={15} style={{ color: 'var(--muted)' }} />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search or create a project"
                style={{
                  flex: 1, border: 0, background: 'transparent',
                  outline: 'none', fontSize: 14, color: 'var(--ink)',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setDropdownOpen(false)
                  if (e.key === 'Enter' && search.trim() && filtered.length === 0) {
                    // Start creating a project with the search text
                    setDropdownOpen(false)
                    setSearch('')
                    setStage('creating')
                    createProject.mutate(search.trim())
                  }
                }}
              />
            </div>

            {/* Project list */}
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {!isFetched && (
                <div style={{ padding: '14px 16px', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
              )}
              {isFetched && filtered.length === 0 && search.trim() && (
                <div style={{ padding: '12px 16px', color: 'var(--muted)', fontSize: 13 }}>
                  No match — press Enter to create "{search}"
                </div>
              )}
              {isFetched && filtered.length === 0 && !search.trim() && (
                <div style={{ padding: '12px 16px', color: 'var(--muted)', fontSize: 13 }}>
                  No projects yet.
                </div>
              )}
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setDropdownOpen(false); navigate(`/projects/${p.id}/overview`) }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 16px', border: 0, background: 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--bg)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}
                >
                  <StatusIcon status={p.status} />
                  <span style={{
                    flex: 1, fontSize: 14, color: 'var(--ink)', fontWeight: 400,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.name}
                  </span>
                </button>
              ))}
            </div>

            {/* New project footer */}
            <div style={{ borderTop: '1px solid var(--line)' }}>
              <button
                onClick={() => {
                  setDropdownOpen(false)
                  setTimeout(() => inputRef.current?.focus(), 60)
                }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 16px', border: 0, background: 'transparent',
                  cursor: 'pointer', textAlign: 'left', color: 'var(--ink)',
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--bg)')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}
              >
                <Plus size={16} style={{ color: 'var(--muted)' }} />
                <span style={{ fontSize: 14, fontWeight: 500 }}>New project</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ProposalCard({ proposal, spaced, busy, onAnswer }: {
  proposal: Proposal
  spaced: boolean
  busy: boolean
  onAnswer: (answer: 'yes' | 'no') => void
}) {
  const { name, description, goal, answer } = proposal
  return (
    <div style={{ marginTop: spaced ? 10 : 0, whiteSpace: 'normal' }}>
      <div style={{ color: 'var(--ink)', fontWeight: 500, marginBottom: 6 }}>Create this project?</div>
      <div style={{ border: '1px solid var(--line)', borderRadius: 10, background: 'var(--bg)', padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: 'var(--ink)' }}>
          <Folder size={15} strokeWidth={1.8} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          {name}
        </div>
        {goal && (
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, display: 'flex', gap: 6 }}>
            <Target size={14} strokeWidth={1.9} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 3 }} />
            <span><strong style={{ fontWeight: 600 }}>Goal:</strong> {goal}</span>
          </div>
        )}
        {description && (
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>{description}</div>
        )}
      </div>
      {!answer ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Button size="sm" variant="primary" icon={Check} disabled={busy} onClick={() => onAnswer('yes')}>Yes, create</Button>
          <Button size="sm" icon={X} disabled={busy} onClick={() => onAnswer('no')}>No</Button>
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {answer === 'yes'
            ? <><Spinner size={12} /> Creating the project…</>
            : <><X size={13} /> Not created. Tell me what to change, or ask anything else.</>}
        </div>
      )}
    </div>
  )
}
