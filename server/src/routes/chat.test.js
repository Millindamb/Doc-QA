import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { createChatRouter } from './chat.js';

// ------------------------------------------------------------------ in-memory stand-ins for the Mongoose models
const oid = () => new mongoose.Types.ObjectId().toString();
const USER = oid();
const OTHER_USER = oid();
const DOC_ID = oid();
const OTHER_DOC_ID = oid();

const docs = [
  { _id: DOC_ID, userId: USER, title: 'Bio Notes', status: 'ready', chunks: [{ id: 'c0', text: 't', position: 0 }], importanceChunks: [], topics: [], analyzedAt: new Date() },
  { _id: OTHER_DOC_ID, userId: USER, title: 'Empty', status: 'processing', chunks: [] },
];
const sessions = [];

const Document = {
  findOne: (f) => ({
    select: () => ({ lean: async () => docs.find((d) => d._id === String(f._id) && d.userId === f.userId) || null }),
  }),
};
const ChatSession = {
  create: async (data) => {
    const s = { _id: oid(), updatedAt: new Date(), ...data, save: async () => {} };
    sessions.push(s);
    return s;
  },
  findOne: async (f) => sessions.find((s) => s._id === String(f._id) && s.userId === f.userId && String(s.documentId) === String(f.documentId ?? s.documentId)) || null,
  find: (f) => ({ sort: async () => sessions.filter((s) => s.userId === f.userId && (!f.documentId || String(s.documentId) === f.documentId)) }),
  findOneAndDelete: async (f) => {
    const i = sessions.findIndex((s) => s._id === String(f._id) && s.userId === f.userId);
    return i >= 0 ? sessions.splice(i, 1)[0] : null;
  },
};

const turns = [];
const runTurn = async (args) => {
  turns.push(args);
  return {
    answer: `echo(${args.mode}): ${args.message}`, sources: [{ label: 1, chunkId: 'c0', position: 0, heading: '', rank: 1, relevance: 0.5, finalScore: 0.5, cited: true }],
    intent: 'question', routing: { confidence: 0.9, method: 'classifier', matchedRules: [] }, provider: 'gemini', mode: args.mode,
    insufficient: false, stub: false, retrieval: { method: 'hybrid(bm25+embedding)' }, warnings: [],
  };
};

// ------------------------------------------------------------------ server + helpers
let server; let base;
const token = (sub = USER) => jwt.sign({ sub }, config.jwtSecret, { expiresIn: '1h' });

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', createChatRouter({ Document, ChatSession, runTurn }));
  app.use((err, _req, _res, next) => { if (!process.env.SHOW_ERRORS) console.error = () => {}; next(err); });
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api/chat`;
});
after(() => new Promise((r) => server.close(r)));

const post = (body, t = token()) =>
  fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(body) });

// ------------------------------------------------------------------ tests
test('401 without a token', async () => {
  assert.equal((await post({ documentId: DOC_ID, message: 'hi' }, null)).status, 401);
});

test('400 on invalid input', async () => {
  assert.equal((await post({ message: 'hi' })).status, 400); // no documentId
  assert.equal((await post({ documentId: 'nope', message: 'hi' })).status, 400);
  assert.equal((await post({ documentId: DOC_ID, message: '   ' })).status, 400);
  assert.equal((await post({ documentId: DOC_ID })).status, 400);
  assert.equal((await post({ documentId: DOC_ID, message: 'hi', mode: 'turbo' })).status, 400);
  assert.equal((await post({ documentId: DOC_ID, message: 'hi', sessionId: 'zzz' })).status, 400);
  assert.equal((await post({ documentId: DOC_ID, message: 'x'.repeat(config.chatMessageMaxChars + 1) })).status, 400);
});

test('404 for a missing document or another user\'s document; 409 when the document has no chunks', async () => {
  assert.equal((await post({ documentId: oid(), message: 'hi' })).status, 404);
  assert.equal((await post({ documentId: DOC_ID, message: 'hi' }, token(OTHER_USER))).status, 404);
  assert.equal((await post({ documentId: OTHER_DOC_ID, message: 'hi' })).status, 409);
});

test('new chat: creates a session, persists both messages, returns the documented shape', async () => {
  sessions.length = 0; turns.length = 0;
  const res = await post({ documentId: DOC_ID, message: 'What is X?', mode: 'exam' });
  assert.equal(res.status, 200);
  const body = await res.json();
  for (const key of ['sessionId', 'answer', 'sources', 'intent', 'provider', 'mode']) assert.ok(key in body, `missing ${key}`);
  assert.equal(body.mode, 'exam');
  assert.equal(body.provider, 'gemini');
  assert.equal(body.sources[0].cited, true);

  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.equal(s.messages.length, 2);
  assert.deepEqual(s.messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(s.messages[1].intent, 'question');
  assert.equal(s.messages[1].provider, 'gemini');
  assert.equal(turns[0].history.length, 0);
});

test('memory: only the last 6 messages are passed as history; mode can change per turn in one session', async () => {
  sessions.length = 0; turns.length = 0;
  const first = await (await post({ documentId: DOC_ID, message: 'q1', mode: 'knowledge' })).json();
  const sid = first.sessionId;
  for (let i = 2; i <= 5; i += 1) await post({ documentId: DOC_ID, sessionId: sid, message: `q${i}` });

  // 5 turns done -> 10 messages stored; the 6th call must see exactly the last 6 of them
  const res = await post({ documentId: DOC_ID, sessionId: sid, message: 'q6', mode: 'exam' });
  const body = await res.json();
  assert.equal(body.sessionId, sid);
  assert.equal(body.mode, 'exam');
  const last = turns.at(-1);
  assert.equal(last.history.length, 6);
  assert.equal(last.history.at(-1).content, 'echo(knowledge): q5');
  assert.equal(last.history[0].content, 'q3'); // oldest of the 6: q3, e3, q4, e4, q5, e5
  assert.equal(sessions[0].messages.length, 12);
  assert.equal(sessions[0].mode, 'exam');
});

test('a session is reused with its stored mode when the request omits mode', async () => {
  sessions.length = 0; turns.length = 0;
  const { sessionId } = await (await post({ documentId: DOC_ID, message: 'a', mode: 'exam' })).json();
  const body = await (await post({ documentId: DOC_ID, sessionId, message: 'b' })).json();
  assert.equal(body.mode, 'exam');
});

test('a session id that does not belong to the user/document is a 404', async () => {
  sessions.length = 0;
  const { sessionId } = await (await post({ documentId: DOC_ID, message: 'a' })).json();
  assert.equal((await post({ documentId: DOC_ID, sessionId: oid(), message: 'b' })).status, 404);
  assert.equal((await post({ documentId: DOC_ID, sessionId, message: 'b' }, token(OTHER_USER))).status, 404);
});

test('LLM/NLP failure is returned as an error and nothing is persisted', async () => {
  sessions.length = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/chat', createChatRouter({ Document, ChatSession, runTurn: async () => { const e = new Error('Both LLM providers failed'); e.status = 502; throw e; } }));
  app.use(errorHandler);
  const s = http.createServer(app);
  await new Promise((r) => s.listen(0, r));
  const orig = console.error; console.error = () => {};
  const res = await fetch(`http://127.0.0.1:${s.address().port}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ documentId: DOC_ID, message: 'hi' }),
  });
  console.error = orig;
  assert.equal(res.status, 502);
  assert.equal(sessions.length, 0);
  await new Promise((r) => s.close(r));
});

test('list / get / delete sessions', async () => {
  sessions.length = 0;
  const { sessionId } = await (await post({ documentId: DOC_ID, message: 'a' })).json();
  const h = { Authorization: `Bearer ${token()}` };

  const list = await (await fetch(`${base}/sessions?documentId=${DOC_ID}`, { headers: h })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].messageCount, 2);

  const one = await (await fetch(`${base}/sessions/${sessionId}`, { headers: h })).json();
  assert.equal(one.messages.length, 2);

  assert.equal((await fetch(`${base}/sessions/${sessionId}`, { method: 'DELETE', headers: h })).status, 204);
  assert.equal((await fetch(`${base}/sessions/${sessionId}`, { headers: h })).status, 404);
});
