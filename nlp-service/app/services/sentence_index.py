"""Builds a flat, document-ordered sentence index from chunks.

Chunks already overlap (see Part 1 chunking), so naively concatenating every
chunk's sentences would double-count the overlapping tail/head sentences.
We de-duplicate consecutive chunks' shared sentences by exact text match on
the boundary before flattening.
"""
from __future__ import annotations

from app.models.document import SentenceInfo
from app.models.schemas import ChunkIn
from app.services.chunking import split_sentences


def build_sentences(chunks: list[ChunkIn]) -> list[SentenceInfo]:
    ordered_chunks = sorted(chunks, key=lambda c: c.position)
    sentences: list[SentenceInfo] = []
    seen_text_in_prev_chunk: set[str] = set()
    position = 0

    for chunk in ordered_chunks:
        chunk_sentences = split_sentences(chunk.text)
        new_seen: set[str] = set()
        for idx, sent in enumerate(chunk_sentences):
            new_seen.add(sent)
            if sent in seen_text_in_prev_chunk:
                # overlap carried over from the previous chunk; skip re-adding it
                continue
            sentences.append(
                SentenceInfo(
                    text=sent,
                    chunk_id=chunk.id,
                    heading=chunk.heading,
                    position=position,
                    sentence_index_in_chunk=idx,
                )
            )
            position += 1
        seen_text_in_prev_chunk = new_seen

    return sentences
