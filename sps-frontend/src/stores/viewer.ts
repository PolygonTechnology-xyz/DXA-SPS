import { create } from 'zustand'

type ViewerTab = 'table' | 'bpmn'
type ViewerType = 'asis' | 'tobe'

interface ViewerStore {
  open: boolean
  type: ViewerType
  tab: ViewerTab
  version: number
  isDirty: boolean
  isFullscreen: boolean
  openViewer: (type: ViewerType, tab?: ViewerTab) => void
  closeViewer: () => void
  setTab: (tab: ViewerTab) => void
  setVersion: (v: number) => void
  setDirty: (v: boolean) => void
  setFullscreen: (v: boolean) => void
}

export const useViewer = create<ViewerStore>((set) => ({
  open: false,
  type: 'asis',
  tab: 'table',
  version: 1,
  isDirty: false,
  isFullscreen: false,
  openViewer: (type, tab = 'table') => set({ open: true, type, tab, isDirty: false }),
  closeViewer: () => set({ open: false, isDirty: false }),
  setTab: (tab) => set({ tab }),
  setVersion: (version) => set({ version }),
  setDirty: (isDirty) => set({ isDirty }),
  setFullscreen: (isFullscreen) => set({ isFullscreen }),
}))
