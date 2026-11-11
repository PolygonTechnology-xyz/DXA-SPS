import { api } from './client'

export interface ProjectStatus {
  phase: string
  tasks: Record<string, { status: string; approved?: boolean }>
}

export interface VersionedOutput {
  task: string
  version: number
  content: string
  approved: boolean
  createdAt: string
}

export interface Document {
  id: string
  name: string
  path: string
  size: number
  createdAt: string
}

export const workspaceApi = {
  status: (id: string) =>
    api.get<ProjectStatus>(`/workspace/${id}/dxa/status`),

  version: (id: string) =>
    api.get<{ version: string }>(`/workspace/${id}/dxa/version`),

  outputs: (id: string, task: string) =>
    api.get<{ versions: VersionedOutput[] }>(`/workspace/${id}/dxa/outputs?task=${task}`),

  documents: (id: string) =>
    api.get<{ documents: Document[] }>(`/workspace/${id}/dxa/documents`),

  upload: (id: string, files: File[]) => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    return api.postForm<{ paths: string[] }>(`/workspace/${id}/dxa/upload`, form)
  },

  acceptVersion: (id: string, task: string, version: number, content?: string) =>
    api.post(`/workspace/${id}/dxa/accept-version`, { task, version, content }),

  decide: (id: string, action: string, payload?: Record<string, unknown>) =>
    api.post(`/workspace/${id}/dxa/decide`, { action, ...payload }),

  stopRun: (id: string) =>
    api.post(`/workspace/${id}/dxa/stop-run`),

  chatNew: (id: string) =>
    api.post<{ sessionId: string }>(`/workspace/${id}/dxa/chat-new`),

  sessionStart: (id: string, message: string) =>
    api.post<{ sessionId: string }>(`/workspace/${id}/dxa/session-start`, { message }),

  sessionMessage: (id: string, sessionId: string, message: string) =>
    api.post(`/workspace/${id}/dxa/session-message`, { sessionId, message }),

  previewUrl: (id: string, path: string) =>
    `/workspace/${id}/dxa/preview?path=${encodeURIComponent(path)}`,

  rawUrl: (id: string, path: string) =>
    `/workspace/${id}/dxa/raw?path=${encodeURIComponent(path)}`,
}
