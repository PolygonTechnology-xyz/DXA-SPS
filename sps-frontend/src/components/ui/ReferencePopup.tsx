import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Globe, FileText, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, BASE } from '@/api/client'
import { useReference, type PopupSource } from '@/stores/reference'
import { Spinner } from '@/components/ui'
import SheetView from './SheetView'

// Opens when a [n] citation or a reference is clicked:
//  - web page: title, site, the text taken from it, and a button to the website
//  - uploaded document: the cited page with the text taken from it marked in yellow

interface PageData { name: string; kind: string | null; page: number; pages: number; text: string; quality: string }

const href = (url: string) => (url.startsWith('/') ? BASE + url : url)
const readableUrl = (url: string) => { try { return decodeURI(url) } catch { return url } }
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

/** "/api/projects/p/files/f/view#page=4" → project, file, page (section number from the title for non-PDFs) */
function parseDoc(s: PopupSource) {
  const m = s.url.match(/\/api\/projects\/([^/]+)\/files\/([^/#?]+)\/view(?:#page=(\d+))?/)
  if (!m) return null
  const fromTitle = s.title.match(/,\s*(?:p\.|section)\s*(\d+)\s*$/)
  return { projectId: m[1], fileId: m[2], page: Number(m[3] ?? fromTitle?.[1] ?? 1) }
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Character ranges of the quotes in the text — whitespace may differ; falls back to the first or last 8 words */
function findRanges(text: string, quotes: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const q of quotes) {
    const words = q.split(/\s+/).filter(Boolean).map(escapeRe)
    if (!words.length) continue
    const tries = [words, words.slice(0, 8), words.slice(-8)].filter((w) => w.length >= Math.min(4, words.length))
    for (const w of tries) {
      const m = new RegExp(w.join('\\s+'), 'iu').exec(text)
      if (m) { ranges.push([m.index, m.index + m[0].length]); break }
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  return merged
}

function Highlighted({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  const parts: ReactNode[] = []
  let at = 0
  ranges.forEach(([a, b], i) => {
    if (a > at) parts.push(text.slice(at, a))
    parts.push(<mark key={i} data-quote style={{ background: '#fde047', color: 'inherit', borderRadius: 3, padding: '1px 0' }}>{text.slice(a, b)}</mark>)
    at = b
  })
  parts.push(text.slice(at))
  return <>{parts}</>
}

function QuoteBox({ quotes, label }: { quotes: string[]; label: string }) {
  if (!quotes.length) return null
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      {quotes.map((q, i) => (
        <blockquote key={i} style={{ margin: '0 0 6px', padding: '8px 12px', borderLeft: '3px solid #eab308', background: '#fef9c3', borderRadius: 6, fontSize: 13.5, lineHeight: 1.6 }}>
          {q}
        </blockquote>
      ))}
    </div>
  )
}

export default function ReferencePopup() {
  const { source, closeReference } = useReference()
  useEffect(() => {
    if (!source) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeReference() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [source, closeReference])
  if (!source) return null

  const doc = source.kind === 'doc' ? parseDoc(source) : null
  return (
    <div
      onClick={closeReference}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(17,24,39,.45)', display: 'grid', placeItems: 'center', padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="ui-card"
        style={{
          // documents get a large, fixed-height window (the file fills it); websites a small one
          ...(doc ? { width: 'min(1400px, 100%)', height: '90vh' } : { width: 'min(820px, 100%)', maxHeight: '88vh' }),
          display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,.25)',
        }}
      >
        {doc ? <DocView source={source} doc={doc} onClose={closeReference} /> : <WebView source={source} onClose={closeReference} />}
      </div>
    </div>
  )
}

function Header({ icon, title, sub, onClose }: { icon: ReactNode; title: string; sub: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
      <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14.5, overflowWrap: 'anywhere' }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{sub}</div>
      </div>
      <button onClick={onClose} aria-label="Close" className="ui-icon-btn"><X size={17} strokeWidth={1.8} /></button>
    </div>
  )
}

interface WebPageData { url: string; title: string; text: string }

/** The server's {"error": "..."} message, or a plain one */
function errorText(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : ''
  try { const e = JSON.parse(raw) as { error?: string }; if (e.error && e.error.includes(' ')) return e.error } catch { /* not JSON */ }
  if (/not_found|404/i.test(raw)) return `${fallback} Restart the backend if it was just updated.`
  return fallback
}

function WebView({ source, onClose }: { source: PopupSource; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['web-page', source.url],
    queryFn: () => api.get<WebPageData>(`/api/web-page?url=${encodeURIComponent(source.url)}`),
    retry: false,
    staleTime: 30 * 60_000,
  })
  const quotes = useMemo(() => source.quotes ?? [], [source])
  const ranges = useMemo(() => (data?.text ? findRanges(data.text, quotes) : []), [data, quotes])

  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bodyRef.current?.querySelector('mark[data-quote]')?.scrollIntoView({ block: 'center' })
  }, [ranges])

  return (
    <>
      <Header icon={<Globe size={17} strokeWidth={1.8} />} title={source.title} sub={hostOf(source.url)} onClose={onClose} />
      <div ref={bodyRef} style={{ flex: 1, minHeight: 200, overflowY: 'auto', padding: '14px 18px', background: 'var(--surface)' }}>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}><Spinner size={14} /> Loading the web page…</div>
        ) : error || !data?.text ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
              {error ? errorText(error, 'The web page could not be loaded here.') : 'This web page has no readable text.'} Use “Open website” below to see it.
            </p>
            <QuoteBox quotes={quotes} label="Text taken from this page" />
          </>
        ) : (
          <>
            {quotes.length > 0 && ranges.length === 0 && (
              <p style={{ fontSize: 12.5, color: 'var(--warn)', margin: '0 0 10px' }}>The exact text could not be found on the page as it is now — it may have changed.</p>
            )}
            {!quotes.length && (
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 10px' }}>The exact text used was not saved for this reference, so nothing is marked.</p>
            )}
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.75, overflowWrap: 'anywhere' }}>
              <Highlighted text={data.text} ranges={ranges} />
            </div>
            {quotes.length > 0 && ranges.length === 0 && <QuoteBox quotes={quotes} label="Text taken from this page" />}
          </>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={readableUrl(source.url)}>{readableUrl(source.url)}</span>
        <a className="ui-btn ui-btn--sm ui-btn--primary" href={href(source.url)} target="_blank" rel="noreferrer"><ExternalLink size={15} strokeWidth={1.9} /> Open website</a>
      </div>
    </>
  )
}

function DocView({ source, doc, onClose }: { source: PopupSource; doc: { projectId: string; fileId: string; page: number }; onClose: () => void }) {
  const [page, setPage] = useState(doc.page)
  useEffect(() => setPage(doc.page), [doc.fileId, doc.page])
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['file-page', doc.fileId, page],
    retry: false,
    queryFn: () => api.get<PageData>(`/api/projects/${doc.projectId}/files/${doc.fileId}/pages/${page}`),
  })
  const quotes = useMemo(() => source.quotes ?? [], [source])
  const readable = !!data && data.quality === 'good' && data.text.trim().length > 0
  const ranges = useMemo(() => (readable ? findRanges(data!.text, quotes) : []), [readable, data, quotes])

  // bring the yellow mark into view
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const mark = bodyRef.current?.querySelector('mark[data-quote]')
    if (mark) mark.scrollIntoView({ block: 'center' })
    else bodyRef.current?.scrollTo({ top: 0 })
  }, [ranges, page])

  // PDFs (and Word / PowerPoint files, shown as the PDF the AI read) and images are shown as they are
  const isSheet = /\.(xlsx|xlsm|xls|ods|csv)$/i.test(data?.name ?? source.title.replace(/,\s*(?:p\.|section)\s*\d+\s*$/, ''))
  const citedSheet = data?.text.match(/^Sheet "(.+?)"/)?.[1]
  const asIs = data?.kind === 'pdf' || data?.kind === 'image' || isSheet
  const unit = data?.kind === 'pdf' || !data ? 'Page' : 'Section'
  const name = data?.name ?? source.title.replace(/,\s*(?:p\.|section)\s*\d+\s*$/, '')
  const fileHref = href(`/api/projects/${doc.projectId}/files/${doc.fileId}/view${data?.kind === 'pdf' ? `#page=${page}` : ''}`)

  return (
    <>
      <Header icon={<FileText size={17} strokeWidth={1.8} />} title={name} sub={data?.kind === 'image' ? 'Uploaded document · image' : isSheet ? `Uploaded spreadsheet${citedSheet ? ` · sheet “${citedSheet}” (cited)` : ''}` : `Uploaded document · ${unit} ${page}${data ? ` of ${data.pages}` : ''}${page === doc.page ? ' (cited)' : ''}`} onClose={onClose} />
      {/* "Taken from …" strip — not for spreadsheets (the cells themselves are marked yellow); remove "!isSheet &&" to show it again */}
      {asIs && !isSheet && quotes.length > 0 && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--line)', background: '#fef9c3', fontSize: 13, lineHeight: 1.55, maxHeight: 76, overflowY: 'auto', flexShrink: 0 }}>
          <span style={{ fontWeight: 600 }}>Taken from {data?.kind === 'pdf' ? `page ${doc.page}` : citedSheet ? `sheet “${citedSheet}”` : 'this file'}: </span>
          {quotes.map((q) => `“${q}”`).join('  ·  ')}
        </div>
      )}
      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: isSheet || data?.kind === 'pdf' ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column', padding: asIs ? 0 : '14px 18px', background: 'var(--surface)' }}>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13, padding: '14px 18px' }}><Spinner size={14} /> Loading the page…</div>
        ) : isError || !data ? (
          <p style={{ color: 'var(--danger)', fontSize: 13, padding: '0 18px' }}>{errorText(error, 'Could not load this page.')}</p>
        ) : isSheet ? (
          <SheetView projectId={doc.projectId} fileId={doc.fileId} quotes={quotes} citedSheet={citedSheet} />
        ) : data.kind === 'pdf' ? (
          // the browser's own PDF viewer, opened at the cited page
          <iframe key={doc.page} src={fileHref} title={name} style={{ display: 'block', width: '100%', flex: 1, minHeight: 0, border: 0, background: '#525659' }} />
        ) : data.kind === 'image' ? (
          <img src={href(`/api/projects/${doc.projectId}/files/${doc.fileId}/view`)} alt={name} style={{ display: 'block', maxWidth: '100%', margin: '0 auto' }} />
        ) : readable ? (
          <>
            {page === doc.page && quotes.length > 0 && ranges.length === 0 && (
              <p style={{ fontSize: 12.5, color: 'var(--warn)', margin: '0 0 10px' }}>The exact text could not be found on this page — it is shown below.</p>
            )}
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.75, overflowWrap: 'anywhere' }}>
              <Highlighted text={data.text} ranges={ranges} />
            </div>
            {page === doc.page && quotes.length > 0 && ranges.length === 0 && <QuoteBox quotes={quotes} label="Text taken from this page" />}
          </>
        ) : data.kind === 'pdf' ? (
          <>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 10px' }}>This page is scanned (or uses an old font), so the text can't be marked on it. {page === doc.page && quotes.length ? 'The text taken from it is shown below the page.' : ''}</p>
            <img src={href(`/api/projects/${doc.projectId}/files/${doc.fileId}/pages/${page}/image`)} alt={`${unit} ${page}`} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 6, background: '#fff' }} />
            {page === doc.page && <QuoteBox quotes={quotes} label="Text taken from this page" />}
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>This part of the document has no readable text — open the file to see it.</p>
            {page === doc.page && <QuoteBox quotes={quotes} label="Text taken from it" />}
          </>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
        {/* the PDF viewer has its own page controls */}
        {!asIs && <>
          <button className="ui-btn ui-btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={15} strokeWidth={1.9} /> Previous</button>
          <button className="ui-btn ui-btn--sm" disabled={!data || page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight size={15} strokeWidth={1.9} /></button>
          {page !== doc.page && <button className="ui-btn ui-btn--sm ui-btn--ghost" onClick={() => setPage(doc.page)}>Back to cited {unit.toLowerCase()}</button>}
        </>}
        <span style={{ flex: 1 }} />
        <a className="ui-btn ui-btn--sm" href={fileHref} target="_blank" rel="noreferrer"><ExternalLink size={15} strokeWidth={1.9} /> Open full file</a>
      </div>
    </>
  )
}
