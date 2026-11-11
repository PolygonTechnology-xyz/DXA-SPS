import { create } from 'zustand'

/** A cited source as shown in the reference popup */
export interface PopupSource {
  title: string
  url: string
  kind: 'web' | 'doc'
  /** exact text taken from the source — highlighted in yellow */
  quotes?: string[]
}

interface ReferenceStore {
  source: PopupSource | null
  openReference: (s: PopupSource) => void
  closeReference: () => void
}

export const useReference = create<ReferenceStore>((set) => ({
  source: null,
  openReference: (source) => set({ source }),
  closeReference: () => set({ source: null }),
}))

export const openReference = (s: PopupSource) => useReference.getState().openReference(s)
