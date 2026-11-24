"""Per-document design (colours, font, sizes). Stored on the meeting or report; the AI changes it through the chat."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


class DocStyle(BaseModel):
    accent: str = "#0f766e"          # table headers, title banner, charts
    heading: str | None = None       # headings; the accent when not set
    font: Literal["sans", "serif", "mono"] = "sans"
    body_size: int = Field(10, ge=8, le=14)
    banner: bool = True              # filled title band
    zebra: bool = True               # shaded alternate table rows

    @field_validator("accent", "heading")
    @classmethod
    def _hex(cls, v):
        if v is not None and not _HEX.match(v):
            raise ValueError("colour must look like #1f6feb")
        return v.lower() if v else v

    @property
    def heading_color(self) -> str:
        return self.heading or self.accent


class StylePatch(BaseModel):
    """What the AI changes. Anything left null stays as it is."""
    accent: str | None = Field(None, description="Hex colour like #1f6feb for the title band, table headers and charts.")
    heading: str | None = Field(None, description="Hex colour for headings. Null keeps the current one.")
    font: Literal["sans", "serif", "mono"] | None = Field(None, description="Font family: sans (clean), serif (formal), mono (code-like).")
    body_size: int | None = Field(None, description="Body text size in points, 8 to 14.")
    banner: bool | None = Field(None, description="Whether the title sits in a filled colour band.")
    zebra: bool | None = Field(None, description="Whether alternate table rows are shaded.")


DEFAULT = DocStyle()


def resolve(stored: dict | None) -> DocStyle:
    try:
        return DocStyle(**(stored or {}))
    except Exception:
        return DEFAULT


def merge(stored: dict | None, patch: StylePatch | None) -> dict | None:
    """The stored style with the AI's changes applied; invalid values are ignored."""
    if patch is None:
        return stored
    cur = resolve(stored).model_dump()
    for k, v in patch.model_dump().items():
        if v is None:
            continue
        try:
            DocStyle(**{**cur, k: v})
        except Exception:
            continue
        cur[k] = v
    return cur
