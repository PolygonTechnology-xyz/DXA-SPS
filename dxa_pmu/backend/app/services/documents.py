"""Project documents: text is pulled out of uploaded PDF, Word and text files so the AI can read it."""

from __future__ import annotations

import io
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Project, ProjectDoc

MAX_BYTES = 10 * 1024 * 1024
MAX_CHARS = 200_000          # kept per document
AI_BUDGET = 30_000           # characters of documents given to the AI in one call
TYPES = (".pdf", ".docx", ".txt", ".md", ".csv")


class DocProblem(Exception):
    pass


def extract(name: str, data: bytes) -> str:
    n = name.lower()
    try:
        if n.endswith(".pdf"):
            from pypdf import PdfReader
            text = "\n".join((pg.extract_text() or "") for pg in PdfReader(io.BytesIO(data)).pages)
        elif n.endswith(".docx"):
            from docx import Document
            d = Document(io.BytesIO(data))
            parts = [p.text for p in d.paragraphs]
            for t in d.tables:
                parts += [" | ".join(c.text.strip() for c in r.cells) for r in t.rows]
            text = "\n".join(parts)
        elif n.endswith(TYPES):
            text = data.decode("utf-8", "replace")
        else:
            raise DocProblem("Upload a PDF, Word (.docx), text, Markdown or CSV file.")
    except DocProblem:
        raise
    except Exception as e:
        raise DocProblem("That file could not be read. Check that it opens normally and is not password protected.") from e
    text = re.sub(r"[ \t]+", " ", text).strip()
    if not text:
        raise DocProblem("No text could be found in that file. Scanned images are not supported yet.")
    return text[:MAX_CHARS]


def sync_names(db: Session, project: Project) -> None:
    """Project.files lists the names, which reports and schedules already use."""
    project.files = [n for (n,) in db.execute(select(ProjectDoc.name).where(ProjectDoc.project_id == project.id).order_by(ProjectDoc.uploaded_at))]


def for_ai(db: Session, project_id: str) -> list[dict[str, str]]:
    """The documents' text, shared fairly between files and trimmed to a budget."""
    rows = db.scalars(select(ProjectDoc).where(ProjectDoc.project_id == project_id).order_by(ProjectDoc.uploaded_at)).all()
    if not rows:
        return []
    each = max(2000, AI_BUDGET // len(rows))
    return [{"file": r.name, "text": r.text[:each] + (" [trimmed]" if len(r.text) > each else "")} for r in rows]
