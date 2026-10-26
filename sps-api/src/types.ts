// Shared domain types for the SPS API

export interface AsIsStep {
  step_number: number
  step_name: string
  actor: string
  action: string
  input?: string
  output?: string
  time_days?: number
  pain_points?: string
  notes?: string
  uid?: string
  digital_status?: string
  digital_note?: string
  legal_basis?: string
  field_sources?: Record<string, string>
  unknown_fields?: string[]
}

export interface ToBeStep {
  step_number: number
  step_name: string
  actor: string
  action: string
  channel: string
  time_days?: number
  citizen_touchpoints?: number
  merged_from?: number[]
  simplification_rationale: string
  legal_basis?: string
}

// Context passed into every tool executor
export interface ToolContext {
  projectId: string
  asisSteps: AsIsStep[]
  tobeSteps: ToBeStep[]
}

// What a tool executor returns
export interface ToolResult {
  summary: string
  updatedAsisSteps?: AsIsStep[]
  updatedTobeSteps?: ToBeStep[]
  sseEvents?: object[]       // additional SSE events to emit (step_updated, action, etc.)
  projectUpdate?: { name?: string; description?: string }
}
