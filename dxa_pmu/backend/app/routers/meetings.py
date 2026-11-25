import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Meeting, Project
from ..schemas import ReviseIn, FormatChoice, DecisionOut, MeetingIn, MeetingOut, MinutesIO, ReviseOut, TranscriptIn
from ..services import ai, chat, docs, documents, register
from ..services import style as docstyle
from .projects import get_project

router = APIRouter(tags=["meetings"])


def _meeting(db: Session, meeting_id: str) -> Meeting:
    m = db.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, "Meeting not found.")
    return m


def _out(m: Meeting) -> MeetingOut:
    return MeetingOut.model_validate(m)


@router.get("/projects/{project_id}/meetings", response_model=list[MeetingOut], response_model_by_alias=True)
def list_meetings(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    rows = db.scalars(select(Meeting).where(Meeting.project_id == p.id).order_by(Meeting.held_on.desc(), Meeting.created_at.desc())).all()
    return [_out(m) for m in rows]


@router.get("/projects/{project_id}/decisions", response_model=list[DecisionOut], response_model_by_alias=True)
def recent_decisions(limit: int = 6, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """Decisions from the project's meeting minutes, newest meeting first. Decisions in approved minutes are
    "Approved"; those in a draft are "Under review"."""
    rows = db.scalars(select(Meeting).where(Meeting.project_id == p.id, Meeting.minutes.is_not(None))
                      .order_by(Meeting.held_on, Meeting.created_at)).all()
    found = [(m, d) for m in rows for d in (m.minutes or {}).get("decisions", [])]
    out = [DecisionOut(number=n, text=d, meeting_id=m.id, meeting_title=m.title, held_on=m.held_on, status="Approved" if m.approved_at else "Under review")
           for n, (m, d) in enumerate(found, 1)]
    return out[::-1][: max(1, min(limit, 500))]


@router.post("/projects/{project_id}/meetings", response_model=MeetingOut, response_model_by_alias=True, status_code=201)
def create_meeting(body: MeetingIn, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    m = Meeting(id=str(uuid.uuid4()), project_id=p.id, title=body.title.strip(), held_on=body.held_on, notes=body.notes)
    db.add(m)
    db.commit()
    return _out(m)


@router.post("/transcripts/text")
async def transcript_text(request: Request):
    """The text of a transcript file (.txt, .vtt or .docx), so it can be checked before the meeting is saved."""
    from urllib.parse import unquote
    name = unquote(request.headers.get("x-file-name", "transcript.txt"))[:200].lower()
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > documents.MAX_BYTES:
            raise HTTPException(413, "That file is larger than 25 MB.")
    if not name.endswith((".txt", ".vtt", ".docx")):
        raise HTTPException(422, "Use a .txt, .vtt or .docx transcript.")
    try:  # subtitle files are plain text
        text = await run_in_threadpool(documents.extract, name[:-4] + ".txt" if name.endswith(".vtt") else name, bytes(data))
    except documents.DocProblem as e:
        raise HTTPException(422, str(e)) from None
    return {"text": text[:60000], "trimmed": len(text) > 60000}


@router.put("/meetings/{meeting_id}/transcript", response_model=MeetingOut, response_model_by_alias=True)
def set_transcript(meeting_id: str, body: TranscriptIn, db: Session = Depends(get_db)):
    """Adds or corrects a meeting's transcript. Minutes that are already approved keep the transcript they were made from."""
    m = _meeting(db, meeting_id)
    if m.approved_at:
        raise HTTPException(409, "The transcript of approved minutes can't be changed.")
    m.notes = body.notes
    db.commit()
    return _out(m)


@router.delete("/meetings/{meeting_id}", status_code=204)
def delete_meeting(meeting_id: str, db: Session = Depends(get_db)):
    db.delete(_meeting(db, meeting_id))
    chat.clear(db, "minutes", meeting_id)
    db.commit()


@router.post("/meetings/{meeting_id}/minutes", response_model=MeetingOut, response_model_by_alias=True)
def draft_minutes(meeting_id: str, db: Session = Depends(get_db)):
    """Claude drafts minutes from the notes. This replaces any earlier draft and clears the approval."""
    m = _meeting(db, meeting_id)
    if not m.notes.strip():
        raise HTTPException(400, "Add the meeting notes first, so there is something to write minutes from.")
    project = db.get(Project, m.project_id)
    d = ai.draft_minutes(project.name if project else "", m.title, m.held_on, m.notes)
    m.minutes = MinutesIO.model_validate(d.model_dump()).model_dump()
    m.ai_generated, m.approved_at = True, None
    register.sync_meeting(db, m)  # risks the meeting raised become suggestions to confirm
    db.commit()
    return _out(m)


@router.delete("/meetings/{meeting_id}/minutes", response_model=MeetingOut, response_model_by_alias=True)
def reject_minutes(meeting_id: str, db: Session = Depends(get_db)):
    """Throws away a draft and its unconfirmed risk suggestions. The transcript stays. Approved minutes are a record."""
    m = _meeting(db, meeting_id)
    if m.approved_at:
        raise HTTPException(409, "Approved minutes are a record and can't be rejected.")
    m.minutes, m.ai_generated = None, False
    register.sync_meeting(db, m)
    chat.clear(db, "minutes", m.id)
    db.commit()
    return _out(m)


@router.get("/meetings/{meeting_id}/chat")
def minutes_chat(meeting_id: str, db: Session = Depends(get_db)):
    _meeting(db, meeting_id)
    return chat.history(db, "minutes", meeting_id)


@router.post("/meetings/{meeting_id}/revise", response_model=ReviseOut, response_model_by_alias=True)
def revise_minutes(meeting_id: str, body: ReviseIn, db: Session = Depends(get_db)):
    """The reviewer asks the AI for changes. Unapproved minutes are updated in place (still a draft); the conversation is kept."""
    m = _meeting(db, meeting_id)
    current = body.current.model_dump() if body.current else m.minutes
    if not current:
        raise HTTPException(409, "Draft the minutes first, then ask for changes.")
    project = db.get(Project, m.project_id)
    r = ai.revise_minutes(project.name if project else "", m.title, m.notes, current, docstyle.resolve(m.style).model_dump(), chat.history(db, "minutes", m.id), body.message)
    out = MinutesIO.model_validate(r.minutes.model_dump())
    if not m.approved_at:  # an approved record is only replaced by approving again
        m.minutes = out.model_dump()
        register.sync_meeting(db, m)
    m.style = docstyle.merge(m.style, r.style)  # design applies to approved minutes too: it is not part of the record
    chat.add(db, "minutes", m.id, body.message, r.reply)
    db.commit()
    return ReviseOut(reply=r.reply, minutes=out, meeting=_out(m))


@router.post("/meetings/{meeting_id}/approve", response_model=MeetingOut, response_model_by_alias=True)
def approve_minutes(meeting_id: str, body: MinutesIO, db: Session = Depends(get_db)):
    """The reviewer's edited minutes become the record."""
    m = _meeting(db, meeting_id)
    m.minutes, m.approved_at = body.model_dump(), datetime.now(timezone.utc)
    register.sync_meeting(db, m)
    db.commit()
    return _out(m)


def _minutes_docx(db: Session, m: Meeting) -> bytes:
    if not m.minutes:
        raise HTTPException(409, "There are no minutes for this meeting yet. Draft them from the transcript first.")
    tpl, _, builtin = docs.resolve_format(db, m.project_id, "minutes", m.format_id)
    try:
        return docs.render(tpl, docs.minutes_context(m, db.get(Project, m.project_id)), builtin, docs.effective_style(m.style, builtin))
    except docs.TemplateProblem as e:
        raise HTTPException(422, str(e)) from None


@router.put("/meetings/{meeting_id}/format", response_model=MeetingOut, response_model_by_alias=True)
def choose_format(meeting_id: str, body: FormatChoice, db: Session = Depends(get_db)):
    m = _meeting(db, meeting_id)
    m.format_id = body.format_id
    db.commit()
    return _out(m)


@router.get("/meetings/{meeting_id}/minutes/preview")
def preview_minutes(meeting_id: str, db: Session = Depends(get_db)):
    m = _meeting(db, meeting_id)
    builtin = docs.resolve_format(db, m.project_id, "minutes", m.format_id)[2]
    return JSONResponse({"html": docs.preview_html(_minutes_docx(db, m), docs.effective_style(m.style, builtin))})


@router.get("/meetings/{meeting_id}/minutes/docx")
def download_minutes(meeting_id: str, db: Session = Depends(get_db)):
    m = _meeting(db, meeting_id)
    from urllib.parse import quote
    import re
    name = re.sub(r'[\\/:*?"<>|\s]+', "-", f"minutes-{m.held_on}-{m.title}").strip("-")[:120] or "minutes"
    return Response(_minutes_docx(db, m), media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}.docx"})
