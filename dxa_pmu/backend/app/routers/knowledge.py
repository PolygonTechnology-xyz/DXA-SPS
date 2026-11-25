"""All resources: documents every project shares."""

import uuid
from typing import Annotated, Literal
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import SharedDoc
from ..services import documents

router = APIRouter(prefix="/knowledge", tags=["all resources"])

Category = Literal["Policy", "Template", "Guideline", "Report", "Other"]


class SharedPatch(BaseModel):
    category: Category | None = None
    tags: list[Annotated[str, Field(min_length=1, max_length=40)]] | None = Field(None, max_length=20)


def _out(d: SharedDoc) -> dict:
    return {"id": d.id, "name": d.name, "size": d.size, "category": d.category, "tags": d.tags or [], "uploadedAt": d.uploaded_at}


def _doc(db: Session, doc_id: str) -> SharedDoc:
    d = db.get(SharedDoc, doc_id)
    if not d:
        raise HTTPException(404, "Document not found.")
    return d


@router.get("")
def list_shared(db: Session = Depends(get_db)):
    return [_out(d) for d in db.scalars(select(SharedDoc).order_by(SharedDoc.uploaded_at.desc()))]


@router.post("", status_code=201)
async def upload_shared(request: Request, db: Session = Depends(get_db)):
    """The raw file as the request body, with its name in the X-File-Name header (URL-encoded)."""
    name = unquote(request.headers.get("x-file-name", "document"))[:200]
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > documents.MAX_BYTES:
            raise HTTPException(413, "That file is larger than 25 MB.")
    try:
        text = await run_in_threadpool(documents.extract, name, bytes(data))
    except documents.DocProblem as e:
        raise HTTPException(422, str(e)) from None
    d = SharedDoc(id=str(uuid.uuid4()), name=name, size=len(data), text=text, tags=[])
    db.add(d)
    db.commit()
    return _out(d)


@router.patch("/{doc_id}")
def update_shared(doc_id: str, body: SharedPatch, db: Session = Depends(get_db)):
    d = _doc(db, doc_id)
    if body.category:
        d.category = body.category
    if body.tags is not None:
        d.tags = list(dict.fromkeys(t.strip() for t in body.tags if t.strip()))
    db.commit()
    return _out(d)


@router.delete("/{doc_id}", status_code=204)
def delete_shared(doc_id: str, db: Session = Depends(get_db)):
    db.delete(_doc(db, doc_id))
    db.commit()
