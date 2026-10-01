"""Evaluation for the project report. Run from the nlp-service directory:

    python -m eval.run_eval                      # retrieval + summaries offline; LLM parts run if API keys exist
    python -m eval.run_eval --llm off            # never call an LLM
    python -m eval.run_eval --chunk-tokens 60 --ks 1,3,5,8

Experiments
  1. Retrieval: BM25-only vs embeddings-only vs hybrid (alpha sweep), recall@k + MRR on eval/data/qa_set.json.
  2. Answers WITH retrieval vs WITHOUT retrieval (needs an LLM): fact recall, ROUGE-L, and how often the model
     admits an unanswerable question cannot be answered from the document.
  3. Summaries: our TextRank vs Lead-N vs random sentences vs an LLM-only summary (ROUGE-1/2/L F1).

Outputs (eval/results/): retrieval.csv, retrieval_alpha_sweep.csv, answers.csv, answers_per_question.csv,
summaries.csv and results.md (all tables, ready to paste into the report).
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from app.config import SERVICE_ROOT, settings
from app.models.schemas import ChunkIn
from app.services.analyze import analyze_chunks
from app.services.chunking import chunk_document, split_sentences
from app.services.cleaning import clean_pages
from app.services.embeddings import embed_chunks, embed_query
from app.services.headings import detect_headings
from app.services.retrieval import retrieve
from eval.llm_client import LlmClient
from eval.metrics import abstained, fact_recall, markdown_table, mean, recall_at_k, reciprocal_rank, relevant_flags

EVAL_DIR = Path(__file__).parent
DEFAULT_QA = EVAL_DIR / "data" / "qa_set.json"
REFERENCE_SUMMARY = EVAL_DIR / "data" / "reference_summary.txt"
GROUNDING_PROMPT = SERVICE_ROOT.parent / "server" / "prompts" / "system_grounding.txt"
FALLBACK_SYSTEM = (
    "You answer questions about ONE document using only the numbered excerpts. Cite chunk numbers like [2]. "
    "If the excerpts do not contain the answer, begin with [[INSUFFICIENT_CONTEXT]] and say what is missing."
)


@dataclass
class EvalChunk:
    id: str
    text: str
    position: int
    heading: str = ""
    token_count: int = 0
    embedding: list[float] | None = field(default=None, repr=False)


def write_csv(path: Path, headers: list[str], rows: list[list[object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(headers)
        w.writerows([[round(v, 4) if isinstance(v, float) else v for v in r] for r in rows])


def build_chunks(text: str, chunk_tokens: int, overlap: int) -> tuple[str, list[EvalChunk], str]:
    cleaned = clean_pages([text])
    headings = detect_headings(cleaned)
    raw = chunk_document(cleaned, headings, target_tokens=chunk_tokens, overlap_tokens=overlap)
    chunks = [EvalChunk(c.id, c.text, c.position, c.heading, c.token_count) for c in raw]
    matrix, model = embed_chunks([c.text for c in chunks])
    for c, vec in zip(chunks, matrix):
        c.embedding = vec.tolist()
    return cleaned, chunks, model


# --------------------------------------------------------------------------- 1. retrieval
def eval_retrieval(chunks: list[EvalChunk], model: str, questions: list[dict], ks: list[int], alphas: list[float]):
    answerable = [q for q in questions if q.get("answerable", True)]
    texts = [c.text for c in chunks]
    warnings: list[str] = []
    labeled = []
    for q in answerable:
        gold = relevant_flags(texts, q["relevant_phrases"])
        if not any(gold):
            warnings.append(f"{q['id']}: no chunk contains a gold phrase (label/chunking mismatch); excluded")
            continue
        labeled.append((q, {c.id for c, g in zip(chunks, gold) if g}))

    def score(alpha: float):
        per_k = {k: [] for k in ks}
        rr: list[float] = []
        backend = ""
        for q, gold_ids in labeled:
            out = retrieve(q["question"], chunks, mode="knowledge", top_k=max(ks), alpha=alpha, embedding_model=model, embedder=embed_query)
            backend = out["meta"]["retrieval_method"]
            flags = [c["id"] in gold_ids for c in out["chunks"]]
            for k in ks:
                per_k[k].append(recall_at_k(flags, k))
            rr.append(reciprocal_rank(flags))
        return {"recall": {k: mean(v) for k, v in per_k.items()}, "mrr": mean(rr), "backend": backend}

    named = [("BM25 only", 1.0), ("Embeddings only", 0.0), (f"Hybrid (alpha={settings.retrieval_alpha})", settings.retrieval_alpha)]
    main = [(name, a, score(a)) for name, a in named]
    sweep = [(a, score(a)) for a in alphas]
    return main, sweep, len(labeled), warnings


# --------------------------------------------------------------------------- 2. answers with / without retrieval
def eval_answers(chunks: list[EvalChunk], model: str, questions: list[dict], llm: LlmClient, sleep: float):
    from rouge_score import rouge_scorer

    scorer = rouge_scorer.RougeScorer(["rougeL"], use_stemmer=True)
    system = GROUNDING_PROMPT.read_text() if GROUNDING_PROMPT.exists() else FALLBACK_SYSTEM
    rows: list[dict] = []

    for q in questions:
        out = retrieve(q["question"], chunks, mode="knowledge", top_k=5, embedding_model=model, embedder=embed_query)
        context = "\n\n".join(f"[{c['position'] + 1}]\n{c['text']}" for c in out["chunks"]) or "(no excerpts retrieved)"
        with_prompt = f"EXCERPTS:\n{context}\n\nSTUDENT QUESTION:\n{q['question']}\n\nAnswer concisely (1-3 sentences) and cite chunk numbers."
        without_prompt = (
            "A student asks this question about their uploaded study document, which you cannot see. "
            f"Answer concisely (1-3 sentences).\n\nQUESTION: {q['question']}"
        )
        for variant, prompt, sys_prompt in (("with_retrieval", with_prompt, system), ("no_retrieval", without_prompt, None)):
            try:
                text, provider = llm.generate(prompt, sys_prompt)
            except RuntimeError as exc:
                text, provider = f"[LLM ERROR: {exc}]", "error"
            time.sleep(sleep)
            answerable = q.get("answerable", True)
            rows.append({
                "id": q["id"], "variant": variant, "answerable": answerable, "provider": provider,
                "fact_recall": fact_recall(text, q["facts"]) if answerable else None,
                "rougeL": scorer.score(q["reference_answer"], text)["rougeL"].fmeasure if answerable else None,
                "abstained": abstained(text), "answer": text.replace("\n", " ")[:600],
            })
    summary = []
    for variant in ("with_retrieval", "no_retrieval"):
        ans = [r for r in rows if r["variant"] == variant and r["answerable"] and r["provider"] != "error"]
        una = [r for r in rows if r["variant"] == variant and not r["answerable"] and r["provider"] != "error"]
        summary.append([
            variant, len(ans), mean(r["fact_recall"] for r in ans), mean(r["rougeL"] for r in ans),
            len(una), mean(1.0 if r["abstained"] else 0.0 for r in una),
        ])
    return rows, summary


# --------------------------------------------------------------------------- 3. summaries
def eval_summaries(cleaned: str, llm: LlmClient | None, n_sentences: int, seed: int):
    from rouge_score import rouge_scorer

    reference = REFERENCE_SUMMARY.read_text().strip()
    scorer = rouge_scorer.RougeScorer(["rouge1", "rouge2", "rougeL"], use_stemmer=True)
    headings = detect_headings(cleaned)
    raw = chunk_document(cleaned, headings, target_tokens=settings.chunk_target_tokens, overlap_tokens=settings.chunk_overlap_tokens)
    analysis = analyze_chunks([ChunkIn(id=c.id, text=c.text, heading=c.heading, position=c.position, token_count=c.token_count) for c in raw], top_n_summary=n_sentences)
    textrank = " ".join(s["text"] for s in analysis["summary_sentences"])

    body = [s for s in split_sentences(re.sub(r"\n+", " ", cleaned)) if len(s.split()) >= 5]
    lead = " ".join(body[:n_sentences])

    rng = random.Random(seed)
    def random_summary() -> str:
        idx = sorted(rng.sample(range(len(body)), min(n_sentences, len(body))))
        return " ".join(body[i] for i in idx)

    def rouge(candidate: str) -> dict[str, float]:
        s = scorer.score(reference, candidate)
        return {k: v.fmeasure for k, v in s.items()}

    rows = []
    add = lambda name, text, extra="": rows.append([name, len(text.split()), *[rouge(text)[k] for k in ("rouge1", "rouge2", "rougeL")], extra])  # noqa: E731
    add("TextRank (ours)", textrank)
    add("Lead-N baseline", lead)
    rand_scores = [rouge(random_summary()) for _ in range(20)]
    rows.append(["Random sentences (mean of 20)", int(mean(len(random_summary().split()) for _ in range(5))),
                 *[mean(r[k] for r in rand_scores) for k in ("rouge1", "rouge2", "rougeL")], ""])

    llm_note = "skipped (no API key or --llm off)"
    if llm is not None:
        target = max(30, len(textrank.split()))
        try:
            text, provider = llm.generate(f"Summarize the following document in about {target} words. Plain prose, no bullet points.\n\nDOCUMENT:\n{cleaned}")
            add("LLM-only", text, provider)
            llm_note = f"answered by {provider}"
        except RuntimeError as exc:
            llm_note = f"failed: {exc}"
    return rows, textrank, llm_note


# --------------------------------------------------------------------------- report
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--qa", default=str(DEFAULT_QA))
    ap.add_argument("--doc", default=None, help="document text file (default: the one named in the QA set)")
    ap.add_argument("--chunk-tokens", type=int, default=90, help="smaller than production (300) so the sample yields ~20 chunks")
    ap.add_argument("--overlap", type=int, default=15)
    ap.add_argument("--ks", default="1,3,5")
    ap.add_argument("--n-summary", type=int, default=5)
    ap.add_argument("--llm", choices=["auto", "on", "off"], default="auto")
    ap.add_argument("--no-cache", action="store_true", help="ignore/skip the on-disk LLM response cache")
    ap.add_argument("--sleep", type=float, default=0.5, help="seconds between LLM calls (free-tier rate limits)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=str(EVAL_DIR / "results"))
    args = ap.parse_args()

    qa = json.loads(Path(args.qa).read_text())
    doc_path = Path(args.doc) if args.doc else (Path(args.qa).parent / qa["document"]).resolve()
    text = doc_path.read_text(encoding="utf-8")
    ks = [int(k) for k in args.ks.split(",")]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    llm = None if args.llm == "off" else LlmClient(use_cache=not args.no_cache)
    if llm is not None and not llm.available():
        if args.llm == "on":
            raise SystemExit("--llm on but neither GEMINI_API_KEY nor GROQ_API_KEY is set")
        llm = None

    cleaned, chunks, model = build_chunks(text, args.chunk_tokens, args.overlap)
    print(f"document: {doc_path.name}  chunks={len(chunks)} (target {args.chunk_tokens} tokens)  embeddings={model}")

    # 1. retrieval
    main_rows, sweep, n_q, warns = eval_retrieval(chunks, model, qa["questions"], ks, [0.0, 0.2, 0.4, 0.6, 0.8, 1.0])
    hdr = ["method", "alpha", "questions", *[f"recall@{k}" for k in ks], "MRR"]
    ret_rows = [[n, a, n_q, *[r["recall"][k] for k in ks], r["mrr"]] for n, a, r in main_rows]
    write_csv(out / "retrieval.csv", hdr, ret_rows)
    write_csv(out / "retrieval_alpha_sweep.csv", ["alpha", *[f"recall@{k}" for k in ks], "MRR"], [[a, *[r["recall"][k] for k in ks], r["mrr"]] for a, r in sweep])
    backend = main_rows[0][2]["backend"]

    # 2. answers
    answers_md = "_Skipped: no GEMINI_API_KEY / GROQ_API_KEY (or --llm off). Set a key and re-run; nothing is simulated._"
    providers = {}
    if llm is not None:
        rows, summ = eval_answers(chunks, model, qa["questions"], llm, args.sleep)
        write_csv(out / "answers_per_question.csv", ["id", "variant", "answerable", "provider", "fact_recall", "rougeL", "abstained", "answer"], [[r[k] for k in ("id", "variant", "answerable", "provider", "fact_recall", "rougeL", "abstained", "answer")] for r in rows])
        ah = ["variant", "answerable_qs", "fact_recall", "ROUGE-L", "unanswerable_qs", "abstain_rate_on_unanswerable"]
        write_csv(out / "answers.csv", ah, summ)
        answers_md = markdown_table(ah, summ)
        providers = dict(llm.providers_used)

    # 3. summaries
    srows, textrank_text, llm_note = eval_summaries(cleaned, llm, args.n_summary, args.seed)
    sh = ["method", "words", "ROUGE-1 F1", "ROUGE-2 F1", "ROUGE-L F1", "note"]
    write_csv(out / "summaries.csv", sh, srows)

    # report
    md = [
        "# Evaluation results", "",
        f"*Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC.* Document: `{doc_path.name}`, "
        f"{len(chunks)} chunks (~{args.chunk_tokens} tokens, overlap {args.overlap}), {n_q} answerable questions.", "",
        f"**Dense backend used for the embedding side of retrieval:** `{backend}` "
        f"(stored vectors: `{model}`)." + (" This run used the TF-IDF *fallback* because sentence-transformers was unavailable, so "
        "'Embeddings only' here is a lexical TF-IDF cosine, NOT a neural embedding. Re-run with `sentence-transformers` installed "
        "for the real comparison." if model == "tfidf-fallback" else ""), "",
        "## 1. Retrieval: BM25 vs embeddings vs hybrid", "", markdown_table(hdr, ret_rows), "",
        "Alpha sweep (alpha = weight of normalised BM25; 1.0 = BM25 only, 0.0 = embeddings only):", "",
        markdown_table(["alpha", *[f"recall@{k}" for k in ks], "MRR"], [[a, *[r["recall"][k] for k in ks], r["mrr"]] for a, r in sweep]), "",
    ]
    if warns:
        md += ["Label warnings:", *[f"- {w}" for w in warns], ""]
    md += [
        "## 2. Answers with vs without retrieval", "",
        "fact_recall = share of gold facts present in the answer; ROUGE-L vs a reference answer; abstain rate = how often the model "
        "said the document cannot answer an out-of-document question (higher is better; the no-retrieval baseline has no document to abstain from).", "",
        answers_md, "", (f"LLM providers used: {providers}" if providers else ""), "",
        "## 3. Summaries: TextRank vs baselines vs LLM-only", "",
        "Reference: hand-written summary in `eval/data/reference_summary.txt`. LLM-only: " + llm_note + ".", "",
        markdown_table(sh, srows), "",
        "**TextRank summary (ours):**", "", f"> {textrank_text}", "",
        "## Caveats", "",
        f"- Small hand-made set ({n_q} answerable questions, one document, one reference summary): treat differences of a few points as noise.",
        "- Fact recall and ROUGE are lexical proxies; they do not judge paraphrase or correctness. Read `answers_per_question.csv` too.",
        "- ROUGE against one reference favours extractive methods that reuse the document's own wording.",
    ]
    (out / "results.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"\nwrote {out}/results.md, retrieval.csv, retrieval_alpha_sweep.csv, summaries.csv" + (", answers*.csv" if llm else ""))
    print("\n" + markdown_table(hdr, ret_rows))


if __name__ == "__main__":
    main()
