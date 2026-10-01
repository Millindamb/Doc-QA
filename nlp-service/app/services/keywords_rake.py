"""RAKE (Rapid Automatic Keyword Extraction), implemented from scratch.

Classic Rose et al. (2010) algorithm:
1. Split text into candidate phrases on stopwords and punctuation.
2. Build a word co-occurrence graph within those candidate phrases.
3. Score each word by degree(word) / frequency(word).
4. Score each candidate phrase as the sum of its words' scores.

We ship our own small stopword list rather than depending on ``nltk`` (which
needs a network call to ``nltk.download`` on first use) so this runs fully
offline out of the box.
"""
from __future__ import annotations

import re
from collections import defaultdict

_STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
    "any", "are", "aren't", "as", "at", "be", "because", "been", "before",
    "being", "below", "between", "both", "but", "by", "can", "cannot", "could",
    "did", "do", "does", "doing", "down", "during", "each", "few", "for",
    "from", "further", "had", "has", "have", "having", "he", "her", "here",
    "hers", "herself", "him", "himself", "his", "how", "i", "if", "in", "into",
    "is", "it", "its", "itself", "just", "me", "more", "most", "my", "myself",
    "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other",
    "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should",
    "so", "some", "such", "than", "that", "the", "their", "theirs", "them",
    "themselves", "then", "there", "these", "they", "this", "those", "through",
    "to", "too", "under", "until", "up", "very", "was", "we", "were", "what",
    "when", "where", "which", "while", "who", "whom", "why", "will", "with",
    "would", "you", "your", "yours", "yourself", "yourselves", "also", "may",
    "one", "two", "three", "etc", "e.g", "i.e", "thus", "however",
}

_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9'-]*")
_SPLIT_RE = re.compile(r"[,.!?;:()\[\]{}\"“”\-–—/\\|\n]+")


def _candidate_phrases(text: str) -> list[list[str]]:
    phrases: list[list[str]] = []
    for chunk in _SPLIT_RE.split(text):
        words = _WORD_RE.findall(chunk)
        current: list[str] = []
        for w in words:
            if w.lower() in _STOPWORDS:
                if current:
                    phrases.append(current)
                    current = []
            else:
                current.append(w.lower())
        if current:
            phrases.append(current)

    def is_useful(p: list[str]) -> bool:
        if not p:
            return False
        # drop degenerate multi-word phrases like ["atp", "atp"] (repeated token)
        return len(p) == 1 or len(set(p)) > 1

    return [p for p in phrases if is_useful(p)]


def extract_rake_keywords(text: str, top_n: int = 15, max_words: int = 4) -> list[tuple[str, float]]:
    """Return up to top_n (phrase, normalized_score) pairs, score in 0..1."""
    if not text or not text.strip():
        return []

    phrases = [p for p in _candidate_phrases(text) if len(p) <= max_words]
    if not phrases:
        return []

    freq: dict[str, int] = defaultdict(int)
    degree: dict[str, int] = defaultdict(int)

    for phrase in phrases:
        phrase_len = len(phrase) - 1
        for word in phrase:
            freq[word] += 1
            degree[word] += phrase_len  # co-occurrence with the rest of the phrase

    for word in freq:
        degree[word] += freq[word]  # word co-occurs with itself once per occurrence

    word_score = {w: degree[w] / freq[w] for w in freq}

    phrase_scores: dict[str, float] = {}
    for phrase in phrases:
        key = " ".join(phrase)
        phrase_scores[key] = sum(word_score[w] for w in phrase)

    if not phrase_scores:
        return []

    max_score = max(phrase_scores.values()) or 1.0
    ranked = sorted(phrase_scores.items(), key=lambda kv: -kv[1])[:top_n]
    return [(phrase, score / max_score) for phrase, score in ranked]
