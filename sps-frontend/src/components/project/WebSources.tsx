import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { Globe, Search, Check, X, Undo2, ExternalLink, ChevronDown, Link, Plus } from 'lucide-react'
import { projectsApi, type WebSource } from '@/api/projects'
import { Button, Spinner } from '@/components/ui'

/** The project's web sources and how many are accepted (also used by the "Start AS-IS" card) */
export function useWebSources(projectId: string) {
  const q = useQuery({ queryKey: ['web-sources', projectId], queryFn: () => projectsApi.webSources(projectId), enabled: !!projectId })
  const sources = q.data?.sources ?? []
  return {
    sources,
    defaultQuery: q.data?.default_query ?? '',
    pending: sources.filter((s) => s.status === 'pending'),
    accepted: sources.filter((s) => s.status === 'accepted'),
    rejected: sources.filter((s) => s.status === 'rejected'),
  }
}

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

/**
 * Knowledge page, first section: the assistant searches the web for the service, lists every
 * site it found with what the AS-IS would take from it, and the user accepts or rejects each.
 */
export default function WebSources({ projectId }: { projectId: string }) {
  const qc = useQueryClient()
  const { sources, defaultQuery, pending, accepted, rejected } = useWebSources(projectId)
  const sourcesCount = useRef(0)
  sourcesCount.current = sources.length
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState<string | null>(null)
  const [note, setNote] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)
  const [showRejected, setShowRejected] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)
  const pollRef = useRef<number | null>(null)
  // leaving the page stops listening (the server still finishes and saves the search)
  useEffect(() => () => {
    stopRef.current?.()
    stopRef.current = null
    if (pollRef.current) clearInterval(pollRef.current)
  }, [])

  // "Add a web page": a link of the user's own, with what the AS-IS should take from it
  const [linkOpen, setLinkOpen] = useState(false)
  const [link, setLink] = useState('')
  const [linkNote, setLinkNote] = useState('')
  const [adding, setAdding] = useState(false)

  // arriving from the Overview's "Let me search the web" / "Share a web page"
  const location = useLocation()
  const navigate = useNavigate()
  const asked = location.state as { webSearch?: boolean; addLink?: boolean } | null
  const started = useRef(false)
  useEffect(() => {
    if (started.current || !asked || !defaultQuery) return
    // started on the next tick: React's development double-mount runs this effect, its cleanup
    // and the effect again — starting at once would cancel the search in that cleanup
    const t = window.setTimeout(() => {
      started.current = true
      if (asked.webSearch) search()
      if (asked.addLink) setLinkOpen(true)
      navigate(location.pathname, { replace: true, state: null })   // a reload does not search again
    }, 0)
    return () => clearTimeout(t)
  }, [asked, defaultQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => qc.invalidateQueries({ queryKey: ['web-sources', projectId] })

  function search() {
    if (searching) return
    const q = query.trim() || defaultQuery
    setSearching(`Searching the web for “${q}”…`)
    setNote(null)
    stopRef.current = projectsApi.searchWebSources(projectId, q, (e) => {
      if (e.type === 'searching') setSearching(`Searching: ${e.query}`)
      if (e.type === 'done') {
        const added = (e as { added?: number }).added ?? 0
        setSearching(null)
        setNote(added
          ? { tone: 'info', text: `${added} new site${added > 1 ? 's' : ''} found — accept the ones the AS-IS should use.` }
          : { tone: 'info', text: 'No new sites found. Try different words.' })
        refresh()
      }
      if (e.type === 'error' && e.network) {
        // the connection dropped, but the server goes on and saves what it finds: watch the list
        setSearching('Still searching — the sites appear here as soon as they are found…')
        const before = sourcesCount.current
        let tries = 0
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = window.setInterval(async () => {
          tries++
          await refresh()
          if (sourcesCount.current > before || tries >= 36) {
            if (pollRef.current) clearInterval(pollRef.current)
            setSearching(null)
            if (sourcesCount.current === before) setNote({ tone: 'danger', text: 'The web search did not finish. Please try again.' })
          }
        }, 5000)
      } else if (e.type === 'error') {
        setSearching(null)
        setNote({ tone: 'danger', text: 'The web search did not work this time. Please try again.' })
      }
    })
  }

  async function addLink() {
    const url = link.trim()
    if (!url || adding) return
    setAdding(true)
    setNote(null)
    try {
      await projectsApi.addWebLink(projectId, /^https?:\/\//i.test(url) ? url : `https://${url}`, linkNote)
      setLink(''); setLinkNote(''); setLinkOpen(false)
      setNote({ tone: 'info', text: 'Web page added to the accepted sources.' })
    } catch {
      setNote({ tone: 'danger', text: 'That page could not be added — check the address and try again.' })
    } finally {
      setAdding(false)
      refresh()
    }
  }

  async function decide(s: WebSource, status: WebSource['status']) {
    // move the card at once; the server confirms
    qc.setQueryData(['web-sources', projectId], (old: { sources: WebSource[]; default_query: string } | undefined) =>
      old ? { ...old, sources: old.sources.map((x) => (x.id === s.id ? { ...x, status } : x)) } : old)
    try { await projectsApi.decideWebSource(projectId, s.id, status) } finally { refresh() }
  }

  return (
    <section className="ui-card kb-col" style={{ padding: '16px 18px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Globe size={16} strokeWidth={1.9} />
        </span>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Web sources</h3>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); search() }} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div style={{ flex: '1 1 220px', minWidth: 0, position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input className="ui-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={defaultQuery || 'What to search for'}
            disabled={!!searching} style={{ width: '100%', height: 38, paddingLeft: 32 }} />
        </div>
        <Button type="submit" variant="primary" icon={Search} loading={!!searching} disabled={!!searching} style={{ height: 38 }}>
          {pending.length + accepted.length + rejected.length ? 'Search again' : 'Search the web'}
        </Button>
        <Button type="button" icon={linkOpen ? X : Plus} variant={linkOpen ? 'active' : 'default'} onClick={() => setLinkOpen((o) => !o)} style={{ height: 38 }}>
          Add a web page
        </Button>
      </form>

      {/* the sites scroll inside the box: 3–4 visible at a glance */}
      <div className="kb-scroll">

      {linkOpen && (
        <form className="ws-link" onSubmit={(e) => { e.preventDefault(); addLink() }}>
          <div style={{ position: 'relative' }}>
            <Link size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input className="ui-input" value={link} onChange={(e) => setLink(e.target.value)} autoFocus disabled={adding}
              placeholder="https://… — a government portal, gazette, circular or citizen charter" style={{ width: '100%', height: 38, paddingLeft: 32 }} />
          </div>
          <textarea className="ui-input" rows={2} value={linkNote} onChange={(e) => setLinkNote(e.target.value)} disabled={adding}
            placeholder="Short description (optional): what should the AS-IS take from this page? e.g. the application steps and fees"
            style={{ width: '100%', resize: 'vertical', padding: '8px 10px', lineHeight: 1.5 }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button type="button" variant="ghost" disabled={adding} onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" icon={Check} loading={adding} disabled={!link.trim() || adding}>{adding ? 'Reading the page…' : 'Add as accepted source'}</Button>
          </div>
        </form>
      )}

      {searching && <div className="ws-status"><Spinner size={13} /> {searching}</div>}
      {note && !searching && <div className="ws-status" style={{ color: note.tone === 'danger' ? 'var(--danger)' : 'var(--ink-2)' }}>{note.text}</div>}

      <WsGroup title="Waiting for your approval" count={pending.length}>
        {pending.map((s) => (
          <WsCard key={s.id} source={s}>
            <Button size="sm" variant="primary" icon={Check} onClick={() => decide(s, 'accepted')}>Accept</Button>
            <Button size="sm" variant="danger" icon={X} onClick={() => decide(s, 'rejected')}>Reject</Button>
          </WsCard>
        ))}
      </WsGroup>

      <WsGroup title="Accepted — used by the AS-IS" count={accepted.length} tone="success">
        {accepted.map((s) => (
          <WsCard key={s.id} source={s} accepted>
            <Button size="sm" variant="ghost" icon={Undo2} onClick={() => decide(s, 'pending')}>Undo</Button>
          </WsCard>
        ))}
      </WsGroup>

      {rejected.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="ws-toggle" onClick={() => setShowRejected((v) => !v)}>
            <ChevronDown size={14} style={{ transform: showRejected ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
            {rejected.length} rejected site{rejected.length > 1 ? 's' : ''}
          </button>
          {showRejected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {rejected.map((s) => (
                <WsCard key={s.id} source={s} muted>
                  <Button size="sm" variant="ghost" icon={Undo2} onClick={() => decide(s, 'pending')}>Restore</Button>
                </WsCard>
              ))}
            </div>
          )}
        </div>
      )}
      </div>
    </section>
  )
}

/** A section of sites — shown only when it has any */
function WsGroup({ title, count, tone, children }: { title: string; count: number; tone?: 'success'; children: React.ReactNode }) {
  if (!count) return null
  return (
    <div style={{ marginTop: 14 }}>
      <div className="ws-group-title">
        {title}
        <span className={`ws-count${tone === 'success' ? ' ws-count--ok' : ''}`}>{count}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>{children}</div>
    </div>
  )
}

function WsCard({ source, accepted, muted, children }: { source: WebSource; accepted?: boolean; muted?: boolean; children: React.ReactNode }) {
  return (
    <div className={`ws-card${accepted ? ' ws-card--ok' : ''}${muted ? ' ws-card--muted' : ''}`}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <a href={source.url} target="_blank" rel="noreferrer" className="ws-title" title={source.url}>
          {source.title || host(source.url)} <ExternalLink size={12} />
        </a>
        <div className="ws-host">{host(source.url)}</div>
        <div className="ws-summary">{source.summary}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'flex-start' }}>{children}</div>
    </div>
  )
}
