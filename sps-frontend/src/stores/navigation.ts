import { create } from 'zustand'

export type PendingAction =
  | { type: 'generate_asis'; input: string }
  | { type: 'generate_tobe' }

interface NavigationStore {
  // UI-only state (not routing)
  sidebarCollapsed: boolean
  newProjectOpen: boolean
  pendingAction: PendingAction | null
  /** Bumped to ask the project page to open the chat rail (e.g. a consent card arrived) */
  chatOpenRequest: number
  requestChatOpen: () => void
  toggleSidebar: () => void
  startNewProject: () => void
  closeNewProject: () => void
  setPendingAction: (a: PendingAction | null) => void
}

export const useNavigation = create<NavigationStore>((set) => ({
  sidebarCollapsed: false,
  newProjectOpen: false,
  pendingAction: null,
  chatOpenRequest: 0,
  requestChatOpen: () => set((s) => ({ chatOpenRequest: s.chatOpenRequest + 1 })),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  startNewProject: () => set({ newProjectOpen: true }),
  closeNewProject: () => set({ newProjectOpen: false }),
  setPendingAction: (pendingAction) => set({ pendingAction }),
}))
