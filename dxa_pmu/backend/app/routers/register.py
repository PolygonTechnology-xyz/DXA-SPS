import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Project, RegisterRisk
from ..schemas import RegisterIn, RegisterOut, RegisterPatch
from ..services.register import list_register as _list
from .projects import get_project

router = APIRouter(tags=["risk register"])


def _row(db: Session, rid: str) -> RegisterRisk:
    r = db.get(RegisterRisk, rid)
    if not r:
        raise HTTPException(404, "Risk not found.")
    return r


@router.get("/projects/{project_id}/register", response_model=list[RegisterOut], response_model_by_alias=True)
def get_register(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    return _list(db, p)


@router.post("/projects/{project_id}/register", response_model=list[RegisterOut], response_model_by_alias=True, status_code=201)
def add_risk(body: RegisterIn, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    d = body.model_dump()
    d["title"] = d["title"].strip()
    d["owner"] = (d["owner"] or "").strip() or None
    d["source"] = "manual"
    db.add(RegisterRisk(id=str(uuid.uuid4()), project_id=p.id, **d))
    db.commit()
    return _list(db, p)


@router.post("/projects/{project_id}/register/from-analysis", response_model=list[RegisterOut], response_model_by_alias=True)
def add_from_analysis(body: RegisterIn, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    """Adds a risk from the analysis page to the register (skips one with the same title)."""
    title = body.title.strip()
    have = db.scalar(select(RegisterRisk.id).where(RegisterRisk.project_id == p.id, RegisterRisk.title == title))
    if not have:
        d = body.model_dump()
        d["title"], d["owner"], d["source"] = title, (body.owner or "").strip() or None, "analysis"
        db.add(RegisterRisk(id=str(uuid.uuid4()), project_id=p.id, **d))
        db.commit()
    return _list(db, p)


@router.patch("/register/{risk_id}", response_model=list[RegisterOut], response_model_by_alias=True)
def update_risk(risk_id: str, body: RegisterPatch, db: Session = Depends(get_db)):
    r = _row(db, risk_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        if k in ("owner", "due"):
            v = (v or "").strip() or None
        setattr(r, k, v)
    db.commit()
    return _list(db, db.get(Project, r.project_id))


@router.delete("/register/{risk_id}", response_model=list[RegisterOut], response_model_by_alias=True)
def delete_risk(risk_id: str, db: Session = Depends(get_db)):
    r = _row(db, risk_id)
    pid = r.project_id
    if r.source == "manual":
        db.delete(r)
    else:
        r.status = "dismissed"  # the person says it is not a risk; the AI will not raise it again
    db.commit()
    return _list(db, db.get(Project, pid))
