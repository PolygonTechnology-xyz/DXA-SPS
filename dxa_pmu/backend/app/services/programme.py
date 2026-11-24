"""Programme figures shown on the dashboard and in reports: health score, phases and meeting decisions.
Mirrors frontend/src/components/Gauge.tsx (score) and Dashboard.tsx (phases); keep them in step."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Meeting, Project
from .analysis import action_status, is_high, is_risk


@dataclass
class Factor:
    label: str
    points: int
    note: str


@dataclass
class Score:
    score: int | None
    band: str
    factors: list[Factor]


@dataclass
class Phase:
    name: str
    pct: int
    done: int
    total: int
    due: str | None


@dataclass
class DecisionRow:
    text: str
    meeting: str
    held_on: str
    status: str  # Approved | Under review


def health_score(tasks: list[dict[str, Any]], today: date | None = None, high_risks: int | None = None) -> Score:
    today = today or date.today()
    open_ = [t for t in tasks if t.get("category") != "done"]
    n = len(open_) or 1
    overdue = sum(1 for t in open_ if action_status(t, today) == "Overdue")
    high = high_risks or 0  # high risks come from the risk register, not from task priority
    unassigned = sum(1 for t in open_ if not t.get("assignee"))
    no_date = sum(1 for t in open_ if not t.get("due"))
    factors = [
        Factor("Overdue work", min(40, round(overdue / n * 80)), f"{overdue} of {len(open_)} open items are past due"),
        Factor("High risks", min(30, high * 10), f"{high} high-severity risk{'' if high == 1 else 's'}"),
        Factor("No owner", min(15, round(unassigned / n * 30)), f"{unassigned} open items unassigned"),
        Factor("No due date", min(15, round(no_date / n * 15)), f"{no_date} open items without a date"),
    ]
    if not tasks:
        return Score(None, "No data", factors)
    score = max(0, 100 - sum(f.points for f in factors))
    return Score(score, "Critical" if score < 40 else "At risk" if score < 70 else "On track", factors)


def phases(project: Project) -> list[Phase]:
    """Epics (or team-managed 'Workstreams') with progress from their child tasks; Jira versions if there are none."""
    tasks = project.tasks or []
    referenced = {t.get("epic") for t in tasks if t.get("epic")}
    out: list[Phase] = []
    for e in tasks:
        if (e.get("type") or "").lower() in ("epic", "workstream") or e["key"] in referenced:
            kids = [t for t in tasks if t.get("epic") == e["key"]]
            done = sum(1 for t in kids if t.get("category") == "done")
            pct = round(done / len(kids) * 100) if kids else (100 if e.get("category") == "done" else 0)
            out.append(Phase(e["summary"], pct, done, len(kids), e.get("due")))
    if not out:
        for m in project.milestones or []:
            total, done = m.get("total") or 0, m.get("doneTasks") or 0
            out.append(Phase(m["title"], 100 if m.get("done") else (round(done / total * 100) if total else 0), done, total, m.get("due")))
    return sorted(out, key=lambda p: (p.due or "9999", p.name))


def decisions(db: Session, project_id: str, limit: int = 12) -> list[DecisionRow]:
    rows = db.scalars(select(Meeting).where(Meeting.project_id == project_id, Meeting.minutes.is_not(None))
                      .order_by(Meeting.held_on.desc(), Meeting.created_at.desc())).all()
    out = [DecisionRow(d, m.title, m.held_on, "Approved" if m.approved_at else "Under review")
           for m in rows for d in (m.minutes or {}).get("decisions", [])]
    return out[:limit]
