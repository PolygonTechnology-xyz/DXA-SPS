import { create } from 'zustand'
import type { ChatMessage } from '@/api/session'
import type { AsIsStep } from '@/api/projects'

interface SessionStore {
  messages: ChatMessage[]
  isTyping: boolean
  progressText: string
  sessionId: string | null
  isRunning: boolean
  /** the AS-IS run shown live: its steps so far, and the phase (mapping, then the review) */
  liveAsis: { phase: 'mapping' | 'review'; steps: AsIsStep[]; reviewed: number } | null
  setLiveAsis: (v: SessionStore['liveAsis']) => void
  /** the last AS-IS run that failed, wherever it was started (Overview, chat, AS-IS page) — for "Try again" */
  asisError: { projectId: string; message: string; opts: { url?: string; query?: string; extra?: string } } | null
  setAsisError: (v: SessionStore['asisError']) => void
  addMessage: (msg: ChatMessage) => void
  setTyping: (v: boolean) => void
  setProgress: (text: string) => void
  setSessionId: (id: string | null) => void
  setRunning: (v: boolean) => void
  reset: () => void
}

export const useSession = create<SessionStore>((set) => ({
  messages: [],
  isTyping: false,
  progressText: '',
  sessionId: null,
  isRunning: false,
  liveAsis: null,
  setLiveAsis: (liveAsis) => set({ liveAsis }),
  asisError: null,
  setAsisError: (asisError) => set({ asisError }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setTyping: (isTyping) => set({ isTyping }),
  setProgress: (progressText) => set({ progressText }),
  setSessionId: (sessionId) => set({ sessionId }),
  setRunning: (isRunning) => set({ isRunning }),
  reset: () => set({ messages: [], isTyping: false, progressText: '', sessionId: null, isRunning: false, liveAsis: null }),
}))
