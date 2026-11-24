"""Action items consolidated from Jira (BR-FR-018): every open task, grouped by owner."""

from __future__ import annotations

from datetime import date
from typing import Any

from ..models import Project
from .analysis import action_status

ORDER = {"Overdue": 0, "Due soon": 1, "In progress": 2, "On track": 3}


def days_overdue(t: dict[str, Any], today: date) -> int | None:
    if not t.get("due"):
        return None
    n = (today - date.fromisoformat(t["due"])).days
    return n if n > 0 else None


def build(p: Project, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    tasks = p.tasks or []
    open_keys = {t["key"] for t in tasks if t.get("category") != "done"}
    owners: dict[str, list[dict[str, Any]]] = {}
    for t in tasks:
        if t.get("category") == "done":
            continue
        status = action_status(t, today)
        owners.setdefault(t.get("assignee") or "", []).append({
            "key": t["key"], "summary": t["summary"], "jiraStatus": t.get("status", ""), "status": status,
            "due": t.get("due"), "daysOverdue": days_overdue(t, today), "priority": t.get("priority"),
            "blockedBy": [k for k in t.get("blockedBy") or [] if k in open_keys],
            "url": f"{p.jira_site}/browse/{t['key']}" if p.jira_site else None,
        })
    out = []
    for name, items in owners.items():
        items.sort(key=lambda a: (ORDER[a["status"]], a["due"] or "9999", a["key"]))
        out.append({
            "name": name or "Unassigned", "unassigned": not name, "open": len(items),
            "overdue": sum(a["status"] == "Overdue" for a in items),
            "dueSoon": sum(a["status"] == "Due soon" for a in items), "actions": items,
        })
    # Owners with overdue work first; "Unassigned" always last.
    out.sort(key=lambda o: (o["unassigned"], -o["overdue"], -o["dueSoon"], o["name"].lower()))
    return {"owners": out, "total": sum(o["open"] for o in out)}
