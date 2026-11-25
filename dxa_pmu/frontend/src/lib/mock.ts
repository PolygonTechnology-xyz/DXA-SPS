export type ProjectStatus = "Planning" | "Active" | "On hold" | "Completed";
export type Health = "On track" | "At risk" | "Off track";

export interface JiraTask {
  key: string;
  summary: string;
  description?: string | null;
  status: string;
  /** Jira's own grouping: "new" (to do), "indeterminate" (in progress) or "done". */
  category: string;
  assignee: string | null;
  priority: string | null;
  type: string;
  /** Due date as YYYY-MM-DD, if Jira has one. */
  due: string | null;
  versions?: string[];
  blockedBy?: string[];
  blocks?: string[];
  epic?: string | null;
}

export type DxaState = "new" | "indeterminate" | "done";


export interface Milestone { title: string; due: string; done: boolean; total?: number; doneTasks?: number; source?: string | null }

export interface ActionItem {
  key: string;
  summary: string;
  jiraStatus: string;
  status: "Overdue" | "Due soon" | "In progress" | "On track";
  due: string | null;
  daysOverdue: number | null;
  priority: string | null;
  blockedBy: string[];
  url: string | null;
}

export interface ActionOwner { name: string; unassigned: boolean; open: number; overdue: number; dueSoon: number; actions: ActionItem[] }

export interface ActionsData { owners: ActionOwner[]; total: number }

export type ReportFrequency = "monthly" | "quarterly" | "custom";

export interface ReportSchedule {
  enabled: boolean;
  frequency: ReportFrequency;
  /** Custom range, YYYY-MM-DD. The report is created once the end date has passed. */
  from?: string;
  to?: string;
}

export interface ReportMeta {
  id: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  trigger: "scheduled" | "manual";
  fileName: string;
  /** A draft must be approved by a person; only approved reports are final. */
  status: "draft" | "final";
  approvedAt: string | null;
  /** False for reports made before Word formats existed. */
  canExport: boolean;
  formatId?: string | null;
}

export interface Project {
  id: string;
  name: string;
  code: string;
  goal: string;
  status: ProjectStatus;
  health: Health;
  progress: number;
  /** PMU tracking details; only present once a project is under way. */
  manager?: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  /** The budget as written in the plan, with its currency. */
  budgetText?: string | null;
  /** Phase names confirmed when the project was set up. */
  phases?: string[];
  milestones: Milestone[];
  jira?: { site: string; key: string; name: string };
  files: string[];
  /** The DXA health score; null until there are Jira tasks. */
  score?: number | null;
  /** Tasks pulled from Jira when it was connected. */
  tasks?: JiraTask[];
  /** ISO time the Jira tasks were last fetched. */
  syncedAt?: string;
  reportSchedule?: ReportSchedule;
}

export interface SharedDoc {
  id: string;
  name: string;
  size: number;
  category: string;
  tags: string[];
  uploadedAt: string;
}

export const STATUSES: ProjectStatus[] = ["Planning", "Active", "On hold", "Completed"];

export const CATEGORIES = ["Policy", "Template", "Guideline", "Report", "Other"];

export interface RiskItem {
  title: string;
  severity: "high" | "medium" | "low";
  rationale: string;
  mitigation: string;
  taskKeys: string[];
  /** The Jira tasks behind the risk. */
  evidence?: { key: string; summary: string; status: string; assignee: string | null; due: string | null; daysOverdue: number | null }[];
}

export interface RisksData {
  /** "stale" or "missing" means the tasks or the report period changed since the last analysis. */
  status: "ready" | "stale" | "missing";
  scope: { label: string };
  overview: string;
  risks: RiskItem[];
  aiGenerated: boolean;
  generatedAt: string | null;
  /** What the reviewer typed to steer this analysis, oldest first. */
  guidance: string[];
  /** The last approved record, which is what reports use. */
  approved: { approvedAt: string; scope: { label: string }; overview: string; risks: RiskItem[] } | null;
  /** True when this draft is the approved record. */
  isApproved: boolean;
}

export interface SummaryDraft {
  summary: string;
  riskLevel: "low" | "medium" | "high";
  findings: string[];
  recommendations: string[];
  aiGenerated?: boolean;
}

export interface SummaryApproved extends SummaryDraft { approvedAt: string }

export type Level = "high" | "medium" | "low";
export interface MeetingRisk { title: string; ifNotDone: string; impact: string; severity: Level; owner: string | null; likelihood?: Level | null; impactLevel?: Level | null }
export interface Minutes {
  summary: string;
  decisions: string[];
  actions: { what: string; owner: string | null; due?: string | null }[];
  risks?: MeetingRisk[];
  keyOutcomes?: string[];
  openQuestions?: string[];
}

export interface Meeting {
  id: string;
  projectId: string;
  title: string;
  heldOn: string;
  notes: string;
  minutes: Minutes | null;
  aiGenerated: boolean;
  approvedAt: string | null;
  formatId?: string | null;
}

export interface Decision { number: number; text: string; meetingId: string; meetingTitle: string; heldOn: string; status: "Approved" | "Under review" }

export interface RegisterRisk {
  id: string;
  title: string;
  description: string;
  mitigation: string;
  severity: "high" | "medium" | "low";
  status: "suggested" | "open" | "mitigating" | "accepted" | "closed";
  number: number | null;
  likelihood: Level | null;
  impact: Level | null;
  trend: "rising" | "steady" | "falling" | null;
  owner: string | null;
  due: string | null;
  taskKeys: string[];
  source: string;
  sourceRef?: string | null;
  createdAt: string;
  updatedAt: string;
  needsIntervention: boolean;
  reasons: string[];
  evidence: { key: string; summary: string; status: string; assignee: string | null; due: string | null; daysOverdue: number | null }[];
}

/** A new project's setup before it is created. `pages` are the document pages a value was read from. */
export interface DraftValue { value: string | null; pages: number[] }
export interface DraftMilestone { title: string; due: string | null }
export interface ProjectDraft {
  name: DraftValue; goal: DraftValue; manager: DraftValue; start: DraftValue; end: DraftValue; budget: DraftValue;
  phases: string[]; phasePages: number[];
  milestones: DraftMilestone[]; milestonePages: number[];
}
export interface NewProjectInput {
  name: string; goal: string; manager?: string | null; startDate?: string | null; endDate?: string | null; budgetText?: string | null;
  phases?: string[]; milestones?: { title: string; due: string }[];
}
