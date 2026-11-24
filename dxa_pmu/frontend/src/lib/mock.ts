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


export interface Milestone { title: string; due: string; done: boolean; total?: number; doneTasks?: number }

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
  milestones: Milestone[];
  jira?: { site: string; key: string; name: string };
  files: string[];
  /** Tasks pulled from Jira when it was connected. */
  tasks?: JiraTask[];
  /** ISO time the Jira tasks were last fetched. */
  syncedAt?: string;
  reportSchedule?: ReportSchedule;
}

export interface KnowledgeDoc {
  id: string;
  name: string;
  size: string;
  category: string;
  tags: string[];
  uploadedAt: string;
}

export const STATUSES: ProjectStatus[] = ["Planning", "Active", "On hold", "Completed"];

export const CATEGORIES = ["Policy", "Template", "Guideline", "Report", "Other"];

export const mockKnowledge: KnowledgeDoc[] = [
  { id: "k-1", name: "PMU Operating Manual.pdf", size: "2.4 MB", category: "Guideline", tags: ["onboarding", "governance"], uploadedAt: "2026-08-04" },
  { id: "k-2", name: "Procurement Policy 2026.pdf", size: "860 KB", category: "Policy", tags: ["procurement", "compliance"], uploadedAt: "2026-07-19" },
  { id: "k-3", name: "Project Charter Template.docx", size: "48 KB", category: "Template", tags: ["charter", "initiation"], uploadedAt: "2026-06-02" },
  { id: "k-4", name: "Quarterly Status Report Q2.xlsx", size: "310 KB", category: "Report", tags: ["reporting", "q2"], uploadedAt: "2026-07-05" },
];

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

export interface MeetingRisk { title: string; ifNotDone: string; impact: string; severity: "high" | "medium" | "low"; owner: string | null }
export interface Minutes { summary: string; decisions: string[]; actions: { what: string; owner: string | null }[]; risks?: MeetingRisk[] }

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

export interface Decision { text: string; meetingId: string; meetingTitle: string; heldOn: string; status: "Approved" | "Under review" }

export interface RegisterRisk {
  id: string;
  title: string;
  description: string;
  mitigation: string;
  severity: "high" | "medium" | "low";
  status: "open" | "mitigating" | "accepted" | "closed";
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
