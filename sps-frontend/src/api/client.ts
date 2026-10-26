export const BASE = import.meta.env.VITE_API_BASE ?? ''

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => req<T>(path),
  post: <T>(path: string, body?: unknown) =>
    req<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    req<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => req<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, form: FormData) =>
    req<T>(path, { method: 'POST', body: form, headers: {} }),
}

export type SseEvent =
  | { type: 'text'; text: string }
  | { type: 'progress'; text: string }
  | { type: 'done'; text: string }
  /** network: the connection dropped (a proxy timeout, a flaky network) — the server may still be working */
  | { type: 'error'; message: string; network?: boolean }
  | { type: 'searching'; step?: number; query: string }
  | { type: 'search_result'; step?: number; summary: string }
  | { type: 'questions'; questions: Array<{ id: string; step_number: number; question: string }>; research?: unknown; conversation?: unknown[] }
  | { type: 'research_complete'; research: unknown }
  | { type: 'tool_started'; name: string; input: Record<string, unknown> }
  | { type: 'step_updated'; step_type: 'asis' | 'tobe'; steps: unknown[] }
  | { type: 'action'; name: string; payload: Record<string, unknown> }
  | { type: 'project_updated'; name?: string; description?: string; goal?: string }
  | { type: 'project_created'; project: import('./projects').Project }
  | { type: 'project_proposed'; name: string; description?: string; goal?: string }
  /** the chat tried to change an approved AS-IS / TO-BE: ask the user about a new version */
  | { type: 'version_locked'; what: 'asis' | 'tobe'; version: number }
  /** quick replies the assistant offers: shown as buttons under its message */
  | { type: 'choices'; options: string[] }
  | { type: 'memory_updated' }
  | { type: 'review_updated' }
  | { type: 'findings_updated' }
  | { type: 'files_updated' }
  /** a run is already going on this project — the page follows it instead */
  | { type: 'busy'; running: 'asis' | 'tobe' | null }
  /** the AS-IS mapping starts over (a web-only run is retried) — clear the live table */
  | { type: 'restart' }
  /** the AS-IS review's JSON as it is written (fills the review columns live) */
  | { type: 'review_text'; text: string }
  /** the mapped AS-IS steps as saved, before the review */
  | { type: 'asis_saved'; steps: import('./projects').AsIsStep[] }

export function sseStream(
  path: string,
  body: unknown,
  onEvent: (e: SseEvent) => void,
): () => void {
  let active = true
  const ctrl = new AbortController()

  async function run() {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok || !res.body) {
      onEvent({ type: 'error', message: `HTTP ${res.status}` })
      return
    }
    // a stream that ends without done / error / busy was cut on the way
    let ended = false
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (active) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() ?? ''
      for (const part of parts) {
        const line = part.trim()
        if (!line.startsWith('data:')) continue
        try {
          const data = JSON.parse(line.slice(5).trim()) as SseEvent
          // Frontend SSE log — concise per event type
          if (data.type === 'tool_started') {
            console.log(`[SSE←] tool_started  name=${(data as {name:string}).name}`)
          } else if (data.type === 'step_updated') {
            const d = data as {step_type:string; steps:unknown[]}
            console.log(`[SSE←] step_updated  step_type=${d.step_type}  steps=${d.steps?.length}`)
          } else if (data.type === 'action') {
            const d = data as {name:string; payload:unknown}
            console.log(`[SSE←] action  name=${d.name}  payload=${JSON.stringify(d.payload).slice(0,80)}`)
          } else if (data.type === 'error') {
            console.error(`[SSE←] ERROR  ${(data as {message:string}).message}`)
          } else if (data.type === 'done') {
            console.log(`[SSE←] done`)
          } else if (data.type !== 'text' && data.type !== 'progress') {
            console.log(`[SSE←] ${data.type}  ${JSON.stringify(data).slice(0,100)}`)
          }
          if (data.type === 'done' || data.type === 'error' || data.type === 'busy') ended = true
          onEvent(data)
        } catch { /* ignore */ }
      }
    }
    if (!ended && active && !ctrl.signal.aborted) onEvent({ type: 'error', message: 'The connection was closed before the end.', network: true })
  }

  run().catch((err) => {
    if (!ctrl.signal.aborted) onEvent({ type: 'error', message: String(err), network: true })
  })

  return () => { active = false; ctrl.abort() }
}
