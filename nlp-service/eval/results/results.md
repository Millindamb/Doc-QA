# Evaluation results

*Generated 2026-09-30 09:36 UTC.* Document: `biology_notes.txt`, 22 chunks (~90 tokens, overlap 15), 21 answerable questions.

**Dense backend used for the embedding side of retrieval:** `hybrid(bm25+tfidf-cosine)` (stored vectors: `tfidf-fallback`). This run used the TF-IDF *fallback* because sentence-transformers was unavailable, so 'Embeddings only' here is a lexical TF-IDF cosine, NOT a neural embedding. Re-run with `sentence-transformers` installed for the real comparison.

## 1. Retrieval: BM25 vs embeddings vs hybrid

| method | alpha | questions | recall@1 | recall@3 | recall@5 | MRR |
|---|---|---|---|---|---|---|
| BM25 only | 1.000 | 21 | 0.810 | 1.000 | 1.000 | 0.905 |
| Embeddings only | 0.000 | 21 | 0.810 | 1.000 | 1.000 | 0.905 |
| Hybrid (alpha=0.4) | 0.400 | 21 | 0.857 | 1.000 | 1.000 | 0.929 |

Alpha sweep (alpha = weight of normalised BM25; 1.0 = BM25 only, 0.0 = embeddings only):

| alpha | recall@1 | recall@3 | recall@5 | MRR |
|---|---|---|---|---|
| 0.000 | 0.810 | 1.000 | 1.000 | 0.905 |
| 0.200 | 0.810 | 1.000 | 1.000 | 0.905 |
| 0.400 | 0.857 | 1.000 | 1.000 | 0.929 |
| 0.600 | 0.810 | 1.000 | 1.000 | 0.905 |
| 0.800 | 0.810 | 1.000 | 1.000 | 0.905 |
| 1.000 | 0.810 | 1.000 | 1.000 | 0.905 |

## 2. Answers with vs without retrieval

fact_recall = share of gold facts present in the answer; ROUGE-L vs a reference answer; abstain rate = how often the model said the document cannot answer an out-of-document question (higher is better; the no-retrieval baseline has no document to abstain from).

_Skipped: no GEMINI_API_KEY / GROQ_API_KEY (or --llm off). Set a key and re-run; nothing is simulated._



## 3. Summaries: TextRank vs baselines vs LLM-only

Reference: hand-written summary in `eval/data/reference_summary.txt`. LLM-only: skipped (no API key or --llm off).

| method | words | ROUGE-1 F1 | ROUGE-2 F1 | ROUGE-L F1 | note |
|---|---|---|---|---|---|
| TextRank (ours) | 118 | 0.432 | 0.164 | 0.279 |  |
| Lead-N baseline | 100 | 0.382 | 0.129 | 0.216 |  |
| Random sentences (mean of 20) | 90 | 0.315 | 0.068 | 0.165 |  |

**TextRank summary (ours):**

> Photosynthesis is defined as the process by which green plants, algae and some bacteria convert sunlight, water and carbon dioxide into glucose and oxygen. The overall equation for photosynthesis is 6CO2 + 6H2O + light energy -> C6H12O6 + 6O2. The rate of photosynthesis depends on light intensity, temperature, and carbon dioxide concentration. CELLULAR RESPIRATION Cellular respiration refers to the metabolic process that converts glucose and oxygen into ATP, water, and carbon dioxide. Producers such as plants capture solar energy by photosynthesis, and only about 1 percent of the sunlight that reaches a leaf is stored as chemical energy. The carbon cycle links photosynthesis, which removes carbon dioxide from the air, with respiration and combustion, which return it.

## Caveats

- Small hand-made set (21 answerable questions, one document, one reference summary): treat differences of a few points as noise.
- Fact recall and ROUGE are lexical proxies; they do not judge paraphrase or correctness. Read `answers_per_question.csv` too.
- ROUGE against one reference favours extractive methods that reuse the document's own wording.
