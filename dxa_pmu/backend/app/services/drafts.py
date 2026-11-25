"""The setup of a new project, drafted by the AI from a document or a chat. Nothing here writes to the database."""

from __future__ import annotations

import io
import re
from datetime import date

from ..schemas import ProjectDraft
from . import documents

SINGLE = ("name", "goal", "manager", "start", "end", "budget")
TYPES = (".pdf", ".docx", ".txt", ".md")


def read_document(name: str, data: bytes) -> tuple[str, int | None, int | None, bool]:
    """The text to give the AI, with page markers for PDFs.
    Returns (text, pages in the file, pages given to the AI, whether anything was left out)."""
    low = name.lower()
    if not low.endswith(TYPES):
        raise documents.DocProblem("Upload a PDF, Word (.docx) or text file.")
    if not low.endswith(".pdf"):
        text = documents.extract(name, data)  # cuts at MAX_CHARS
        return text, None, None, len(text) >= documents.MAX_CHARS
    try:
        from pypdf import PdfReader
        raw = [(pg.extract_text() or "") for pg in PdfReader(io.BytesIO(data)).pages]
    except Exception as e:
        raise documents.DocProblem("That file could not be read. Check that it opens normally and is not password protected.") from e
    parts: list[str] = []
    used = read = 0
    trimmed = False
    for n, page in enumerate(raw, 1):
        body = re.sub(r"[ \t]+", " ", page).strip()
        if used + len(body) > documents.MAX_CHARS:
            trimmed = True
            break
        # a closing tag inside the document must not end the page block early
        body = re.sub(r"</?(page|document)\b", "(tag)", body, flags=re.I)
        parts.append(f'<page n="{n}">\n{body}\n</page>')
        used += len(body)
        read = n
    if not any(p.strip() for p in raw[:read]):
        raise documents.DocProblem("No text could be found in that file. Scanned images are not supported yet.")
    return "\n".join(parts), len(raw), read, trimmed


def _date(value: str | None, month_ok: bool) -> str | None:
    """A real calendar date as YYYY-MM-DD (or YYYY-MM), else nothing."""
    v = (value or "").strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            date.fromisoformat(v)
            return v
        if month_ok and re.fullmatch(r"\d{4}-\d{2}", v):
            date.fromisoformat(v + "-01")
            return v
    except ValueError:
        pass
    return None


def clean(raw: dict, max_page: int | None) -> ProjectDraft:
    """Tidies what the AI returned: drops empty or impossible values and page numbers that do not exist."""
    def pages(v) -> list[int]:
        return sorted({n for n in v or [] if max_page and 1 <= n <= max_page})

    out: dict = {}
    for key in SINGLE:
        item = raw.get(key) or {}
        value = (item.get("value") or "").strip() or None
        if key in ("start", "end"):
            value = _date(value, month_ok=True)
        elif value:
            value = value[:{"name": 200, "goal": 5000}.get(key, 120)]
        out[key] = {"value": value, "pages": pages(item.get("pages")) if value else []}
    out["phases"] = [p.strip()[:200] for p in raw.get("phases") or [] if p and p.strip()][:40]
    out["milestones"] = [
        {"title": m["title"].strip()[:200], "due": _date(m.get("due"), month_ok=False)}
        for m in raw.get("milestones") or [] if (m.get("title") or "").strip()
    ][:100]
    out["phase_pages"] = pages(raw.get("phase_pages")) if out["phases"] else []
    out["milestone_pages"] = pages(raw.get("milestone_pages")) if out["milestones"] else []
    return ProjectDraft.model_validate(out)


def merge_chat(before: ProjectDraft, after: ProjectDraft) -> ProjectDraft:
    """Keeps what the chat did not change. A value is never lost because the AI left it out of its answer,
    and an unchanged value keeps the pages it was read from. People remove values by editing the draft."""
    out = after.model_copy(deep=True)
    for key in SINGLE:
        old, new = getattr(before, key), getattr(after, key)
        if not new.value or new.value == old.value:
            setattr(out, key, old.model_copy())
        else:
            getattr(out, key).pages = []
    for items, page_list in (("phases", "phase_pages"), ("milestones", "milestone_pages")):
        old, new = getattr(before, items), getattr(after, items)
        if not new or new == old:
            setattr(out, items, old)
            setattr(out, page_list, getattr(before, page_list))
        else:
            setattr(out, page_list, [])
    return out
