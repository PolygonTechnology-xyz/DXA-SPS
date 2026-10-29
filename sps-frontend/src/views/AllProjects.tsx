import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useNavigation } from '@/stores/navigation'
import { projectsApi, type Project } from '@/api/projects'
import { analyzeApi } from '@/api/analyze'
import type { SseEvent } from '@/api/client'
import { Folder, Target, Check, X, Paperclip, FileText, Landmark } from 'lucide-react'
import { Button, Spinner, AssistantAvatar, RichText } from '@/components/ui'
import ChatComposer, { fileKey } from '@/components/home/ChatComposer'
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder'

const MODEL_KEY = 'sps.homeModel'

type Stage = 'idle' | 'thinking' | 'creating'
/** A project the agent proposed; created only when the user presses Yes */
interface ProposalFields { name: string; goal: string; description: string; country: string; ministry: string; department: string }
interface Proposal extends ProposalFields { answer?: 'yes' | 'no' }
interface Msg { role: 'user' | 'assistant'; content: string; proposal?: Proposal; files?: string[] }

/** What the agent sees of a message in the history (the card becomes plain text) */
function toHistory(m: Msg): { role: 'user' | 'assistant'; content: string } {
  if (m.files?.length) return { role: m.role, content: `${m.content}\n\n[Attached files: ${m.files.join(', ')}]`.trim() }
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
  // files in the box, and files already sent — uploaded into the project once it is created
  const [files, setFiles] = useState<File[]>([])
  const [sentFiles, setSentFiles] = useState<File[]>([])

  const { data: modelList } = useQuery({ queryKey: ['home-models'], queryFn: analyzeApi.homeModels, staleTime: Infinity })
  const [pickedModel, setPickedModel] = useState<string>(() => {
    try { return localStorage.getItem(MODEL_KEY) ?? '' } catch { return '' }
  })
  const models = modelList?.models ?? []
  const model = models.some((m) => m.id === pickedModel) ? pickedModel : (modelList?.default ?? '')
  function changeModel(id: string) {
    setPickedModel(id)
    try { localStorage.setItem(MODEL_KEY, id) } catch { /* private window */ }
  }

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })

  function openProject(project: Project) {
    qc.invalidateQueries({ queryKey: ['projects'] })
    navigate(`/projects/${project.id}/overview`)
  }

  // Yes / No on the agent's project card
  const confirmProposal = useMutation({
    mutationFn: async (p: Proposal) => {
      const project = await projectsApi.create({
        name: p.name.trim() || 'Untitled Project', description: p.description.trim(), goal: p.goal.trim(),
        country: p.country.trim(), ministry: p.ministry.trim(), department: p.department.trim(),
      })
      // a failed upload still opens the project — the Files tab shows what arrived
      await Promise.allSettled(sentFiles.map((f) => projectsApi.uploadFile(project.id, f)))
      return project
    },
    // files given in the chat: open the Files tab, where they are listed
    onSuccess: (project) => {
      if (!sentFiles.length) return openProject(project)
      qc.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/projects/${project.id}/files`)
    },
    onError: () => {
      setStage('idle')
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Sorry, the project could not be created. Please try again.' }])
    },
  })

  // the user corrects the assistant's details on the card before pressing Yes
  function editProposal(index: number, patch: Partial<ProposalFields>) {
    setMessages((prev) => prev.map((m, i) => (i === index && m.proposal && !m.proposal.answer ? { ...m, proposal: { ...m.proposal, ...patch } } : m)))
  }

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

  useEffect(() => {
    if (newProjectOpen) {
      closeNewProject()
      stopRef.current?.()
      setStage('idle')
      setInput('')
      setMessages([])
      setFiles([])
      setSentFiles([])
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

  // Voice commands: answer the open project card, open a project by name, or talk to the agent
  function handleVoice(spoken: string) {
    if (stage !== 'idle') return
    const said = spoken.trim().replace(/[.!?,]+$/, '')
    const pending = messages.findIndex((m) => m.proposal && !m.proposal.answer)
    if (pending >= 0 && /^(yes|yeah|yep|sure|ok(ay)?|confirm|create( it)?|go ahead)\b/i.test(said)) return answerProposal(pending, 'yes')
    if (pending >= 0 && /^(no|nope|cancel|don'?t)\b/i.test(said)) return answerProposal(pending, 'no')

    const open = said.match(/^(?:open|go to|show)\s+(?:the\s+)?(?:project\s+)?(.+?)(?:\s+project)?$/i)
    if (open) {
      const name = open[1].toLowerCase()
      const match = projects.find((p) => p.name.toLowerCase() === name)
        ?? projects.find((p) => p.name.toLowerCase().includes(name))
      if (match) return navigate(`/projects/${match.id}/overview`)
    }
    handleSubmit(said)
  }

  const voice = useVoiceRecorder(handleVoice)

  function handleSubmit(spoken?: string) {
    const text = (spoken ?? input).trim()
    if ((!text && !files.length) || stage !== 'idle') return

    // Typing instead of pressing a button counts as "not answered" — close the open card
    const closed = messages.map((m) => (m.proposal && !m.proposal.answer ? { ...m, proposal: { ...m.proposal, answer: 'no' as const } } : m))
    const history: Msg[] = [...closed, { role: 'user', content: text, ...(files.length ? { files: files.map((f) => f.name) } : {}) }]
    if (files.length) {
      setSentFiles((prev) => {
        const known = new Set(prev.map(fileKey))
        return [...prev, ...files.filter((f) => !known.has(fileKey(f)))]
      })
      setFiles([])
    }
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
          next[next.length - 1] = { ...last, proposal: {
            name: e.name, description: e.description ?? '', goal: e.goal ?? '',
            country: e.country || 'Bangladesh', ministry: e.ministry ?? '', department: e.department ?? '',
          } }
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
    }, model || undefined)
  }

  const isSpinning = stage !== 'idle'
  const spinLabel = stage === 'creating'
    ? (sentFiles.length ? `Creating project and uploading ${sentFiles.length} file${sentFiles.length > 1 ? 's' : ''}…` : 'Creating project…')
    : 'Thinking…'
  const chatting = messages.length > 0

  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
      justifyContent: chatting ? 'flex-start' : 'center',
      background: 'var(--bg)',
    }}>
    {/* Greeting + conversation — scrolls on its own once a conversation is running */}
    <div
      style={{
        flex: chatting ? 1 : 'none', minHeight: 0, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: chatting ? '32px 24px 16px' : '40px 24px 0',
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
        <div style={{ width: '100%', maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map((m, i) => m.role === 'user' ? (
            <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div dir="auto" style={{
                background: 'var(--accent)', color: 'var(--accent-ink)',
                borderRadius: 12, borderTopRightRadius: 4,
                padding: '10px 14px', fontSize: 14, maxWidth: '80%', lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
              }}>
                {m.content}
                {m.files?.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: m.content ? 8 : 0 }}>
                    {m.files.map((name) => (
                      <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, padding: '3px 8px', borderRadius: 8, background: 'rgba(255,255,255,.18)' }}>
                        <Paperclip size={12} /> {name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AssistantAvatar />
              <div dir="auto" style={{
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
                    onEdit={(patch) => editProposal(i, patch)}
                  />
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

    </div>

    {/* Composer — below the greeting at first, at the bottom once a conversation is running */}
    <div style={{
      flexShrink: 0, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: chatting ? '6px 24px 12px' : '0 24px 48px',
    }}>
      {/* messages fade out above the box instead of being cut off */}
      {chatting && <div style={{ position: 'absolute', left: 0, right: 0, top: -28, height: 28, background: 'linear-gradient(to bottom, transparent, var(--bg))', pointerEvents: 'none' }} />}
      <div style={{ width: '100%', maxWidth: 680 }}>
        <ChatComposer
          inputRef={inputRef}
          value={input}
          onChange={setInput}
          onSubmit={() => handleSubmit()}
          placeholder={chatting ? 'Reply…' : 'Describe the service you want to simplify, or ask anything about SPS…'}
          busy={isSpinning}
          files={files}
          onFilesChange={setFiles}
          voice={voice}
          models={models}
          model={model}
          onModelChange={changeModel}
          menuUp={chatting}
        />
      </div>
    </div>
    </div>
  )
}

function ProposalCard({ proposal, spaced, busy, onAnswer, onEdit }: {
  proposal: Proposal
  spaced: boolean
  busy: boolean
  onAnswer: (answer: 'yes' | 'no') => void
  onEdit: (patch: Partial<ProposalFields>) => void
}) {
  const { name, description, goal, country, ministry, department, answer } = proposal
  const owner = [country, ministry, department].filter(Boolean).join(' · ')

  // answered: the details as they were sent
  if (answer) {
    return (
      <div style={{ marginTop: spaced ? 10 : 0, whiteSpace: 'normal' }}>
        <div className="pc-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: 'var(--ink)' }}>
            <Folder size={15} strokeWidth={1.8} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            {name}
          </div>
          {owner && <div className="pc-meta"><Landmark size={13} /> {owner}</div>}
          {goal && <div className="pc-text"><Target size={13} strokeWidth={1.9} /><span><strong>Goal:</strong> {goal}</span></div>}
          {description && <div className="pc-text"><FileText size={13} strokeWidth={1.9} /><span><strong>Service summary:</strong> {description}</span></div>}
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {answer === 'yes'
            ? <><Spinner size={12} /> Creating the project…</>
            : <><X size={13} /> Not created. Tell me what to change, or ask anything else.</>}
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: spaced ? 10 : 0, whiteSpace: 'normal' }}>
      <div style={{ color: 'var(--ink)', fontWeight: 500 }}>Create this project?</div>
      <div style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 8 }}>Check the details and change anything that is wrong or missing.</div>
      <div className="pc-card pc-form">
        <label className="pc-field">
          <span>Project name</span>
          <input className="pc-input" value={name} onChange={(e) => onEdit({ name: e.target.value })} disabled={busy} style={{ fontWeight: 600 }} />
        </label>
        <label className="pc-field">
          <span>Goal</span>
          <textarea className="pc-input" dir="auto" rows={3} value={goal} onChange={(e) => onEdit({ goal: e.target.value })} disabled={busy}
            placeholder="What should the simplification achieve — for citizens, and in the process?" />
        </label>
        <label className="pc-field">
          <span>Service summary</span>
          <textarea className="pc-input" dir="auto" rows={4} value={description} onChange={(e) => onEdit({ description: e.target.value })} disabled={busy}
            placeholder="What the service is, who applies, how it works today and the known problems" />
        </label>
        <div className="pc-grid">
          <label className="pc-field">
            <span>Country</span>
            <input className="pc-input" value={country} onChange={(e) => onEdit({ country: e.target.value })} disabled={busy} placeholder="Bangladesh" />
          </label>
          <label className="pc-field">
            <span>Ministry</span>
            <input className="pc-input" value={ministry} onChange={(e) => onEdit({ ministry: e.target.value })} disabled={busy} placeholder="e.g. Ministry of Home Affairs" />
          </label>
          <label className="pc-field">
            <span>Department of the ministry</span>
            <input className="pc-input" value={department} onChange={(e) => onEdit({ department: e.target.value })} disabled={busy} placeholder="e.g. Department of Immigration and Passports" />
          </label>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <Button size="sm" variant="primary" icon={Check} disabled={busy || !name.trim()} onClick={() => onAnswer('yes')}>Yes, create</Button>
        <Button size="sm" icon={X} disabled={busy} onClick={() => onAnswer('no')}>No</Button>
      </div>
    </div>
  )
}
