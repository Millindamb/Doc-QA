/**
 * Part 3 end-to-end check WITHOUT API keys or MongoDB.
 *
 * Uses the REAL nlp-service (/ingest, /analyze, /retrieve, /route) and the REAL chat pipeline
 * (intent routing -> retrieval -> prompt building); only the LLM call is replaced by a stub that
 * returns a canned, citation-bearing answer, so you can see exactly what would be sent to Gemini/Groq.
 *
 *   1. start nlp-service:   cd nlp-service && uvicorn app.main:app --port 8000
 *   2. run:                 cd server && node scripts/e2e-no-llm.mjs [--show-prompt]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestWithNlpService, analyzeWithNlpService, retrieveWithNlpService, routeWithNlpService } from '../src/services/nlpClient.js';
import { handlers } from '../src/services/intentHandlers.js';
import { runChatTurn } from '../src/services/chat.js';
import { selectChunks } from '../src/services/questionSelect.js';
import { buildResearchQueries } from '../src/services/queryBuilder.js';
import { createQuestionSet } from '../src/services/quizService.js';
import { runResearch } from '../src/services/researchService.js';
import { runResources } from '../src/services/resourcesService.js';

const showPrompt = process.argv.includes('--show-prompt');
const sample = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../samples/biology_notes.txt');
const text = fs.readFileSync(sample, 'utf8');

// ---- build the same document shape the Express route reads from Mongo
const ingest = await ingestWithNlpService({ sourceType: 'text', text });
const chunks = ingest.chunks.map((c) => ({ id: c.id, text: c.text, heading: c.heading, position: c.position, tokenCount: c.token_count }));
const analysis = await analyzeWithNlpService(chunks);
const vectors = new Map(analysis.embeddings.map((e) => [e.chunk_id, e.vector]));
const doc = {
  title: 'Biology notes',
  analyzedAt: new Date(),
  embeddingModel: analysis.embedding_model,
  keywords: analysis.keywords.map((k) => ({ term: k.term, score: k.score })),
  topics: analysis.topics.map((t) => ({ id: t.id, label: t.label, topTerms: t.top_terms, chunkIds: t.chunk_ids, size: t.size })),
  importanceChunks: analysis.importance_chunks.map((c) => ({ chunkId: c.chunk_id, score: c.score })),
  chunks: chunks.map((c) => ({ ...c, embedding: vectors.get(c.id) })),
};
console.log(`document: ${doc.chunks.length} chunks, embeddings=${analysis.embedding_model}\n`);


// ---- fakes for the Part 4 services used by the intent handlers (real analysis data, no LLM / network / Mongo)
const fakeQuizLlm = async (prompt, opts) => {
  const labels = [...prompt.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
  const n = Number(prompt.match(/exactly (\d+)/)[1]);
  return { provider: opts.provider, json: { questions: Array.from({ length: n }, (_, i) => ({ question: `Question number ${i + 1} about the text?`, options: ['one', 'two', 'three', 'four'], answer: 'B', explanation: 'because of the passage', sourceChunk: labels[i % labels.length] })) } };
};
const fakeQuizModel = { create: async (d) => ({ _id: 'Q1', ...d }) };
const fakeSearch = async (q) => ({ provider: 'wikipedia', errors: [], results: [{ title: `About ${q}`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(q)}`, snippet: 's', provider: 'wikipedia' }] });
const fakeSummaryLlm = async () => ({ text: 'Summary [1][2]. See https://made-up.example/x for more.', provider: 'stub-llm' });
const fakeResourceDeps = { youtube: async () => [], wikipedia: async () => [], suggest: async () => { throw new Error('stub'); } };

let lastPrompt = '';
const deps = {
  routeIntent: routeWithNlpService,
  retrieve: retrieveWithNlpService,
  generate: async (prompt) => {
    lastPrompt = prompt;
    return { text: 'STUB ANSWER citing the first excerpt [1].', provider: 'stub-llm' };
  },
  handlers,
  services: {
    createQuestionSet: (args) => createQuestionSet({ ...args, doc: { ...args.doc, _id: 'D1' } }, { generate: fakeQuizLlm, Quiz: fakeQuizModel }),
    runResearch: (args) => runResearch(args, { search: fakeSearch, generate: fakeSummaryLlm }),
    runResources: (args) => runResources(args, fakeResourceDeps),
  },
};

const QUESTION = 'How do cells make and use ATP?';
for (const mode of ['knowledge', 'exam']) {
  const r = await runChatTurn({ doc, mode, message: QUESTION, history: [] }, deps);
  console.log(`=== ${mode.toUpperCase()} :: "${QUESTION}"`);
  console.log(`intent=${r.intent} (${r.routing.method}, ${r.routing.confidence})  retrieval=${r.retrieval.method}  topK=${r.retrieval.topK}  reranked=${r.retrieval.rerankedByImportance}  sufficient=${r.retrieval.sufficient}`);
  console.log('sources (label / rank / relevance / importance / final):');
  for (const s of r.sources) console.log(`  [${s.label}] #${s.rank}  rel=${s.relevance}  imp=${s.importance}  final=${s.finalScore}  ${s.heading}`);
  console.log(`prompt template: ${lastPrompt.split('\n')[0]}`);
  if (showPrompt) console.log(`\n${lastPrompt}\n`);
  console.log();
}

console.log('=== intent dispatch');
for (const msg of ["I don't understand how the Calvin cycle works", 'Quiz me on this document', 'Give me practice questions', 'research the latest on artificial photosynthesis', 'Find me videos to study this', 'Who won the football world cup in 2018?']) {
  const r = await runChatTurn({ doc, mode: 'knowledge', message: msg, history: [] }, deps);
  console.log(`  ${msg.padEnd(52)} -> ${r.intent.padEnd(9)} ${r.routing.method.padEnd(10)} payload=${r.payload?.kind ?? '-'} insufficient=${r.insufficient} provider=${r.provider}`);
}

// ------------------------------------------------------------------ Part 4 (real analysis data, fake LLM / search)
console.log('\n=== Part 4: question selection on real analysis');
for (const mode of ['exam', 'knowledge']) {
  const sel = selectChunks(doc, { mode, count: 6 });
  console.log(`  ${mode.padEnd(9)} -> chunks ${sel.map((c) => `[${c.label}]`).join(' ')}  topics: ${[...new Set(sel.map((c) => c.topicLabel))].join(' | ')}`);
}

const { quiz, provider, warnings } = await createQuestionSet(
  { doc: { ...doc, _id: 'D1' }, userId: 'U1', kind: 'quiz', count: 6, difficulty: 'medium', type: 'mcq', mode: 'knowledge' },
  { generate: fakeQuizLlm, Quiz: fakeQuizModel }
);
console.log(`  quiz: ${quiz.questions.length} questions via ${provider}; topics: ${[...new Set(quiz.questions.map((q) => q.topicLabel))].join(' | ')}; warnings: ${warnings.length}`);

console.log('\n=== Part 4: research queries built from the real keywords / topic labels');
for (const q of [undefined, 'artificial photosynthesis']) console.log(`  ${(q ?? '(none)').padEnd(26)} -> ${JSON.stringify(buildResearchQueries(doc, q))}`);
const r = await runResearch({ doc }, { search: fakeSearch, generate: fakeSummaryLlm });
console.log(`  research: ${r.sources.length} sources, invented link removed: ${!r.summary.includes('made-up')}, warnings: ${JSON.stringify(r.warnings)}`);
const res = await runResources({ doc }, fakeResourceDeps);
console.log(`  resources queries: ${JSON.stringify(res.queries)}  warnings: ${res.warnings.length}`);
