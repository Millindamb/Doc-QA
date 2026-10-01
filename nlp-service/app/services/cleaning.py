"""Our own text-cleaning pipeline (no LLM involved).

Steps, in order:
1. Unicode normalization (NFKC) + control-char stripping.
2. Repeated header/footer/page-number removal (uses repetition across pages).
3. De-hyphenation across line breaks ("exam-\nple" -> "example").
4. Whitespace normalization + joining of broken (soft-wrapped) lines into paragraphs,
   while preserving intentional paragraph/heading breaks.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter

_PAGE_NUM_RE = re.compile(
    r"""^\s*(
        \d{1,4}
        | [ivxlcdm]{1,6}
        | page\s+\d{1,4}(\s*(of|/)\s*\d{1,4})?
        | \d{1,4}\s*(of|/)\s*\d{1,4}
    )\s*$""",
    re.IGNORECASE | re.VERBOSE,
)

_HYPHEN_BREAK_RE = re.compile(r"(\w)-\n(\w)")
_MULTI_SPACE_RE = re.compile(r"[ \t]+")
_MULTI_BLANK_RE = re.compile(r"\n{3,}")
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def normalize_unicode(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    # Common ligatures/quotes that NFKC doesn't always fold usefully for plain text
    replacements = {
        "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
        "\u2013": "-", "\u2014": "-", "\u00a0": " ", "\ufeff": "",
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    return _CONTROL_CHARS_RE.sub("", text)


def dehyphenate(text: str) -> str:
    """Join words split across a line break by a hyphen: 'infor-\\nmation' -> 'information'."""
    prev = None
    while prev != text:
        prev = text
        text = _HYPHEN_BREAK_RE.sub(r"\1\2", text)
    return text


def strip_page_numbers(lines: list[str]) -> list[str]:
    return ["" if _PAGE_NUM_RE.match(ln) else ln for ln in lines]


def remove_repeated_headers_footers(
    pages: list[list[str]], min_repeat_ratio: float = 0.4, max_lines_checked: int = 3
) -> list[list[str]]:
    """Given text already split into per-page line lists, drop lines that repeat
    verbatim (case/space-insensitive) near the top or bottom of many pages —
    typical running headers/footers.
    """
    if len(pages) < 3:
        return pages

    def key(line: str) -> str:
        return re.sub(r"\d+", "#", line.strip().lower())

    top_counter: Counter[str] = Counter()
    bottom_counter: Counter[str] = Counter()
    for page in pages:
        non_blank = [ln for ln in page if ln.strip()]
        for ln in non_blank[:max_lines_checked]:
            top_counter[key(ln)] += 1
        for ln in non_blank[-max_lines_checked:]:
            bottom_counter[key(ln)] += 1

    n_pages = len(pages)
    repeated_top = {k for k, c in top_counter.items() if c / n_pages >= min_repeat_ratio}
    repeated_bottom = {k for k, c in bottom_counter.items() if c / n_pages >= min_repeat_ratio}
    repeated = repeated_top | repeated_bottom

    cleaned_pages: list[list[str]] = []
    for page in pages:
        new_page = []
        for ln in page:
            if ln.strip() and key(ln) in repeated:
                continue
            new_page.append(ln)
        cleaned_pages.append(new_page)
    return cleaned_pages


def join_broken_lines(text: str) -> str:
    """Join soft-wrapped lines into paragraphs.

    Heuristic: a newline is a *paragraph break* (kept) if the line before it is
    blank, ends with terminal punctuation, or the next line looks like a heading
    / list item. Otherwise it's a *soft wrap* and gets replaced with a space.
    """
    lines = text.split("\n")
    out: list[str] = []
    heading_like = re.compile(r"^(\s*[-*•]|\s*\d+[.)]\s|\s*[A-Z][A-Z\s]{3,}$)")
    caps_heading = re.compile(r"^\s*[A-Z][A-Z0-9\s:&,-]{3,}$")  # a finished ALL-CAPS heading line

    for i, line in enumerate(lines):
        stripped = line.rstrip()
        if i == 0:
            out.append(stripped)
            continue

        prev = out[-1] if out else ""
        cur = stripped

        if not cur.strip():
            out.append("")  # blank line preserved
            continue
        if not prev.strip():
            out.append(cur)
            continue
        if (
            re.search(r"[.!?:;\"')\]]\s*$", prev)
            or heading_like.match(cur)
            or caps_heading.match(prev)  # never glue body text onto a heading above it
        ):
            out.append(cur)
            continue

        # soft wrap: merge with previous line
        out[-1] = f"{prev.rstrip()} {cur.lstrip()}"

    return "\n".join(out)


def normalize_whitespace(text: str) -> str:
    text = _MULTI_SPACE_RE.sub(" ", text)
    lines = [ln.strip() for ln in text.split("\n")]
    text = "\n".join(lines)
    text = _MULTI_BLANK_RE.sub("\n\n", text)
    return text.strip()


def clean_pages(pages: list[str]) -> str:
    """Full pipeline entry point.

    ``pages`` is a list of raw per-page text (already OCR'd/extracted).
    Returns a single cleaned document string with pages joined by blank lines.
    """
    norm_pages = [normalize_unicode(p) for p in pages]
    line_pages = [p.split("\n") for p in norm_pages]
    line_pages = remove_repeated_headers_footers(line_pages)
    line_pages = [strip_page_numbers(lp) for lp in line_pages]

    joined = "\n\n".join("\n".join(lp) for lp in line_pages)
    joined = dehyphenate(joined)
    joined = join_broken_lines(joined)
    joined = normalize_whitespace(joined)
    return joined
