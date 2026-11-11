import { useEffect, useRef, useState } from 'react'
import { Upload, Link as LinkIcon, Search, Download, ClipboardList, Cloud, X, ArrowLeft, Check } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui'
import { UPLOAD_ACCEPT } from '@/lib/files'

export type SourceView = 'menu' | 'link' | 'search'

interface Props {
  initialView?: SourceView
  defaultQuery: string
  onClose: () => void
  onFiles: (files: FileList) => void
  onSearch: (query: string) => void
  /** true once the page is added */
  onLink: (url: string, note: string) => Promise<boolean>
}

/** "Add sources": one place to bring anything into the project's Knowledge */
export default function AddSourcesDialog({ initialView = 'menu', defaultQuery, onClose, onFiles, onSearch, onLink }: Props) {
  const [view, setView] = useState<SourceView>(initialView)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const busyRef = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busyRef.current) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const titles: Record<SourceView, [string, string]> = {
    menu: ['Add sources', 'Choose how you want to add sources to this project’s knowledge'],
    link: ['Add a link', 'A web page the AS-IS should read: a portal, gazette, circular or citizen charter'],
    search: ['Search the web', 'The agent lists the official sites it finds — you accept or reject each'],
  }
  const [title, sub] = titles[view]

  return (
    <div className="src-backdrop" onClick={() => { if (!busyRef.current) onClose() }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) { onFiles(e.dataTransfer.files); onClose() } }}>
      <div role="dialog" aria-modal="true" aria-labelledby="src-title" className="src-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="src-head">
          {view !== 'menu' && (
            <button type="button" className="src-x" aria-label="Back" onClick={() => setView('menu')} style={{ marginRight: 4 }}>
              <ArrowLeft size={18} />
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="src-title">{title}</h2>
            <p>{sub}</p>
          </div>
          <button type="button" className="src-x" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="src-body">
          {view === 'menu' && (
            <>
              <p className="src-ask">How would you like to add sources?</p>
              <input ref={inputRef} type="file" multiple accept={UPLOAD_ACCEPT} hidden
                onChange={(e) => { if (e.target.files?.length) { onFiles(e.target.files); onClose() } }} />
              <div className={`src-grid${dragging ? ' src-grid--drop' : ''}`}>
                <Tile icon={Upload} title="Files" sub={dragging ? 'Drop to upload' : 'Upload documents'} onClick={() => inputRef.current?.click()} />
                <Tile icon={LinkIcon} title="Link" sub="Paste URL" onClick={() => setView('link')} />
                <Tile icon={Search} title="Search" sub="Web search" onClick={() => setView('search')} />
                <Tile icon={Download} title="Knowledge" sub="Use existing" soon />
                <Tile icon={ClipboardList} title="Survey" sub="Collect data" soon />
                <Tile icon={Cloud} title="Drive" sub="Cloud storage (Google Drive, Microsoft SharePoint, etc.)" soon />
              </div>
              <p className="src-foot">
                Supported: PDF, DOCX, DOC, PPTX, XLSX, XLS, CSV, TXT, MD, HTML, ODT, RTF and images (PNG, JPG, WEBP, TIFF) — scanned pages and Bangla are read too
              </p>
            </>
          )}
          {view === 'link' && <LinkForm busyRef={busyRef} onLink={onLink} onDone={onClose} />}
          {view === 'search' && <SearchForm defaultQuery={defaultQuery} onSearch={(q) => { onSearch(q); onClose() }} />}
        </div>
      </div>
    </div>
  )
}

function Tile({ icon: Icon, title, sub, onClick, soon }: { icon: LucideIcon; title: string; sub: string; onClick?: () => void; soon?: boolean }) {
  return (
    <button type="button" className="src-tile" onClick={onClick} disabled={soon} aria-label={soon ? `${title} (coming soon)` : title}>
      {soon && <span className="src-soon">Soon</span>}
      <Icon size={22} strokeWidth={1.6} />
      <strong>{title}</strong>
      <span>{sub}</span>
    </button>
  )
}

function LinkForm({ busyRef, onLink, onDone }: { busyRef: React.MutableRefObject<boolean>; onLink: Props['onLink']; onDone: () => void }) {
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  async function submit() {
    if (!link.trim() || adding) return
    setAdding(true); busyRef.current = true; setError('')
    const ok = await onLink(link, note)
    setAdding(false); busyRef.current = false
    if (ok) onDone()
    else setError('That page could not be added — check the address and try again.')
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit() }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ position: 'relative' }}>
        <LinkIcon size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
        <input className="ui-input" value={link} onChange={(e) => setLink(e.target.value)} autoFocus disabled={adding}
          placeholder="https://…" style={{ paddingLeft: 32 }} />
      </div>
      <textarea className="ui-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={adding}
        placeholder="Short description (optional): what should the AS-IS take from this page? e.g. the application steps and fees"
        style={{ height: 'auto', resize: 'vertical', padding: '8px 12px', lineHeight: 1.5 }} />
      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="submit" variant="primary" icon={Check} loading={adding} disabled={!link.trim() || adding}>
          {adding ? 'Reading the page…' : 'Add to documents'}
        </Button>
      </div>
    </form>
  )
}

function SearchForm({ defaultQuery, onSearch }: { defaultQuery: string; onSearch: (q: string) => void }) {
  const [query, setQuery] = useState('')
  const q = query.trim() || defaultQuery
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (q) onSearch(q) }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
        <input className="ui-input" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
          placeholder={defaultQuery || 'What to search for'} style={{ paddingLeft: 32 }} />
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>
        Leave it empty to search for the service itself. Nothing is used until you accept it.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="submit" variant="primary" icon={Search} disabled={!q}>Search the web</Button>
      </div>
    </form>
  )
}
