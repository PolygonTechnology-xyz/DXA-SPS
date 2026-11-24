"""Stored conversations with the AI about a draft."""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import ChatMessage


def history(db: Session, kind: str, ref_id: str) -> list[dict[str, str]]:
    rows = db.scalars(select(ChatMessage).where(ChatMessage.kind == kind, ChatMessage.ref_id == ref_id).order_by(ChatMessage.id)).all()
    return [{"role": r.role, "content": r.content} for r in rows]


def add(db: Session, kind: str, ref_id: str, user: str, reply: str) -> None:
    db.add(ChatMessage(kind=kind, ref_id=ref_id, role="user", content=user))
    db.add(ChatMessage(kind=kind, ref_id=ref_id, role="assistant", content=reply))


def clear(db: Session, kind: str, ref_id: str) -> None:
    db.execute(delete(ChatMessage).where(ChatMessage.kind == kind, ChatMessage.ref_id == ref_id))
