import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DocFormat, Meeting, Project
from ..schemas import FormatChoice
from ..services import docs
from .projects import get_project

router = APIRouter(tags=["formats"])
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
MAX_BYTES = 5 * 1024 * 1024


def _kind(kind: str) -> str:
    if kind not in docs.KINDS:
        raise HTTPException(404, "Unknown format. Use 'minutes' or 'report'.")
    return kind


def _row(db: Session, format_id: str) -> DocFormat:
    row = db.get(DocFormat, format_id)
    if not row:
        raise HTTPException(404, "Format not found.")
    return row


@router.get("/projects/{project_id}/formats")
def list_formats(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """Every uploaded format of the project, by kind. The built-in format is always available as well."""
    out: dict = {k: [] for k in docs.KINDS}
    for r in db.scalars(select(DocFormat).where(DocFormat.project_id == p.id).order_by(DocFormat.uploaded_at)):
        out[r.kind].append({"id": r.id, "name": r.name, "uploadedAt": r.uploaded_at, "isDefault": r.is_default})
    return out


@router.post("/projects/{project_id}/formats/{kind}", status_code=201)
async def upload_format(kind: str, request: Request, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """The raw .docx as the request body, with its name in the X-File-Name header (URL-encoded). The new format becomes the default."""
    from urllib.parse import unquote
    kind = _kind(kind)
    name = unquote(request.headers.get("x-file-name", "format.docx"))[:200]
    data = await request.body()
    if not name.lower().endswith(".docx") or data[:2] != b"PK":
        raise HTTPException(400, "Please upload a Word file (.docx).")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "That file is larger than 5 MB.")
    try:
        docs.validate(data)
    except docs.TemplateProblem as e:
        raise HTTPException(422, str(e)) from None
    for r in db.scalars(select(DocFormat).where(DocFormat.project_id == p.id, DocFormat.kind == kind)):
        r.is_default = False
    row = DocFormat(id=str(uuid.uuid4()), project_id=p.id, kind=kind, name=name, data=data, is_default=True)
    db.add(row)
    db.commit()
    return {"id": row.id, "name": row.name, "uploadedAt": row.uploaded_at, "isDefault": True}


@router.put("/projects/{project_id}/formats/{kind}/default")
def set_default(kind: str, body: FormatChoice, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """Makes one format the default for new documents, or the built-in format when formatId is null."""
    kind = _kind(kind)
    for r in db.scalars(select(DocFormat).where(DocFormat.project_id == p.id, DocFormat.kind == kind)):
        r.is_default = r.id == body.format_id
    db.commit()
    return list_formats(p, db)


@router.delete("/formats/{format_id}", status_code=204)
def delete_format(format_id: str, db: Session = Depends(get_db)):
    db.delete(_row(db, format_id))
    db.commit()


@router.get("/formats/{format_id}/file")
def download_format(format_id: str, db: Session = Depends(get_db)):
    r = _row(db, format_id)
    return Response(r.data, media_type=DOCX, headers={"Content-Disposition": f"attachment; filename*=UTF-8\'\'{__import__('urllib.parse').parse.quote(r.name)}"})


@router.get("/projects/{project_id}/formats/{kind}/sample")
def sample_format(kind: str, p: Project = Depends(get_project)):
    """The built-in format filled with example content: a sample of how a document looks, to edit and upload back."""
    kind = _kind(kind)
    out = docs.render(docs.builtin_template(kind), docs.SAMPLE[kind], True, docs.effective_style(None, True))
    return Response(out, media_type=DOCX, headers={"Content-Disposition": f'attachment; filename="sample-{kind}.docx"'})


def _live(db: Session, p: Project, kind: str, format_id: str | None) -> tuple[bytes, object]:
    """A document made now from the project's current data in the chosen (or default) format. Nothing is saved."""
    from ..services.reports import gather

    tpl, _, builtin = docs.resolve_format(db, p.id, kind, format_id)
    if kind == "report":
        ctx = gather(db, p, f"Preview, {date.today():%d %b %Y}")[5]
        ctx["status"] = "Preview - not saved"
    else:
        m = db.scalars(select(Meeting).where(Meeting.project_id == p.id, Meeting.minutes.is_not(None))
                       .order_by(Meeting.held_on.desc(), Meeting.created_at.desc())).first()
        if not m:
            raise HTTPException(409, "No meeting has minutes yet. Draft minutes from a transcript first.")
        ctx = docs.minutes_context(m, p)
    st = docs.effective_style(None, builtin)
    try:
        return docs.render(tpl, ctx, builtin, st), st
    except docs.TemplateProblem as e:
        raise HTTPException(422, str(e)) from None


@router.get("/projects/{project_id}/formats/{kind}/preview")
def preview_live(kind: str, format: str | None = None, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    data, st = _live(db, p, _kind(kind), format)
    return JSONResponse({"html": docs.preview_html(data, st)})


@router.get("/projects/{project_id}/formats/{kind}/preview.docx")
def preview_live_docx(kind: str, format: str | None = None, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    return Response(_live(db, p, _kind(kind), format)[0], media_type=DOCX, headers={"Content-Disposition": f'attachment; filename="{kind}-preview.docx"'})
