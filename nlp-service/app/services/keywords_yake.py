"""YAKE keyword extraction.

Primary path: the ``yake`` package (unsupervised, statistical, no training
data or network access needed at runtime).

Fallback: if ``yake`` isn't installed, a small own statistical extractor that
approximates YAKE's core signals (term frequency, how early a term first
appears, and how spread out across sentences it is) so keyword extraction
keeps working offline. The response's keyword ``sources`` always reflects
which one actually ran.
"""
from __future__ import annotations

import re
from collections import defaultdict

_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9'-]*")
_STOPWORDS_MIN = {
    "the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "is", "are",
    "was", "were", "be", "been", "being", "with", "as", "by", "at", "this",
    "that", "these", "those", "it", "its", "from", "into", "than", "then",
}


def _fallback_extract(text: str, top_n: int, max_ngram: int) -> list[tuple[str, float]]:
    sentences = re.split(r"(?<=[.!?])\s+", text)
    total_sentences = max(len(sentences), 1)

    term_first_pos: dict[str, int] = {}
    term_sentence_ids: dict[str, set[int]] = defaultdict(set)
    term_freq: dict[str, int] = defaultdict(int)

    word_position = 0
    for sent_idx, sentence in enumerate(sentences):
        words = [w for w in _WORD_RE.findall(sentence)]
        for n in range(1, max_ngram + 1):
            for i in range(len(words) - n + 1):
                gram_words = words[i : i + n]
                if any(w.lower() in _STOPWORDS_MIN for w in (gram_words[0], gram_words[-1])):
                    continue
                term = " ".join(w.lower() for w in gram_words)
                term_freq[term] += 1
                term_sentence_ids[term].add(sent_idx)
                term_first_pos.setdefault(term, word_position + i)
        word_position += len(words)

    if not term_freq:
        return []

    max_freq = max(term_freq.values())
    max_pos = max(term_first_pos.values()) or 1

    scores: dict[str, float] = {}
    for term, freq in term_freq.items():
        freq_score = freq / max_freq
        earliness = 1.0 - (term_first_pos[term] / max_pos)
        spread = len(term_sentence_ids[term]) / total_sentences
        # lower "cost" (YAKE-style) is better; we invert to a 0..1 "goodness" score
        scores[term] = 0.5 * freq_score + 0.3 * earliness + 0.2 * spread

    ranked = sorted(scores.items(), key=lambda kv: -kv[1])[:top_n]
    max_score = ranked[0][1] if ranked else 1.0
    return [(term, score / max_score if max_score else 0.0) for term, score in ranked]


def extract_yake_keywords(text: str, top_n: int = 15, max_ngram: int = 3) -> list[tuple[str, float]]:
    if not text or not text.strip():
        return []

    try:
        import yake  # noqa: PLC0415
    except ImportError:
        return _fallback_extract(text, top_n, max_ngram)

    try:
        extractor = yake.KeywordExtractor(lan="en", n=max_ngram, top=top_n)
        raw = extractor.extract_keywords(text)  # list[(term, score)], LOWER score = better
    except Exception:
        return _fallback_extract(text, top_n, max_ngram)

    if not raw:
        return []

    # invert YAKE's "lower is better" cost into a 0..1 "higher is better" score
    max_cost = max(score for _, score in raw) or 1.0
    return [(term, 1.0 - (score / max_cost)) for term, score in raw]
