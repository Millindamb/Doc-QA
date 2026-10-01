"""Minimal sync LLM client for the evaluation: Gemini first, Groq fallback, on-disk cache.

Reads GEMINI_API_KEY / GROQ_API_KEY (+ optional GEMINI_MODEL / GROQ_MODEL) from the environment or nlp-service/.env.
With no keys, `available()` is False and the LLM-dependent parts of the evaluation are skipped (not faked).
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()
CACHE_PATH = Path(__file__).parent / "results" / "llm_cache.json"


class LlmClient:
    def __init__(self, use_cache: bool = True, timeout: float = 60.0) -> None:
        self.gemini_key = os.getenv("GEMINI_API_KEY", "")
        self.groq_key = os.getenv("GROQ_API_KEY", "")
        self.gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
        self.groq_model = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
        self.timeout = timeout
        self.use_cache = use_cache
        self.providers_used: dict[str, int] = {}
        self._cache: dict[str, dict] = {}
        if use_cache and CACHE_PATH.exists():
            try:
                self._cache = json.loads(CACHE_PATH.read_text())
            except json.JSONDecodeError:
                self._cache = {}

    def available(self) -> bool:
        return bool(self.gemini_key or self.groq_key)

    def _save(self) -> None:
        if self.use_cache:
            CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            CACHE_PATH.write_text(json.dumps(self._cache))

    def generate(self, prompt: str, system: str | None = None) -> tuple[str, str]:
        """Return (text, provider). Raises RuntimeError if every configured provider fails."""
        key = hashlib.sha256(f"{system}\x1f{prompt}".encode()).hexdigest()
        if key in self._cache:
            c = self._cache[key]
            self.providers_used[c["provider"]] = self.providers_used.get(c["provider"], 0) + 1
            return c["text"], c["provider"]

        errors: list[str] = []
        for provider in ("gemini", "groq"):
            try:
                text = self._gemini(prompt, system) if provider == "gemini" else self._groq(prompt, system)
                if text.strip():
                    self._cache[key] = {"text": text, "provider": provider}
                    self._save()
                    self.providers_used[provider] = self.providers_used.get(provider, 0) + 1
                    return text, provider
                errors.append(f"{provider}: empty response")
            except Exception as exc:  # noqa: BLE001 - any failure moves on to the next provider
                errors.append(f"{provider}: {exc}")
        raise RuntimeError("; ".join(errors))

    def _gemini(self, prompt: str, system: str | None) -> str:
        if not self.gemini_key:
            raise RuntimeError("GEMINI_API_KEY not set")
        body: dict = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.2}}
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        r = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.gemini_model}:generateContent",
            params={"key": self.gemini_key}, json=body, timeout=self.timeout,
        )
        r.raise_for_status()
        parts = r.json()["candidates"][0]["content"]["parts"]
        return "\n".join(p.get("text", "") for p in parts)

    def _groq(self, prompt: str, system: str | None) -> str:
        if not self.groq_key:
            raise RuntimeError("GROQ_API_KEY not set")
        messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
        r = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {self.groq_key}"},
            json={"model": self.groq_model, "messages": messages, "temperature": 0.2},
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]
