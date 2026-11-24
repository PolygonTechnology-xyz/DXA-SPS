from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Project
from ..schemas import AnalysisOut, ApproveRisksIn, ChatIn, ChatOut, CreateProjectChatOut, RiskRunIn, RisksOut, SummaryIn, SummaryOut, TaskSummaryOut
from ..services import ai, approvals, documents, risks
from ..services.analysis import analyse
from .projects import get_project

router = APIRouter(tags=["ai"])


@router.post("/chat/create-project", response_model=CreateProjectChatOut, response_model_by_alias=True)
def create_project_chat(body: ChatIn):
    """One turn of the 'create a project' conversation. Send the whole history each time.
    When `ready` is true, call POST /projects with the returned name and goal."""
    turn = ai.create_project_turn([m.model_dump() for m in body.messages])
    ready = turn.ready and bool(turn.project_name and turn.goal)
    return CreateProjectChatOut(reply=turn.reply, project_name=turn.project_name, goal=turn.goal, ready=ready)


@router.post("/projects/{project_id}/chat", response_model=ChatOut, response_model_by_alias=True)
def project_chat(body: ChatIn, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """Ask a question about one project's Jira tasks."""
    reply = ai.ask_about_project(p.name, p.goal, analyse(p.tasks), [m.model_dump() for m in body.messages], documents.for_ai(db, p.id))
    return ChatOut(reply=reply)


@router.post("/projects/{project_id}/analysis", response_model=AnalysisOut, response_model_by_alias=True)
def project_analysis(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """Figures come from the rule-based analysis; Claude writes the assessment. Falls back to the rule-based text if the AI is unavailable."""
    a = analyse(p.tasks)
    try:
        t = ai.analyse_tasks(p.name, p.goal, a, documents.for_ai(db, p.id))
        return AnalysisOut(headline=a.headline, metrics=a.metrics(), summary=t.summary, risk_level=t.risk_level,
                           findings=t.findings, recommendations=t.recommendations, ai_generated=True)
    except ai.AIError:
        level = "high" if a.high_risks or a.overdue else "medium" if a.unassigned or a.no_date else "low"
        return AnalysisOut(headline=a.headline, metrics=a.metrics(), summary=a.headline, risk_level=level,
                           findings=a.findings, recommendations=[], ai_generated=False)


@router.get("/projects/{project_id}/risks", response_model=RisksOut, response_model_by_alias=True)
def get_risks(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """The saved risk analysis. `status` is "missing" or "stale" when the tasks or the report period changed;
    call POST to refresh it (it takes a few seconds because Claude does the analysis)."""
    return risks.status_for(db, p)


@router.post("/projects/{project_id}/risks", response_model=RisksOut, response_model_by_alias=True)
def refresh_risks(body: RiskRunIn | None = None, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """Analyse the project's top risks now, for the period set in its report settings. The body can carry the
    reviewer's messages (`guidance`) that tell the AI what to focus on."""
    return risks.generate(db, p, guidance=body.guidance if body else None)


def _approval_http(e: approvals.ApprovalError) -> HTTPException:
    return HTTPException(e.status, e.message)


@router.post("/projects/{project_id}/risks/approve", response_model=RisksOut, response_model_by_alias=True)
def approve_risks(body: ApproveRisksIn | None = None, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """A person approves the current risk draft (or only the chosen risks). Only approved risks reach reports."""
    try:
        approvals.approve_risks(db, p, body.include if body else None)
    except approvals.ApprovalError as e:
        raise _approval_http(e) from None
    return risks.status_for(db, p)


@router.delete("/projects/{project_id}/risks/approve", response_model=RisksOut, response_model_by_alias=True)
def withdraw_risks(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """Withdraws the approval; reports go back to rule-based risks."""
    approvals.withdraw(db, p.id, approvals.RISKS)
    return risks.status_for(db, p)


@router.delete("/projects/{project_id}/risks/{index}", response_model=RisksOut, response_model_by_alias=True)
def delete_risk(index: int, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """Removes one risk from the draft (by its position). Approved analyses cannot be edited."""
    try:
        approvals.remove_risk(db, p, index)
    except approvals.ApprovalError as e:
        raise _approval_http(e) from None
    return risks.status_for(db, p)


@router.post("/projects/{project_id}/tasks/{key}/summary", response_model=TaskSummaryOut, response_model_by_alias=True)
def task_summary(key: str, p: Project = Depends(get_project)):
    """A short AI summary of one Jira task. Shown on request and not saved, so it is never a record."""
    tasks = p.tasks or []
    task = next((t for t in tasks if t["key"] == key), None)
    if not task:
        raise HTTPException(404, "That task is not in this project.")
    blockers = [t for t in tasks if t["key"] in (task.get("blockedBy") or []) and t.get("category") != "done"]
    return TaskSummaryOut(key=key, summary=ai.summarise_task(p.name, p.goal, task, blockers, date.today().isoformat()))


def _summary_out(row) -> SummaryOut | None:
    return SummaryOut(**row.data, approved_at=row.approved_at) if row else None


@router.get("/projects/{project_id}/summary", response_model=SummaryOut | None, response_model_by_alias=True)
def get_summary(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """The approved AI summary, or null when nobody has approved one."""
    return _summary_out(approvals.get(db, p.id, approvals.SUMMARY))


@router.post("/projects/{project_id}/summary/approve", response_model=SummaryOut, response_model_by_alias=True)
def approve_summary(body: SummaryIn, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """Saves the summary exactly as the person approved it (after any edits)."""
    return _summary_out(approvals.approve_summary(db, p, body.model_dump(by_alias=False)))


@router.delete("/projects/{project_id}/summary/approve", status_code=204)
def withdraw_summary(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    approvals.withdraw(db, p.id, approvals.SUMMARY)
