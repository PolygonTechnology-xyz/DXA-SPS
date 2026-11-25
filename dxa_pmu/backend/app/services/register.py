"""Register risks with the rules that decide which ones need the project manager's intervention."""

from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

import uuid

from ..models import Project, RegisterRisk
from ..schemas import RegisterOut, RiskEvidence
from .actions import days_overdue

_ORDER = {"high": 0, "medium": 1, "low": 2}


def _out(r: RegisterRisk, tasks: dict[str, dict], today: date) -> RegisterOut:
    """Flags a live risk for the project manager's intervention and says why."""
    reasons: list[str] = []
    if r.status in ("open", "mitigating"):
        late = [k for k in r.task_keys if (t := tasks.get(k)) and t.get("category") != "done" and t.get("due") and date.fromisoformat(t["due"]) < today]
        if r.severity == "high":
            reasons.append("High severity" + (", no owner named" if not r.owner else ""))
        if late:
            reasons.append(f"{len(late)} linked task(s) overdue ({', '.join(late[:4])})")
    out = RegisterOut.model_validate(r)
    out.needs_intervention, out.reasons = bool(reasons), reasons
    out.evidence = [RiskEvidence(key=k, summary=t["summary"], status=t.get("status", ""), assignee=t.get("assignee"), due=t.get("due"),
                                 days_overdue=days_overdue(t, today) if t.get("category") != "done" else None)
                    for k in r.task_keys if (t := tasks.get(k))]
    return out


def list_register(db: Session, p: Project) -> list[RegisterOut]:
    tasks = {t["key"]: t for t in (p.tasks or [])}
    rows = db.scalars(select(RegisterRisk).where(RegisterRisk.project_id == p.id, RegisterRisk.status != "dismissed")).all()
    today = date.today()
    out = [_out(r, tasks, today) for r in rows]
    out.sort(key=lambda r: (r.status == "closed", not r.needs_intervention, _ORDER[r.severity], r.created_at))
    return out




def flagged(db: Session, p: Project) -> list[RegisterOut]:
    return [r for r in list_register(db, p) if r.needs_intervention]


def next_number(db: Session, project_id: str) -> int:
    return (db.scalar(select(func.max(RegisterRisk.number)).where(RegisterRisk.project_id == project_id)) or 0) + 1


def add_risk(db: Session, project_id: str, *, title: str, severity: str = "medium", description: str = "", mitigation: str = "",
             owner: str | None = None, task_keys: list[str] | None = None, source: str = "manual", source_ref: str | None = None,
             status: str = "open", likelihood: str | None = None, impact: str | None = None) -> bool:
    """Adds a risk to the register unless one with the same title is already there. Does not commit."""
    title = title.strip()
    if not title or db.scalar(select(RegisterRisk.id).where(RegisterRisk.project_id == project_id, RegisterRisk.title == title)):
        return False
    db.add(RegisterRisk(id=str(uuid.uuid4()), project_id=project_id, title=title[:300], severity=severity, description=description,
                        mitigation=mitigation, owner=(owner or "").strip() or None, task_keys=task_keys or [], source=source, source_ref=source_ref,
                        status=status, likelihood=likelihood, impact=impact, number=next_number(db, project_id)))
    return True


def sync_meeting(db: Session, meeting) -> int:
    """The risks a meeting raised become suggestions. They replace this meeting's earlier unconfirmed suggestions
    (a redraft or an edit). Confirmed risks stay, and risks a person removed stay removed. Does not commit."""
    ref = f"{meeting.title} ({meeting.held_on})"
    new = (meeting.minutes or {}).get("risks", [])
    titles = {(r.get("title") or "").strip() for r in new}
    for row in db.scalars(select(RegisterRisk).where(RegisterRisk.project_id == meeting.project_id, RegisterRisk.source == "meeting",
                                                      RegisterRisk.source_ref == ref, RegisterRisk.status == "suggested")).all():
        if row.title not in titles:
            db.delete(row)
    n = 0
    for r in new:
        desc = " ".join(x for x in (f"If {r['if_not_done'].rstrip('.')}," if r.get("if_not_done") else "", (r.get("impact") or "").rstrip(".") + "." if r.get("impact") else "") if x)
        if add_risk(db, meeting.project_id, title=r.get("title", ""), severity=r.get("severity", "medium"), description=desc,
                    owner=r.get("owner"), source="meeting", source_ref=ref, status="suggested",
                    likelihood=r.get("likelihood"), impact=r.get("impact_level")):
            n += 1
    return n


def sync_analysis(db: Session, project_id: str, risks: list[dict], links: list[dict] | None = None) -> None:
    """The latest AI risk analysis replaces the previous analysis's unconfirmed suggestions. Does not commit."""
    for row in db.scalars(select(RegisterRisk).where(RegisterRisk.project_id == project_id, RegisterRisk.source == "analysis",
                                                      RegisterRisk.status == "suggested")).all():
        db.delete(row)
    db.flush()
    for r in risks:
        add_risk(db, project_id, title=r["title"], severity=r["severity"], description=r["rationale"], mitigation=r["mitigation"],
                 task_keys=r.get("taskKeys", []), source="analysis", source_ref="AI risk analysis", status="suggested",
                 likelihood=r.get("likelihood"), impact=r.get("impact"))
    # Risks from meetings have no Jira link yet; the AI says which tasks are behind each one.
    by_title = {l["title"].strip(): l["taskKeys"] for l in links or [] if l.get("taskKeys")}
    if by_title:
        for row in db.scalars(select(RegisterRisk).where(RegisterRisk.project_id == project_id, _keeps(), RegisterRisk.status != "dismissed")).all():
            if row.title in by_title:
                row.task_keys = by_title[row.title]


def _keeps():
    """Rows a new analysis does not replace: everything except its own unconfirmed suggestions."""
    return or_(RegisterRisk.source != "analysis", RegisterRisk.status != "suggested")


def dismissed_titles(db: Session, project_id: str) -> list[str]:
    return list(db.scalars(select(RegisterRisk.title).where(RegisterRisk.project_id == project_id, RegisterRisk.status == "dismissed")).all())


def active(db: Session, p: Project) -> list[RegisterOut]:
    return [r for r in list_register(db, p) if r.status in ("open", "mitigating")]


def known_titles(db: Session, project_id: str) -> list[str]:
    """Risks already in the register that did not come from the AI analysis (meetings, by hand), so it adds only new ones."""
    return list(db.scalars(select(RegisterRisk.title).where(RegisterRisk.project_id == project_id, _keeps(),
                                                            RegisterRisk.status != "dismissed")).all())
