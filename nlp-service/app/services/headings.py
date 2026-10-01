"""Rule-based heading detection (own implementation, no ML/LLM).

Works on the cleaned, paragraph-joined text produced by ``cleaning.clean_pages``.
Each non-blank "paragraph" (line, since join_broken_lines merges soft wraps into
single lines) is scored against a set of heuristics; lines that pass become
headings with a level 1-4.

If PyMuPDF per-line font-size info is available (``font_hints``: text -> size),
a line whose font size is meaningfully larger than the document's median body
size is boosted, which lets us catch headings that don't match textual rules.
"""
from __future__ import annotations

import re
import statistics
from dataclasses import dataclass

_NUMBERED_RE = re.compile(r"^(\d+(\.\d+){0,3})[.)]?\s+\S")
_ALLCAPS_RE = re.compile(r"^[A-Z0-9][A-Z0-9\s\-:,&/()]{2,80}$")
_TITLECASE_RE = re.compile(r"^([A-Z][a-zA-Z0-9'&]*\s*){1,10}$")
_TERMINAL_PUNCT_RE = re.compile(r"[.!?,;]\s*$")
_BULLET_RE = re.compile(r"^\s*[-*•]\s+")
_COMMON_HEADING_WORDS = {
    "introduction", "conclusion", "summary", "abstract", "background",
    "overview", "references", "appendix", "methodology", "results",
    "discussion", "objectives", "chapter", "section",
}


@dataclass
class HeadingCandidate:
    text: str
    level: int
    line_index: int  # index into the list of non-blank paragraph lines


def _numbering_depth(text: str) -> int:
    m = _NUMBERED_RE.match(text)
    if not m:
        return 0
    return m.group(1).count(".") + 1


def _looks_like_heading(line: str, word_count: int) -> tuple[bool, int]:
    """Return (is_heading, level) using purely textual rules."""
    stripped = line.strip()
    if not stripped or _BULLET_RE.match(stripped):
        return False, 0
    if len(stripped) > 90:
        return False, 0

    # Rule 1: numbered sections e.g. "1.", "2.3", "3.1.2 Title"
    if _NUMBERED_RE.match(stripped):
        depth = _numbering_depth(stripped)
        return True, min(depth, 4)

    # Rule 2: ALL CAPS line (allow short connecting words)
    if _ALLCAPS_RE.match(stripped) and word_count <= 12 and any(c.isalpha() for c in stripped):
        return True, 1

    # Rule 3: short line, no terminal punctuation, title-case-ish, common heading vocab
    first_word = stripped.split()[0].lower().strip(":") if stripped.split() else ""
    if (
        word_count <= 8
        and not _TERMINAL_PUNCT_RE.search(stripped)
        and (stripped[:1].isupper() or first_word in _COMMON_HEADING_WORDS)
    ):
        if first_word in _COMMON_HEADING_WORDS:
            return True, 1
        if _TITLECASE_RE.match(stripped):
            return True, 2

    return False, 0


def detect_headings(
    cleaned_text: str, font_hints: dict[str, float] | None = None
) -> list[HeadingCandidate]:
    """Detect headings in cleaned_text.

    ``font_hints`` optionally maps a line's exact text to its dominant font size
    (from PyMuPDF spans); lines with a size notably above the median get treated
    as headings (level 1) even if the textual rules miss them, and lines caught
    by textual rules get promoted to level 1 if their font size is in the top
    bracket.
    """
    paragraphs = [ln for ln in cleaned_text.split("\n") if ln.strip()]
    if not paragraphs:
        return []

    median_size = None
    if font_hints:
        sizes = list(font_hints.values())
        if sizes:
            median_size = statistics.median(sizes)

    candidates: list[HeadingCandidate] = []
    for idx, line in enumerate(paragraphs):
        word_count = len(line.split())
        is_heading, level = _looks_like_heading(line, word_count)

        if font_hints and median_size:
            size = font_hints.get(line.strip())
            if size is not None:
                if size >= median_size * 1.4 and word_count <= 15:
                    is_heading, level = True, 1 if not is_heading else min(level, 1)
                elif size >= median_size * 1.15 and word_count <= 15 and not is_heading:
                    is_heading, level = True, 2

        if is_heading:
            candidates.append(HeadingCandidate(text=line.strip(), level=level, line_index=idx))

    return candidates
