"""PDF reports. AI-written content (summary, risk assessment) is included only after a person approved it;
until then the rule-based figures and findings are used, so scheduled reports are always created and never
carry unreviewed AI text."""

from __future__ import annotations

import io
import logging
import re
import uuid
from datetime import date, datetime, timezone
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.graphics.charts.barcharts import HorizontalBarChart, VerticalBarChart
from reportlab.graphics.charts.legends import Legend
from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics.shapes import Drawing, String
from reportlab.platypus import Flowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from contextvars import ContextVar
from sqlalchemy.orm import Session

from ..models import Project, Report
from . import style as docstyle
from . import ai, approvals
from .analysis import Analysis, action_status, analyse, is_high
from .register import active as active_risks, flagged as flagged_risks
from .programme import decisions as programme_decisions, health_score, phases as programme_phases

log = logging.getLogger(__name__)
_STY: ContextVar[docstyle.DocStyle] = ContextVar("doc_style", default=docstyle.DEFAULT)
FONTS = {"sans": ("Helvetica", "Helvetica-Bold"), "serif": ("Times-Roman", "Times-Bold"), "mono": ("Courier", "Courier-Bold")}


def _accent() -> colors.Color:
    return colors.HexColor(_STY.get().accent)


# Bengali needs a font that has the glyphs, and shaping (uharfbuzz) so conjuncts and vowel signs render correctly.
BN = "NotoBn"
_BN_RUN = re.compile(r"[\u0980-\u09FF\u0964\u0965](?:[\u0980-\u09FF\u0964\u0965\s.,;:!?()\u200c\u200d-]*[\u0980-\u09FF\u0964\u0965])?")
_fonts_ready = False


def _register_fonts() -> bool:
    global _fonts_ready
    if not _fonts_ready:
        f = Path(__file__).resolve().parent.parent / "fonts" / "NotoSansBengali-Regular.ttf"
        try:
            pdfmetrics.registerFont(TTFont(BN, str(f)))
            _fonts_ready = True
        except Exception:  # missing font or shaper: Bengali falls back to the default font
            log.warning("Bengali font could not be loaded; Bengali text may not render in PDFs.", exc_info=True)
            return False
    return True


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    text = text or ""
    if _BN_RUN.search(text) and _register_fonts():
        marked = _BN_RUN.sub(lambda m: f"\x00{m.group(0)}\x01", text)
        html = escape(marked).replace("\x00", f'<font name="{BN}">').replace("\x01", "</font>")
        return Paragraph(html, ParagraphStyle("bn", parent=style, shaping=1))
    return Paragraph(escape(text), style)


def _table(rows: list[list], widths: list[float], styles: ParagraphStyle) -> Table:
    data = [[c if isinstance(c, (Paragraph, Flowable)) else _p(str(c), styles) for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), _accent()),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#eef2f2") if _STY.get().zebra else colors.white]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e4e4df")),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


GREY, GREEN, AMBER, RED = (colors.HexColor(c) for c in ("#94a3b8", "#16a34a", "#f59e0b", "#dc2626"))


def _legend(d: Drawing, x: float, y: float, pairs: list[tuple[str, colors.Color]]) -> None:
    lg = Legend()
    lg.x, lg.y, lg.fontName, lg.fontSize = x, y, "Helvetica", 8
    lg.alignment, lg.dx, lg.dy, lg.deltay, lg.columnMaximum = "right", 7, 7, 11, 8
    lg.colorNamePairs = [(c, n) for n, c in pairs]
    d.add(lg)


def pie_chart(title: str, parts: list[tuple[str, float, colors.Color]], w: float, h: float = 120) -> Drawing | None:
    parts = [p for p in parts if p[1] > 0]
    if not parts:
        return None
    d = Drawing(w, h)
    d.add(String(0, h - 9, title, fontName="Helvetica-Bold", fontSize=9))
    pie = Pie()
    pie.x, pie.y, pie.width, pie.height = 4, 4, h - 28, h - 28
    pie.data = [p[1] for p in parts]
    pie.labels = None
    pie.sideLabels = False
    pie.slices.strokeColor, pie.slices.strokeWidth = colors.white, 1
    for i, (_, _, c) in enumerate(parts):
        pie.slices[i].fillColor = c
    d.add(pie)
    _legend(d, h - 14, h - 40, [(f"{n} ({int(v)})", c) for n, v, c in parts])
    return d


def bar_chart(title: str, parts: list[tuple[str, float, colors.Color]], w: float, h: float = 120) -> Drawing | None:
    if not any(p[1] for p in parts):
        return None
    d = Drawing(w, h)
    d.add(String(0, h - 9, title, fontName="Helvetica-Bold", fontSize=9))
    ch = VerticalBarChart()
    ch.x, ch.y, ch.width, ch.height = 22, 22, w - 34, h - 48
    ch.data = [[p[1] for p in parts]]
    ch.categoryAxis.categoryNames = [p[0] for p in parts]
    ch.categoryAxis.labels.fontSize = 8
    top = max(p[1] for p in parts)
    ch.valueAxis.valueMin, ch.valueAxis.valueMax = 0, top + max(1, round(top * 0.15))
    ch.valueAxis.valueStep = max(1, round(top / 4))
    ch.valueAxis.labels.fontSize = 8
    ch.valueAxis.visibleGrid, ch.valueAxis.gridStrokeColor = True, colors.HexColor("#e4e4df")
    ch.bars.strokeColor = None
    ch.barLabelFormat, ch.barLabels.nudge, ch.barLabels.fontSize = "%d", 7, 8
    ch.barWidth = 26
    for i, (_, _, c) in enumerate(parts):
        ch.bars[(0, i)].fillColor = c
    d.add(ch)
    return d


def owner_chart(load: dict[str, dict[str, int]], w: float, max_owners: int = 12) -> Drawing | None:
    """Stacked horizontal bars: each owner's tasks split into To do / In progress / Done."""
    rows = sorted(((n, r) for n, r in load.items() if n != "Unassigned"), key=lambda x: (-x[1]["open"], x[0]))[:max_owners]
    if not rows:
        return None
    rows = rows[::-1]  # the busiest owner is drawn at the top
    h = 78 + 20 * len(rows)
    d = Drawing(w, h)
    d.add(String(0, h - 9, "Workload by owner", fontName="Helvetica-Bold", fontSize=9))
    ch = HorizontalBarChart()
    ch.x, ch.y, ch.width, ch.height = 110, 24, w - 126, h - 72
    ch.data = [
        [r["open"] - r["inProgress"] for _, r in rows],
        [r["inProgress"] for _, r in rows],
        [r["done"] for _, r in rows],
    ]
    ch.categoryAxis.categoryNames = [(n if len(n) <= 22 else n[:21] + "…") for n, _ in rows]
    ch.categoryAxis.labels.fontSize = 8
    ch.categoryAxis.labels.boxAnchor = "e"
    top = max(sum(col[i] for col in ch.data) for i in range(len(rows)))
    ch.valueAxis.valueMin, ch.valueAxis.valueMax, ch.valueAxis.valueStep = 0, top + 1, max(1, round(top / 5))
    ch.valueAxis.labels.fontSize = 8
    ch.valueAxis.visibleGrid, ch.valueAxis.gridStrokeColor = True, colors.HexColor("#e4e4df")
    ch.categoryAxis.style = "stacked"
    ch.groupSpacing, ch.barWidth = 6, 14
    ch.bars.strokeColor = colors.white
    ch.bars.strokeWidth = 0.5
    for i, c in enumerate((GREY, _accent(), GREEN)):
        ch.bars[i].fillColor = c
    d.add(ch)
    _legend(d, w - 90, h - 8, [("To do", GREY), ("In progress", _accent()), ("Done", GREEN)])
    return d


def _bar(pct: int, w: float) -> Drawing:
    d = Drawing(w, 9)
    from reportlab.graphics.shapes import Rect
    d.add(Rect(0, 1, w, 7, fillColor=colors.HexColor("#e9ecec"), strokeColor=None, rx=3.5, ry=3.5))
    if pct:
        d.add(Rect(0, 1, max(w * pct / 100, 7), 7, fillColor=GREEN if pct >= 100 else colors.HexColor("#2b9bd6"), strokeColor=None, rx=3.5, ry=3.5))
    return d


def _programme_sections(programme: dict | None, h2, body, sub, tbl, w) -> list:
    """Health score, phases and decisions: the same figures as the dashboard."""
    if not programme:
        return []
    out: list = []
    sc = programme["score"]
    out += [_p("Project health", h2)]
    if sc.score is None:
        out.append(_p("No tasks yet, so no health score.", body))
    else:
        out += [_p(f"DXA score: {sc.score} / 100  ·  {sc.band}", body),
                _p("Critical below 40  ·  At risk 40-69  ·  On track 70+", sub),
                tbl(["Factor", "Detail", "Points lost"], [[f.label, f.note, f"-{f.points}" if f.points else "0"] for f in sc.factors],
                    [w * 0.25, w * 0.55, w * 0.2])]
    ph = programme["phases"]
    out.append(_p(f"Programme phases ({len(ph)})", h2))
    if not ph:
        out.append(_p("No phases found. Group work under epics or Jira versions to track phase progress.", sub))
    else:
        def state(p): return "Done" if p.pct >= 100 else "In progress" if p.pct else "Not started"
        rows = [[p.name, _bar(p.pct, w * 0.22), f"{p.pct}%", state(p), f"{p.done} of {p.total}" if p.total else "-", p.due or "-"] for p in ph]
        out.append(tbl(["Phase", "Progress", "%", "Status", "Tasks done", "Due"], rows, [w * 0.27, w * 0.24, w * 0.10, w * 0.13, w * 0.13, w * 0.13]))
    fl = programme.get("flagged") or []
    out.append(_p("Risks needing PM intervention", h2))
    if not fl:
        out.append(_p("No register risks currently need intervention.", sub))
    else:
        out.append(tbl(["Risk", "Severity", "Owner", "Status", "Why flagged"],
                       [[f.title, f.severity.title(), f.owner or "Unassigned", f.status.title(), "; ".join(f.reasons)] for f in fl],
                       [w * 0.26, w * 0.10, w * 0.14, w * 0.12, w * 0.38]))
    dec = programme["decisions"]
    out.append(_p("Recent decisions", h2))
    if not dec:
        out.append(_p("No decisions recorded yet. They come from meeting minutes drafted from transcripts.", sub))
    else:
        out.append(tbl(["Decision", "Meeting", "Date", "Status"], [[d.text, d.meeting, d.held_on, d.status] for d in dec],
                       [w * 0.5, w * 0.22, w * 0.13, w * 0.15]))
        if any(d.status != "Approved" for d in dec):
            out.append(_p("Decisions marked Under review come from minutes that have not been approved yet.", sub))
    return out


def build_pdf(project: Project, period_label: str, a: Analysis, ai_text: ai.TaskAnalysis | None, risks: dict | None = None,
              approved_at: dict[str, datetime] | None = None, programme: dict | None = None, draft: bool = False, style: dict | None = None) -> bytes:
    st = docstyle.resolve(style)
    tok = _STY.set(st)
    try:
        return _build_pdf(project, period_label, a, ai_text, risks, approved_at, programme, draft, st)
    finally:
        _STY.reset(tok)


def _build_pdf(project, period_label, a, ai_text, risks, approved_at, programme, draft, st) -> bytes:
    regular, bold = FONTS[st.font]
    ss = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=ss["BodyText"], fontName=regular, fontSize=st.body_size, leading=st.body_size * 1.4)
    cell = ParagraphStyle("cell", parent=body, fontSize=st.body_size - 1.5, leading=(st.body_size - 1.5) * 1.3)
    head = ParagraphStyle("head", parent=cell, textColor=colors.white, fontName=bold)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontName=bold, textColor=colors.HexColor(st.heading_color), fontSize=st.body_size + 3, spaceBefore=12, spaceAfter=6)
    title = ParagraphStyle("title", parent=ss["Title"], fontName=bold, alignment=0, fontSize=22, spaceAfter=2,
                           textColor=colors.white if st.banner else colors.HexColor(st.heading_color))
    sub = ParagraphStyle("sub", parent=body, textColor=colors.HexColor("#6b6b66"), fontSize=9)

    def tbl(header: list[str], rows: list[list[str]], widths: list[float]) -> Table:
        return _table([[Paragraph(escape(h), head) for h in header]] + rows, widths, cell)

    today = date.today()
    w = A4[0] - 40 * mm
    def _banner(par, width):
        t = Table([[par]], colWidths=[width])
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), _accent()), ("LEFTPADDING", (0, 0), (-1, -1), 12), ("TOPPADDING", (0, 0), (-1, -1), 12), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
        return t
    s: list = [
        _banner(_p("Project report", title), w) if st.banner else _p("Project report", title),
        _p(f"{project.name}" + (f"  ·  {project.jira_key}" if project.jira_key else ""), body),
        _p(f"Reporting period: {period_label}  ·  Generated {today:%d %B %Y}"
           + (f"  ·  Jira synced {project.synced_at:%d %b %Y %H:%M} UTC" if project.synced_at else ""), sub),
        *([_p("DRAFT - pending approval. Not the final version.", ParagraphStyle("draftnote", parent=body, textColor=colors.HexColor("#b45309"), fontName="Helvetica-Bold"))] if draft else []),
        Spacer(1, 8), _p("Summary", h2),
        _p(ai_text.summary if ai_text else a.headline, body),
    ]
    if ai_text:
        s.append(_p(f"Overall risk: {ai_text.risk_level}. {a.headline}", body))
    if project.goal:
        s.append(_p(f"Goal: {project.goal}", body))

    if project.jira_key:
        m = a.metrics()
        s += [Spacer(1, 6), tbl(["Measure", "Value"], [
            ["Total tasks", str(m["total"])],
            ["Open actions", f'{m["open"]} ({m["overdue"]} overdue, {m["dueSoon"]} due within 7 days)'],
            ["Active risks (register)", f'{len((programme or {}).get("register") or [])} ({sum(1 for r in (programme or {}).get("register") or [] if r.severity == "high")} high severity)'],
            ["To do / In progress / Done", f'{m["todo"]} / {m["inProgress"]} / {m["done"]}'],
            ["Completion", f'{m["percentComplete"]}%'],
            ["Unassigned open tasks", str(m["unassigned"])],
        ], [w * 0.4, w * 0.6])]

        s += _programme_sections(programme, h2, body, sub, tbl, w)

        s.append(_p("Analysis and recommendations", h2))
        for line in (ai_text.findings if ai_text else a.findings):
            s.append(_p(f"•  {line}", body))
        if ai_text and ai_text.recommendations:
            s.append(Spacer(1, 4))
            for i, line in enumerate(ai_text.recommendations, 1):
                s.append(_p(f"{i}.  {line}", body))

        m_ = a.metrics()
        on_track = m_["open"] - m_["overdue"] - m_["dueSoon"] - m_["noDueDate"]
        half = w / 2 - 6
        left = pie_chart("Tasks by status", [("To do", m_["todo"], GREY), ("In progress", m_["inProgress"], _accent()), ("Done", m_["done"], GREEN)], half)
        right = bar_chart("Open tasks by schedule", [("Overdue", m_["overdue"], RED), ("Due soon", m_["dueSoon"], AMBER),
                                                      ("On track", on_track, GREEN), ("No date", m_["noDueDate"], GREY)], half)
        if left or right:
            s += [_p("Charts", h2), Table([[left or "", right or ""]], colWidths=[w / 2, w / 2], style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))]
        owners = owner_chart(a.load, w)
        if owners:
            s += [Spacer(1, 6), owners]
        reg = (programme or {}).get("register") or []
        s.append(_p("Risk register", h2))
        if not reg:
            s.append(_p("No active risks in the register. Risks come from meeting minutes, the AI risk analysis, or are added by hand.", sub))
        else:
            s.append(_p("Each risk says what happens if something is not done. Risks from meetings are added when the minutes are approved.", sub))
            s.append(tbl(["Severity", "Risk: if not done, then...", "Owner", "Status", "Action"],
                         [[r.severity.title(), f"{r.title}. {r.description}".strip(), r.owner or "Unassigned", r.status.title(), r.mitigation or "-"] for r in reg],
                         [w * 0.11, w * 0.40, w * 0.14, w * 0.12, w * 0.23]))
        attention = a.overdue + a.due_soon
        if attention:
            s += [_p("Overdue and due soon", h2), tbl(["Key", "Action", "Owner", "Due", "Status"],
                  [[t["key"], t["summary"], t.get("assignee") or "Unassigned", t["due"], action_status(t, today)] for t in attention],
                  [w * 0.12, w * 0.4, w * 0.2, w * 0.15, w * 0.13])]
        s += [_p("All tasks", h2), tbl(["Key", "Task", "Type", "Status", "Owner", "Priority", "Due"],
              [[t["key"], t["summary"], t["type"], t["status"], t.get("assignee") or "Unassigned", t.get("priority") or "—", t.get("due") or "—"] for t in a.tasks],
              [w * 0.1, w * 0.27, w * 0.09, w * 0.12, w * 0.16, w * 0.11, w * 0.15])]

    approved_at = approved_at or {}
    ai_notes = [f"{what} approved on {approved_at[k]:%d %b %Y %H:%M} UTC" for k, what in (("summary", "Summary and recommendations"), ("risks", "Risk assessment")) if k in approved_at]
    s += [_p("Sources", h2),
          _p("Jira: " + (f"{project.jira_key} ({project.jira_name}), {len(a.tasks)} tasks" if project.jira_key else "not connected"), body),
          _p("Documents: " + (", ".join(project.files) if project.files else "none uploaded"), body),
          _p("AI content: " + ("; ".join(ai_notes) + "." if ai_notes else "none. Every figure and finding in this report comes from Jira data and fixed rules."), body)]

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont(regular, 8)
        canvas.setFillColor(colors.HexColor("#828282"))
        canvas.drawString(20 * mm, 12 * mm, f"DXA PMU  ·  {project.name}" + ("  ·  DRAFT, pending approval" if draft else "  ·  Approved report"))
        canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, f"Page {doc.page}")
        canvas.restoreState()

    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=20 * mm,
                      title=f"Project report - {project.name}").build(s, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


def gather(db: Session, project: Project, period_label: str):
    """Analyse the project's current data: (analysis, ai_text, risks, approved_at, programme, context)."""
    a = analyse(project.tasks)
    ai_text, risks, approved_at = None, None, {}
    if project.jira_key and a.tasks:
        summary = approvals.get(db, project.id, approvals.SUMMARY)
        if summary:
            ai_text = ai.TaskAnalysis(**summary.data)
            approved_at["summary"] = summary.approved_at
        ar = approvals.get(db, project.id, approvals.RISKS)
        if ar:
            risks, approved_at["risks"] = ar.data, ar.approved_at
    reg = active_risks(db, project)
    programme = {"score": health_score(project.tasks or [], high_risks=sum(1 for r in reg if r.severity == "high")),
                 "phases": programme_phases(project), "decisions": programme_decisions(db, project.id),
                 "flagged": flagged_risks(db, project), "register": reg}
    sc = programme["score"]
    def _state(p): return "Done" if p.pct >= 100 else "In progress" if p.pct else "Not started"
    risk_rows = [{"severity": r.severity.title(), "title": r.title, "description": r.description, "mitigation": r.mitigation,
                  "owner": r.owner or "Unassigned", "status": r.status.title(), "source": r.source_ref or r.source.title()} for r in reg]
    context = {
        "project": project.name, "jira_key": project.jira_key or "", "period": period_label, "generated": date.today().strftime("%d %b %Y"),
        "summary": ai_text.summary if ai_text else a.headline, "headline": a.headline,
        "score": sc.score if sc.score is not None else "-", "band": sc.band,
        "factors": [{"label": f.label, "note": f.note, "points": f"-{f.points}" if f.points else "0"} for f in sc.factors],
        "phases": [{"name": p.name, "pct": p.pct, "status": _state(p), "tasks": f"{p.done} of {p.total}" if p.total else "-", "due": p.due or "-"} for p in programme["phases"]],
        "decisions": [{"text": d.text, "meeting": d.meeting, "date": d.held_on, "status": d.status} for d in programme["decisions"]],
        "flagged": [{"title": f.title, "severity": f.severity.title(), "owner": f.owner or "Unassigned", "status": f.status.title(), "why": "; ".join(f.reasons)} for f in programme["flagged"]],
        "risks": risk_rows, "findings": list(ai_text.findings if ai_text else a.findings), "metrics": a.metrics(),
        "overdue": [{"key": t["key"], "summary": t["summary"], "owner": t.get("assignee") or "Unassigned", "due": t["due"]} for t in a.overdue],
    }
    return a, ai_text, risks, approved_at, programme, context


def apply_edits(ai_text: ai.TaskAnalysis | None, a: Analysis, context: dict, edits: dict | None):
    """Written parts the reviewer changed through the chat replace the generated ones."""
    if not edits:
        return ai_text, context
    ai_text = ai.TaskAnalysis(summary=edits["summary"], risk_level=ai_text.risk_level if ai_text else "medium",
                              findings=edits["findings"], recommendations=edits["recommendations"])
    context = {**context, "summary": edits["summary"], "findings": edits["findings"], "recommendations": edits["recommendations"], "edits": edits}
    return ai_text, context


def revise_report(db: Session, report: Report, message: str, history: list[dict[str, str]]) -> str:
    """Applies the reviewer's request to a draft's summary, findings and recommendations and rebuilds both PDFs."""
    project = db.get(Project, report.project_id)
    a, ai_text, risks, approved_at, programme, context = gather(db, project, report.period_label)
    edits = (report.context or {}).get("edits")
    cur = edits or {"summary": context["summary"], "findings": context["findings"],
                    "recommendations": list(ai_text.recommendations) if ai_text else []}
    r = ai.revise_report(project.name, cur, docstyle.resolve(report.style).model_dump(), history, message)
    edits = {"summary": r.summary, "findings": r.findings, "recommendations": r.recommendations}
    ai_text, context = apply_edits(ai_text, a, context, edits)
    report.context = context
    report.style = docstyle.merge(report.style, r.style)
    report.pdf = build_pdf(project, report.period_label, a, ai_text, risks, approved_at, programme, draft=True, style=report.style)
    report.final_pdf = build_pdf(project, report.period_label, a, ai_text, risks, approved_at, programme, draft=False, style=report.style)
    db.commit()
    return r.reply


def create_report(db: Session, project: Project, *, period_label: str, start: date, end: date, trigger: str) -> Report:
    """Analyse the project's current data and store a PDF."""
    a, ai_text, risks, approved_at, programme, context = gather(db, project, period_label)
    slug = re.sub(r"[^a-z0-9]+", "-", project.name.lower()).strip("-") or "project"
    report = Report(context=context,
        id=str(uuid.uuid4()), project_id=project.id, project_name=project.name, period_label=period_label,
        period_from=start.isoformat(), period_to=end.isoformat(), trigger=trigger,
        file_name=f"{slug}-report-{end.isoformat()}.pdf", status="draft",
        pdf=build_pdf(project, period_label, a, ai_text, risks, approved_at, programme, draft=True),
        final_pdf=build_pdf(project, period_label, a, ai_text, risks, approved_at, programme, draft=False),
        dedupe_key=f"{project.id}:{start}:{end}" if trigger == "scheduled" else None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(report)
    db.commit()
    return report
