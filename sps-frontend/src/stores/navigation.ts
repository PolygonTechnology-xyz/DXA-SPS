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
  /** What the AS-IS review in the chat still waits for (published by the review card) */
  reviewWaiting: { projectId: string; open: number; topic: string } | null
  setReviewWaiting: (r: { projectId: string; open: number; topic: string } | null) => void
  /** Bumped to open the chat and bring the review card into view */
  reviewFocusRequest: number
  focusReview: () => void
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
  reviewWaiting: null,
  setReviewWaiting: (reviewWaiting) => set({ reviewWaiting }),
  reviewFocusRequest: 0,
  focusReview: () => set((s) => ({ chatOpenRequest: s.chatOpenRequest + 1, reviewFocusRequest: s.reviewFocusRequest + 1 })),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  startNewProject: () => set({ newProjectOpen: true }),
  closeNewProject: () => set({ newProjectOpen: false }),
  setPendingAction: (pendingAction) => set({ pendingAction }),
}))
