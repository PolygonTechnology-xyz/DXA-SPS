from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Project
from ..schemas import ActionsOut, JiraConnectIn, JiraConnectOut, ProjectCreate, ProjectOut, ProjectPatch
from ..services import actions, jira
from ..services.projects import connect_jira, next_ids, refresh_tasks

router = APIRouter(prefix="/projects", tags=["projects"])


def _milestones(p: Project) -> list[dict]:
    """Jira versions with how many of their tasks are done (tasks carry their fix versions)."""
    out = []
    for m in p.milestones or []:
        mine = [t for t in p.tasks or [] if m["title"] in (t.get("versions") or [])]
        out.append({**m, "total": len(mine), "done_tasks": sum(t.get("category") == "done" for t in mine)})
    return out


def project_out(p: Project) -> ProjectOut:
    return ProjectOut.model_validate({
        "id": p.id, "code": p.code, "name": p.name, "goal": p.goal, "status": p.status, "health": p.health,
        "progress": p.progress, "manager": p.manager, "start_date": p.start_date, "end_date": p.end_date,
        "budget": p.budget, "milestones": _milestones(p), "files": p.files or [],
        "jira": {"site": p.jira_site, "key": p.jira_key, "name": p.jira_name or p.jira_key} if p.jira_key else None,
        "tasks": p.tasks, "synced_at": p.synced_at, "report_schedule": p.report_schedule,
    })


def get_project(project_id: str, db: Session = Depends(get_db)) -> Project:
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Project not found.")
    return p


def _jira_http(e: jira.JiraError) -> HTTPException:
    return HTTPException(e.status, e.message)


@router.get("", response_model=list[ProjectOut], response_model_by_alias=True)
def list_projects(db: Session = Depends(get_db)):
    return [project_out(p) for p in db.scalars(select(Project).order_by(Project.created_at.desc()))]


@router.post("", response_model=ProjectOut, status_code=201, response_model_by_alias=True)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    pid, code = next_ids(db)
    p = Project(id=pid, code=code, name=body.name.strip(), goal=body.goal.strip(), milestones=[], files=[])
    db.add(p)
    db.commit()
    return project_out(p)


@router.get("/{project_id}", response_model=ProjectOut, response_model_by_alias=True)
def read_project(p: Project = Depends(get_project)):
    return project_out(p)


@router.patch("/{project_id}", response_model=ProjectOut, response_model_by_alias=True)
def update_project(body: ProjectPatch, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True, by_alias=False)
    if "report_schedule" in data:
        sched = body.report_schedule
        if sched and sched.enabled and sched.frequency == "custom" and not (sched.from_ and sched.to and sched.from_ <= sched.to):
            raise HTTPException(422, "A custom schedule needs a start date on or before its end date.")
        data["report_schedule"] = sched.model_dump(by_alias=True) if sched else None
    for k, v in data.items():
        setattr(p, k, v)
    db.commit()
    return project_out(p)


@router.delete("/{project_id}", status_code=204)
def delete_project(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    db.delete(p)
    db.commit()


@router.post("/{project_id}/jira", response_model=JiraConnectOut, response_model_by_alias=True)
def connect(body: JiraConnectIn, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """Checks the Jira login, saves it (token encrypted) and imports the project's tasks."""
    try:
        res = connect_jira(db, p, body.site_url, body.email, body.api_token, body.project_key)
    except jira.JiraError as e:
        raise _jira_http(e) from None
    return JiraConnectOut(message=f"Connected as {res['user']}.", project_name=res["project_name"], project=project_out(p))


@router.post("/{project_id}/jira/refresh", response_model=ProjectOut, response_model_by_alias=True)
def refresh(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """Re-imports tasks using the saved login."""
    try:
        refresh_tasks(db, p)
    except jira.JiraError as e:
        raise _jira_http(e) from None
    return project_out(p)


@router.delete("/{project_id}/jira", response_model=ProjectOut, response_model_by_alias=True)
def disconnect(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    if p.connection:
        db.delete(p.connection)
    p.jira_site = p.jira_key = p.jira_name = p.synced_at = p.tasks = None
    db.commit()
    return project_out(p)


@router.get("/{project_id}/actions", response_model=ActionsOut, response_model_by_alias=True)
def get_actions(p: Project = Depends(get_project)):
    """Open Jira tasks as action items, grouped by owner."""
    return actions.build(p)
