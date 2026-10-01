import test from 'node:test';
import assert from 'node:assert/strict';
import { runChatTurn } from './chat.js';
import { handlers } from './intentHandlers.js';

const DOC = { title: 'Bio Notes', chunks: [{ id: 'c0', text: 't', position: 0 }], topics: [], importanceChunks: [], analyzedAt: null };

function deps(intent, extra = {}) {
  const calls = { handler: [] };
  return {
    calls,
    routeIntent: async () => ({ intent, confidence: 0.91, method: 'rules', matchedRules: [`${intent}:x`] }),
    retrieve: async () => { throw new Error('should not be called'); },
    generate: async () => { throw new Error('should not be called'); },
    handlers: {
      ...handlers,
      question: async (c) => { calls.handler.push(['question', c]); return { answer: 'Q-ANSWER', sources: [], provider: 'groq', warnings: ['w1'] }; },
      doubt: async (c) => { calls.handler.push(['doubt', c]); return { answer: 'D-ANSWER', sources: [], provider: 'gemini' }; },
    },
    ...extra,
  };
}

test('question and doubt intents are dispatched to the document-QA handler with mode + history', async () => {
  const d = deps('question');
  const r = await runChatTurn({ doc: DOC, mode: 'exam', message: 'What is X?', history: [{ role: 'user', content: 'hi' }] }, d);
  assert.equal(r.intent, 'question');
  assert.equal(r.answer, 'Q-ANSWER');
  assert.equal(r.provider, 'groq');
  assert.equal(r.mode, 'exam');
  assert.deepEqual(r.warnings, ['w1']);
  assert.equal(d.calls.handler[0][1].mode, 'exam');
  assert.equal(d.calls.handler[0][1].history.length, 1);
  assert.equal(r.routing.method, 'rules');

  const r2 = await runChatTurn({ doc: DOC, mode: 'knowledge', message: "I don't get it" }, deps('doubt'));
  assert.equal(r2.intent, 'doubt');
  assert.equal(r2.answer, 'D-ANSWER');
});

test('quiz / practice / research / resources are dispatched to their real handlers (no stubs)', async () => {
  const calls = [];
  const d = (intent) => deps(intent, {
    services: {
      createQuestionSet: async (a) => { calls.push(['set', a.kind, a.userId, a.mode]); return { quiz: { _id: 'Q1', questions: [1, 2, 3], difficulty: 'hard', type: 'mcq' }, provider: 'gemini', warnings: [] }; },
      runResearch: async (a) => { calls.push(['research', a.query]); return { summary: 'Cited [1].', sources: [{ n: 1, title: 'T', url: 'https://x.org/a', provider: 'wikipedia' }], queries: ['q'], provider: 'groq', warnings: [] }; },
      runResources: async (a) => { calls.push(['resources', a.query]); return { queries: ['q'], youtube: [{ title: 'Vid', url: 'https://youtu.be/1', channel: 'Ch', minutes: 12 }], wikipedia: [], suggestions: { provider: 'gemini', topics: [{ title: 'ATP', why: 'core' }], books: [] }, warnings: [] }; },
    },
  });
  const run = (intent, message) => runChatTurn({ doc: DOC, mode: 'exam', message, history: [], userId: 'U1' }, d(intent));

  const quiz = await run('quiz', 'quiz me with 3 hard mcq questions');
  assert.deepEqual(calls.shift(), ['set', 'quiz', 'U1', 'exam']);
  assert.equal(quiz.payload.kind, 'quiz');
  assert.equal(quiz.payload.quizId, 'Q1');
  assert.match(quiz.answer, /3-question hard multiple-choice quiz/);

  const practice = await run('practice', 'give me practice questions');
  assert.deepEqual(calls.shift(), ['set', 'practice', 'U1', 'exam']);
  assert.equal(practice.payload.kind, 'practice');

  const research = await run('research', 'research the latest on artificial photosynthesis');
  assert.deepEqual(calls.shift(), ['research', 'artificial photosynthesis']);
  assert.match(research.answer, /Cited \[1\]\./);
  assert.match(research.answer, /\[T\]\(https:\/\/x\.org\/a\)/);
  assert.equal(research.provider, 'groq');

  const resources = await run('resources', 'find me videos to study this');
  assert.deepEqual(calls.shift(), ['resources', undefined]);
  assert.match(resources.answer, /\[Vid\]\(https:\/\/youtu\.be\/1\)/);
  assert.match(resources.answer, /AI-generated, not verified/);
  assert.equal(resources.payload.kind, 'resources');
});

test('if the router is down, the turn degrades to a question with a warning', async () => {
  const d = deps('question', { routeIntent: async () => { throw new Error('ECONNREFUSED'); } });
  const r = await runChatTurn({ doc: DOC, mode: 'knowledge', message: 'What is X?' }, d);
  assert.equal(r.intent, 'question');
  assert.equal(r.routing.method, 'fallback');
  assert.ok(r.warnings.some((w) => /routing failed/.test(w)));
});

test('unknown intents fall back to the question handler', async () => {
  const r = await runChatTurn({ doc: DOC, mode: 'knowledge', message: 'x' }, deps('mystery'));
  assert.equal(r.answer, 'Q-ANSWER');
});
