"""Word formats for meeting minutes and reports. A project uploads any .docx as an example of its format and
the AI writes new documents in that format. A project can keep several; one is the default and a meeting or report can pick another.
Without an upload the built-in format below is used (filled with docxtpl). Previews are HTML made with mammoth."""

from __future__ import annotations

import hashlib
import io
import json
from typing import Any

import mammoth
from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.shared import Pt
from docxtpl import DocxTemplate
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import DocFormat, Meeting, Project, Report
from . import style as docstyle

KINDS = ("minutes", "report")


class TemplateProblem(Exception):
    pass


# ---- built-in formats (also offered as the downloadable sample) --------------------------------------

def _row_table(doc, header: list[str], cells: list[str], loop: str):
    """A table whose body row repeats for `loop` (docxtpl row tags)."""
    t = doc.add_table(rows=4, cols=len(header))
    t.style = "Light Grid Accent 1"
    for i, h in enumerate(header):
        t.cell(0, i).text = h
    t.cell(1, 0).text = "{%tr for " + loop + " %}"
    for i, c in enumerate(cells):
        t.cell(2, i).text = c
    t.cell(3, 0).text = "{%tr endfor %}"
    return t


def default_template(kind: str) -> bytes:
    d = Document()
    d.styles["Normal"].font.size = Pt(10.5)
    if kind == "minutes":
        d.add_heading("Meeting minutes", 0)
        d.add_paragraph("{{ project }}")
        info = d.add_table(rows=3, cols=2)
        info.style = "Light List Accent 1"
        for i, (k, v) in enumerate([("Meeting", "{{ title }}"), ("Date", "{{ date }}"), ("Status", "{{ status }}")]):
            info.cell(i, 0).text, info.cell(i, 1).text = k, v
        d.add_heading("Summary", 1)
        d.add_paragraph("{{ summary }}")
        d.add_heading("Decisions", 1)
        d.add_paragraph("{%p for d in decisions %}")
        d.add_paragraph("{{ loop.index }}. {{ d }}")
        d.add_paragraph("{%p endfor %}")
        d.add_heading("Actions", 1)
        _row_table(d, ["Action", "Owner"], ["{{ a.what }}", "{{ a.owner }}"], "a in actions")
        d.add_heading("Risks", 1)
        _row_table(d, ["Risk", "If not done", "Impact", "Severity", "Owner"],
                   ["{{ r.title }}", "{{ r.if_not_done }}", "{{ r.impact }}", "{{ r.severity }}", "{{ r.owner }}"], "r in risks")
        d.add_paragraph("")
        d.add_paragraph("Generated {{ generated }}")
    else:
        d.add_heading("Project report", 0)
        d.add_paragraph("{{ project }}  ·  {{ jira_key }}")
        d.add_paragraph("Period: {{ period }}  ·  Generated {{ generated }}  ·  Status: {{ status }}")
        d.add_heading("Summary", 1)
        d.add_paragraph("{{ summary }}")
        d.add_heading("Project health", 1)
        d.add_paragraph("DXA score: {{ score }} / 100  ·  {{ band }}")
        _row_table(d, ["Factor", "Detail", "Points lost"], ["{{ f.label }}", "{{ f.note }}", "{{ f.points }}"], "f in factors")
        d.add_heading("Programme phases", 1)
        _row_table(d, ["Phase", "Progress", "Status", "Tasks done", "Due"],
                   ["{{ p.name }}", "{{ p.pct }}%", "{{ p.status }}", "{{ p.tasks }}", "{{ p.due }}"], "p in phases")
        d.add_heading("Risks needing PM intervention", 1)
        _row_table(d, ["Risk", "Severity", "Owner", "Status", "Why flagged"],
                   ["{{ x.title }}", "{{ x.severity }}", "{{ x.owner }}", "{{ x.status }}", "{{ x.why }}"], "x in flagged")
        d.add_heading("Recent decisions", 1)
        _row_table(d, ["Decision", "Meeting", "Date", "Status"], ["{{ x.text }}", "{{ x.meeting }}", "{{ x.date }}", "{{ x.status }}"], "x in decisions")
        d.add_heading("Risk register", 1)
        _row_table(d, ["Severity", "Risk (if not done, then...)", "Owner", "Status", "Action"],
                   ["{{ r.severity }}", "{{ r.title }}. {{ r.description }}", "{{ r.owner }}", "{{ r.status }}", "{{ r.mitigation }}"], "r in risks")
        d.add_heading("Findings", 1)
        d.add_paragraph("{%p for f in findings %}")
        d.add_paragraph("• {{ f }}")
        d.add_paragraph("{%p endfor %}")
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


# ---- data given to a format ---------------------------------------------------------------------------

def minutes_context(m: Meeting, project: Project | None) -> dict[str, Any]:
    from datetime import date
    mn = m.minutes or {}
    return {
        "project": project.name if project else "", "title": m.title, "date": m.held_on,
        "status": "Approved" if m.approved_at else "Draft - not approved",
        "summary": mn.get("summary", ""), "decisions": mn.get("decisions", []),
        "risks": [{"title": r.get("title", ""), "if_not_done": r.get("if_not_done", ""), "impact": r.get("impact", ""),
                   "severity": (r.get("severity") or "").title(), "owner": r.get("owner") or "-"} for r in mn.get("risks", [])],
        "actions": [{"what": a.get("what", ""), "owner": a.get("owner") or "-"} for a in mn.get("actions", [])],
        "transcript": m.notes, "generated": date.today().strftime("%d %b %Y"),
    }


def report_context(r: Report) -> dict[str, Any]:
    c = dict(r.context or {})
    c["status"] = "Approved" if r.status == "final" else "Draft - not approved"
    return c


SAMPLE = {
    "minutes": {"project": "Payments Platform", "title": "Steering Committee", "date": "2026-01-15", "status": "Approved",
                "summary": "The committee reviewed provider onboarding and agreed the pilot timeline.",
                "decisions": ["The wave 2 checklist deadline moves to 30 January.", "A provider support desk will run for one month."],
                "risks": [{"title": "Outstanding providers miss the deadline", "if_not_done": "the remaining API integrations are not finished", "impact": "wave 2 certification slips by two weeks", "severity": "High", "owner": "Nasrin"}],
                "actions": [{"what": "Set up the provider support desk", "owner": "Imran"}, {"what": "Send the budget request", "owner": "Nasrin"}],
                "transcript": "", "generated": "15 Jan 2026"},
    "report": {"project": "Payments Platform", "jira_key": "PAY", "period": "Snapshot, 15 Jan 2026", "generated": "15 Jan 2026", "status": "Approved",
               "summary": "11 of 29 tasks are complete (38%). Three tasks are overdue and need attention.", "headline": "11 of 29 tasks complete.", "score": 62, "band": "Watch",
               "factors": [{"label": "Overdue work", "note": "3 of 18 open items are past due", "points": "-13"}, {"label": "High risks", "note": "2 high-severity risks", "points": "-20"}],
               "phases": [{"name": "Provider onboarding", "pct": 60, "status": "In progress", "tasks": "6 of 10", "due": "2026-02-28"}, {"name": "Pilot rollout", "pct": 0, "status": "Not started", "tasks": "0 of 5", "due": "2026-04-30"}],
               "decisions": [{"text": "Pilot waits for wave 1 certification.", "meeting": "Steering Committee", "date": "2026-01-15", "status": "Approved"}],
               "flagged": [{"title": "Timeout fix not deployed", "severity": "High", "owner": "Rahim", "status": "Open", "why": "High severity; linked task overdue"}],
               "risks": [{"severity": "High", "title": "Timeout fix not deployed", "description": "If the fix is not deployed, certification cannot start.", "mitigation": "Deploy by Wednesday.", "owner": "Rahim", "status": "Open", "source": "Steering Committee"}],
               "findings": ["Three tasks are overdue, mostly in provider onboarding.", "Eighteen open tasks have no owner."],
               "recommendations": ["Assign owners to the open tasks this week."], "metrics": {}, "overdue": []},
}


# ---- storage, rendering, preview ---------------------------------------------------------------------

def builtin_template(kind: str) -> bytes:
    return default_template(kind)


def resolve_format(db: Session, project_id: str, kind: str, format_id: str | None = None) -> tuple[bytes, str | None, bool]:
    """(file, name, is_builtin) for a document: the format it picked, else the project's default, else the built-in one."""
    row = None
    if format_id and format_id != "builtin":
        row = db.get(DocFormat, format_id)
        if row and (row.project_id != project_id or row.kind != kind):
            row = None
    if row is None and format_id != "builtin":
        row = db.scalars(select(DocFormat).where(DocFormat.project_id == project_id, DocFormat.kind == kind, DocFormat.is_default.is_(True))).first()
    return (row.data, row.name, False) if row else (default_template(kind), None, True)


def _outline(doc) -> tuple[str, list[str]]:
    """The example's structure as text for the AI: each paragraph/table with its style name."""
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    lines: list[str] = []
    for el in doc.element.body.iterchildren():
        if el.tag.endswith("}p"):
            p = Paragraph(el, doc)
            if p.text.strip():
                lines.append(f"[{p.style.name}] {p.text.strip()[:300]}")
        elif el.tag.endswith("}tbl"):
            t = Table(el, doc)
            lines.append(f"[TABLE style={t.style.name if t.style else ''} cols={len(t.columns)} rows={len(t.rows)}]")
            for r in t.rows[:4]:
                lines.append("  | " + " | ".join(c.text.strip()[:80] for c in r.cells))
    styles = sorted({s.name for s in doc.styles if s.type in (WD_STYLE_TYPE.PARAGRAPH, WD_STYLE_TYPE.TABLE)})
    return "\n".join(lines), styles


_cache: dict[str, bytes] = {}


def _ai_render(template: bytes, ctx: dict[str, Any]) -> bytes:
    """The upload is an example, not a template: the agent works out its format and writes the new document in it."""
    key = hashlib.sha256(template + json.dumps(ctx, sort_keys=True, default=str).encode()).hexdigest()
    if key in _cache:
        return _cache[key]
    try:
        doc = Document(io.BytesIO(template))
    except Exception as e:
        raise TemplateProblem("That file could not be opened as a Word document.") from e
    outline, styles = _outline(doc)
    kind = "meeting minutes" if "actions" in ctx else "project status report"
    from . import ai
    try:
        layout = ai.layout_document(kind, outline, styles, json.dumps(ctx, ensure_ascii=False, default=str))
    except ai.AIError as e:
        raise TemplateProblem(f"The AI could not follow your example format right now: {e.message}") from e
    except Exception as e:
        raise TemplateProblem("The AI could not follow your example format right now. Please try again.") from e
    body = doc.element.body
    for el in list(body.iterchildren()):
        if not el.tag.endswith("}sectPr"):
            body.remove(el)  # keeps the example's page setup, header, footer, fonts and styles
    have = {s.name for s in doc.styles}
    def style(name: str, fallback: str | None) -> str | None:
        return name if name in have else fallback if fallback in have else None
    for b in layout.blocks:
        if b.type == "table":
            rows = [r for r in b.rows if r]
            if not rows:
                continue
            n = max(len(r) for r in rows)
            t = doc.add_table(rows=len(rows), cols=n)
            st = style(b.style, "Table Grid")
            if st:
                t.style = st
            for i, r in enumerate(rows):
                for j in range(n):
                    t.cell(i, j).text = r[j] if j < len(r) else ""
            doc.add_paragraph()
        elif b.type == "heading":
            doc.add_paragraph(b.text, style=style(b.style, "Heading 1"))
        elif b.type == "bullet":
            st = style(b.style, "List Bullet")
            doc.add_paragraph(b.text if st else f"\u2022 {b.text}", style=st)
        else:
            doc.add_paragraph(b.text, style=style(b.style, None))
    out = io.BytesIO()
    doc.save(out)
    if len(_cache) > 50:
        _cache.clear()
    _cache[key] = out.getvalue()
    return _cache[key]


def _shade(cell, hex_: str) -> None:
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    tcPr = cell._tc.get_or_add_tcPr()
    for old in tcPr.findall(qn("w:shd")):
        tcPr.remove(old)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), hex_.lstrip("#"))
    tcPr.append(shd)


_FONT = {"sans": "Calibri", "serif": "Georgia", "mono": "Consolas"}


def apply_style(docx: bytes, st: docstyle.DocStyle) -> bytes:
    """Colours, font and sizes chosen for this document, applied over the finished Word file."""
    from docx.shared import RGBColor
    d = Document(io.BytesIO(docx))
    rgb = lambda h: RGBColor.from_string(h.lstrip("#").upper())
    font = _FONT[st.font]
    def setfont(f, size=None):
        f.name = font
        if size:
            f.size = Pt(size)
    for sty in d.styles:
        if sty.type != WD_STYLE_TYPE.PARAGRAPH:
            continue
        n = sty.name or ""
        if n == "Normal" or n.startswith("List") or n == "Body Text":
            setfont(sty.font, st.body_size)
        elif n == "Title" or n.startswith("Heading"):
            setfont(sty.font)
            sty.font.color.rgb = rgb(st.heading_color)
    for p in d.paragraphs:
        n = p.style.name if p.style is not None else ""
        for r in p.runs:
            r.font.name = font
            if n == "Title" or n.startswith("Heading"):
                r.font.color.rgb = rgb(st.heading_color)
        if n == "Title" and st.banner:
            from docx.oxml import OxmlElement
            from docx.oxml.ns import qn
            pPr = p._p.get_or_add_pPr()
            shd = OxmlElement("w:shd")
            shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), st.accent.lstrip("#"))
            pPr.append(shd)
            for r in p.runs:
                r.font.color.rgb = RGBColor(255, 255, 255)
    for t in d.tables:
        if len(t.rows) < 2:
            continue
        for c in t.rows[0].cells:
            _shade(c, st.accent)
            for p in c.paragraphs:
                for r in p.runs:
                    r.font.bold, r.font.color.rgb, r.font.name = True, RGBColor(255, 255, 255), font
        for i, row in enumerate(t.rows[1:], 1):
            for c in row.cells:
                _shade(c, "EEF2F2" if st.zebra and i % 2 == 0 else "FFFFFF")
                for p in c.paragraphs:
                    for r in p.runs:
                        r.font.name = font
    out = io.BytesIO()
    d.save(out)
    return out.getvalue()


def effective_style(stored: dict | None, builtin: bool) -> docstyle.DocStyle | None:
    """The design to apply: the built-in format always gets one; an uploaded example keeps its own look unless the chat changed it."""
    if stored:
        return docstyle.resolve(stored)
    return docstyle.DEFAULT if builtin else None


def render(template: bytes, ctx: dict[str, Any], builtin: bool, style: docstyle.DocStyle | None = None) -> bytes:
    """The built-in format is filled directly; any uploaded format is an example the AI follows."""
    out = _fill_builtin(template, ctx) if builtin else _ai_render(template, ctx)
    return apply_style(out, style) if style else out


def _fill_builtin(template: bytes, ctx: dict[str, Any]) -> bytes:
    try:
        t = DocxTemplate(io.BytesIO(template))
        t.render(ctx, autoescape=True)
        out = io.BytesIO()
        t.save(out)
        return out.getvalue()
    except Exception as e:
        raise TemplateProblem("The built-in format could not be filled.") from e


def validate(data: bytes) -> None:
    """An upload only has to be a readable Word document; the AI works out its layout when it is used."""
    try:
        Document(io.BytesIO(data))
    except Exception as e:
        raise TemplateProblem("That file could not be opened as a Word document.") from e


def preview_html(docx: bytes, st: docstyle.DocStyle | None = None) -> str:
    body = mammoth.convert_to_html(io.BytesIO(docx)).value
    fam = {"sans": "system-ui,'Noto Sans Bengali',sans-serif", "serif": "Georgia,'Noto Sans Bengali',serif", "mono": "Consolas,monospace"}[st.font if st else "sans"]
    size = (st.body_size + 4) if st else 14
    design = ""
    if st:
        design = (f"h1,h2,h3{{color:{st.heading_color}}}th{{background:{st.accent}!important;color:#fff}}"
                  + ("tr:nth-child(even) td{background:#eef2f2}" if st.zebra else "")
                  + (f"h1:first-of-type{{background:{st.accent};color:#fff;padding:12px 14px;border-radius:6px}}" if st.banner else ""))
    return (f"<!doctype html><meta charset=utf-8><style>body{{font:{size}px/1.55 {fam};color:#16201f;max-width:760px;margin:24px auto;padding:0 20px}}"
            "table{border-collapse:collapse;width:100%;margin:10px 0}td,th{border:1px solid #d5dbd9;padding:6px 9px;text-align:left;vertical-align:top}"
            "th{background:#eef2f2}h1,h2,h3{letter-spacing:-.01em}" + design + "</style>" + body)
