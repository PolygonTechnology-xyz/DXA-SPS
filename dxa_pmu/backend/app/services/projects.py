from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import JiraConnection, Project
from ..security import decrypt, encrypt
from . import jira


def next_ids(db: Session) -> tuple[str, str]:
    nums = [int(i[2:]) for i in db.scalars(select(Project.id)).all() if i[2:].isdigit()]
    n = max(nums, default=0) + 1
    return f"p-{n:03d}", f"PMU-{n:03d}"


def merge_milestones(current: list[dict] | None, from_jira: list[dict]) -> list[dict]:
    """Jira versions replace earlier Jira ones. Milestones confirmed at setup stay, unless Jira has one with the same title."""
    titles = {m["title"].strip().lower() for m in from_jira}
    kept = [m for m in current or [] if m.get("source") == "setup" and m["title"].strip().lower() not in titles]
    return sorted([*from_jira, *kept], key=lambda m: m.get("due") or "9999")


def connect_jira(db: Session, p: Project, site_url: str, email: str, token: str, key: str) -> dict:
    """Check the login, save it (token encrypted) and store the tasks on the project."""
    res = jira.fetch(site_url, email, token, key)
    site = jira.parse_site(site_url)
    p.jira_site, p.jira_key, p.jira_name = site, key.strip().upper(), res["project_name"]
    p.tasks, p.synced_at = res["tasks"], datetime.now(timezone.utc)
    if res.get("milestones") is not None:
        p.milestones = merge_milestones(p.milestones, res["milestones"])
    conn = p.connection or JiraConnection(project_id=p.id)
    conn.site_url, conn.email, conn.token_encrypted, conn.project_key = site, email.strip(), encrypt(token.strip()), p.jira_key
    p.connection = conn
    db.commit()
    return res


def refresh_tasks(db: Session, p: Project) -> None:
    """Re-fetch tasks with the saved login. Raises JiraError if it fails."""
    c = p.connection
    if not c:
        raise jira.JiraError(404, "No saved Jira details for this project. Please connect Jira again.")
    res = jira.fetch(c.site_url, c.email, decrypt(c.token_encrypted), c.project_key)
    p.jira_name, p.synced_at = res["project_name"], datetime.now(timezone.utc)
    p.tasks = res["tasks"]
    if res.get("milestones") is not None:
        p.milestones = merge_milestones(p.milestones, res["milestones"])
    db.commit()
