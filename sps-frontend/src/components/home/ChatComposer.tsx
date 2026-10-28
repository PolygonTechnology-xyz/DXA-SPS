import { useEffect, useRef, useState, type RefObject } from 'react'
import { Plus, Mic, Square, ArrowUp, FileText, X, ChevronDown, Check } from 'lucide-react'
import { Spinner } from '@/components/ui'
import type { ChatModel } from '@/api/analyze'
import type { VoiceState } from '@/hooks/useVoiceRecorder'

const MAX_FILES = 10

export const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface Props {
  inputRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder: string
  /** the assistant is answering — typing and sending wait */
  busy: boolean
  files: File[]
  onFilesChange: (files: File[]) => void
  voice: { state: VoiceState; error: string | null; supported: boolean; toggle: () => void; clearError: () => void }
  models: ChatModel[]
  model: string
  onModelChange: (id: string) => void
  /** the model menu opens upwards when the box sits at the bottom of the screen */
  menuUp: boolean
}

/** The home chat box: text, attachments, voice and the model picker */
export default function ChatComposer({ inputRef, value, onChange, onSubmit, placeholder, busy, files, onFilesChange, voice, models, model, onModelChange, menuUp }: Props) {
  const pickerRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  // grow with the text, up to about 8 lines
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value, inputRef])

  function addFiles(list: FileList | null) {
    if (!list?.length) return
    const known = new Set(files.map(fileKey))
    const added = Array.from(list).filter((f) => !known.has(fileKey(f)))
    onFilesChange([...files, ...added].slice(0, MAX_FILES))
  }

  const recording = voice.state === 'recording'
  const voiceBusy = voice.state !== 'idle'
  const canSend = (!!value.trim() || files.length > 0) && !busy && !voiceBusy

  return (
    <div style={{ width: '100%' }}>
      <div
        className={`composer${dragging ? ' composer--drop' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
        onClick={(e) => { if (e.target === e.currentTarget) inputRef.current?.focus() }}
      >
        {files.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 0 8px' }}>
            {files.map((f) => (
              <span key={fileKey(f)} className="composer-file" title={f.name}>
                <FileText size={14} strokeWidth={1.8} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{f.name}</span>
                <span style={{ color: 'var(--muted)', flexShrink: 0 }}>{fmtSize(f.size)}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onFilesChange(files.filter((x) => x !== f))}>
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <textarea
            ref={inputRef}
            rows={1}
            dir="auto"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) onSubmit() }
            }}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files) } }}
            placeholder={recording ? 'Listening…' : voice.state === 'transcribing' ? 'Transcribing…' : placeholder}
            disabled={busy || voiceBusy}
            className="composer-input"
          />
          <button
            type="button"
            className="composer-send"
            onClick={onSubmit}
            disabled={!canSend}
            aria-label="Send"
            title="Send (Enter)"
          >
            {busy ? <Spinner size={15} /> : <ArrowUp size={17} strokeWidth={2.2} />}
          </button>
        </div>
      </div>

      {/* Toolbar under the box */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 6, padding: '0 2px', minHeight: 32 }}>
        <input ref={pickerRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <button
          type="button" className="composer-tool" title="Attach files" aria-label="Attach files"
          onClick={() => pickerRef.current?.click()}
          disabled={busy || files.length >= MAX_FILES}
        >
          <Plus size={18} strokeWidth={1.9} />
        </button>
        {voice.supported && (
          <button
            type="button"
            className={`composer-tool${recording ? ' composer-tool--rec' : ''}`}
            title={recording ? 'Stop and send' : 'Speak a command'}
            aria-label={recording ? 'Stop recording' : 'Voice command'}
            onClick={() => { voice.clearError(); voice.toggle() }}
            disabled={busy || voice.state === 'transcribing'}
          >
            {voice.state === 'transcribing' ? <Spinner size={15} /> : recording ? <Square size={14} fill="currentColor" /> : <Mic size={17} strokeWidth={1.9} />}
          </button>
        )}

        <div style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 12, color: voice.error ? 'var(--danger)' : 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 8px' }}>
          {voice.error
            ?? (recording ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="voice-dot" /> Listening… press stop when you're done</span>
            : 'DXA is AI and can make mistakes.')}
        </div>

        <ModelPicker models={models} value={model} onChange={onModelChange} up={menuUp} disabled={busy} />
      </div>
    </div>
  )
}

function ModelPicker({ models, value, onChange, up, disabled }: { models: ChatModel[]; value: string; onChange: (id: string) => void; up: boolean; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!models.length) return null
  const current = models.find((m) => m.id === value) ?? models[0]

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button type="button" className="composer-model" onClick={() => setOpen((o) => !o)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}>
        {current.label}
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
      </button>
      {open && (
        <div role="listbox" className="composer-menu" style={up ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' }}>
          {models.map((m) => (
            <button
              key={m.id} type="button" role="option" aria-selected={m.id === current.id}
              onClick={() => { onChange(m.id); setOpen(false) }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{m.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{m.note}</span>
              </span>
              {m.id === current.id && <Check size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
