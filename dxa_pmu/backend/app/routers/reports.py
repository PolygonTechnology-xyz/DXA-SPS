import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Project, Report
from ..schemas import ReviseIn, FormatChoice, ReportCreate, ReportOut, ReviseOut
from ..services import chat, docs, jira
from ..services.projects import refresh_tasks
from ..services.reports import create_report, revise_report
from .projects import get_project

log = logging.getLogger(__name__)
router = APIRouter(tags=["reports"])


@router.get("/reports", response_model=list[ReportOut], response_model_by_alias=True)
def list_reports(project_id: str | None = None, db: Session = Depends(get_db)):
    q = select(Report).order_by(Report.created_at.desc())
    if project_id:
        q = q.where(Report.project_id == project_id)
    return db.scalars(q).all()


@router.post("/projects/{project_id}/reports", response_model=ReportOut, status_code=201, response_model_by_alias=True)
def generate_report(body: ReportCreate | None = None, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """Analyses the project's current data and creates a PDF now (the 'Prepare report' button). It starts as a draft that a person approves.."""
    if not (p.jira_key or p.files):
        raise HTTPException(409, "Connect Jira or upload documents before creating a report.")
    today = date.today()
    if p.jira_key and p.connection:
        try:
            refresh_tasks(db, p)  # analyse up to today, not the last sync
        except jira.JiraError as e:
            log.warning("Report for %s uses saved tasks: %s", p.id, e.message)
    label = (body.period_label if body and body.period_label else f"Snapshot, {today:%d %b %Y}")
    return create_report(db, p, period_label=label, start=today, end=today, trigger="manual")


def _report(db: Session, report_id: str) -> Report:
    r = db.get(Report, report_id)
    if not r:
        raise HTTPException(404, "Report not found.")
    return r


@router.get("/reports/{report_id}/download")
def download_report(report_id: str, inline: bool = False, db: Session = Depends(get_db)):
    """A draft downloads as a marked draft; once approved it is the final version."""
    r = _report(db, report_id)
    if r.status == "draft":
        data, name = r.pdf, r.file_name.removesuffix(".pdf") + "-DRAFT.pdf"
    else:
        data, name = r.final_pdf or r.pdf, r.file_name
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": f'{"inline" if inline else "attachment"}; filename="{name}"'})


@router.post("/reports/{report_id}/approve", response_model=ReportOut, response_model_by_alias=True)
def approve_report(report_id: str, db: Session = Depends(get_db)):
    """The reviewed draft becomes the final version. The content does not change."""
    r = _report(db, report_id)
    if r.status == "final":
        raise HTTPException(409, "This report is already approved.")
    r.status, r.approved_at = "final", datetime.now(timezone.utc)
    db.commit()
    return r


@router.post("/reports/{report_id}/revise", response_model=ReviseOut, response_model_by_alias=True)
def revise(report_id: str, body: ReviseIn, db: Session = Depends(get_db)):
    """The reviewer asks the AI to change the written parts of a draft report."""
    r = _report(db, report_id)
    if r.status == "final":
        raise HTTPException(409, "An approved report can't be changed. Prepare a new report instead.")
    reply = revise_report(db, r, body.message, chat.history(db, "report", r.id))
    chat.add(db, "report", r.id, body.message, reply)
    db.commit()
    return ReviseOut(reply=reply, report=r)


@router.get("/reports/{report_id}/chat")
def report_chat(report_id: str, db: Session = Depends(get_db)):
    _report(db, report_id)
    return chat.history(db, "report", report_id)


@router.delete("/reports/{report_id}", status_code=204)
def discard_draft(report_id: str, db: Session = Depends(get_db)):
    r = _report(db, report_id)
    if r.status == "final":
        raise HTTPException(409, "An approved report cannot be deleted.")
    chat.clear(db, "report", r.id)
    db.delete(r)
    db.commit()


def _report_docx(db: Session, r: Report) -> bytes:
    if r.context is None:
        raise HTTPException(409, "This report was made before Word formats existed. Prepare a new report to use one.")
    tpl, _, builtin = docs.resolve_format(db, r.project_id, "report", r.format_id)
    try:
        return docs.render(tpl, docs.report_context(r), builtin, docs.effective_style(r.style, builtin))
    except docs.TemplateProblem as e:
        raise HTTPException(422, str(e)) from None


@router.get("/reports/{report_id}/preview")
def preview_report(report_id: str, db: Session = Depends(get_db)):
    r = _report(db, report_id)
    builtin = docs.resolve_format(db, r.project_id, "report", r.format_id)[2]
    return JSONResponse({"html": docs.preview_html(_report_docx(db, r), docs.effective_style(r.style, builtin))})


@router.put("/reports/{report_id}/format", response_model=ReportOut, response_model_by_alias=True)
def choose_format(report_id: str, body: FormatChoice, db: Session = Depends(get_db)):
    r = _report(db, report_id)
    r.format_id = body.format_id
    db.commit()
    return r


@router.get("/reports/{report_id}/docx")
def download_report_docx(report_id: str, db: Session = Depends(get_db)):
    r = _report(db, report_id)
    name = r.file_name.removesuffix(".pdf") + ("-DRAFT" if r.status == "draft" else "") + ".docx"
    return Response(_report_docx(db, r), media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
