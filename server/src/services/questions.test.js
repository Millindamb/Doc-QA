import test from 'node:test';
import assert from 'node:assert/strict';
import { selectChunks, poolSize } from './questionSelect.js';
import { buildQuestionsSchema, resolveMcqAnswer } from './questionSchema.js';
import { gradeMcq, gradeShort, gradeAttempt, aggregateWeakAreas } from './grading.js';
import { parseQuizRequest } from './messageParsing.js';

// 10 chunks, 3 topics (A: c0-c3, B: c4-c6, C: c7-c9); chunk importance rises with c5 the highest
const chunks = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, text: `text ${i}`, heading: `H${i}`, position: i, tokenCount: 10 }));
const importance = [0.1, 0.9, 0.2, 0.3, 0.4, 0.95, 0.35, 0.5, 0.6, 0.15];
const doc = {
  chunks,
  importanceChunks: importance.map((score, i) => ({ chunkId: `c${i}`, score })),
  topics: [
    { id: 't0', label: 'A', chunkIds: ['c0', 'c1', 'c2', 'c3'], size: 4 },
    { id: 't1', label: 'B', chunkIds: ['c4', 'c5', 'c6'], size: 3 },
    { id: 't2', label: 'C', chunkIds: ['c7', 'c8', 'c9'], size: 3 },
  ],
};

// ------------------------------------------------------------------ chunk selection
test('poolSize grows with count but is clamped to 3..8 and the document size', () => {
  assert.equal(poolSize(1, 20), 3);
  assert.equal(poolSize(10, 20), 6);
  assert.equal(poolSize(20, 20), 8);
  assert.equal(poolSize(20, 4), 4);
});

test('exam mode: the highest-importance chunks, returned in reading order', () => {
  const sel = selectChunks(doc, { mode: 'exam', count: 5 }); // pool 4 -> c5 .95, c1 .9, c8 .6, c7 .5
  assert.deepEqual(sel.map((c) => c.id), ['c1', 'c5', 'c7', 'c8']);
  assert.deepEqual(sel.map((c) => c.label), [2, 6, 8, 9]);
});

test('knowledge mode: spreads across topics (one chunk per topic before repeating)', () => {
  const sel = selectChunks(doc, { mode: 'knowledge', count: 5 }); // pool 4
  const topics = sel.map((c) => c.topicId);
  assert.deepEqual([...new Set(topics)].sort(), ['t0', 't1', 't2']);
  // each topic's most important chunk comes first: t0->c1, t1->c5, t2->c8; then the round-robin restarts at t0 -> c3
  assert.deepEqual(sel.map((c) => c.id), ['c1', 'c3', 'c5', 'c8']);
});

test('modes really differ on the same document', () => {
  const ids = (mode) => selectChunks(doc, { mode, count: 5 }).map((c) => c.id).join();
  assert.notEqual(ids('exam'), ids('knowledge'));
});

test('without analysis both modes fall back to evenly spaced chunks; chunks carry topic labels when known', () => {
  const bare = { chunks };
  const sel = selectChunks(bare, { mode: 'exam', count: 5 });
  assert.equal(sel.length, 4);
  assert.deepEqual(sel.map((c) => c.id), ['c0', 'c2', 'c5', 'c7']);
  assert.equal(sel[0].topicLabel, 'General');
  assert.equal(selectChunks(doc, { mode: 'exam', count: 1 })[0].topicLabel, 'A');
});

// ------------------------------------------------------------------ zod schema
const S = (over = {}) => buildQuestionsSchema({ type: 'mixed', count: 3, labels: [1, 2, 3], ...over });
const mcq = (over = {}) => ({ question: 'What is photosynthesis?', options: ['A', 'B', 'C', 'D'].map((x) => `opt ${x}`), answer: 'opt B', explanation: 'because', sourceChunk: 2, ...over });
const short = (over = {}) => ({ question: 'Explain osmosis briefly.', options: [], answer: 'Diffusion of water across a membrane', explanation: 'e.g.', sourceChunk: 1, ...over });

test('schema accepts {"questions":[...]} and bare arrays, and normalises', () => {
  for (const raw of [{ questions: [mcq(), short()] }, [mcq(), short()]]) {
    const r = S().safeParse(raw);
    assert.equal(r.success, true, r.error?.message);
    assert.deepEqual(r.data.map((q) => q.type), ['mcq', 'short']);
  }
});

test('MCQ answer may be a letter, "Option C", a prefixed option or the text; always normalised to the option text', () => {
  const opts = ['red', 'green', 'blue', 'grey'];
  assert.equal(resolveMcqAnswer('C', opts), 'blue');
  assert.equal(resolveMcqAnswer('Option D', opts), 'grey');
  assert.equal(resolveMcqAnswer('b) green', opts), 'green');
  assert.equal(resolveMcqAnswer('  BLUE ', opts), 'blue');
  assert.equal(resolveMcqAnswer('purple', opts), null);
  const r = S({ type: 'mcq', count: 1 }).safeParse({ questions: [mcq({ options: ['A) x1', 'B) y2', 'C) z3', 'D) w4'], answer: 'B' })] });
  assert.equal(r.data[0].answer, 'y2');
  assert.deepEqual(r.data[0].options, ['x1', 'y2', 'z3', 'w4']);
});

test('schema rejects: wrong answer, duplicate options, mcq without options, missing fields, empty list', () => {
  const bad = [
    { questions: [mcq({ answer: 'not an option' })] },
    { questions: [mcq({ options: ['same', 'same', 'x', 'y'], answer: 'x' })] },
    { questions: [short()] }, // type mcq requires options
    { questions: [{ question: 'Is this valid?' }] },
    { questions: [] },
    'just text',
  ];
  bad.forEach((raw, i) => assert.equal(S({ type: 'mcq', count: 1 }).safeParse(raw).success, false, `case ${i}`));
});

test('short type clears options; unknown/absent sourceChunk becomes null (soft); result is trimmed to count', () => {
  const r = S({ type: 'short', count: 2 }).safeParse({ questions: [short({ options: ['x', 'y'], sourceChunk: 99 }), short({ sourceChunk: '[3]' }), short({ sourceChunk: null })] });
  assert.equal(r.success, true);
  assert.equal(r.data.length, 2);
  assert.deepEqual(r.data.map((q) => q.sourceChunk), [null, 3]);
  assert.deepEqual(r.data[0].options, []);
});

test('too few questions (< 60% of requested) is invalid so the caller retries', () => {
  assert.equal(S({ count: 10 }).safeParse({ questions: [short(), short()] }).success, false);
  assert.equal(S({ count: 3 }).safeParse({ questions: [short(), short()] }).success, true);
});

// ------------------------------------------------------------------ grading
const qm = { id: 'q1', type: 'mcq', options: ['x', 'y'], answer: 'y', topicId: 't0', topicLabel: 'A' };
const qs = { id: 'q2', type: 'short', options: [], answer: 'Chlorophyll absorbs red and blue light', topicId: 't1', topicLabel: 'B' };

test('gradeMcq accepts option text or its letter', () => {
  assert.equal(gradeMcq(qm, 'y').correct, true);
  assert.equal(gradeMcq(qm, 'B').correct, true);
  assert.equal(gradeMcq(qm, 'x').correct, false);
  assert.equal(gradeMcq(qm, '').correct, false);
});

test('gradeShort: >=60% key-term coverage correct, >=30% half credit, else 0; reports missing terms', () => {
  assert.deepEqual([gradeShort(qs, 'Chlorophyll absorbs red and blue light').correct, gradeShort(qs, 'Chlorophyll absorbs red and blue light').score], [true, 1]);
  assert.equal(gradeShort(qs, 'It absorbs light').score, 0.5);
  const none = gradeShort(qs, 'I do not know');
  assert.equal(none.score, 0);
  assert.ok(none.missing.includes('chlorophyll'));
  assert.equal(gradeShort(qs, '').score, 0);
});

test('gradeAttempt: totals, percent, per-topic breakdown (weakest first); unanswered = 0', () => {
  const quiz = { questions: [qm, qs, { ...qm, id: 'q3', topicId: 't0' }] };
  const g = gradeAttempt(quiz, [{ questionId: 'q1', response: 'y' }, { questionId: 'q2', response: 'no idea' }]);
  assert.equal(g.total, 3);
  assert.equal(g.score, 1);
  assert.equal(g.percent, 33);
  assert.deepEqual(g.perTopic.map((t) => [t.label, t.percent]), [['B', 0], ['A', 50]]);
});

test('aggregateWeakAreas pools attempts per topic, flags topics under 60%, weakest first', () => {
  const attempts = [
    { perTopic: [{ topicId: 't0', label: 'A', earned: 1, total: 2 }, { topicId: 't1', label: 'B', earned: 2, total: 2 }] },
    { perTopic: [{ topicId: 't0', label: 'A', earned: 0, total: 2 }] },
  ];
  const w = aggregateWeakAreas(attempts);
  assert.deepEqual(w.map((t) => [t.label, t.percent, t.weak]), [['A', 25, true], ['B', 100, false]]);
});

// ------------------------------------------------------------------ chat message parsing
test('parseQuizRequest reads count, difficulty and type from natural language', () => {
  assert.deepEqual(parseQuizRequest('quiz me with 8 hard multiple choice questions'), { count: 8, difficulty: 'hard', type: 'mcq' });
  assert.deepEqual(parseQuizRequest('give me ten easy short answer questions'), { count: 10, difficulty: 'easy', type: 'short' });
  assert.deepEqual(parseQuizRequest('Quiz me on this'), { count: 5, difficulty: 'medium', type: 'mixed' });
  assert.equal(parseQuizRequest('give me 500 questions').count, 20);
});
