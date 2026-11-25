from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)  # p-001
    code: Mapped[str] = mapped_column(String(20), unique=True)  # PMU-001
    name: Mapped[str] = mapped_column(String(200))
    goal: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="Planning")
    health: Mapped[str] = mapped_column(String(20), default="On track")
    progress: Mapped[int] = mapped_column(default=0)
    manager: Mapped[str | None] = mapped_column(String(120))
    start_date: Mapped[str | None] = mapped_column(String(10))
    end_date: Mapped[str | None] = mapped_column(String(10))
    budget: Mapped[int | None]
    milestones: Mapped[list] = mapped_column(JSON, default=list)
    files: Mapped[list] = mapped_column(JSON, default=list)
    phases: Mapped[list | None] = mapped_column(JSON)  # phase names from the setup draft
    budget_text: Mapped[str | None] = mapped_column(String(120))  # as written, with its currency

    jira_site: Mapped[str | None] = mapped_column(String(300))
    jira_key: Mapped[str | None] = mapped_column(String(50))
    jira_name: Mapped[str | None] = mapped_column(String(200))
    tasks: Mapped[list | None] = mapped_column(JSON)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    report_schedule: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    connection: Mapped["JiraConnection | None"] = relationship(back_populates="project", cascade="all, delete-orphan", uselist=False)
    reports: Mapped[list["Report"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    risk_analysis: Mapped["RiskAnalysis | None"] = relationship(cascade="all, delete-orphan", uselist=False)


class JiraConnection(Base):
    """A project's saved Jira login. The API token is stored encrypted."""

    __tablename__ = "jira_connections"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    site_url: Mapped[str] = mapped_column(String(300))
    email: Mapped[str] = mapped_column(String(200))
    token_encrypted: Mapped[str] = mapped_column(Text)
    project_key: Mapped[str] = mapped_column(String(50))

    project: Mapped[Project] = relationship(back_populates="connection")


class Report(Base):
    __tablename__ = "reports"
    # A scheduled period is created once, however many workers or restarts there are.
    __table_args__ = (UniqueConstraint("dedupe_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    project_name: Mapped[str] = mapped_column(String(200))
    period_label: Mapped[str] = mapped_column(String(80))
    period_from: Mapped[str] = mapped_column(String(10))
    period_to: Mapped[str] = mapped_column(String(10))
    trigger: Mapped[str] = mapped_column(String(12))  # scheduled | manual
    file_name: Mapped[str] = mapped_column(String(200))
    pdf: Mapped[bytes] = mapped_column(LargeBinary)
    dedupe_key: Mapped[str | None] = mapped_column(String(120))  # set for scheduled reports only
    status: Mapped[str] = mapped_column(String(10), default="draft", server_default="final")  # draft | final
    final_pdf: Mapped[bytes | None] = mapped_column(LargeBinary)  # same content, marked as the approved version
    context: Mapped[dict | None] = mapped_column(JSON)  # the figures behind the PDF, used to fill a Word format
    format_id: Mapped[str | None] = mapped_column(String(36))  # chosen format: a DocFormat id, "builtin", or null for the project default
    style: Mapped[dict | None] = mapped_column(JSON)  # design changes asked for in the chat
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    project: Mapped[Project] = relationship(back_populates="reports")

    @property
    def can_export(self) -> bool:
        return self.context is not None


class RiskAnalysis(Base):
    """The latest AI risk analysis for a project, reused until the tasks or the period change."""

    __tablename__ = "risk_analyses"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    input_hash: Mapped[str] = mapped_column(String(64))
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AIApproval(Base):
    """An AI output a person has approved. Only these become records (shown in reports); drafts never do.
    kind is "risks" or "summary"."""

    __tablename__ = "ai_approvals"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)
    source: Mapped[str | None] = mapped_column(String(40))  # which draft was approved (its generation time)
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Meeting(Base):
    """A meeting's notes. Claude drafts minutes from them; they become the record only once a person approves."""

    __tablename__ = "meetings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    held_on: Mapped[str] = mapped_column(String(10))  # YYYY-MM-DD
    notes: Mapped[str] = mapped_column(Text, default="")
    minutes: Mapped[dict | None] = mapped_column(JSON)  # {summary, decisions[], actions[{what, owner}]}
    ai_generated: Mapped[bool] = mapped_column(default=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    style: Mapped[dict | None] = mapped_column(JSON)  # design changes asked for in the chat
    format_id: Mapped[str | None] = mapped_column(String(36))  # chosen format: a DocFormat id, "builtin", or null for the project default
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DocFormat(Base):
    """A Word document a project uploaded as an example of how its minutes or reports should look.
    Several can exist per kind; one is the default, and a meeting or report can pick another."""

    __tablename__ = "doc_formats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))  # minutes | report
    name: Mapped[str] = mapped_column(String(200))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    is_default: Mapped[bool] = mapped_column(default=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ProjectDoc(Base):
    """A document uploaded to a project (PDF, Word, text). Only the extracted text is kept; the AI reads it."""

    __tablename__ = "project_docs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    size: Mapped[int] = mapped_column(default=0)
    text: Mapped[str] = mapped_column(Text, default="")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class RegisterRisk(Base):
    """A risk the team is tracking over time: someone owns it and moves it through a status."""

    __tablename__ = "risk_register"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    mitigation: Mapped[str] = mapped_column(Text, default="")
    severity: Mapped[str] = mapped_column(String(10), default="medium")  # high | medium | low
    status: Mapped[str] = mapped_column(String(12), default="open")  # suggested | open | mitigating | accepted | closed | dismissed
    number: Mapped[int | None]  # shown as R-01, numbered within the project
    likelihood: Mapped[str | None] = mapped_column(String(10))  # high | medium | low
    impact: Mapped[str | None] = mapped_column(String(10))  # high | medium | low
    trend: Mapped[str | None] = mapped_column(String(10))  # rising | steady | falling, set by a person
    owner: Mapped[str | None] = mapped_column(String(120))
    due: Mapped[str | None] = mapped_column(String(10))  # review / mitigation date
    task_keys: Mapped[list] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(10), default="manual")  # manual | analysis | meeting
    source_ref: Mapped[str | None] = mapped_column(String(300))  # e.g. the meeting it came from
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class ChatMessage(Base):
    """The conversation with the AI about one draft (a meeting's minutes or a report). Kept so it survives a reload."""
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(10), index=True)  # minutes | report
    ref_id: Mapped[str] = mapped_column(String(36), index=True)
    role: Mapped[str] = mapped_column(String(10))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SharedDoc(Base):
    """A document shared by every project (policies, templates, guidelines). The AI reads the extracted text."""

    __tablename__ = "shared_docs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    size: Mapped[int] = mapped_column(default=0)
    text: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(40), default="Other")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
