import { analyzeApi } from '@/api/analyze'
import type { AsIsStep } from '@/api/projects'
import { useSession } from '@/stores/session'
import { useNavigation } from '@/stores/navigation'
import { queryClient } from '@/lib/queryClient'
import { projectsApi, type Project } from '@/api/projects'
import { liveAsisSteps, withLiveReview } from '@/lib/liveSteps'

export interface AsisRunOptions {
  projectId: string
  name: string
  description?: string
  /** who owns the service — narrows the research to the right office */
  ministry?: string
  department?: string
  /** a page to read (web_fetch) */
  url?: string
  /** extra web-search focus */
  query?: string
  /** extra instructions, e.g. from the chat rail */
  extra?: string
}

let stopCurrent: (() => void) | null = null

/**
 * Waits until the server has finished the run on this project (it keeps going when the
 * browser's connection drops) and returns the project as saved — null if it never ends.
 */
export async function waitForServer(projectId: string): Promise<Project | null> {
  const deadline = Date.now() + 45 * 60_000
  while (Date.now() < deadline) {
    try {
      const p = await queryClient.fetchQuery({ queryKey: ['project', projectId], queryFn: () => projectsApi.get(projectId), staleTime: 0 })
      if (!p.running) return p
    } catch { /* the network may still be away — keep trying */ }
    await new Promise((r) => setTimeout(r, 4000))
  }
  return null
}

/**
 * The live connection dropped (a proxy timeout, a flaky network) but the run goes on on the
 * server: no error for that. The page shows it as running on the server; when it ends, its
 * result shows — and only if it ended WITHOUT a result is the user told it failed.
 */
async function followOnServer(projectId: string, retry?: AsisRunOptions): Promise<void> {
  queryClient.invalidateQueries({ queryKey: ['project', projectId] })
  const p = await waitForServer(projectId)
  afterReview(projectId)
  if (retry && !(p?.asis_steps?.length)) {
    useSession.getState().setAsisError({
      projectId,
      message: 'The AS-IS could not be finished. Please try again.',
      opts: { url: retry.url, query: retry.query, extra: retry.extra },
    })
  }
}

/** After a mapping or review: refresh the project and the chat (consent card, questions) */
function afterReview(projectId: string) {
  queryClient.invalidateQueries({ queryKey: ['project', projectId] })
  queryClient.invalidateQueries({ queryKey: ['projects'] })
  queryClient.invalidateQueries({ queryKey: ['chat-messages', projectId] })
  useNavigation.getState().requestChatOpen()
}

/**
 * Runs AS-IS generation (documents first, web for gaps), followed on the server by the
 * review (pain point, digital status, law per step). The backend saves everything; this
 * only drives the progress overlay and refreshes the cache, so it finishes correctly
 * even if the user switches tabs while it runs.
 */
export function runAsis(opts: AsisRunOptions): Promise<{ ok: boolean; error?: string }> {
  const session = useSession.getState()
  stopCurrent?.()
  session.setAsisError(null)
  session.setRunning(true)
  session.setLiveAsis({ phase: 'mapping', steps: [], reviewed: 0 })
  session.setProgress('Researching the AS-IS process…')

  const input = [
    `Analyze the complete AS-IS process for: ${opts.name}.`,
    opts.ministry ? `Ministry: ${opts.ministry}` : '',
    opts.department ? `Department: ${opts.department}` : '',
    opts.description ? `Service summary: ${opts.description}` : '',
    opts.extra ?? '',
  ].filter(Boolean).join('\n')

  return new Promise((resolve) => {
    let stepsSeen = 0
    let text = ''
    let reviewText = ''
    let saved: AsIsStep[] = []
    const finish = (result: { ok: boolean; error?: string }) => {
      useSession.getState().setLiveAsis(null)
      useSession.getState().setRunning(false)
      useSession.getState().setProgress('')
      // remembered for the AS-IS page, whichever page started the run
      if (!result.ok) useSession.getState().setAsisError({
        projectId: opts.projectId,
        message: result.error ?? 'The AS-IS could not be made. Please try again.',
        opts: { url: opts.url, query: opts.query, extra: opts.extra },
      })
      stopCurrent = null
      resolve(result)
    }

    stopCurrent = analyzeApi.asis(input, opts.projectId, (e) => {
      const set = useSession.getState().setProgress
      if (e.type === 'progress') set(e.text)
      if (e.type === 'searching') set(`Searching: ${e.query}`)
      if (e.type === 'search_result') set(`Reading sources — ${e.summary}`)
      if (e.type === 'restart') {
        text = ''
        stepsSeen = 0
        useSession.getState().setLiveAsis({ phase: 'mapping', steps: [], reviewed: 0 })
      }
      // the table on the AS-IS page fills in as the steps (then the review columns) are written
      if (e.type === 'text') {
        text += e.text
        const live = liveAsisSteps(text)
        if (live.length > stepsSeen) {
          stepsSeen = live.length
          set(`Mapping step ${live.length}…`)
          useSession.getState().setLiveAsis({ phase: 'mapping', steps: live, reviewed: 0 })
        }
      }
      if (e.type === 'asis_saved') {
        saved = e.steps
        useSession.getState().setLiveAsis({ phase: 'review', steps: saved, reviewed: 0 })
      }
      if (e.type === 'review_text') {
        reviewText += e.text
        const live = withLiveReview(saved, reviewText)
        if (live.reviewed > (useSession.getState().liveAsis?.reviewed ?? 0)) {
          useSession.getState().setLiveAsis({ phase: 'review', ...live })
          set(`Reviewing step ${live.reviewed} of ${saved.length} — pain point, digital status, law`)
        }
      }
      // a run is already going (e.g. started before a reload): the page follows it instead
      if (e.type === 'busy') {
        queryClient.setQueryData(['project', opts.projectId], (old: Record<string, unknown> | undefined) => (old ? { ...old, running: e.running } : old))
        queryClient.invalidateQueries({ queryKey: ['project', opts.projectId] })
        finish({ ok: true })
        return
      }
      if (e.type === 'done') {
        let steps: AsIsStep[] = []
        try { steps = (JSON.parse(e.text) as { steps?: AsIsStep[] }).steps ?? [] } catch { /* handled below */ }
        if (!steps.length) { finish({ ok: false, error: 'AI did not return structured steps. Please try again.' }); return }
        queryClient.setQueryData(['project', opts.projectId], (old: Record<string, unknown> | undefined) =>
          old ? { ...old, asis_steps: steps, tobe_steps: [], status: 'asis_complete' } : old)
        afterReview(opts.projectId)
        finish({ ok: true })
      }
      if (e.type === 'error' && e.network) { finish({ ok: true }); followOnServer(opts.projectId, opts); return }
      if (e.type === 'error') finish({ ok: false, error: e.message })
    }, { url: opts.url, query: opts.query })
  })
}

/** Runs the AS-IS review again ("Review now" / "Review again") with the same progress overlay */
export function runReview(projectId: string): Promise<{ ok: boolean; error?: string }> {
  const session = useSession.getState()
  stopCurrent?.()
  session.setRunning(true)
  session.setProgress('Reviewing the AS-IS…')
  const current = (queryClient.getQueryData(['project', projectId]) as { asis_steps?: AsIsStep[] } | undefined)?.asis_steps ?? []
  session.setLiveAsis({ phase: 'review', steps: current, reviewed: 0 })
  let reviewText = ''
  return new Promise((resolve) => {
    const finish = (result: { ok: boolean; error?: string }) => {
      useSession.getState().setLiveAsis(null)
      useSession.getState().setRunning(false)
      useSession.getState().setProgress('')
      stopCurrent = null
      resolve(result)
    }
    stopCurrent = analyzeApi.asisReview(projectId, (e) => {
      const set = useSession.getState().setProgress
      if (e.type === 'progress') set(e.text)
      if (e.type === 'searching') set(`Searching: ${e.query}`)
      if (e.type === 'search_result') set(`Reading sources — ${e.summary}`)
      if (e.type === 'review_text') {
        reviewText += e.text
        const live = withLiveReview(current, reviewText)
        if (live.reviewed > (useSession.getState().liveAsis?.reviewed ?? 0)) {
          useSession.getState().setLiveAsis({ phase: 'review', ...live })
          set(`Reviewing step ${live.reviewed} of ${current.length} — pain point, digital status, law`)
        }
      }
      if (e.type === 'busy') {
        queryClient.setQueryData(['project', projectId], (old: Record<string, unknown> | undefined) => (old ? { ...old, running: e.running } : old))
        queryClient.invalidateQueries({ queryKey: ['project', projectId] })
        finish({ ok: true })
        return
      }
      if (e.type === 'done') { afterReview(projectId); finish({ ok: true }) }
      if (e.type === 'error' && e.network) { finish({ ok: true }); followOnServer(projectId); return }
      if (e.type === 'error') { afterReview(projectId); finish({ ok: false, error: e.message }) }
    })
  })
}

export function stopAsis() {
  stopCurrent?.()
  stopCurrent = null
  useSession.getState().setLiveAsis(null)
  useSession.getState().setRunning(false)
  useSession.getState().setProgress('')
}
