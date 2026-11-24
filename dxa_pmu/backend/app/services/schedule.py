from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Period:
    start: date
    end: date
    label: str


def _month_start(y: int, m: int) -> date:
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    return date(y, m, 1)


def _month_end(d: date) -> date:
    return date(d.year, d.month, monthrange(d.year, d.month)[1])


def due_period(schedule: dict | None, today: date | None = None) -> Period | None:
    """The most recent finished period that should have a report, or None if nothing is due yet."""
    today = today or date.today()
    if not schedule or not schedule.get("enabled"):
        return None
    freq = schedule.get("frequency")
    if freq == "monthly":
        start = _month_start(today.year, today.month - 1)
        return Period(start, _month_end(start), start.strftime("%B %Y"))
    if freq == "quarterly":
        q = (today.month - 1) // 3
        start = _month_start(today.year, q * 3 - 2)  # first month of the previous quarter
        end = _month_end(_month_start(start.year, start.month + 2))
        return Period(start, end, f"Q{(start.month - 1) // 3 + 1} {start.year}")
    if freq == "custom":
        try:
            start, end = date.fromisoformat(schedule["from"]), date.fromisoformat(schedule["to"])
        except (KeyError, TypeError, ValueError):
            return None
        if start > end or end > today:
            return None
        return Period(start, end, f"{start:%d %b} – {end:%d %b %Y}")
    return None


def current_period(schedule: dict | None, today: date | None = None) -> Period | None:
    """The period 'now' falls in (this month, this quarter, or the custom range). None means no schedule is set."""
    today = today or date.today()
    if not schedule or not schedule.get("enabled"):
        return None
    freq = schedule.get("frequency")
    if freq == "monthly":
        start = date(today.year, today.month, 1)
        return Period(start, _month_end(start), start.strftime("%B %Y"))
    if freq == "quarterly":
        q = (today.month - 1) // 3
        start = date(today.year, q * 3 + 1, 1)
        return Period(start, _month_end(_month_start(start.year, start.month + 2)), f"Q{q + 1} {today.year}")
    if freq == "custom":
        try:
            start, end = date.fromisoformat(schedule["from"]), date.fromisoformat(schedule["to"])
        except (KeyError, TypeError, ValueError):
            return None
        return Period(start, end, f"{start:%d %b} – {end:%d %b %Y}") if start <= end else None
    return None
