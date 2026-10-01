# Evaluation

```bash
cd nlp-service
pip install -r eval/requirements-eval.txt        # rouge-score (also in requirements.txt)
python -m eval.run_eval                          # auto: LLM parts run only if GEMINI_API_KEY / GROQ_API_KEY are set
python -m eval.run_eval --llm off                # fully offline
python -m eval.run_eval --chunk-tokens 60 --ks 1,3,5,8 --no-cache
```

| Experiment | What is measured | Needs LLM |
|---|---|---|
| Retrieval | recall@k and MRR for BM25-only (alpha=1), embeddings-only (alpha=0), hybrid (alpha=0.4) + alpha sweep | no |
| Answers | with retrieved context vs no context: fact recall, ROUGE-L, and abstain rate on 3 out-of-document questions | yes |
| Summaries | TextRank vs Lead-N vs random sentences vs LLM-only, ROUGE-1/2/L F1 against a hand-written reference | LLM row only |

Outputs in `eval/results/`: `retrieval.csv`, `retrieval_alpha_sweep.csv`, `answers.csv`, `answers_per_question.csv`,
`summaries.csv`, `results.md` (all tables, paste-ready). LLM replies are cached in `results/llm_cache.json` so re-runs are free.

Data: `data/qa_set.json` (21 answerable + 3 unanswerable questions over `samples/biology_notes.txt`; a chunk is relevant if it
contains any gold phrase, so labels survive re-chunking) and `data/reference_summary.txt`.
To evaluate your own document, write a new QA file in the same format and pass `--qa` (and `--doc`).

Read the numbers carefully: the set is small and single-document, ROUGE favours extractive methods, and if
`sentence-transformers` is not installed "embeddings only" silently becomes a TF-IDF cosine (the report states which backend ran).
