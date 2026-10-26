import { sseStream, type SseEvent } from './client'

export const analyzeApi = {
  homeChat: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    onEvent: (e: SseEvent) => void,
  ) => sseStream('/api/home/chat', { messages }, onEvent),

  projectChat: (
    projectId: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    pane: string,
    onEvent: (e: SseEvent) => void,
  ) => sseStream(`/api/projects/${projectId}/chat`, { messages, pane }, onEvent),


  /** AS-IS mapping (documents first, web for gaps), then the review; the backend saves everything */
  asis: (
    input: string,
    project_id: string | undefined,
    onEvent: (e: SseEvent) => void,
    options?: { url?: string; query?: string },
  ) => sseStream('/api/analyze/asis', { input, project_id, ...options }, onEvent),

  /** Re-runs the AS-IS review (pain point, digital status, law per step); the backend saves it */
  asisReview: (project_id: string, onEvent: (e: SseEvent) => void) =>
    sseStream('/api/analyze/asis-review', { project_id }, onEvent),

  /** TO-BE generation from the approved AS-IS (confirmed information only); the backend saves the steps */
  tobe: (project_id: string, onEvent: (e: SseEvent) => void) =>
    sseStream('/api/analyze/tobe', { project_id }, onEvent),

  /** Drafts the implementation plan (strategic plan + work plan); the backend saves it */
  spsPlan: (project_id: string, onEvent: (e: SseEvent) => void) =>
    sseStream('/api/analyze/sps-plan', { project_id }, onEvent),

  chat: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    context: string | undefined,
    onEvent: (e: SseEvent) => void,
  ) => sseStream('/api/chat', { messages, context }, onEvent),

  webSearch: (query: string, onEvent: (e: SseEvent) => void) =>
    sseStream('/api/web-search', { query }, onEvent),

  adjustTobe: (
    tobe_steps: unknown[],
    request: string,
    context: string | undefined,
    onEvent: (e: SseEvent) => void,
  ) => sseStream('/api/adjust/tobe', { tobe_steps, request, context }, onEvent),
}
