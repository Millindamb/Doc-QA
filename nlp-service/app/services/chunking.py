"""Own sentence splitter + chunker (no ML/LLM, no third-party sentence-splitter).

split_sentences: regex-based, with an abbreviation list so "Dr. Smith went..."
                 isn't split after "Dr.".
chunk_document:  groups (heading, sentences) into ~target_tokens chunks with a
                 ~overlap_tokens sentence-level overlap between consecutive
                 chunks, never splitting a sentence, and tags each chunk with
                 its nearest preceding heading + a position index.
"""
from __future__ import annotations

import re

from app.models.document import Chunk
from app.services.headings import HeadingCandidate
from app.utils.tokens import count_tokens

_ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e",
    "fig", "eq", "no", "vol", "pp", "op", "ca", "cf", "al", "inc", "ltd", "co",
    "a.m", "p.m", "u.s", "u.k", "u.n", "approx", "dept", "univ", "gov",
}

# Split on . ! ? followed by whitespace + a capital/quote/digit, but we post-filter
# false positives using the abbreviation list and decimal numbers.
_SENTENCE_BOUNDARY_RE = re.compile(r'([.!?])(["\')\]]?)(\s+)(?=[A-Z0-9"\'(\[])')
_DECIMAL_RE = re.compile(r"\d\.\s*$")


def split_sentences(text: str) -> list[str]:
    """Split a paragraph of text into sentences."""
    text = text.strip()
    if not text:
        return []

    # Protect abbreviations by temporarily masking every period in the match
    # (the abbreviation itself may contain internal periods, e.g. "p.m.").
    def mask(m: re.Match) -> str:
        return m.group(0).replace(".", "\u0000")

    abbrev_pattern = re.compile(
        r"\b(" + "|".join(re.escape(a) for a in sorted(_ABBREVIATIONS, key=len, reverse=True)) + r")\.",
        re.IGNORECASE,
    )
    masked = abbrev_pattern.sub(mask, text)

    pieces: list[str] = []
    last = 0
    for m in _SENTENCE_BOUNDARY_RE.finditer(masked):
        end = m.end(2) if m.group(2) else m.end(1)
        candidate_end_text = masked[max(0, m.start(1) - 2):m.start(1) + 1]
        if _DECIMAL_RE.search(candidate_end_text):
            continue  # looks like "3.14" style decimal, not a sentence end
        pieces.append(masked[last:end].strip())
        last = m.end(3)
    tail = masked[last:].strip()
    if tail:
        pieces.append(tail)

    return [p.replace("\u0000", ".") for p in pieces if p.strip()]


def split_paragraphs_to_sentences(cleaned_text: str) -> list[str]:
    """Flatten cleaned_text (paragraphs separated by blank lines / newlines) into
    a single ordered list of sentences, paragraph by paragraph."""
    sentences: list[str] = []
    for para in cleaned_text.split("\n"):
        para = para.strip()
        if not para:
            continue
        sentences.extend(split_sentences(para))
    return sentences


def chunk_document(
    cleaned_text: str,
    headings: list[HeadingCandidate],
    target_tokens: int = 300,
    overlap_tokens: int = 50,
) -> list[Chunk]:
    """Chunk cleaned_text into ~target_tokens pieces with ~overlap_tokens overlap.

    Never splits mid-sentence. Each chunk is tagged with the nearest heading
    at or before its first sentence's paragraph line.
    """
    paragraphs = [ln.strip() for ln in cleaned_text.split("\n") if ln.strip()]
    if not paragraphs:
        return []

    heading_by_line = {h.line_index: h.text for h in headings}
    # sentence_index -> paragraph line_index, so we can look up the active heading
    sent_line_idx: list[int] = []
    sentences: list[str] = []
    for line_idx, para in enumerate(paragraphs):
        for sent in split_sentences(para):
            sentences.append(sent)
            sent_line_idx.append(line_idx)

    if not sentences:
        return []

    def heading_for(line_idx: int) -> str:
        current = ""
        for h in headings:
            if h.line_index <= line_idx:
                current = h.text
            else:
                break
        return current

    chunks: list[Chunk] = []
    position = 0
    start = 0
    n = len(sentences)

    while start < n:
        tokens_so_far = 0
        end = start
        while end < n:
            stoks = count_tokens(sentences[end])
            if tokens_so_far and tokens_so_far + stoks > target_tokens:
                break
            tokens_so_far += stoks
            end += 1
        if end == start:  # a single sentence longer than target_tokens
            end = start + 1

        chunk_sentences = sentences[start:end]
        chunk_text = " ".join(chunk_sentences)
        chunk_heading = heading_for(sent_line_idx[start])

        chunks.append(
            Chunk(
                id=f"c{position}",
                text=chunk_text,
                heading=chunk_heading,
                position=position,
                token_count=count_tokens(chunk_text),
            )
        )
        position += 1

        if end >= n:
            break

        # Compute overlap: step back from `end` while under overlap_tokens budget.
        overlap_start = end
        overlap_accum = 0
        while overlap_start > start:
            stoks = count_tokens(sentences[overlap_start - 1])
            if overlap_accum + stoks > overlap_tokens:
                break
            overlap_accum += stoks
            overlap_start -= 1

        next_start = overlap_start if overlap_start > start else end
        start = next_start

    return chunks
