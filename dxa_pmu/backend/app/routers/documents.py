import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Project, ProjectDoc
from ..services import documents
from .projects import get_project

router = APIRouter(tags=["documents"])


def _out(d: ProjectDoc) -> dict:
    return {"id": d.id, "name": d.name, "size": d.size, "chars": len(d.text), "uploadedAt": d.uploaded_at}


@router.get("/projects/{project_id}/documents")
def list_documents(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    return [_out(d) for d in db.scalars(select(ProjectDoc).where(ProjectDoc.project_id == p.id).order_by(ProjectDoc.uploaded_at.desc()))]


@router.post("/projects/{project_id}/documents", status_code=201)
async def upload_document(request: Request, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """The raw file as the request body, with its name in the X-File-Name header (URL-encoded)."""
    from urllib.parse import unquote
    name = unquote(request.headers.get("x-file-name", "document"))[:200]
    data = await request.body()
    if len(data) > documents.MAX_BYTES:
        raise HTTPException(413, "That file is larger than 10 MB.")
    try:
        text = documents.extract(name, data)
    except documents.DocProblem as e:
        raise HTTPException(422, str(e)) from None
    d = ProjectDoc(id=str(uuid.uuid4()), project_id=p.id, name=name, size=len(data), text=text)
    db.add(d)
    db.flush()
    documents.sync_names(db, p)
    db.commit()
    return _out(d)


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(doc_id: str, db: Session = Depends(get_db)):
    d = db.get(ProjectDoc, doc_id)
    if not d:
        raise HTTPException(404, "Document not found.")
    p = db.get(Project, d.project_id)
    db.delete(d)
    db.flush()
    if p:
        documents.sync_names(db, p)
    db.commit()
