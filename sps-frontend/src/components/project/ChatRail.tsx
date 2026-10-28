import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useNavigation } from '@/stores/navigation'
import { projectsApi, type AsIsStep, type ToBeStep, type StoredChatMessage } from '@/api/projects'
import { analyzeApi } from '@/api/analyze'
import ChatMessage from '@/components/chat/ChatMessage'
import TypingIndicator from '@/components/chat/TypingIndicator'
import type { ChatMessage as Msg } from '@/api/session'
import type { LucideIcon } from 'lucide-react'
import { Pencil, Plus, Trash2, ArrowUpDown, Merge, FolderOpen, Workflow, Target, MessageSquare, ChevronsRight, ArrowUp, Undo2, Play, Eraser, Brain, Search, BookOpen, ListChecks, CircleHelp, Globe, FilePlus, Lock, GitBranchPlus, Mic, Square, FileText } from 'lucide-react'
import MemoryPanel from '@/components/project/MemoryPanel'
import ConsentCard from '@/components/project/ConsentCard'
import ReviewSteps from '@/components/project/ReviewSteps'
import { Button, IconButton, Spinner } from '@/components/ui'
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder'
import { useVersions, nextVersion, refreshAfterVersionChange } from '@/components/project/Versions'

let railMsgCounter = 0
const mkId = () => `live-${++railMsgCounter}`

const TOOL_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  update_step: { label: 'Updating step', icon: Pencil },
  add_step: { label: 'Adding step', icon: Plus },
  remove_step: { label: 'Removing step', icon: Trash2 },
  move_step: { label: 'Moving step', icon: ArrowUpDown },
  merge_steps: { label: 'Merging steps', icon: Merge },
  navigate: { label: 'Navigating', icon: FolderOpen },
  generate_asis: { label: 'Starting AS-IS generation', icon: Workflow },
  generate_tobe: { label: 'Starting TO-BE generation', icon: Target },
  update_project: { label: 'Updating project', icon: Pencil },
  update_memory: { label: 'Noting in project memory', icon: Brain },
  search_documents: { label: 'Searching documents', icon: Search },
  read_pages: { label: 'Reading documents', icon: BookOpen },
  decide_findings: { label: 'Applying your decision', icon: ListChecks },
  mark_unknown: { label: 'Marking as unknown', icon: CircleHelp },
  web_search: { label: 'Searching the web', icon: Globe },
  save_web_research: { label: 'Saving web research to Files', icon: FilePlus },
}

interface Props {
  projectId: string
  pane: string
  onClose: () => void
}

/** A message in the rail: text, or a card drawn from its payload */
type RailMsg = Msg & { kind?: StoredChatMessage['kind']; payload?: StoredChatMessage['payload'] }

// The rail's width: dragged on its left edge, remembered in this browser
const WIDTH_KEY = 'sps.chatWidth'
const DEFAULT_WIDTH = 420
const MIN_WIDTH = 320
const maxWidth = () => Math.max(MIN_WIDTH, Math.min(900, Math.round(window.innerWidth * 0.6)))
const clampWidth = (w: number) => Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, w)))
function readWidth(): number {
  try { const w = Number(localStorage.getItem(WIDTH_KEY)); return w ? clampWidth(w) : DEFAULT_WIDTH } catch { return DEFAULT_WIDTH }
}

const GREETING: RailMsg = {
  id: 'greeting',
  role: 'assistant',
  content: 'Hi! Upload documents or tell me about the process, then say **“start the AS-IS”** when you are ready. I can also edit, add or remove steps, generate the TO-BE, or answer questions about this project.',
}

export default function ChatRail({ projectId, pane, onClose }: Props) {
  const navigate = useNavigate()
  const { setPendingAction } = useNavigation()
  const qc = useQueryClient()

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: !!projectId,
  })

  // The project's saved conversation (the server stores every message, and posts its own —
  // consent cards and review questions — so it is refetched after a review)
  const { data: saved = [], isSuccess: historyLoaded } = useQuery({
    queryKey: ['chat-messages', projectId],
    queryFn: () => projectsApi.chatMessages(projectId),
    enabled: !!projectId,
  })
  // The turn in progress, shown until its messages appear in the saved history
  const [live, setLive] = useState<{ base: number; msgs: RailMsg[] }>({ base: 0, msgs: [] })
  const messages: RailMsg[] = [
    GREETING,
    ...saved.map((m): RailMsg => ({
      id: `saved-${m.id}`, role: m.role, content: m.content, kind: m.kind, payload: m.payload,
      createdAt: new Date(m.created_at * 1000).toISOString(),
    })),
    ...live.msgs.slice(Math.max(0, saved.length - live.base)),
  // the reply placeholder stays hidden until text arrives — the typing dots show meanwhile
  ].filter((m) => m.role !== 'assistant' || m.content.trim() || m.kind === 'consent' || m.kind === 'review_steps')


  // only the newest review card tells the page what is still open
  const latestReviewId = [...messages].reverse().find((m) => m.kind === 'review_steps')?.id

  useEffect(() => {
    if (historyLoaded && !latestReviewId) useNavigation.getState().setReviewWaiting(null)
  }, [historyLoaded, latestReviewId])

  const [confirmClear, setConfirmClear] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [typing, setTyping] = useState(false)
  // the reply being written: hidden until it is complete — one box, with the full answer
  const writingId = typing ? live.msgs.find((m) => m.role === 'assistant')?.id : undefined
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [pendingAction, setPendingActionLocal] = useState<{ name: string; payload: Record<string, unknown> } | null>(null)
  const [undoSnapshot, setUndoSnapshot] = useState<{ asis?: AsIsStep[]; tobe?: ToBeStep[] } | null>(null)
  // the chat tried to change an approved AS-IS / TO-BE: ask about a new version, then redo the request there
  const [lockPrompt, setLockPrompt] = useState<{ what: 'asis' | 'tobe'; version: number; request: string } | null>(null)
  const [lockBusy, setLockBusy] = useState(false)
  const { data: versionList } = useVersions(projectId)

  const endRef = useRef<HTMLDivElement>(null)
  const stopRef = useRef<(() => void) | null>(null)

  const [width, setWidth] = useState(readWidth)
  const [resizing, setResizing] = useState(false)
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    let latest = startW
    setResizing(true)
    // the rail sits on the right: dragging left makes it wider
    const move = (ev: PointerEvent) => { latest = clampWidth(startW + (startX - ev.clientX)); setWidth(latest) }
    const up = () => {
      setResizing(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      try { localStorage.setItem(WIDTH_KEY, String(latest)) } catch { /* private window */ }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function resetWidth() {
    setWidth(DEFAULT_WIDTH)
    try { localStorage.setItem(WIDTH_KEY, String(DEFAULT_WIDTH)) } catch { /* private window */ }
  }
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pickerRef = useRef<HTMLInputElement>(null)

  // the box grows with the text, up to about 10 lines
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 72), 240)}px`
  }, [input])

  // "+": documents go straight into the project's Knowledge (read and indexed in the background)
  const [upload, setUpload] = useState<{ busy: string[]; done: string[]; failed: string[] }>({ busy: [], done: [], failed: [] })
  const [dropping, setDropping] = useState(false)
  async function uploadFiles(raw: FileList | null) {
    if (!raw?.length || upload.busy.length) return
    const list = Array.from(raw)
    setUpload({ busy: list.map((f) => f.name), done: [], failed: [] })
    const results = await Promise.allSettled(list.map((f) => projectsApi.uploadFile(projectId, f)))
    setUpload({
      busy: [],
      done: list.filter((_, i) => results[i].status === 'fulfilled').map((f) => f.name),
      failed: list.filter((_, i) => results[i].status === 'rejected').map((f) => f.name),
    })
    qc.invalidateQueries({ queryKey: ['files', projectId] })
    qc.invalidateQueries({ queryKey: ['project', projectId] })
  }

  // A different project: its own conversation
  useEffect(() => {
    setLive({ base: 0, msgs: [] })
    setPendingActionLocal(null)
    setUndoSnapshot(null)
    setConfirmClear(false)
    setLockPrompt(null)
  }, [projectId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, typing, activeTool])

  function clearChat() {
    setConfirmClear(false)
    stopRef.current?.()
    setTyping(false)
    setActiveTool(null)
    projectsApi.clearChat(projectId).finally(() => {
      setLive({ base: 0, msgs: [] })
      setPendingActionLocal(null)
      setUndoSnapshot(null)
      qc.invalidateQueries({ queryKey: ['chat-messages', projectId] })
    })
  }

  function updateLive(id: string, content: string) {
    setLive((l) => ({ ...l, msgs: l.msgs.map((m) => (m.id === id ? { ...m, content } : m)) }))
  }

  function executePendingAction(action: { name: string; payload: Record<string, unknown> }) {
    setPendingActionLocal(null)
    if (action.name === 'navigate') {
      navigate(`/projects/${projectId}/${action.payload.pane}`)
    } else if (action.name === 'generate_asis') {
      setPendingAction({ type: 'generate_asis', input: action.payload.input as string })
      navigate(`/projects/${projectId}/asis`)
    } else if (action.name === 'generate_tobe') {
      setPendingAction({ type: 'generate_tobe' })
      navigate(`/projects/${projectId}/tobe`)
    }
  }

  function undo() {
    if (!undoSnapshot) return
    const patch: Parameters<typeof projectsApi.update>[1] = {}
    if (undoSnapshot.asis) patch.asis_steps = undoSnapshot.asis
    if (undoSnapshot.tobe) patch.tobe_steps = undoSnapshot.tobe
    projectsApi.update(projectId, patch).then(() => {
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      setUndoSnapshot(null)
      // a local note — the history on the server is unchanged
      setLive((l) => ({ base: saved.length, msgs: [...l.msgs.slice(Math.max(0, saved.length - l.base)), { id: mkId(), role: 'assistant', content: 'Changes undone.' }] }))
    })
  }

  // Voice: the transcript is sent like a typed message
  const voice = useVoiceRecorder((text) => send(text))

  function send(text: string) {
    text = text.trim()
    if (!text || typing || !historyLoaded) return
    setInput('')
    setPendingActionLocal(null)
    setUndoSnapshot(null)
    setLockPrompt(null)
    setActiveTool(null)

    console.log(`[CHAT] send  pane=${pane}  text="${text.slice(0, 60)}"`)
    setTyping(true)
    const aiMsgId = mkId()
    let accumulated = ''
    // the server saves this turn's two messages; until then they are shown from here
    setLive({ base: saved.length, msgs: [{ id: mkId(), role: 'user', content: text }, { id: aiMsgId, role: 'assistant', content: '' }] })

    // Snapshot current steps for undo
    const snapshot: typeof undoSnapshot = {}
    if (project?.asis_steps?.length) snapshot.asis = [...project.asis_steps]
    if (project?.tobe_steps?.length) snapshot.tobe = [...project.tobe_steps]

    // only the new message: the server keeps the conversation (with a summary of older
    // messages) and the project memory, and builds the model's context from them
    const history = [{ role: 'user' as const, content: text }]

    const stop = analyzeApi.projectChat(projectId, history, pane, (e) => {
      if (e.type === 'text') {
        accumulated += e.text
        updateLive(aiMsgId, accumulated)
      }

      if (e.type === 'tool_started') {
        setActiveTool(e.name)
      }

      if (e.type === 'step_updated') {
        setActiveTool(null)
        // Update React Query cache immediately — no refetch needed
        qc.setQueryData(['project', projectId], (old: typeof project) => {
          if (!old) return old
          if (e.step_type === 'asis') return { ...old, asis_steps: e.steps as AsIsStep[] }
          return { ...old, tobe_steps: e.steps as ToBeStep[] }
        })
        // Save snapshot for undo — only of what changed (an approved part can't be written back)
        const kind = e.step_type === 'asis' ? 'asis' : 'tobe'
        setUndoSnapshot((prev) => ({ ...prev, [kind]: snapshot[kind] }))
      }

      if (e.type === 'project_updated') {
        qc.setQueryData(['project', projectId], (old: typeof project) => {
          if (!old) return old
          return {
            ...old,
            ...(e.name !== undefined ? { name: e.name } : {}),
            ...(e.description !== undefined ? { description: e.description } : {}),
            ...(e.goal !== undefined ? { goal: e.goal, goal_by: 'user' as const } : {}),
          }
        })
        qc.invalidateQueries({ queryKey: ['projects'] })
      }

      if (e.type === 'action') {
        setActiveTool(null)
        // Confirm-before-run only when generation would overwrite existing steps
        const overwrites =
          (e.name === 'generate_asis' && (project?.asis_steps?.length ?? 0) > 0) ||
          (e.name === 'generate_tobe' && (project?.tobe_steps?.length ?? 0) > 0)
        if (overwrites) {
          setPendingActionLocal({ name: e.name, payload: e.payload })
        } else {
          executePendingAction({ name: e.name, payload: e.payload })
        }
      }

      if (e.type === 'done') {
        setTyping(false)
        setActiveTool(null)
        updateLive(aiMsgId, e.text || accumulated)
        qc.invalidateQueries({ queryKey: ['chat-messages', projectId] })
      }

      // memory, consent decisions and dropped steps change the project — refetch it
      // saved web research is a new document in the project's files
      if (e.type === 'files_updated') {
        qc.invalidateQueries({ queryKey: ['files', projectId] })
        qc.invalidateQueries({ queryKey: ['project', projectId] })
      }

      if (e.type === 'choices') {
        setLive((l) => ({ ...l, msgs: l.msgs.map((m) => (m.id === aiMsgId ? { ...m, payload: { ...m.payload, choices: e.options } } : m)) }))
      }

      if (e.type === 'version_locked') {
        setActiveTool(null)
        setLockPrompt({ what: e.what, version: e.version, request: text })
      }

      if (e.type === 'memory_updated' || e.type === 'findings_updated') {
        qc.invalidateQueries({ queryKey: ['project', projectId] })
      }

      // the connection dropped, but the server finishes the reply and saves it: keep the typing
      // dots and pick the reply up from the saved history (an error only if none comes)
      if (e.type === 'error' && e.network) {
        setActiveTool(null)
        const base = saved.length
        const deadline = Date.now() + 5 * 60_000
        const poll = async () => {
          const msgs = await qc.fetchQuery({ queryKey: ['chat-messages', projectId], queryFn: () => projectsApi.chatMessages(projectId), staleTime: 0 }).catch(() => null)
          if (msgs?.slice(base).some((m) => m.role === 'assistant')) {
            setTyping(false)
            for (const key of ['project', 'files', 'versions-all']) qc.invalidateQueries({ queryKey: [key, projectId] })
            return
          }
          if (Date.now() > deadline) {
            setTyping(false)
            updateLive(aiMsgId, 'Something went wrong. Please try again.')
            return
          }
          setTimeout(poll, 4000)
        }
        setTimeout(poll, 3000)
        return
      }

      if (e.type === 'error') {
        setTyping(false)
        setActiveTool(null)
        updateLive(aiMsgId, 'Something went wrong. Please try again.')
      }
    })

    stopRef.current = stop
  }

  return (
    <aside style={{
      width, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative',
      background: 'var(--surface)', borderLeft: '1px solid var(--line)',
    }}>
      {/* drag to make the rail wider or narrower; double-click for the default width */}
      <div
        className={`rail-resize${resizing ? ' rail-resize--on' : ''}`}
        role="separator" aria-orientation="vertical" aria-label="Resize the chat" title="Drag to resize · double-click to reset"
        tabIndex={0}
        onPointerDown={startResize}
        onDoubleClick={resetWidth}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const w = clampWidth(width + (e.key === 'ArrowLeft' ? 24 : -24))
            setWidth(w)
            try { localStorage.setItem(WIDTH_KEY, String(w)) } catch { /* private window */ }
          }
        }}
      />
      {resizing && <div style={{ position: 'fixed', inset: 0, zIndex: 50, cursor: 'col-resize' }} />}
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', minHeight: 56, borderBottom: '1px solid var(--line)', flexShrink: 0,
      }}>
        <strong style={{ fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageSquare size={17} strokeWidth={1.9} style={{ color: 'var(--accent)' }} /> Assistant
        </strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <IconButton icon={Brain} size="sm" label={showMemory ? 'Hide project memory' : 'Project memory'} onClick={() => setShowMemory((v) => !v)}
            style={showMemory ? { color: 'var(--accent)', background: 'var(--accent-soft)' } : undefined} />
          {messages.length > 1 && (
            <IconButton icon={Eraser} size="sm" label="Clear chat history" onClick={() => setConfirmClear(true)} disabled={typing} />
          )}
          <Button size="sm" iconRight={ChevronsRight} onClick={onClose}>Hide</Button>
        </div>
      </div>

      {showMemory && <MemoryPanel projectId={projectId} onClose={() => setShowMemory(false)} />}

      {confirmClear && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', flexShrink: 0,
          background: 'var(--danger-soft)', borderBottom: '1px solid var(--danger-line)', fontSize: 13,
        }}>
          <span style={{ flex: 1, color: 'var(--danger)' }}>Delete this project's chat history? (Project memory is kept.)</span>
          <Button size="sm" variant="danger" onClick={clearChat}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
        </div>
      )}

      {/* Messages */}
      <div className="ui-scroll-hover" style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 0' }}>
        {messages.filter((m) => m.id !== writingId).map((m) => (m.kind === 'review_steps' && m.payload?.topics
          ? <ReviewSteps key={m.id} cardId={m.id} latest={m.id === latestReviewId} createdAt={m.createdAt} projectId={projectId} project={project} topics={m.payload.topics} sources={m.payload.sources}
              busy={typing || !historyLoaded} onAnswer={(text) => send(text)} />
          : m.kind === 'consent' && m.payload?.finding_ids
          ? <ConsentCard key={m.id} projectId={projectId} project={project} findingIds={m.payload.finding_ids} lang={m.payload.lang} mode={m.payload.mode} />
          : <ChatMessage key={m.id} message={m} compact sources={m.payload?.sources} />))}

        {/* Quick replies: the assistant's last question as buttons; a click answers it */}
        {(() => {
          const last = messages[messages.length - 1]
          const options = last?.role === 'assistant' ? last.payload?.choices : undefined
          if (!options?.length || typing) return null
          return (
            <div className="chat-choices" role="group" aria-label="Quick replies">
              {options.map((o) => (
                <button key={o} className="chat-choice" onClick={() => send(o)}>{o}</button>
              ))}
            </div>
          )
        })()}

        {/* Active tool indicator */}
        {activeTool && (() => {
          const t = TOOL_LABELS[activeTool]
          const Icon = t?.icon
          return (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', margin: '6px 0 6px 38px',
              background: 'var(--accent-soft)', border: '1px solid #c7d2fe', borderRadius: 'var(--radius-sm)',
              fontSize: 13, color: 'var(--accent)',
            }}>
              <Spinner size={13} />
              {Icon && <Icon size={14} strokeWidth={2} />}
              {t?.label ?? activeTool}…
            </div>
          )
        })()}

        {typing && !activeTool && <TypingIndicator />}

        {/* Confirm banner for generation actions */}
        {pendingAction && !typing && (
          <div className="ui-card" style={{ margin: '10px 0 10px 38px', padding: '12px 14px', borderColor: '#c7d2fe', background: 'var(--accent-soft)' }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--accent)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 7 }}>
              {pendingAction.name === 'generate_asis'
                ? <><Workflow size={15} /> Regenerate the AS-IS? This replaces the current steps.</>
                : <><Target size={15} /> Regenerate the TO-BE? This replaces the current steps.</>}
            </div>
            {pendingAction.name === 'generate_asis' && (
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
                Input: <em>{String(pendingAction.payload.input ?? '')}</em>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="sm" variant="primary" icon={Play} onClick={() => executePendingAction(pendingAction)}>Run</Button>
              <Button size="sm" variant="ghost" onClick={() => setPendingActionLocal(null)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* An approved AS-IS / TO-BE: make a new version, then the request is done there */}
        {lockPrompt && !typing && (() => {
          const name = lockPrompt.what === 'asis' ? 'AS-IS' : 'TO-BE'
          const next = nextVersion(versionList)
          return (
            <div className="ui-card" style={{ margin: '10px 0 10px 38px', padding: '12px 14px', borderColor: '#c7d2fe', background: 'var(--accent-soft)' }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--accent)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 7 }}>
                <Lock size={14} /> This {name} (v{lockPrompt.version}) is already approved
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 10, lineHeight: 1.5 }}>
                Create a new version v{next.number} to make this change? v{lockPrompt.version} stays as it is.
                {next.replaces && <span style={{ display: 'block', color: '#b45309', marginTop: 4 }}>The unapproved AS-IS draft v{next.number} will be replaced.</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" variant="primary" icon={GitBranchPlus} loading={lockBusy} onClick={() => {
                  const { what, request } = lockPrompt
                  setLockBusy(true)
                  projectsApi.newVersion(projectId, what)
                    .then(async () => {
                      setLockPrompt(null)
                      refreshAfterVersionChange(qc, projectId)
                      await qc.refetchQueries({ queryKey: ['project', projectId] })
                      navigate(`/projects/${projectId}/${what}`)
                      send(request)   // the same request, now on the new version
                    })
                    .finally(() => setLockBusy(false))
                }}>Yes, create new version</Button>
                <Button size="sm" variant="ghost" disabled={lockBusy} onClick={() => setLockPrompt(null)}>No</Button>
              </div>
            </div>
          )
        })()}

        {/* Undo bar */}
        {undoSnapshot && !typing && !pendingAction && (
          <div className="ui-card" style={{ margin: '8px 0 8px 38px', display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px 6px 12px' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)', flex: 1 }}>Steps updated</span>
            <Button size="sm" icon={Undo2} onClick={undo}>Undo</Button>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 14px 14px', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
        {(voice.error || upload.busy.length > 0 || upload.done.length > 0 || upload.failed.length > 0) && (
          <div style={{ fontSize: 12.5, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {voice.error && <span style={{ color: 'var(--danger)' }}>{voice.error}</span>}
            {upload.busy.length > 0 && (
              <span style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Spinner size={12} /> Uploading {upload.busy.length} file{upload.busy.length > 1 ? 's' : ''}…
              </span>
            )}
            {upload.done.length > 0 && (
              <span style={{ color: 'var(--ink-2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FileText size={13} style={{ color: 'var(--accent)' }} />
                {upload.done.length === 1 ? upload.done[0] : `${upload.done.length} files`} added to
                <button type="button" onClick={() => navigate(`/projects/${projectId}/files`)}
                  style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', font: 'inherit' }}>
                  Knowledge
                </button>
              </span>
            )}
            {upload.failed.length > 0 && <span style={{ color: 'var(--danger)' }}>Could not upload: {upload.failed.join(', ')}</span>}
          </div>
        )}
        <div
          className={`composer${dropping ? ' composer--drop' : ''}`}
          style={{ padding: '10px 10px 8px 14px', borderRadius: 16 }}
          onDragOver={(e) => { e.preventDefault(); setDropping(true) }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => { e.preventDefault(); setDropping(false); uploadFiles(e.dataTransfer.files) }}
          onClick={(e) => { if (e.target === e.currentTarget) inputRef.current?.focus() }}
        >
          <textarea
            ref={inputRef}
            className="composer-input"
            dir="auto"
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
            placeholder={voice.state === 'recording' ? 'Listening… press stop when you\'re done'
              : voice.state === 'transcribing' ? 'Transcribing…'
              : 'Edit a step, ask a question, or give an instruction…'}
            disabled={typing || !historyLoaded || voice.state !== 'idle'}
            style={{ width: '100%', fontSize: 14, padding: '2px 0', maxHeight: 240 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 4 }}>
            <input ref={pickerRef} type="file" multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = '' }} />
            <button type="button" className="composer-tool" title="Upload documents to Knowledge" aria-label="Upload documents"
              onClick={() => pickerRef.current?.click()} disabled={upload.busy.length > 0}>
              {upload.busy.length > 0 ? <Spinner size={15} /> : <Plus size={18} strokeWidth={1.9} />}
            </button>
            {voice.supported && (
              <button
                type="button"
                className={`composer-tool${voice.state === 'recording' ? ' composer-tool--rec' : ''}`}
                title={voice.state === 'recording' ? 'Stop and send' : 'Speak a command'}
                aria-label={voice.state === 'recording' ? 'Stop recording' : 'Voice command'}
                onClick={() => { voice.clearError(); voice.toggle() }}
                disabled={typing || !historyLoaded || voice.state === 'transcribing'}
              >
                {voice.state === 'transcribing' ? <Spinner size={15} /> : voice.state === 'recording' ? <Square size={14} fill="currentColor" /> : <Mic size={17} strokeWidth={1.9} />}
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button type="button" className="composer-send" aria-label="Send" title="Send (Enter)"
              onClick={() => send(input)} disabled={!input.trim() || typing || voice.state !== 'idle'}>
              {typing ? <Spinner size={15} /> : <ArrowUp size={17} strokeWidth={2.2} />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
