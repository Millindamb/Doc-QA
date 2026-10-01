import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchQueries, extractTopic, topKeywords } from './queryBuilder.js';
import { searchChain, searchWikipedia, searchTavily, searchSerpApi } from './searchProviders.js';
import { runResearch, sanitizeSummary } from './researchService.js';

const doc = {
  title: 'Biology notes',
  keywords: [
    { term: 'photosynthesis', score: 0.9 }, { term: 'calvin cycle', score: 0.8 }, { term: 'cycle', score: 0.75 },
    { term: 'atp', score: 0.7 }, { term: 'chloroplast', score: 0.6 }, { term: 'osmosis', score: 0.5 }, { term: 'membrane', score: 0.4 },
  ],
  topics: [
    { id: 't0', label: 'light, carbon, atp', topTerms: ['light', 'carbon', 'atp'], size: 5 },
    { id: 't1', label: 'membrane, solute', topTerms: ['membrane', 'solute'], size: 2 },
  ],
};

// ------------------------------------------------------------------ query builder
test('topKeywords: best first, drops terms contained in a better-ranked one', () => {
  assert.deepEqual(topKeywords(doc, 4), ['photosynthesis', 'calvin cycle', 'atp', 'chloroplast']); // "cycle" dropped
});

test('buildResearchQueries: 2-3 distinct queries from keywords + topic labels, each <= 8 words', () => {
  const qs = buildResearchQueries(doc);
  assert.ok(qs.length >= 2 && qs.length <= 3, qs.join(' | '));
  assert.equal(qs[0], 'photosynthesis calvin cycle atp');
  assert.ok(qs.some((q) => q.startsWith('light carbon')));
  assert.ok(qs.every((q) => q.split(' ').length <= 8));
  assert.equal(new Set(qs.map((q) => q.toLowerCase())).size, qs.length);
});

test('buildResearchQueries with a user query keeps it first and adds document context', () => {
  const qs = buildResearchQueries(doc, 'artificial photosynthesis');
  assert.equal(qs[0], 'artificial photosynthesis');
  assert.ok(qs.length >= 2 && qs.some((q) => /atp|light|overview/.test(q)));
  assert.equal(buildResearchQueries({ title: 'Only a title' }).join(), 'Only a title');
  assert.deepEqual(buildResearchQueries({}), []);
});

test('extractTopic strips command words and returns "" when no topic is left', () => {
  assert.equal(extractTopic('research the latest on artificial photosynthesis'), 'artificial photosynthesis');
  assert.equal(extractTopic('Find me videos to study CRISPR'), 'CRISPR');
  assert.equal(extractTopic('research this'), '');
  assert.equal(extractTopic('look it up online'), '');
});

// ------------------------------------------------------------------ providers + chain
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const routes = (map) => async (url) => {
  for (const [needle, fn] of Object.entries(map)) if (String(url).includes(needle)) return fn(url);
  throw new Error(`unexpected url ${url}`);
};
const wiki = json({ query: { search: [{ title: 'Calvin cycle', snippet: 'The <span class="searchmatch">Calvin</span> cycle &amp; more' }] } });

test('Wikipedia provider builds real article URLs and strips HTML from snippets', async () => {
  const r = await searchWikipedia('calvin', { fetchImpl: routes({ 'wikipedia.org': () => wiki }) });
  assert.deepEqual(r[0], { title: 'Calvin cycle', url: 'https://en.wikipedia.org/wiki/Calvin_cycle', snippet: 'The Calvin cycle & more', provider: 'wikipedia' });
});

test('Tavily and SerpAPI need keys; results with invalid URLs are dropped', async () => {
  await assert.rejects(searchTavily('q', { apiKey: '' }), /not configured/);
  await assert.rejects(searchSerpApi('q', { apiKey: '' }), /not configured/);
  const t = await searchTavily('q', { apiKey: 'k', fetchImpl: async () => json({ results: [{ title: 'A', url: 'https://a.org', content: 'x' }, { title: 'B', url: 'javascript:alert(1)', content: 'y' }] }) });
  assert.deepEqual(t.map((x) => x.url), ['https://a.org']);
});

test('chain order Tavily -> Wikipedia -> SerpAPI: first provider with results wins', async () => {
  const tavily = async () => [{ title: 'T', url: 'https://t.org', snippet: '', provider: 'tavily' }];
  const wikiFn = async () => { throw new Error('should not run'); };
  const r1 = await searchChain('q', { chain: [{ name: 'tavily', fn: tavily }, { name: 'wikipedia', fn: wikiFn }] });
  assert.equal(r1.provider, 'tavily');
});

test('chain falls through on error, on empty results and on missing keys', async () => {
  const calls = [];
  const mk = (name, impl) => ({ name, fn: async () => { calls.push(name); return impl(); } });
  const r = await searchChain('q', {
    chain: [
      mk('tavily', () => { throw new Error('TAVILY_API_KEY is not configured'); }),
      mk('wikipedia', () => []),
      mk('serpapi', () => [{ title: 'S', url: 'https://s.org', snippet: '', provider: 'serpapi' }]),
    ],
  });
  assert.deepEqual(calls, ['tavily', 'wikipedia', 'serpapi']);
  assert.equal(r.provider, 'serpapi');
  assert.equal(r.errors.length, 2);
  const none = await searchChain('q', { chain: [mk('tavily', () => [])] });
  assert.deepEqual([none.provider, none.results], [null, []]);
});

// ------------------------------------------------------------------ never invent URLs
const SOURCES = [
  { n: 1, title: 'Calvin cycle', url: 'https://en.wikipedia.org/wiki/Calvin_cycle', snippet: '', provider: 'wikipedia' },
  { n: 2, title: 'ATP', url: 'https://example.org/atp', snippet: '', provider: 'tavily' },
];

test('sanitizeSummary removes invented URLs, maps real ones to [n], and drops citations to missing sources', () => {
  const raw = 'Fixes carbon [1]. See https://fake-site.com/paper for more [7]. Also https://example.org/atp, and ATP [2][9].';
  const { text, removed } = sanitizeSummary(raw, SOURCES);
  assert.doesNotMatch(text, /fake-site/);
  assert.match(text, /\[2\]/);
  assert.doesNotMatch(text, /\[7\]|\[9\]/);
  assert.match(text, /\[2\], and ATP \[2\]/);
  assert.equal(removed, 3);
});

test('runResearch: builds queries, searches, summarises with the LLM, returns only REAL source links', async () => {
  const searched = [];
  const search = async (q) => {
    searched.push(q);
    return { provider: 'wikipedia', errors: [], results: [{ title: `Result for ${q}`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(q)}`, snippet: 'snippet', provider: 'wikipedia' }, { title: 'Shared', url: 'https://shared.org/x', snippet: 's', provider: 'wikipedia' }] };
  };
  const generate = async (prompt, opts) => {
    assert.match(prompt, /RESEARCH FOCUS: artificial photosynthesis/);
    assert.match(prompt, /\[1\] Result for/);
    assert.match(opts.system, /NEVER write a URL/);
    return { text: 'It works [1]. Details at https://hallucinated.example/paper [2].', provider: 'groq' };
  };
  const r = await runResearch({ doc, query: 'artificial photosynthesis' }, { search, generate });
  assert.ok(searched.length >= 2);
  assert.equal(r.provider, 'groq');
  assert.doesNotMatch(r.summary, /hallucinated/);
  assert.ok(r.warnings.some((w) => /removed/.test(w)));
  const urls = r.sources.map((s) => s.url);
  assert.equal(new Set(urls).size, urls.length, 'sources are de-duplicated');
  assert.ok(urls.every((u) => u.startsWith('https://')));
  assert.equal(r.sources.find((s) => s.n === 1).cited, true);
});

test('runResearch with no search results: no LLM call, summary null, reasons reported', async () => {
  let called = false;
  const r = await runResearch({ doc }, { search: async () => ({ results: [], provider: null, errors: ['tavily: not configured'] }), generate: async () => { called = true; } });
  assert.equal(r.summary, null);
  assert.equal(called, false);
  assert.match(r.warnings[0], /no search provider/);
});
