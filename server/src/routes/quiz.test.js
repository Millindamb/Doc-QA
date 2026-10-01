import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { createQuizRouter, createPracticeRouter } from './quiz.js';
import { createResearchRouter, createResourcesRouter } from './study.js';
import { createQuestionSet } from '../services/quizService.js';

const oid = () => new mongoose.Types.ObjectId().toString();
const USER = oid();
const OTHER = oid();
const DOC = oid();

const chunks = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, text: `chunk text number ${i}`, heading: '', position: i, tokenCount: 10 }));
const docs = [
  {
    _id: DOC, userId: USER, title: 'Bio', status: 'ready', chunks, analyzedAt: new Date(), keywords: [{ term: 'atp', score: 1 }],
    topics: [{ id: 't0', label: 'Energy', chunkIds: ['c0', 'c1', 'c2'], size: 3 }, { id: 't1', label: 'Membranes', chunkIds: ['c3', 'c4', 'c5'], size: 3 }],
    importanceChunks: chunks.map((c, i) => ({ chunkId: c.id, score: i / 10 })),
  },
];

// ---- in-memory models
const store = { quizzes: [], attempts: [] };
const wrap = (o) => ({ ...o, toObject: () => o });
const Document = { findOne: (f) => ({ select: () => ({ lean: async () => docs.find((d) => d._id === String(f._id) && d.userId === f.userId) || null }) }) };
const Quiz = {
  create: async (d) => { const q = wrap({ _id: oid(), createdAt: new Date(), ...d }); store.quizzes.push(q); return q; },
  findOne: async (f) => store.quizzes.find((q) => q._id === String(f._id) && q.userId === f.userId) || null,
  find: (f) => ({ sort: async () => store.quizzes.filter((q) => q.userId === f.userId && (!f.documentId || String(q.documentId) === f.documentId)) }),
};
const QuizAttempt = {
  create: async (d) => { const a = { _id: oid(), createdAt: new Date(), ...d }; store.attempts.push(a); return a; },
  find: (f) => ({ sort: async () => store.attempts.filter((a) => a.userId === f.userId && (!f.documentId || String(a.documentId) === String(f.documentId)) && (!f.quizId || String(a.quizId) === String(f.quizId))) }),
};

// ---- fake LLM that returns a valid question list for whatever chunk labels appear in the prompt
const fakeGenerate = async (prompt, opts) => {
  const labels = [...prompt.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
  const count = Number(prompt.match(/exactly (\d+)/)[1]);
  const isPractice = /PRACTICE/.test(prompt);
  const questions = Array.from({ length: count }, (_, i) => {
    const label = labels[i % labels.length];
    return i % 2 === 0 && !isPractice
      ? { question: `Which statement about item ${i} is true?`, options: ['alpha one', 'beta two', 'gamma three', 'delta four'], answer: 'beta two', explanation: `see chunk ${label}`, sourceChunk: label }
      : { question: `Explain concept ${i} in a sentence.`, options: [], answer: 'ATP stores usable chemical energy', explanation: 'key terms: ATP, energy', sourceChunk: label };
  });
  return { json: { questions }, provider: opts.provider || 'gemini' };
};
const createSet = (args) => createQuestionSet(args, { generate: fakeGenerate, Quiz });

let server; let base;
const token = (sub = USER) => jwt.sign({ sub }, config.jwtSecret, { expiresIn: '1h' });
const calls = { research: [], resources: [] };

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/quiz', createQuizRouter({ Document, Quiz, QuizAttempt, createSet }));
  app.use('/api/practice', createPracticeRouter({ Document, Quiz, QuizAttempt, createSet }));
  app.use('/api/research', createResearchRouter({ Document, run: async (a) => { calls.research.push(a); return { summary: 'ok [1]', sources: [] }; } }));
  app.use('/api/resources', createResourcesRouter({ Document, run: async (a) => { calls.resources.push(a); return { youtube: [] }; } }));
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => new Promise((r) => server.close(r)));

const call = (path, { method = 'POST', body, t = token() } = {}) =>
  fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

test('auth is required on all Part 4 routes', async () => {
  for (const p of ['/quiz', '/practice', '/research', '/resources']) assert.equal((await call(p, { body: {}, t: null })).status, 401, p);
});

test('POST /quiz validates input', async () => {
  assert.equal((await call('/quiz', { body: {} })).status, 400);
  assert.equal((await call('/quiz', { body: { documentId: oid() } })).status, 404);
  assert.equal((await call('/quiz', { body: { documentId: DOC }, t: token(OTHER) })).status, 404);
  for (const bad of [{ count: 0 }, { count: 99 }, { count: 'x' }, { difficulty: 'brutal' }, { type: 'essay' }, { mode: 'turbo' }]) {
    assert.equal((await call('/quiz', { body: { documentId: DOC, ...bad } })).status, 400, JSON.stringify(bad));
  }
});

test('POST /quiz creates a quiz and HIDES answers/explanations from the client', async () => {
  store.quizzes.length = 0;
  const res = await call('/quiz', { body: { documentId: DOC, count: 4, difficulty: 'hard', type: 'mixed', mode: 'exam' } });
  assert.equal(res.status, 201);
  const q = await res.json();
  assert.deepEqual([q.kind, q.mode, q.difficulty, q.count], ['quiz', 'exam', 'hard', 4]);
  assert.deepEqual(q.questions.map((x) => x.type), ['mcq', 'short', 'mcq', 'short']);
  assert.ok(q.questions.every((x) => !('answer' in x) && !('explanation' in x)));
  assert.ok(q.questions.every((x) => x.sourceChunk >= 1 && x.topicLabel));
  assert.equal(store.quizzes.length, 1);
  // exam mode -> questions come from the highest-importance chunks (c5, c4, ...) => label 6 must appear
  assert.ok(store.quizzes[0].chunkIds.includes('c5'));
});

test('POST /practice returns model answers up front; practice sets cannot be graded', async () => {
  const res = await call('/practice', { body: { documentId: DOC, count: 3 } });
  assert.equal(res.status, 201);
  const p = await res.json();
  assert.equal(p.kind, 'practice');
  assert.ok(p.questions.every((x) => x.answer && x.explanation));
  assert.equal((await call(`/quiz/${p.id}/attempts`, { body: { answers: [] } })).status, 409);
});

test('attempt flow: grade, store score, per-topic weak areas, reveal answers + explanations', async () => {
  store.quizzes.length = 0; store.attempts.length = 0;
  const quiz = await (await call('/quiz', { body: { documentId: DOC, count: 4, type: 'mixed', mode: 'knowledge' } })).json();
  const stored = store.quizzes[0];
  // answer the MCQs correctly, and the short answers wrongly
  const answers = quiz.questions.map((q) => ({ questionId: q.id, response: q.type === 'mcq' ? 'beta two' : 'I do not know' }));
  const res = await call(`/quiz/${quiz.id}/attempts`, { body: { answers } });
  assert.equal(res.status, 201);
  const r = await res.json();
  assert.deepEqual([r.score, r.total, r.percent], [2, 4, 50]);
  assert.ok(r.results.every((x) => x.answer && x.explanation));
  assert.ok(r.perTopic.length >= 1 && r.perTopic.every((t) => typeof t.percent === 'number'));
  assert.equal(store.attempts.length, 1);
  assert.equal(store.attempts[0].score, 2);

  const weak = await (await call(`/quiz/weak-areas?documentId=${DOC}`, { method: 'GET' })).json();
  assert.equal(weak.attempts, 1);
  assert.ok(weak.topics.length >= 1);
  assert.deepEqual(weak.topics.map((t) => t.percent), [...weak.topics.map((t) => t.percent)].sort((a, b) => a - b));
  assert.ok(stored.questions.length === 4);

  const list = await (await call(`/quiz/${quiz.id}/attempts`, { method: 'GET' })).json();
  assert.equal(list.length, 1);
  assert.equal((await call(`/quiz/${quiz.id}`, { method: 'GET' })).status, 200);
  assert.equal((await call(`/quiz/${quiz.id}`, { method: 'GET', t: token(OTHER) })).status, 404);
});

test('attempt input validation', async () => {
  const quiz = await (await call('/quiz', { body: { documentId: DOC, count: 3 } })).json();
  assert.equal((await call(`/quiz/${quiz.id}/attempts`, { body: { answers: 'nope' } })).status, 400);
  assert.equal((await call(`/quiz/${quiz.id}/attempts`, { body: { answers: [{ response: 'x' }] } })).status, 400);
  assert.equal((await call(`/quiz/${oid()}/attempts`, { body: { answers: [] } })).status, 404);
  assert.equal((await call('/quiz/weak-areas', { method: 'GET' })).status, 400);
});

test('research / resources: query validation, ownership, and analyze-first rule', async () => {
  assert.equal((await call('/research', { body: { documentId: DOC, query: 5 } })).status, 400);
  assert.equal((await call('/research', { body: { documentId: DOC, query: 'x'.repeat(301) } })).status, 400);
  assert.equal((await call('/research', { body: { documentId: DOC }, t: token(OTHER) })).status, 404);
  const ok = await call('/research', { body: { documentId: DOC, query: '  artificial photosynthesis ' } });
  assert.equal(ok.status, 200);
  assert.equal(calls.research.at(-1).query, 'artificial photosynthesis');
  assert.equal((await call('/resources', { body: { documentId: DOC } })).status, 200);
  assert.equal(calls.resources.at(-1).query, undefined);
});
