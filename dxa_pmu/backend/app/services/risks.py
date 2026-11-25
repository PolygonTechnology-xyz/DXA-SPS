"""Top risks for a project, for the period its report settings define (this month, this quarter, a custom range)."""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from ..models import Project, RiskAnalysis
from . import ai, documents
from .actions import days_overdue
from .analysis import action_status, is_high
from .schedule import Period, current_period

SEV = {"high": 0, "medium": 1, "low": 2}


def src_key(dt: datetime) -> str:
    """Identifies one generated draft (epoch ms, so timezone formatting cannot matter)."""
    return str(int(dt.timestamp() * 1000))


def scope_of(project: Project, today: date | None = None) -> tuple[Period | None, str]:
    today = today or date.today()
    period = current_period(project.report_schedule, today)
    return period, (period.label if period else "All open tasks")


def tasks_in_scope(tasks: list[dict] | None, period: Period | None) -> tuple[list[dict], int]:
    """Open tasks that matter in the period: due in it, overdue from before it, or with no date.
    Tasks due after the period ends are left out (and counted)."""
    open_ = [t for t in (tasks or []) if t.get("category") != "done"]
    if not period:
        return open_, 0
    inside = [t for t in open_ if not t.get("due") or date.fromisoformat(t["due"]) <= period.end]
    return inside, len(open_) - len(inside)


def meeting_digest(db: Session, project_id: str, limit: int = 6) -> list[dict]:
    """What the recent meetings found, for the risk analysis: summary, decisions, actions and risks raised."""
    from sqlalchemy import select

    from ..models import Meeting
    rows = db.scalars(select(Meeting).where(Meeting.project_id == project_id, Meeting.minutes.is_not(None))
                      .order_by(Meeting.held_on.desc(), Meeting.created_at.desc()).limit(limit)).all()
    return [{"meeting": m.title, "date": m.held_on, "summary": (m.minutes or {}).get("summary", ""),
             "decisions": (m.minutes or {}).get("decisions", []), "actions": (m.minutes or {}).get("actions", []),
             "risks": (m.minutes or {}).get("risks", [])} for m in rows]


def input_hash(project: Project, period: Period | None, in_scope: list[dict], meetings: list[dict] | None = None, docs: list[dict] | None = None) -> str:
    keys = ("key", "summary", "description", "status", "category", "assignee", "priority", "type", "due", "blockedBy", "blocks")
    blob = json.dumps({
        "goal": project.goal, "files": project.files,
        "period": [period.start.isoformat(), period.end.isoformat()] if period else None,
        "tasks": [{k: t.get(k) for k in keys} for t in in_scope],
        "meetings": meetings or [],
        "docs": docs or [],
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


def rule_risks(in_scope: list[dict], today: date) -> list[dict[str, Any]]:
    """Used when the AI is unavailable. Plain rules over the same tasks."""
    out: list[dict[str, Any]] = []
    for t in in_scope:
        status = action_status(t, today)
        reasons = []
        if status == "Overdue":
            reasons.append(f"overdue since {t['due']}")
        elif status == "Due soon":
            reasons.append(f"due {t['due']}")
        if is_high(t) or (t.get("type") or "").lower() == "bug":
            reasons.append(f"{t.get('priority') or t.get('type')} priority")
        if not t.get("assignee") and (status in ("Overdue", "Due soon") or is_high(t)):
            reasons.append("no owner")
        if not reasons:
            continue
        sev = "high" if status == "Overdue" or is_high(t) else "medium"
        out.append({
            "title": t["summary"], "severity": sev, "rationale": f"{t['key']} is " + ", ".join(reasons) + ".",
            "mitigation": "Confirm an owner and a realistic date." if "no owner" in reasons else "Check progress with the owner.",
            "taskKeys": [t["key"]],
        })
    return sorted(out, key=lambda r: SEV[r["severity"]])[:8]


MAX_RISKS = 10


def dependency_risks(open_tasks: list[dict], today: date) -> list[dict[str, Any]]:
    """Overdue work that other open tasks are waiting on (Jira "Blocks" links)."""
    by_key = {t["key"]: t for t in open_tasks}
    out = []
    for t in open_tasks:
        waiting = [k for k in t.get("blocks") or [] if k in by_key]
        late = days_overdue(t, today)
        if not waiting or not late:
            continue
        out.append({
            "title": f"{t['summary']} is late and blocks other work", "severity": "high",
            "rationale": f"{t['key']} is {late} day(s) overdue and {len(waiting)} open task(s) cannot finish until it is done: {', '.join(waiting)}.",
            "mitigation": "Unblock it or agree a new date, then re-plan the tasks waiting on it.",
            "taskKeys": [t["key"], *waiting],
        })
    return out


def overdue_risk(uncovered: list[dict], today: date) -> dict[str, Any]:
    """Overdue Jira tasks count as timeline evidence (BR-BR-011), so none may go unmentioned."""
    worst = max(days_overdue(t, today) or 0 for t in uncovered)
    sev = "high" if worst > 14 or any(is_high(t) for t in uncovered) else "medium"
    return {
        "title": f"{len(uncovered)} overdue task(s) put the timeline at risk", "severity": sev,
        "rationale": "Overdue in Jira: " + ", ".join(f"{t['key']} ({days_overdue(t, today)} d)" for t in uncovered[:10]) + ("…" if len(uncovered) > 10 else "") + ".",
        "mitigation": "Agree a new date or unblock each task, and confirm an owner.",
        "taskKeys": [t["key"] for t in uncovered][:15],
    }


def add_evidence(data: dict[str, Any], tasks: list[dict], today: date) -> None:
    """Make sure overdue Jira tasks and blocked dependencies show up, and attach the tickets behind every risk."""
    risks = data["risks"]  # tasks are evidence for a risk, never a risk by themselves
    by_key = {t["key"]: t for t in tasks}
    for r in risks:
        r["evidence"] = [
            {"key": k, "summary": by_key[k]["summary"], "status": by_key[k].get("status", ""), "assignee": by_key[k].get("assignee"),
             "due": by_key[k].get("due"), "daysOverdue": days_overdue(by_key[k], today)}
            for k in r["taskKeys"] if k in by_key and by_key[k].get("category") != "done"
        ]
    data["risks"] = sorted(risks, key=lambda r: SEV[r["severity"]])[:MAX_RISKS]


def clean_guidance(raw: list[str] | None) -> list[str]:
    """The reviewer's messages: trimmed, no blanks, the latest 10."""
    return [g.strip()[:1000] for g in (raw or []) if g and g.strip()][-10:]


def compute(project: Project, today: date | None = None, guidance: list[str] | None = None, meetings: list[dict] | None = None, rejected: list[str] | None = None, known: list[str] | None = None, docs: list[dict] | None = None) -> dict[str, Any]:
    """Run the analysis now. Always returns a result; falls back to rules if the AI fails.
    `guidance` is what the reviewer typed to steer the AI (it does not change the rule-based fallback)."""
    today = today or date.today()
    period, label = scope_of(project, today)
    inside, later = tasks_in_scope(project.tasks, period)
    data: dict[str, Any] = {
        "scope": {"label": label, "from": period.start.isoformat() if period else None, "to": period.end.isoformat() if period else None},
        "overview": "", "risks": [], "aiGenerated": False, "guidance": guidance or [],
    }
    if not inside:
        data["overview"] = "There are no open tasks in this period, so no risks were found." if project.tasks else "Connect Jira to see risks."
        return data
    try:
        extra: dict[str, Any] = {"guidance": guidance} if guidance else {}
        extra["meetings"] = meetings or []
        extra["rejected"] = rejected or []
        extra["known"] = known or []
        rep = ai.analyse_risks(project.name, project.goal, label, today.isoformat(), inside, later, docs or [], **extra)
        known = {t["key"] for t in inside}
        data["overview"] = rep.overview
        data["risks"] = sorted(
            ({"title": r.title, "severity": r.severity, "rationale": r.rationale, "mitigation": r.mitigation,
              "taskKeys": [k for k in r.task_keys if k in known], "likelihood": r.likelihood, "impact": r.impact} for r in rep.risks),
            key=lambda r: SEV[r["severity"]],
        )
        data["registerLinks"] = [{"title": l.title, "taskKeys": [k for k in l.task_keys if k in known]} for l in rep.register_links]
        data["aiGenerated"] = True
    except ai.AIError:
        data["risks"] = rule_risks(inside, today)
        data["overview"] = f"{len(data['risks'])} item(s) need attention (rule-based; the AI analysis is unavailable)." if data["risks"] else "No overdue, high-priority or unowned items."
    add_evidence(data, project.tasks or [], today)
    if data["risks"] and not data["aiGenerated"]:
        data["overview"] = f"{len(data['risks'])} item(s) need attention (rule-based; the AI analysis is unavailable)."
    return data


def status_for(db: Session, project: Project, today: date | None = None) -> dict[str, Any]:
    """The saved analysis (a draft until approved), marked ready / stale / missing against the current tasks
    and period. `approved` is the last approved record, `isApproved` says it is this very draft."""
    from ..models import AIApproval

    period, label = scope_of(project, today)
    inside, _ = tasks_in_scope(project.tasks, period)
    ap = db.get(AIApproval, (project.id, "risks"))
    approved = {**ap.data, "approvedAt": ap.approved_at} if ap else None
    row = db.get(RiskAnalysis, project.id)
    if not row:
        return {"status": "missing", "scope": {"label": label, "from": None, "to": None}, "overview": "", "risks": [], "aiGenerated": False,
                "generatedAt": None, "approved": approved, "isApproved": False}
    fresh = row.input_hash == input_hash(project, period, inside, meeting_digest(db, project.id), documents.for_ai(db, project.id))
    return {**row.data, "status": "ready" if fresh else "stale", "generatedAt": row.created_at,
            "approved": approved, "isApproved": bool(ap and ap.source == src_key(row.created_at))}


def generate(db: Session, project: Project, today: date | None = None, guidance: list[str] | None = None) -> dict[str, Any]:
    """Analyse now. `guidance` None keeps the reviewer's earlier messages (so automatic re-analysis after a Jira
    sync still honours them); a list replaces them, and an empty list clears them."""
    period, _ = scope_of(project, today)
    inside, _ = tasks_in_scope(project.tasks, period)
    row = db.get(RiskAnalysis, project.id)
    notes = clean_guidance(guidance) if guidance is not None else clean_guidance((row.data or {}).get("guidance") if row else None)
    meetings = meeting_digest(db, project.id)
    docs = documents.for_ai(db, project.id)
    from .register import dismissed_titles, known_titles, sync_analysis
    data = compute(project, today, notes, meetings, dismissed_titles(db, project.id), known_titles(db, project.id), docs)
    h = input_hash(project, period, inside, meetings, docs)
    now = datetime.now(timezone.utc)
    if row:
        row.input_hash, row.data, row.created_at = h, data, now
    else:
        db.add(RiskAnalysis(project_id=project.id, input_hash=h, data=data, created_at=now))
    if data["aiGenerated"]:
        sync_analysis(db, project.id, data["risks"], data.get("registerLinks", []))  # as suggestions a person confirms
    db.commit()
    return {**data, "status": "ready", "generatedAt": now, **_approval_view(db, project.id, now)}


def _approval_view(db: Session, project_id: str, generated_at: datetime) -> dict[str, Any]:
    from ..models import AIApproval

    ap = db.get(AIApproval, (project_id, "risks"))
    return {"approved": {**ap.data, "approvedAt": ap.approved_at} if ap else None,
            "isApproved": bool(ap and ap.source == src_key(generated_at))}
