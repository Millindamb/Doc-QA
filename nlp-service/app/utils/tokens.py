"""Tiny dependency-free token counter.

A "token" here is a word (with internal apostrophes) or a single punctuation mark.
This is deliberately model-agnostic; LLM tokenizers produce ~1.2-1.4x more tokens
for English, so ~300 of ours is roughly 400 LLM tokens.
"""
from __future__ import annotations

import re

_TOKEN_RE = re.compile(r"\w+(?:['’]\w+)*|[^\w\s]", re.UNICODE)


def count_tokens(text: str) -> int:
    return len(_TOKEN_RE.findall(text))
