"""Creates reports that have come due. Runs inside the API process, hourly by default."""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..config import get_settings
from ..db import SessionLocal
from ..models import Project, Report
from . import jira
from . import risks as risk_service
from .projects import refresh_tasks
from .reports import create_report
from .schedule import due_period

log = logging.getLogger(__name__)


def run_due_reports(today: date | None = None) -> int:
    """Create every scheduled report that is due and does not exist yet. Returns how many were made."""
    made = 0
    with SessionLocal() as db:
        for p in db.scalars(select(Project).where(Project.report_schedule.is_not(None))).all():
            period = due_period(p.report_schedule, today)
            if not period or not (p.jira_key or p.files):
                continue
            key = f"{p.id}:{period.start}:{period.end}"
            if db.scalar(select(Report.id).where(Report.dedupe_key == key)):
                continue
            try:
                if p.jira_key and p.connection:
                    try:
                        refresh_tasks(db, p)  # report on fresh data when we can
                    except jira.JiraError as e:
                        log.warning("Using saved tasks for %s: %s", p.id, e.message)
                create_report(db, p, period_label=period.label, start=period.start, end=period.end, trigger="scheduled")
                made += 1
            except IntegrityError:
                db.rollback()  # another worker created it first
            except Exception:  # keep going with the other projects
                db.rollback()
                log.exception("Scheduled report failed for %s", p.id)
    return made


def sync_jira_projects() -> int:
    """Re-import tasks for every project with a saved Jira login. Read-only: nothing is written to Jira.
    One project failing never stops the others. Returns how many synced."""
    synced = 0
    with SessionLocal() as db:
        for p in db.scalars(select(Project).where(Project.jira_key.is_not(None))).all():
            if not p.connection:
                continue
            try:
                refresh_tasks(db, p)
                synced += 1
                try:
                    risk_service.generate(db, p)  # keeps the risk register up to date without anyone asking
                except Exception:
                    db.rollback()
                    log.warning("Risk analysis failed for %s", p.id)
            except jira.JiraError as e:
                db.rollback()
                log.warning("Jira sync failed for %s: %s", p.id, e.message)
            except Exception:
                db.rollback()
                log.exception("Jira sync failed for %s", p.id)
    return synced


def start() -> BackgroundScheduler | None:
    s = get_settings()
    if not s.scheduler_enabled:
        return None
    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(run_due_reports, "interval", minutes=s.scheduler_interval_minutes,
                  next_run_time=datetime.now(timezone.utc), max_instances=1, coalesce=True)
    if s.jira_sync_enabled:
        sched.add_job(sync_jira_projects, "interval", minutes=s.jira_sync_interval_minutes,
                      id="sync_jira", max_instances=1, coalesce=True)
    sched.start()
    return sched
