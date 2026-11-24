"""API shapes. Field names are camelCase on the wire, matching the frontend's Project type."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class JiraTaskOut(Camel):
    key: str
    summary: str
    description: str | None = None
    status: str
    category: str
    assignee: str | None = None
    priority: str | None = None
    type: str
    due: str | None = None
    versions: list[str] = []
    blocked_by: list[str] = []
    blocks: list[str] = []
    epic: str | None = None


class JiraInfo(Camel):
    site: str
    key: str
    name: str


class ReportSchedule(Camel):
    enabled: bool = True
    frequency: Literal["monthly", "quarterly", "custom"] = "monthly"
    from_: str | None = Field(None, alias="from")  # custom range, YYYY-MM-DD
    to: str | None = None


class Milestone(Camel):
    title: str
    due: str
    done: bool = False
    total: int = 0  # tasks tagged with this version in Jira
    done_tasks: int = 0


class ProjectOut(Camel):
    id: str
    code: str
    name: str
    goal: str
    status: str
    health: str
    progress: int
    manager: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    budget: int | None = None
    milestones: list[Milestone] = []
    files: list[str] = []
    jira: JiraInfo | None = None
    tasks: list[JiraTaskOut] | None = None
    synced_at: datetime | None = None
    report_schedule: ReportSchedule | None = None


class ProjectCreate(Camel):
    name: str = Field(min_length=1, max_length=200)
    goal: str = Field("", max_length=5000)


class ProjectPatch(Camel):
    name: str | None = Field(None, min_length=1, max_length=200)
    goal: str | None = Field(None, max_length=5000)
    status: Literal["Planning", "Active", "On hold", "Completed"] | None = None
    files: list[str] | None = None
    report_schedule: ReportSchedule | None = None


class JiraConnectIn(Camel):
    site_url: str
    email: str
    api_token: str
    project_key: str


class JiraConnectOut(Camel):
    ok: bool = True
    message: str
    project_name: str
    project: ProjectOut


class ReportOut(Camel):
    id: str
    project_id: str
    project_name: str
    created_at: datetime
    period_label: str
    period_from: str
    period_to: str
    trigger: Literal["scheduled", "manual"]
    file_name: str
    status: Literal["draft", "final"] = "final"
    approved_at: datetime | None = None
    format_id: str | None = None
    can_export: bool = False  # false for reports made before Word formats existed


class ReportCreate(Camel):
    period_label: str | None = None  # defaults to "Snapshot, <today>"


class ChatMessage(Camel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20000)


class ChatIn(Camel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=50)


class CreateProjectChatOut(Camel):
    reply: str
    project_name: str | None = None
    goal: str | None = None
    ready: bool = False


class ChatOut(Camel):
    reply: str


class AnalysisOut(Camel):
    headline: str
    metrics: dict[str, int]
    summary: str
    risk_level: Literal["low", "medium", "high"]
    findings: list[str]
    recommendations: list[str]
    ai_generated: bool


class RiskEvidence(Camel):
    """A Jira task behind a risk, so the risk can be traced back to the ticket."""

    key: str
    summary: str
    status: str
    assignee: str | None = None
    due: str | None = None
    days_overdue: int | None = None


class RiskItem(Camel):
    title: str
    severity: Literal["high", "medium", "low"]
    rationale: str
    mitigation: str
    task_keys: list[str] = []
    evidence: list["RiskEvidence"] = []


class RiskScope(Camel):
    label: str
    from_: str | None = Field(None, alias="from")
    to: str | None = None


class ApprovedRisks(Camel):
    approved_at: datetime
    scope: RiskScope
    overview: str
    risks: list[RiskItem]


class RisksOut(Camel):
    status: Literal["ready", "stale", "missing"]
    scope: RiskScope
    overview: str
    risks: list[RiskItem]
    ai_generated: bool
    generated_at: datetime | None = None
    guidance: list[str] = []  # the reviewer's messages this draft was written with
    approved: ApprovedRisks | None = None  # the last approved record (what reports use)
    is_approved: bool = False  # true when this draft is that record


class RiskRunIn(Camel):
    """What the reviewer typed to steer the analysis, oldest first. Omit to keep the earlier messages; [] clears them."""

    guidance: list[Annotated[str, Field(max_length=1000)]] | None = Field(None, max_length=10)


class TaskSummaryOut(Camel):
    key: str
    summary: str


class ApproveRisksIn(Camel):
    include: list[int] | None = None  # positions of the risks to approve; all when omitted


class SummaryIn(Camel):
    """What a person approved: the AI's summary after their edits."""

    summary: str = Field(min_length=1, max_length=3000)
    risk_level: Literal["low", "medium", "high"]
    findings: list[str] = Field(default=[], max_length=20)
    recommendations: list[str] = Field(default=[], max_length=20)


class SummaryOut(SummaryIn):
    approved_at: datetime


class ActionItem(Camel):
    key: str
    summary: str
    jira_status: str
    status: Literal["Overdue", "Due soon", "In progress", "On track"]
    due: str | None = None
    days_overdue: int | None = None
    priority: str | None = None
    blocked_by: list[str] = []  # open tasks this one is waiting on
    url: str | None = None


class ActionOwner(Camel):
    name: str
    unassigned: bool = False
    open: int
    overdue: int
    due_soon: int
    actions: list[ActionItem]


class ActionsOut(Camel):
    owners: list[ActionOwner]
    total: int


class MeetingActionIO(Camel):
    what: str = Field(max_length=500)
    owner: str | None = Field(None, max_length=120)


class MeetingRiskIO(Camel):
    title: str = Field(max_length=300)
    if_not_done: str = Field(default="", max_length=1000)
    impact: str = Field(default="", max_length=1000)
    severity: Literal["high", "medium", "low"] = "medium"
    owner: str | None = Field(None, max_length=120)


class MinutesIO(Camel):
    summary: str = Field(max_length=4000)
    risks: list[MeetingRiskIO] = Field(default_factory=list, max_length=30)
    decisions: list[Annotated[str, Field(max_length=1000)]] = Field(default_factory=list, max_length=50)
    actions: list[MeetingActionIO] = Field(default_factory=list, max_length=50)


class MeetingIn(Camel):
    title: str = Field(min_length=1, max_length=200)
    held_on: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    notes: str = Field(default="", max_length=60000)


class MeetingOut(Camel):
    id: str
    project_id: str
    title: str
    held_on: str
    notes: str
    minutes: MinutesIO | None = None
    ai_generated: bool = False
    approved_at: datetime | None = None
    format_id: str | None = None


class DecisionOut(Camel):
    text: str
    meeting_id: str
    meeting_title: str
    held_on: str
    status: Literal["Approved", "Under review"]


class RegisterIn(Camel):
    title: str = Field(min_length=1, max_length=300)
    description: str = Field(default="", max_length=3000)
    mitigation: str = Field(default="", max_length=3000)
    severity: Literal["high", "medium", "low"] = "medium"
    status: Literal["open", "mitigating", "accepted", "closed"] = "open"
    owner: str | None = Field(default=None, max_length=120)
    due: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    task_keys: list[str] = Field(default=[], max_length=30)


class RegisterPatch(Camel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=3000)
    mitigation: str | None = Field(default=None, max_length=3000)
    severity: Literal["high", "medium", "low"] | None = None
    status: Literal["open", "mitigating", "accepted", "closed"] | None = None
    owner: str | None = Field(default=None, max_length=120)
    due: str | None = Field(default=None, pattern=r"^(\d{4}-\d{2}-\d{2})?$")


class RegisterOut(Camel):
    id: str
    title: str
    description: str
    mitigation: str
    severity: Literal["high", "medium", "low"]
    status: Literal["open", "mitigating", "accepted", "closed"]
    owner: str | None = None
    due: str | None = None
    task_keys: list[str] = []
    source: str
    source_ref: str | None = None
    created_at: datetime
    updated_at: datetime
    needs_intervention: bool = False
    reasons: list[str] = []
    evidence: list[RiskEvidence] = []


class ReviseIn(Camel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[dict[str, str]] = []
    current: MinutesIO | None = None  # the minutes as the reviewer currently sees them (including unsaved edits)


class ReviseOut(Camel):
    reply: str
    minutes: MinutesIO | None = None
    meeting: MeetingOut | None = None
    report: ReportOut | None = None


class FormatChoice(Camel):
    format_id: str | None = None  # a format id, "builtin", or null for "use the project default"
