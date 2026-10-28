import { api, sseStream, type SseEvent } from './client'

export interface Project {
  id: string
  /** an AI run in progress on the server — the pages stay locked until it ends */
  running?: 'asis' | 'tobe' | null
  /** the version that is open, and what in it is approved (can't change in place) */
  version?: { id: number; version: number; asis_locked: boolean; tobe_locked: boolean } | null
  name: string
  description: string
  /** what the simplification should achieve — the assistant's suggestion until the user edits it */
  goal?: string
  goal_by?: 'assistant' | 'user' | null
  status: string
  asis_steps: AsIsStep[]
  tobe_steps: ToBeStep[]
  interview_data: Record<string, InterviewStepData>
  /** Country whose laws and services the agents research (default Bangladesh) */
  country?: string
  /** who owns the service — asked when the project is created */
  ministry?: string
  department?: string
  /** Web/AI proposals awaiting the user's consent (and their decisions) */
  asis_findings?: Finding[]
  /** Last AS-IS review: when it ran, questions it could not answer */
  asis_review?: AsIsReview | null
  /** SPS worksheets and settings (the guideline's matrices and sheets) */
  sps?: SpsData
  /** Computed on the server: TCVQ of AS-IS and TO-BE, difference, annual saving */
  tcvq?: TcvqComparison
  /** Computed on the server: the guideline's checks on the TO-BE */
  sps_checks?: SpsCheck[]
  /** Documents were added, removed or replaced since AS-IS was generated */
  asis_docs_stale?: boolean
  /** Project memory (Markdown): decisions, facts, preferences, open questions — read by every AI step */
  memory?: string
  memory_updated_at?: number | null
  memory_updated_by?: 'user' | 'assistant' | null
  created_at: number
  updated_at: number
  trashed: number
}

/** A cited source — [n] markers in step text point at it */
export interface StepSource {
  n: number
  title: string
  url: string
  kind: 'web' | 'doc'
  /** exact text taken from the source — highlighted in the reference popup */
  quotes?: string[]
}

export type ReviewField = 'pain_points' | 'digital_status' | 'legal_basis'
export const REVIEW_FIELDS: ReviewField[] = ['pain_points', 'digital_status', 'legal_basis']
/** Where a confirmed value came from */
export type FieldSource = 'doc' | 'web' | 'user' | 'ai'

/** A proposal found only on the web (or without a source) — used only after the user accepts it */
export interface Finding {
  id: string
  kind: 'field' | 'step'
  step_uid?: string
  field?: ReviewField
  value?: string
  digital_note?: string
  after_uid?: string | null
  step?: Partial<AsIsStep>
  sources: Array<{ id: string; title: string; url: string; kind: 'web' | 'doc'; quotes?: string[] }>
  /** web: found on the web (Use / Don't use); unsourced: no source — the user confirms (Yes / No / Skip) */
  origin: 'web' | 'ai' | 'unsourced'
  status: 'pending' | 'accepted' | 'rejected' | 'dropped' | 'skipped'
  created_at: number
  decided_at?: number
}

// ── SPS (সেবা সহজীকরণ নির্দেশিকা ২০২৬) ─────────────────────────────────────────
export interface SpsDocument {
  name: string
  source: 'citizen_own' | 'other_office'
  verify: 'none' | 'own' | 'other_office'
  tobe?: 'submit' | 'auto' | 'removed'
}
export interface SpsProblem { aspect: string; problem: string; demand: string; proposal: string; rationale: string }
export interface SpsMapping { asis: number; tobe: number | null; disposition: 'kept' | 'merged' | 'removed'; reason: string }
export interface SpsData {
  settings?: {
    cost_fare?: number; cost_food?: number; cost_wage?: number; users_per_year?: number
    office_cost_asis?: number; office_cost_tobe?: number; unexpected_asis?: number; unexpected_tobe?: number
  }
  office?: { ministry?: string; department?: string; office?: string; services?: string }
  priority?: Record<string, number>
  feedback?: { respondents: number; averages: Record<string, number>; total: number; comments: string[] }
  profile?: Record<string, { value: string; source?: string }>
  documents?: SpsDocument[]
  problems?: SpsProblem[]
  problems_edited?: boolean
  mapping?: SpsMapping[]
  plan?: { challenges?: string; measures?: string; publicity?: string; monitoring?: string; workplan?: Array<{ activity: string; months: string[] }> }
  team?: string
}
export interface Tcvq {
  time_days: number; visits: number; citizen_cost: number; fees: number; documents: number | null
  steps: number; staff: number; decisions: number; office_cost: number | null
}
export interface TcvqComparison {
  asis: Tcvq
  tobe: Tcvq | null
  diff: Partial<Record<keyof Tcvq, number>> | null
  annual: { users: number; days: number; visits: number; taka: number } | null
  per_visit: number
}
export interface SpsCheck { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }

export interface AsIsReview {
  reviewed_at: number
  country: string
  questions: Array<{ step_uid: string; field: ReviewField; question: string }>
}

export interface AsIsStep {
  uid?: string
  step_number: number
  step_name: string
  actor: string
  action: string
  input?: string
  output?: string
  time_days?: number
  touchpoints?: number
  pain_points?: string
  /** manual | partly | online */
  digital_status?: string
  /** system / portal name (+ citations) */
  digital_note?: string
  legal_basis?: string
  field_sources?: Partial<Record<ReviewField, FieldSource>>
  unknown_fields?: ReviewField[]
  step_source?: FieldSource
  reviewed?: boolean
  /** the guideline's step fields */
  step_type?: 'activity' | 'decision' | 'document' | 'message'
  visit?: boolean
  fee?: number
  no_goto?: number
  notes?: string
  sources?: StepSource[]
}

export interface InterviewStepData {
  step_number: number
  step_name: string
  law_regulation: {
    required: boolean
    citation: string | null
    confidence: 'high' | 'medium' | 'low'
    notes: string
  }
  pain_point: {
    description: string
    severity: 'high' | 'medium' | 'low'
  }
  digital_availability: {
    status: 'fully_digital' | 'partially_digital' | 'not_digital'
    reason: string
    recommendation: string
  }
  law_protected: boolean
}

export interface ToBeStep {
  step_number: number
  step_name: string
  actor: string
  action: string
  channel: 'digital' | 'in_person' | 'hybrid'
  time_days?: number
  citizen_touchpoints?: number
  merged_from?: number[]
  /** the same AS-IS steps by their fixed uid (numbers shift when AS-IS steps are added or deleted) */
  merged_from_uids?: string[]
  simplification_rationale: string
  legal_basis?: string
  /** a digital / hybrid step: how it is digitalized (system, automation, notifications) */
  digital_how?: string
  /** a decision: what happens on a "No" — who tells the applicant, what to fix, where it returns, appeal */
  if_rejected?: string
  /** the world best practice this step follows, cited to the web page it came from */
  best_practice?: string
  /** how the step is put in place (the TO-BE's implementation pass) */
  implementation?: { prerequisites: string; legal_fit: string; owner: string; effort: 'quick' | 'medium' | 'long'; fallback: string }
  /** what the reviewer still finds unrealistic about this step */
  checks?: Array<{ severity: 'high' | 'medium'; issue: string }>
  sources?: StepSource[]
  step_type?: 'activity' | 'decision' | 'document' | 'message'
  visit?: boolean
  fee?: number
  no_goto?: number
}

export interface StoredChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  mode: 'chat' | 'interview'
  pane: string | null
  /** text, or a card drawn from payload (consent: { finding_ids, lang }) */
  kind: 'text' | 'consent' | 'review_steps'
  /** consent: { finding_ids, lang }; review questions: { sources } for their "Sources: [1] [2]" lines */
  payload: { finding_ids?: string[]; lang?: 'bn' | 'en'; mode?: 'confirm'; sources?: StepSource[]; choices?: string[]; topics?: import('@/components/project/ReviewSteps').ReviewTopic[] } | null
  created_at: number
}

/** An approved TO-BE with the approved AS-IS it was designed from (Outputs tab) */
/** A version in the switcher (drafts too) */
export interface VersionInfo {
  id: number
  version: number
  status: string
  asis_locked: boolean
  tobe_locked: boolean
  asis_count: number
  tobe_count: number
  approved_at: number | null
  updated_at: number | null
}
export interface VersionList { versions: VersionInfo[]; active: number | null }

export interface ProcessVersion {
  id: number
  version: number
  project_name: string
  country: string
  approved_at: number
  asis_steps: AsIsStep[]
  tobe_steps: ToBeStep[]
  /** TCV analysis of this version (only when its TO-BE is approved) */
  tcvq?: TcvqComparison
}

export interface ProjectFile {
  id: string
  project_id: string
  name: string
  size: number
  path?: string
  url?: string
  created_at: number
  /** pdf (incl. converted office files) | text (sheets, text files) | image */
  kind?: 'pdf' | 'text' | 'image' | null
  pages?: number
  /** processing → ready (searchable) | visual (scans/images: AI reads the pages, search can't) | failed | unsupported */
  status?: 'processing' | 'ready' | 'visual' | 'failed' | 'unsupported' | null
  status_note?: string | null
}

/** A web page found for the project (Knowledge page) — the AS-IS uses it only once accepted */
export interface WebSource {
  id: string
  url: string
  title: string
  /** two lines: what the AS-IS takes from this site */
  summary: string
  status: 'pending' | 'accepted' | 'rejected'
  created_at: number
}

export const projectsApi = {
  list: () => api.get<Project[]>('/api/projects'),
  get: (id: string) => api.get<Project>(`/api/projects/${id}`),
  create: (body: { name: string; description?: string; goal?: string; country?: string; ministry?: string; department?: string }) =>
    api.post<Project>('/api/projects', body),
  /** one short AI call: a goal for a project that has none */
  suggestGoal: (id: string) => api.post<Project>(`/api/projects/${id}/suggest-goal`),
  update: (id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'goal' | 'status' | 'asis_steps' | 'tobe_steps' | 'interview_data' | 'memory' | 'country' | 'ministry' | 'department' | 'sps'>>) =>
    api.patch<Project>(`/api/projects/${id}`, patch),
  trash: (id: string) => api.delete<{ ok: boolean }>(`/api/projects/${id}`),
  /** Chat rail history of this project (saved by the server as messages are sent) */
  chatMessages: (id: string) => api.get<StoredChatMessage[]>(`/api/projects/${id}/chat-messages`),
  clearChat: (id: string) => api.delete<{ ok: boolean }>(`/api/projects/${id}/chat-messages`),
  /** Approved TO-BE versions, newest first */
  versions: (id: string) => api.get<ProcessVersion[]>(`/api/projects/${id}/versions`),
  /** every version (drafts too), for the switcher */
  allVersions: (id: string) => api.get<VersionList>(`/api/projects/${id}/versions/all`),
  openVersion: (id: string, versionId: number) => api.post<VersionList>(`/api/projects/${id}/versions/${versionId}/open`),
  /** a new version from the open one, to change its approved AS-IS or TO-BE */
  newVersion: (id: string, kind: 'asis' | 'tobe') =>
    api.post<VersionList & { id: number; version: number; replaced: number | null }>(`/api/projects/${id}/versions/new`, { kind }),
  /** Excel download of one version's AS-IS or TO-BE */
  /** the current AS-IS / TO-BE (as on screen) as Excel */
  currentExportUrl: (id: string, kind: 'asis' | 'tobe') => `/api/projects/${id}/export?kind=${kind}`,
  exportUrl: (id: string, versionId: number, kind: 'asis' | 'tobe' | 'report') =>
    `/api/projects/${id}/versions/${versionId}/export?kind=${kind}`,
  /** ম্যাট্রিক্স-৩ responses: rows of 14 scores (1–5) and free comments */
  importFeedback: (id: string, rows: number[][], comments: string[]) =>
    api.post<Project>(`/api/projects/${id}/sps/feedback`, { rows, comments }),
  /** The user's consent on findings (consent card buttons) */
  decideFindings: (id: string, decisions: Array<{ id: string; decision: 'accept' | 'reject' | 'skip'; value?: string }>) =>
    api.post<{ asis_steps: AsIsStep[]; asis_findings: Finding[]; results: string[] }>(`/api/projects/${id}/findings/decide`, { decisions }),
  listFiles: (id: string) => api.get<ProjectFile[]>(`/api/projects/${id}/files`),
  webSources: (id: string) => api.get<{ sources: WebSource[]; default_query: string }>(`/api/projects/${id}/web-sources`),
  searchWebSources: (id: string, query: string, onEvent: (e: SseEvent) => void) =>
    sseStream(`/api/projects/${id}/web-sources/search`, { query }, onEvent),
  /** a page the user gives — kept as accepted, with their note (or the AI's two lines) */
  addWebLink: (id: string, url: string, note: string) => api.post<WebSource>(`/api/projects/${id}/web-sources`, { url, note }),
  decideWebSource: (id: string, sourceId: string, status: WebSource['status']) =>
    api.patch<WebSource>(`/api/projects/${id}/web-sources/${sourceId}`, { status }),
  uploadFile: (id: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.postForm<ProjectFile>(`/api/projects/${id}/files`, form)
  },
  /** Process a file that failed again (Retry) */
  retryFile: (projectId: string, fileId: string) =>
    api.post<ProjectFile>(`/api/projects/${projectId}/files/${fileId}/retry`, {}),
  deleteFile: (projectId: string, fileId: string) =>
    api.delete<{ ok: boolean }>(`/api/projects/${projectId}/files/${fileId}`),
  downloadUrl: (projectId: string, fileId: string) =>
    `/api/projects/${projectId}/files/${fileId}/download`,
}
