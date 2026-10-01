import { contentStems, uniq } from './textUtil.js';
import { resolveMcqAnswer } from './questionSchema.js';

export const SHORT_CORRECT_THRESHOLD = 0.6;
export const WEAK_THRESHOLD = 0.6;

/** MCQ: response must be the correct option (exact text or its letter). */
export function gradeMcq(question, response) {
  const resolved = resolveMcqAnswer(String(response || ''), question.options);
  const correct = resolved !== null && resolved === question.answer;
  return { correct, score: correct ? 1 : 0 };
}

/**
 * Short answer (own, lexical): share of the model answer's content stems found in the response.
 * >= 60% coverage = correct (1 point); >= 30% = half credit; else 0.
 * This is a keyword-overlap heuristic - it can't judge paraphrase or reasoning; the UI shows the model
 * answer and the missing terms so the student can judge for themselves.
 */
export function gradeShort(question, response) {
  const keyTerms = uniq(contentStems(question.answer));
  const given = new Set(contentStems(response || ''));
  if (!keyTerms.length || !given.size) return { correct: false, score: 0, coverage: 0, missing: keyTerms.slice(0, 8) };
  const hit = keyTerms.filter((t) => given.has(t));
  const coverage = hit.length / keyTerms.length;
  const score = coverage >= SHORT_CORRECT_THRESHOLD ? 1 : coverage >= 0.3 ? 0.5 : 0;
  return {
    correct: coverage >= SHORT_CORRECT_THRESHOLD,
    score,
    coverage: Math.round(coverage * 100) / 100,
    missing: keyTerms.filter((t) => !given.has(t)).slice(0, 8),
  };
}

function topicKey(q) {
  return { topicId: q.topicId ?? 'general', label: q.topicLabel || 'General' };
}

export function summarizeByTopic(items) {
  const map = new Map();
  for (const it of items) {
    const { topicId, label } = it;
    const cur = map.get(topicId) || { topicId, label, earned: 0, total: 0 };
    cur.earned += it.score;
    cur.total += 1;
    map.set(topicId, cur);
  }
  return [...map.values()]
    .map((t) => ({ ...t, earned: Math.round(t.earned * 100) / 100, percent: Math.round((t.earned / t.total) * 100) }))
    .sort((a, b) => a.percent - b.percent);
}

/** Grade a submitted attempt against the stored quiz. Unanswered questions score 0. */
export function gradeAttempt(quiz, answers) {
  const byId = new Map((answers || []).map((a) => [a.questionId, String(a.response ?? '')]));
  const items = quiz.questions.map((q) => {
    const response = byId.get(q.id) ?? '';
    const g = q.type === 'mcq' ? gradeMcq(q, response) : gradeShort(q, response);
    return { questionId: q.id, response, ...g, ...topicKey(q) };
  });
  const score = Math.round(items.reduce((s, i) => s + i.score, 0) * 100) / 100;
  const total = items.length;
  return {
    items,
    score,
    total,
    percent: total ? Math.round((score / total) * 100) : 0,
    perTopic: summarizeByTopic(items),
  };
}

/** Across many attempts: per-topic accuracy, weakest first; `weak` = below 60%. */
export function aggregateWeakAreas(attempts, threshold = WEAK_THRESHOLD) {
  const map = new Map();
  for (const a of attempts) {
    for (const t of a.perTopic || []) {
      const cur = map.get(t.topicId) || { topicId: t.topicId, label: t.label, earned: 0, total: 0 };
      cur.earned += t.earned;
      cur.total += t.total;
      map.set(t.topicId, cur);
    }
  }
  return [...map.values()]
    .map((t) => {
      const ratio = t.total ? t.earned / t.total : 0;
      return { ...t, percent: Math.round(ratio * 100), weak: ratio < threshold };
    })
    .sort((a, b) => a.percent - b.percent);
}
