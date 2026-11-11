import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { projectsApi, type WebSource } from '@/api/projects'

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

export const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

export type WsNote = { tone: 'info' | 'danger'; text: string }

/**
 * What the Knowledge page does with web pages: the assistant searches the web for the service
 * (the sites it finds wait for the user's approval), the user adds a page of their own, and
 * accepts or rejects each site.
 */
export function useWebSourceActions(projectId: string) {
  const qc = useQueryClient()
  const { sources } = useWebSources(projectId)
  const sourcesCount = useRef(0)
  sourcesCount.current = sources.length
  const [searching, setSearching] = useState<string | null>(null)
  const [note, setNote] = useState<WsNote | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const pollRef = useRef<number | null>(null)
  // leaving the page stops listening (the server still finishes and saves the search)
  useEffect(() => () => {
    stopRef.current?.()
    stopRef.current = null
    if (pollRef.current) clearInterval(pollRef.current)
  }, [])

  const refresh = () => qc.invalidateQueries({ queryKey: ['web-sources', projectId] })

  function search(q: string) {
    if (searching || !q.trim()) return
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

  /** a link of the user's own, with what the AS-IS should take from it — true once added */
  async function addLink(raw: string, linkNote: string): Promise<boolean> {
    const url = raw.trim()
    if (!url) return false
    setNote(null)
    try {
      await projectsApi.addWebLink(projectId, /^https?:\/\//i.test(url) ? url : `https://${url}`, linkNote)
      setNote({ tone: 'info', text: 'Web page added to your documents.' })
      return true
    } catch {
      return false
    } finally {
      refresh()
    }
  }

  async function decide(list: WebSource[], status: WebSource['status']) {
    if (!list.length) return
    const ids = new Set(list.map((s) => s.id))
    // move the rows at once; the server confirms
    qc.setQueryData(['web-sources', projectId], (old: { sources: WebSource[]; default_query: string } | undefined) =>
      old ? { ...old, sources: old.sources.map((x) => (ids.has(x.id) ? { ...x, status } : x)) } : old)
    try { await Promise.allSettled(list.map((s) => projectsApi.decideWebSource(projectId, s.id, status))) } finally { refresh() }
  }

  return { searching, note, setNote, search, addLink, decide }
}
