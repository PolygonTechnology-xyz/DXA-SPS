import { create } from 'zustand'
import type { ToBeStep } from '@/api/projects'

// TO-BE generation runs from the approved AS-IS (no separate research or interview):
// idle → generating → done.
export type ToBeStage = 'idle' | 'generating' | 'done'

export type LogItem =
  | { kind: 'progress'; text: string }
  | { kind: 'searching'; step?: number; query: string }
  | { kind: 'search_result'; step?: number; summary: string }

interface ToBeStore {
  projectId: string | null
  stage: ToBeStage
  log: LogItem[]
  genError: string | null
  /** TO-BE steps as they are written, shown live (read-only) until the run ends */
  liveSteps: ToBeStep[]
  // SSE stop function stored here so it survives component unmount
  stopFn: (() => void) | null

  initForProject: (id: string) => void
  setStage: (s: ToBeStage) => void
  addLog: (item: LogItem) => void
  setGenError: (e: string | null) => void
  setLiveSteps: (steps: ToBeStep[]) => void
  setStopFn: (fn: (() => void) | null) => void
  reset: () => void
}

const INITIAL = {
  projectId: null as string | null,
  stage: 'idle' as ToBeStage,
  log: [] as LogItem[],
  genError: null as string | null,
  liveSteps: [] as ToBeStep[],
  stopFn: null as (() => void) | null,
}

export const useToBeStore = create<ToBeStore>((set, get) => ({
  ...INITIAL,

  initForProject: (id) => {
    if (get().projectId === id) return   // same project — keep state as-is
    get().stopFn?.()                      // cancel any running stream
    set({ ...INITIAL, projectId: id })
  },

  setStage: (stage) => set({ stage }),
  addLog: (item) => set((s) => ({ log: [...s.log, item] })),
  setGenError: (genError) => set({ genError }),
  setLiveSteps: (liveSteps) => set({ liveSteps }),
  setStopFn: (stopFn) => set({ stopFn }),
  reset: () => { get().stopFn?.(); set({ ...INITIAL, projectId: get().projectId }) },
}))
