"""Plain internal data structures (no third-party deps, easy to unit test)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional


@dataclass
class Line:
    """One physical text line. A blank ``Line("")`` marks a paragraph/block gap."""

    text: str
    font_size: Optional[float] = None  # dominant font size (PyMuPDF) if known
    bold: bool = False
    page: Optional[int] = None  # 1-based
    page_break: bool = False  # only meaningful on blank lines: gap is a page boundary

    @property
    def is_blank(self) -> bool:
        return not self.text.strip()


@dataclass
class Block:
    """A logical unit of the cleaned document: a heading or a paragraph."""

    kind: Literal["heading", "paragraph"]
    text: str
    level: int = 0  # heading level 1..4, 0 for paragraphs
    page: Optional[int] = None


@dataclass
class Chunk:
    id: str
    text: str
    heading: str
    position: int
    token_count: int


@dataclass
class HeadingInfo:
    text: str
    level: int
    block_index: int
    char_offset: int  # offset of the heading inside cleaned_text
    page: Optional[int] = None


@dataclass
class SentenceInfo:
    """A sentence located within a chunk, used by TextRank/importance/summary."""

    text: str
    chunk_id: str
    heading: str
    position: int  # global sentence index across all chunks, in document order
    sentence_index_in_chunk: int
