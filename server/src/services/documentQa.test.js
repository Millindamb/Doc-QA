import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSUFFICIENT_MARKER, answerFromDocument, buildRetrievalQuery, contentWordCount, extractCitations,
  formatContext, formatHistory, isFollowUp, toSources,
} from './documentQa.js';

// ------------------------------------------------------------------ fixtures
const chunk = (position, text = `Sample text of chunk ${position}.`, extra = {}) => ({
  id: `c${position}`, text, heading: position < 2 ? 'INTRODUCTION' : 'RESPIRATION', position, token_count: 20,
  rank: position + 1, bm25_score: 1, cosine: 0.5, relevance: 0.6, importance: null, final_score: 0.6, ...extra,
});

const DOC = {
  title: 'Bio Notes',
  analyzedAt: new Date(),
  embeddingModel: 'all-MiniLM-L6-v2',
  topics: [{ label: 'Photosynthesis' }, { label: 'Respiration' }],
  importanceChunks: [{ chunkId: 'c0', score: 0.9 }, { chunkId: 'c2', score: 0.4 }],
  chunks: [
    { id: 'c0', text: 'Photosynthesis is defined as the process...', heading: 'INTRODUCTION', position: 0, tokenCount: 20, embedding: [0.1, 0.2] },
    { id: 'c2', text: 'Cellular respiration refers to...', heading: 'RESPIRATION', position: 2, tokenCount: 20, embedding: [0.2, 0.1] },
  ],
};

/** fake retrieve that behaves differently per mode, like the real service */
function makeDeps({ llmText = 'Answer [1].', sufficient = true, chunks, llmError } = {}) {
  const calls = { retrieve: [], generate: [] };
  return {
    calls,
    retrieve: async (args) => {
      calls.retrieve.push(args);
      const list = chunks ?? (args.mode === 'exam' ? [chunk(0), chunk(2)] : [chunk(0), chunk(1), chunk(2)]);
      return {
        chunks: list, retrieval_method: 'hybrid(bm25+embedding)', embedding_model: 'all-MiniLM-L6-v2', alpha: 0.4,
        top_k: args.mode === 'exam' ? 5 : 8, reranked_by_importance: args.mode === 'exam', sufficient,
        max_cosine: 0.5, query_term_coverage: 0.7, warnings: [],
      };
    },
    generate: async (prompt, opts) => {
      calls.generate.push({ prompt, opts });
      if (llmError) throw llmError;
      return { text: llmText, provider: 'gemini' };
    },
  };
}
const ctx = (over = {}) => ({ intent: 'question', mode: 'knowledge', doc: DOC, message: 'What is photosynthesis?', history: [], routing: {}, ...over });

// ------------------------------------------------------------------ follow-up detection / retrieval query
test('contentWordCount ignores doubt/filler vocabulary', () => {
  assert.equal(contentWordCount("I still don't get it"), 0);
  assert.equal(contentWordCount('What about limitations?'), 1);
  assert.equal(contentWordCount('How does the Calvin cycle work?'), 3);
});

test('isFollowUp: bare doubts and pronoun questions are follow-ups; self-contained questions are not', () => {
  assert.equal(isFollowUp("I don't understand"), true);
  assert.equal(isFollowUp('Can you explain that again?'), true);
  assert.equal(isFollowUp('why?'), true);
  assert.equal(isFollowUp('What about limitations?'), true);
  assert.equal(isFollowUp('How is it produced?'), true);
  assert.equal(isFollowUp('What is ATP?'), false);
  assert.equal(isFollowUp("I don't understand the Calvin cycle"), false);
  assert.equal(isFollowUp('Explain how osmosis moves water across a membrane'), false);
});

test('buildRetrievalQuery borrows the previous user question only for follow-ups', () => {
  const history = [
    { role: 'user', content: 'What is photosynthesis?' },
    { role: 'assistant', content: 'It converts light...' },
  ];
  assert.equal(buildRetrievalQuery("I don't understand", history), "What is photosynthesis? I don't understand");
  assert.equal(buildRetrievalQuery('What is ATP?', history), 'What is ATP?');
  assert.equal(buildRetrievalQuery("I don't understand", []), "I don't understand");
});

// ------------------------------------------------------------------ prompt pieces
test('formatHistory keeps only the last 6 messages and truncates long ones', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `msg${i} ${'x'.repeat(40)}` }));
  const out = formatHistory(history, { maxMessages: 6, maxChars: 20 });
  assert.equal(out.split('\n').length, 6);
  assert.match(out, /msg4/);
  assert.doesNotMatch(out, /msg3/);
  assert.match(out, /\.\.\.$/m);
  assert.equal(formatHistory([]), '(no previous messages)');
});

test('formatContext labels chunks 1-based by position and includes the section heading', () => {
  const out = formatContext([chunk(0, 'Alpha'), chunk(2, 'Beta')]);
  assert.match(out, /^\[1\] \(Section: INTRODUCTION\)\nAlpha/);
  assert.match(out, /\[3\] \(Section: RESPIRATION\)\nBeta/);
});

test('extractCitations handles [1], [2][5] and [2, 5]', () => {
  assert.deepEqual([...extractCitations('A [1]. B [2][5]. C [3, 4]. D [x] [12]')].sort((a, b) => a - b), [1, 2, 3, 4, 5, 12]);
});

test('toSources flags which retrieved chunks were actually cited', () => {
  const s = toSources([chunk(0, 'a'), chunk(2, 'b')], new Set([1]));
  assert.deepEqual(s.map((x) => [x.label, x.chunkId, x.cited]), [[1, 'c0', true], [3, 'c2', false]]);
});

// ------------------------------------------------------------------ answerFromDocument: the two modes on the same question
test('same question: knowledge vs exam use different retrieval settings AND different prompts', async () => {
  const dk = makeDeps();
  const de = makeDeps();
  const knowledge = await answerFromDocument(ctx({ mode: 'knowledge' }), dk);
  const exam = await answerFromDocument(ctx({ mode: 'exam' }), de);

  assert.equal(dk.calls.retrieve[0].mode, 'knowledge');
  assert.equal(de.calls.retrieve[0].mode, 'exam');
  assert.equal(knowledge.retrieval.topK, 8);
  assert.equal(exam.retrieval.topK, 5);
  assert.equal(exam.retrieval.rerankedByImportance, true);
  assert.equal(knowledge.retrieval.rerankedByImportance, false);

  const kp = dk.calls.generate[0].prompt;
  const ep = de.calls.generate[0].prompt;
  assert.match(kp, /MODE: KNOWLEDGE/);
  assert.match(ep, /MODE: EXAM/);
  assert.match(ep, /\*\*Definitions\*\*/);
  assert.doesNotMatch(kp, /\*\*Definitions\*\*/);
  assert.notEqual(kp, ep);
  assert.ok(knowledge.sources.length > exam.sources.length);
});

test('importance scores and embedding model are forwarded to retrieval', async () => {
  const d = makeDeps();
  await answerFromDocument(ctx({ mode: 'exam' }), d);
  assert.deepEqual(d.calls.retrieve[0].importance, { c0: 0.9, c2: 0.4 });
  assert.equal(d.calls.retrieve[0].embeddingModel, 'all-MiniLM-L6-v2');
});

test('doubt intent uses the doubt template in either mode', async () => {
  for (const mode of ['knowledge', 'exam']) {
    const d = makeDeps();
    await answerFromDocument(ctx({ intent: 'doubt', mode, message: "I don't understand osmosis" }), d);
    assert.match(d.calls.generate[0].prompt, /MODE: DOUBT/);
    assert.equal(d.calls.retrieve[0].mode, mode);
  }
});

test('the system prompt (grounding rules) is always sent to the LLM', async () => {
  const d = makeDeps();
  await answerFromDocument(ctx(), d);
  assert.match(d.calls.generate[0].opts.system, /GROUNDING RULES/);
});

test('history is included in the prompt and the follow-up borrows the last question for retrieval', async () => {
  const d = makeDeps();
  const history = [
    { role: 'user', content: 'What is photosynthesis?' },
    { role: 'assistant', content: 'It converts light into chemical energy [1].' },
  ];
  await answerFromDocument(ctx({ intent: 'doubt', message: "I don't understand", history }), d);
  assert.equal(d.calls.retrieve[0].query, "What is photosynthesis? I don't understand");
  assert.match(d.calls.generate[0].prompt, /Student: What is photosynthesis\?/);
  assert.match(d.calls.generate[0].prompt, /Assistant: It converts light/);
});

test('cited chunks are marked in sources; provider is passed through', async () => {
  const r = await answerFromDocument(ctx(), makeDeps({ llmText: 'Photosynthesis makes sugar [1][3].' }));
  assert.equal(r.provider, 'gemini');
  assert.deepEqual(r.sources.filter((s) => s.cited).map((s) => s.label), [1, 3]);
  assert.equal(r.insufficient, false);
});

// ------------------------------------------------------------------ grounding / insufficient context
test('insufficient-context marker: stripped, flagged, and research is offered', async () => {
  const r = await answerFromDocument(
    ctx({ message: 'Who won the 2018 world cup?' }),
    makeDeps({ llmText: `${INSUFFICIENT_MARKER}\nThe excerpts only cover biology.`, sufficient: false })
  );
  assert.equal(r.insufficient, true);
  assert.doesNotMatch(r.answer, /INSUFFICIENT_CONTEXT/);
  assert.match(r.answer, /The excerpts only cover biology\./);
  assert.match(r.answer, /research this/i);
});

test('marker with no explanation still yields a helpful research offer', async () => {
  const r = await answerFromDocument(ctx(), makeDeps({ llmText: INSUFFICIENT_MARKER }));
  assert.equal(r.insufficient, true);
  assert.match(r.answer, /research this/i);
});

test('no chunks retrieved: no LLM call, honest answer, research offered', async () => {
  const d = makeDeps({ chunks: [] });
  const r = await answerFromDocument(ctx({ message: 'quantum chromodynamics?' }), d);
  assert.equal(d.calls.generate.length, 0);
  assert.equal(r.provider, null);
  assert.equal(r.insufficient, true);
  assert.deepEqual(r.sources, []);
  assert.match(r.answer, /research this/i);
});

test('low retrieval confidence is surfaced to the LLM in the prompt', async () => {
  const d = makeDeps({ sufficient: false });
  await answerFromDocument(ctx(), d);
  assert.match(d.calls.generate[0].prompt, /confidence is LOW/);
});

test('un-analyzed documents produce a warning but still work', async () => {
  const r = await answerFromDocument(ctx({ doc: { ...DOC, analyzedAt: null, topics: [] } }), makeDeps());
  assert.ok(r.warnings.some((w) => /not been analyzed/.test(w)));
  assert.ok(r.answer.length > 0);
});

test('LLM failure surfaces as a 502', async () => {
  await assert.rejects(
    answerFromDocument(ctx(), makeDeps({ llmError: new Error('Both LLM providers failed') })),
    (err) => err.status === 502 && /Both LLM providers failed/.test(err.message)
  );
});
