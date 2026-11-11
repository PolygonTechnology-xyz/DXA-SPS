const BASE = import.meta.env.VITE_API_BASE ?? ''

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt?: string
}

export interface SessionEvent {
  type: 'message' | 'typing' | 'done' | 'error' | 'progress'
  payload?: string
}

export function connectSession(
  workspaceId: string,
  onEvent: (e: SessionEvent) => void,
): () => void {
  const url = `${BASE}/workspace/${workspaceId}/live`.replace('http', 'ws')
  const ws = new WebSocket(url)

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.type === 'message' || data.type === 'assistant') {
        onEvent({ type: 'message', payload: data.content ?? data.text ?? '' })
      } else if (data.type === 'typing' || data.type === 'thinking') {
        onEvent({ type: 'typing' })
      } else if (data.type === 'done' || data.type === 'complete') {
        onEvent({ type: 'done' })
      } else if (data.type === 'error') {
        onEvent({ type: 'error', payload: data.message })
      } else if (data.type === 'progress' || data.type === 'status') {
        onEvent({ type: 'progress', payload: data.message ?? data.content })
      }
    } catch {
      onEvent({ type: 'message', payload: e.data })
    }
  }

  ws.onerror = () => onEvent({ type: 'error', payload: 'Connection lost' })
  ws.onclose = () => onEvent({ type: 'done' })

  return () => ws.close()
}
