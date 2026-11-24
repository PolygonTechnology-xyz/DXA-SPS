"""Rule-based task analysis. The numbers always come from here; Claude only writes the words around them."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

HIGH = re.compile(r"^(highest|high|critical|blocker|major)$", re.I)


def is_high(t: dict[str, Any]) -> bool:
    return bool(HIGH.match(t.get("priority") or ""))


def is_risk(t: dict[str, Any]) -> bool:
    return (t.get("type") or "").lower() == "bug" or is_high(t)


def action_status(t: dict[str, Any], today: date) -> str:
    """Overdue / Due soon / In progress / On track."""
    if t.get("due"):
        due = date.fromisoformat(t["due"])
        if due < today:
            return "Overdue"
        if due - today <= timedelta(days=7):
            return "Due soon"
    return "In progress" if t.get("category") == "indeterminate" else "On track"


@dataclass
class Analysis:
    tasks: list[dict[str, Any]]
    open: list[dict[str, Any]]
    overdue: list[dict[str, Any]]
    due_soon: list[dict[str, Any]]
    risks: list[dict[str, Any]]
    high_risks: list[dict[str, Any]]
    todo: list[dict[str, Any]]
    in_progress: list[dict[str, Any]]
    done: int
    pct: int
    unassigned: list[dict[str, Any]]
    no_date: list[dict[str, Any]]
    load: dict[str, dict[str, int]] = field(default_factory=dict)
    findings: list[str] = field(default_factory=list)
    headline: str = ""

    def metrics(self) -> dict[str, int]:
        return {
            "total": len(self.tasks),
            "open": len(self.open),
            "overdue": len(self.overdue),
            "dueSoon": len(self.due_soon),
            "risks": len(self.risks),
            "highRisks": len(self.high_risks),
            "todo": len(self.todo),
            "inProgress": len(self.in_progress),
            "done": self.done,
            "percentComplete": self.pct,
            "unassigned": len(self.unassigned),
            "noDueDate": len(self.no_date),
        }


def _keys(ts: list[dict[str, Any]]) -> str:
    return ", ".join(t["key"] for t in ts)


def analyse(tasks: list[dict[str, Any]] | None, today: date | None = None) -> Analysis:
    tasks = tasks or []
    today = today or date.today()
    open_ = [t for t in tasks if t.get("category") != "done"]
    overdue = [t for t in open_ if action_status(t, today) == "Overdue"]
    due_soon = [t for t in open_ if action_status(t, today) == "Due soon"]
    risks = [t for t in open_ if is_risk(t)]
    high = [t for t in risks if is_high(t)]
    done = len(tasks) - len(open_)
    unassigned = [t for t in open_ if not t.get("assignee")]
    no_date = [t for t in open_ if not t.get("due")]

    load: dict[str, dict[str, int]] = defaultdict(lambda: {"open": 0, "inProgress": 0, "done": 0})
    for t in tasks:
        row = load[t.get("assignee") or "Unassigned"]
        if t.get("category") == "done":
            row["done"] += 1
        else:
            row["open"] += 1
            if t.get("category") == "indeterminate":
                row["inProgress"] += 1

    a = Analysis(
        tasks=tasks, open=open_, overdue=overdue, due_soon=due_soon, risks=risks, high_risks=high,
        todo=[t for t in tasks if t.get("category") == "new"],
        in_progress=[t for t in tasks if t.get("category") == "indeterminate"],
        done=done, pct=round(done / len(tasks) * 100) if tasks else 0,
        unassigned=unassigned, no_date=no_date, load=dict(load),
    )

    f = a.findings
    if not tasks:
        f.append("No tasks were found in Jira, so progress cannot be measured yet.")
    if overdue:
        f.append(f"{len(overdue)} open task(s) overdue ({_keys(overdue)}). Agree a new date or unblock them first.")
    if due_soon:
        f.append(f"{len(due_soon)} task(s) due within 7 days.")
    if unassigned:
        f.append(f"{len(unassigned)} open task(s) have no owner. Assign owners so work does not stall.")
    if open_ and len(no_date) == len(open_):
        f.append("None of the open tasks has a due date, so delays cannot be detected. Add due dates in Jira.")
    elif no_date:
        f.append(f"{len(no_date)} open task(s) have no due date.")
    if tasks and not overdue and not high and not unassigned:
        f.append("No overdue, high-severity or unowned items. The project looks healthy.")

    a.headline = (
        "No Jira tasks are available yet."
        if not tasks
        else f"{done} of {len(tasks)} tasks are complete ({a.pct}%). {len(open_)} remain open"
        + (f", {len(overdue)} of them overdue." if overdue else ".")
    )
    return a
