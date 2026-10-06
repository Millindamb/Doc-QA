# DocQA - Multi-Model Intelligent Document Understanding & Question Answering

Upload a PDF, an image or raw text. DocQA extracts and cleans the text, finds key points and topics, then lets you **ask questions** (grounded in your document, with citations), take **quizzes**, work through **practice questions**, run **web research** and get **study resources**.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Answer Modes](#answer-modes)
4. [Tech Stack](#tech-stack)
5. [Architecture](#architecture)
6. [Quick Start (Docker)](#quick-start-docker)
7. [Local Development](#local-development)
8. [Environment Variables & API Keys](#environment-variables--api-keys)
9. [API Reference](#api-reference)
10. [How Key Pieces Work](#how-key-pieces-work)
11. [Testing](#testing)
12. [Evaluation](#evaluation)
13. [Project Structure](#project-structure)
14. [Known Limitations](#known-limitations)
15. [Future Work](#future-work)

---

## Overview

Students and self-learners work with long notes, textbooks and scanned handouts. DocQA turns that material into an interactive study assistant whose answers are **grounded in the user's own document** rather than generated from general knowledge alone.

**Design principle:** every NLP algorithm is our own code in `nlp-service/` (cleaning, heading detection, chunking, TextRank, exam importance score, hybrid retrieval, intent router). The LLM only *writes* (answers, key points, quiz questions, research summaries); it never replaces those algorithms.

## Features

| Feature | Description |
| --- | --- |
| Multi-format ingestion | PDF, PNG/JPG, TXT or pasted text. Scanned pages use OpenCV preprocessing + EasyOCR/Tesseract; low OCR quality falls back to Gemini. |
| Document analysis | Keywords (TF-IDF + RAKE + YAKE), MiniLM embeddings, KMeans topics, TextRank summary, per-chunk exam importance score. |
| Grounded Q&A | Hybrid BM25 + cosine retrieval; answers cite chunk numbers. |
| Intent routing | Chat messages are routed to Q&A, quiz, practice, research or resources automatically. |
| Quizzes | 1-20 questions, easy/medium/hard, MCQ / short / mixed; graded with per-topic breakdown and weak-area tracking. |
| Practice questions | Questions with model answers. |
| Web research | Tavily -> Wikipedia -> SerpAPI chain with a cited summary and real links. |
| Study resources | Ranked YouTube videos, Wikipedia links and clearly-labelled AI suggestions. |
| Auth | JWT register / login. |

## Answer Modes

| Mode | Retrieval | Answer style |
| --- | --- | --- |
| **Knowledge** | top 8 chunks, ordered by relevance | in-depth: background, examples, analogies, cites chunk numbers |
| **Exam** | top 5 chunks, re-ranked by `0.6*relevance + 0.4*importance` | concise: definitions -> formulas/key facts -> likely exam questions -> short answer |

## Tech Stack

| Layer | Technologies |
| --- | --- |
| Client | React, Vite, Tailwind CSS, nginx (in Docker) |
| API server | Node.js 20+, Express, MongoDB, JWT, multer, zod |
| NLP service | Python 3.10+, FastAPI, PyMuPDF, OpenCV, EasyOCR / Tesseract, sentence-transformers (MiniLM), scikit-learn, RAKE, YAKE, BM25 |
| LLMs | Google Gemini (primary), Groq (fallback) |
| External APIs | Tavily, Wikipedia, SerpAPI, YouTube Data API v3 (all optional) |
| DevOps | Docker, docker-compose |
| Testing | pytest, npm test, rouge-score |

## Architecture

```
React (Vite+Tailwind) --/api--> Express + MongoDB ---------> nlp-service (FastAPI)
  client/  (nginx in docker)     server/  JWT, multer          OCR, cleaning, chunking, keywords,
                                  |  LLM wrapper                TextRank, importance, BM25+cosine
                                  |  (Gemini -> Groq)           retrieval, intent router
                                  +--> Tavily / Wikipedia / SerpAPI, YouTube Data API
```

- **LLM wrapper** (`server/src/services/llm.js`): Gemini first (accepts PDFs/images), automatic fallback to Groq on any error / 429 / timeout / invalid output. `structured.js` adds schema validation: invalid JSON -> retry once on the same provider -> fall back to the other provider.
- **Prompts** live in `server/prompts/*.txt`, one file per template, never inline.
- **nlp-service** is internal; guard it with `NLP_INTERNAL_KEY`.

## Quick Start (Docker)

```bash
cp .env.example .env        # set JWT_SECRET and at least one of GEMINI_API_KEY / GROQ_API_KEY
docker compose up --build   # first build is slow (torch, sentence-transformers, EasyOCR)
# open http://localhost:8080
```

| Service | Port |
| --- | --- |
| `mongo` | 27017 |
| `nlp-service` | 8000 |
| `server` | 5000 |
| `client` (nginx, proxies `/api`) | 8080 |

Sentence-transformers / EasyOCR weights download on first use into the `nlp_models` volume.

> **Note:** the compose file and Dockerfiles were written and YAML-validated but not built in the environment where the project was authored. Expect to fix small things on the first `docker compose up`; the local setup below was tested.

## Local Development

**Prerequisites:** Node 20+, Python 3.10+, MongoDB (`docker compose up -d mongo` is the easiest).

```bash
# 1. NLP service
cd nlp-service
python -m venv .venv && source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu   # optional, keeps install small
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000

# 2. API server
cd server && npm install && cp .env.example .env    # add keys
npm run dev                                          # http://localhost:5000

# 3. Client
cd client && npm install && npm run dev              # http://localhost:5173 (proxies /api to :5000)
```

**Graceful degradation**

- Without `sentence-transformers`, the service stores TF-IDF fallback vectors and retrieval uses TF-IDF cosine (reported in `retrieval.method`).
- Without a Tesseract binary the EasyOCR path is used, and vice versa.
- Research works with **no** search keys (Wikipedia needs none). Missing pieces appear as `warnings` in responses.

## Environment Variables & API Keys

| Key | Used for | Needed? |
| --- | --- | --- |
| `JWT_SECRET` | signing auth tokens | required |
| `GEMINI_API_KEY` ([aistudio.google.com](https://aistudio.google.com/apikey)) | primary LLM, PDF/image OCR fallback | one of Gemini/Groq required for any LLM feature |
| `GROQ_API_KEY` ([console.groq.com](https://console.groq.com/keys)) | fallback LLM | recommended |
| `TAVILY_API_KEY` | research provider #1 | optional |
| `SERPAPI_API_KEY` | research provider #3 | optional |
| `YOUTUBE_API_KEY` (YouTube Data API v3) | study-resource videos | optional (videos skipped with a warning) |
| `NLP_INTERNAL_KEY` | guards internal nlp-service routes | recommended |

**Model names.** Defaults are `GEMINI_MODEL=gemini-3.5-flash-lite` and `GROQ_MODEL=openai/gpt-oss-120b` (set in `.env`). Provider lineups change often: if every LLM call fails with a 404 / `model_decommissioned` error, check [Gemini models](https://ai.google.dev/gemini-api/docs/models) and [Groq deprecations](https://console.groq.com/docs/deprecations) and update the variable. Groq retired its Llama 3.x chat models on 2026-08-16, so the fallback is no longer a Llama model. `gemini-3.8-flash` is a stronger (slower, lower free quota) alternative for Gemini.

## API Reference

All `/api/*` routes except auth need `Authorization: Bearer <jwt>`.

| Method & path | Purpose |
| --- | --- |
| `POST /auth/register`, `/auth/login` | JWT auth |
| `POST /documents/upload` | multipart `file` (pdf/png/jpg/txt) or `text`; runs ingest |
| `GET /documents`, `GET /documents/:id`, `DELETE /documents/:id` | list / read / delete |
| `POST /documents/:id/analyze`, `GET /documents/:id/analysis` | keywords, topics, summary, importance, embeddings, key points |
| `POST /chat` `{documentId, sessionId?, message, mode}` | routes the intent, answers from the document, or dispatches quiz/practice/research/resources |
| `GET /chat/sessions?documentId=`, `GET/DELETE /chat/sessions/:id` | conversation history |
| `POST /quiz` `{documentId, count, difficulty, type, mode}` | new quiz (answers hidden). `count` 1-20, `difficulty` easy/medium/hard, `type` mcq/short/mixed, `mode` knowledge (spread over topics) / exam (highest-importance chunks) |
| `POST /quiz/:id/attempts` `{answers:[{questionId,response}]}` | grade + store; returns score, per-topic breakdown, answers, explanations |
| `GET /quiz/weak-areas?documentId=` | per-topic accuracy across attempts, weakest first (`weak` = under 60%) |
| `GET /quiz?documentId=`, `GET /quiz/:id`, `GET /quiz/:id/attempts` | history |
| `POST /practice` `{documentId, count, difficulty, type, mode}` | practice questions **with model answers** |
| `POST /research` `{documentId, query?}` | 2-3 built queries -> Tavily / Wikipedia / SerpAPI chain -> cited summary + real links |
| `POST /resources` `{documentId, query?}` | ranked YouTube videos, Wikipedia links, clearly-labelled AI suggestions |

**nlp-service (internal):** `POST /ingest`, `/analyze`, `/retrieve`, `/route`, `GET /health`.

## How Key Pieces Work

- **Ingest:** PyMuPDF text per page (scanned pages -> OpenCV preprocessing -> EasyOCR/Tesseract), own cleaning (hyphenation, headers/footers, whitespace), heading detection, sentence splitting, ~300-token chunks with 50-token overlap. Low OCR quality sets `needs_llm_ocr`, and the server re-reads the file with Gemini.
- **Analyze:** TF-IDF + RAKE + YAKE keywords merged; MiniLM embeddings; KMeans topics (k by silhouette); TextRank summary; exam importance score (TF-IDF, heading, definition patterns, numbers/formulas/dates, position, TextRank) with per-feature breakdown.
- **Retrieve:** `alpha*normalized_BM25 + (1-alpha)*cosine` (alpha 0.4). Exam mode shortlists then re-ranks by importance. Chunks scoring under 10% of the best are dropped so importance cannot promote irrelevant text.
- **Route:** regex rules first; ambiguous queries go to a TF-IDF + LogisticRegression classifier (`nlp-service/data/intents.csv`, retrain with `python train_router.py`).
- **Questions:** chunk selection (exam = top importance, knowledge = round-robin across topics) -> strict-JSON prompt -> zod validation -> retry once -> other provider. MCQs are graded exactly; short answers by key-term coverage (a lexical heuristic that cannot judge paraphrase, so the UI always shows the model answer and missing terms).
- **Research:** query builder (top keywords + topic labels), provider chain, LLM summary constrained to numbered sources; any URL or citation the LLM invents is stripped server-side.
- **Resources:** YouTube results filtered to 5-40 min with a title match, ranked by title match, views, recency and duration (weights configurable). AI-suggested topics/books are labelled unverified and may not contain URLs.

## Testing

```bash
cd nlp-service && pytest          # 105 tests: cleaning, headings, chunking, analysis, retrieval, router, eval
cd server && npm test             # 99 tests: prompts, structured output, questions, grading, research, resources, chat, HTTP routes
cd client && npm run build        # compiles the UI (there are no browser tests)
```

`server/scripts/e2e-no-llm.mjs` drives the real nlp-service through the real chat pipeline with a stubbed LLM. The full manual checklist (with curl) is in [`docs/E2E_CHECKLIST.md`](docs/E2E_CHECKLIST.md); Part 3 curl examples are in [`docs/PART3_TESTING.md`](docs/PART3_TESTING.md).

## Evaluation

```bash
cd nlp-service
pip install rouge-score
python -m eval.run_eval            # retrieval + summaries offline; adds answer comparison if an LLM key is set
python -m eval.run_eval --llm off  # never call an LLM
```

Compares BM25-only vs embeddings-only vs hybrid (recall@k, MRR, alpha sweep), answers with vs without retrieval, and TextRank vs Lead-N vs random vs LLM-only summaries (ROUGE). Writes CSVs and `results.md` to `nlp-service/eval/results/`. See [`nlp-service/eval/README.md`](nlp-service/eval/README.md).

> The committed `results/` were produced **without** an LLM key and **without** sentence-transformers (so "embeddings only" was a TF-IDF cosine). Re-run in your environment for report numbers.

## Project Structure

```
client/       React app: pages/ (auth, dashboard, upload, document view),
              components/ (chat, quiz, practice, research, resources)
server/       src/{routes,services,models,middleware}, prompts/, scripts/
nlp-service/  app/{routers,services,models}, data/intents.csv,
              artifacts/router.joblib, eval/, tests/
docs/         E2E checklist, Part 3 curl tests
samples/      biology_notes.txt (used by tests, e2e script and evaluation)
docker-compose.yml
.env.example
DocQA_Project_Setup.md
```

## Known Limitations

- Short-answer grading is keyword overlap, not understanding.
- Stored embeddings are sent to `/retrieve` on every chat turn (stateless). Fine for normal documents; use a vector DB for huge ones.
- The TextRank summary can include a heading glued to the following sentence (the sentence splitter treats heading lines as text).
- Research/resources quality depends on the search providers; YouTube results need a key and consume API quota.
- Docker setup has not been built end to end yet.
- The UI was compiled but not exercised in a browser during development.

## Future Work

- Semantic short-answer grading (embedding similarity or LLM-judged rubric).
- Vector database for large documents.
- Browser-based UI tests and a CI pipeline.
- Multi-document sessions and spaced-repetition scheduling from weak-area data.
- Fix heading/sentence splitting in summaries.

## License

Add a license of your choice (e.g. MIT) before publishing.