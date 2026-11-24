"""Human approval of AI output (BR-BR: AI output becomes a record only after a person approves it).

Drafts live elsewhere (the saved risk analysis, or the summary in the browser). Approving copies exactly what
the person chose into `ai_approvals`; reports read only from there.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from ..models import AIApproval, Project, RiskAnalysis
from . import risks as risk_service

RISKS, SUMMARY = "risks", "summary"


class ApprovalError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def get(db: Session, project_id: str, kind: str) -> AIApproval | None:
    return db.get(AIApproval, (project_id, kind))


def _put(db: Session, project_id: str, kind: str, data: dict[str, Any], source: str | None) -> AIApproval:
    row = get(db, project_id, kind)
    now = datetime.now(timezone.utc)
    if row:
        row.data, row.source, row.approved_at = data, source, now
    else:
        row = AIApproval(project_id=project_id, kind=kind, data=data, source=source, approved_at=now)
        db.add(row)
    db.commit()
    return row


def withdraw(db: Session, project_id: str, kind: str) -> None:
    row = get(db, project_id, kind)
    if row:
        db.delete(row)
        db.commit()


def approve_risks(db: Session, p: Project, include: list[int] | None) -> AIApproval:
    """Approve the current draft, or only the chosen risks of it (by position)."""
    draft = db.get(RiskAnalysis, p.id)
    if not draft:
        raise ApprovalError(409, "There is no risk analysis to approve yet.")
    if risk_service.status_for(db, p)["status"] != "ready":
        raise ApprovalError(409, "The tasks or report period changed since this analysis. Re-analyse, then approve.")
    items = draft.data["risks"]
    if include is not None:
        if any(i < 0 or i >= len(items) for i in include):
            raise ApprovalError(422, "One of the selected risks does not exist.")
        items = [items[i] for i in sorted(set(include))]
    data = {"scope": draft.data["scope"], "overview": draft.data["overview"], "risks": items, "aiGenerated": draft.data["aiGenerated"]}
    return _put(db, p.id, RISKS, data, risk_service.src_key(draft.created_at))


def remove_risk(db: Session, p: Project, index: int) -> None:
    """Delete one risk from the current draft. An approved draft is a record and cannot be edited."""
    draft = db.get(RiskAnalysis, p.id)
    if not draft:
        raise ApprovalError(404, "There is no risk analysis yet.")
    status = risk_service.status_for(db, p)
    if status["isApproved"]:
        raise ApprovalError(409, "This analysis is already approved and cannot be changed. Re-analyse to start a new draft.")
    items = list(draft.data["risks"])
    if not 0 <= index < len(items):
        raise ApprovalError(404, "That risk no longer exists. Reload and try again.")
    del items[index]
    draft.data = {**draft.data, "risks": items}  # a new dict, so the JSON column registers the change
    db.commit()


def approve_summary(db: Session, p: Project, data: dict[str, Any]) -> AIApproval:
    return _put(db, p.id, SUMMARY, data, None)
