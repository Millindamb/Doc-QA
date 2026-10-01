import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIsoDuration, rankVideos, fetchYouTubeVideos } from './youtube.js';
import { runResources, suggestionsSchema } from './resourcesService.js';

const NOW = new Date('2026-09-30T00:00:00Z');
const v = (over) => ({ videoId: over.videoId ?? over.title, title: 'x', channel: 'c', publishedAt: '2026-01-01T00:00:00Z', seconds: 600, views: 100000, url: 'u', ...over });

test('parseIsoDuration', () => {
  assert.equal(parseIsoDuration('PT10M'), 600);
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(parseIsoDuration('PT45S'), 45);
  assert.equal(parseIsoDuration('P1DT1H'), 90000);
  assert.equal(parseIsoDuration('nonsense'), null);
});

test('rankVideos hard-filters: duration outside 5-40 min, no title match, missing duration, duplicates', () => {
  const vids = [
    v({ title: 'Calvin cycle explained', seconds: 4 * 60 }),
    v({ title: 'Calvin cycle explained', videoId: 'ok', seconds: 12 * 60 }),
    v({ title: 'Calvin cycle full lecture', seconds: 75 * 60 }),
    v({ title: 'Cooking pasta', seconds: 10 * 60 }),
    v({ title: 'Calvin cycle', seconds: null }),
    v({ title: 'Calvin cycle explained', videoId: 'ok', seconds: 12 * 60 }),
  ];
  const r = rankVideos(vids, 'calvin cycle', { now: NOW });
  assert.deepEqual(r.map((x) => x.videoId), ['ok']);
  assert.equal(r[0].minutes, 12);
});

test('rankVideos scores: better title match, more views, newer and ~14 minute videos rank higher', () => {
  const base = { title: 'Calvin cycle explained', views: 10000, publishedAt: '2025-06-01T00:00:00Z', seconds: 14 * 60 };
  const rank = (over) => rankVideos([v({ ...base, videoId: 'a' }), v({ ...base, videoId: 'b', ...over })], 'calvin cycle light', { now: NOW }).map((x) => x.videoId);
  assert.equal(rank({ title: 'Calvin cycle and light reactions', views: 10000 })[0], 'b'); // title covers more query terms
  assert.equal(rank({ views: 5_000_000 })[0], 'b');
  assert.equal(rank({ publishedAt: '2015-01-01T00:00:00Z' })[0], 'a');
  assert.equal(rank({ seconds: 38 * 60 })[0], 'a');
  const top = rankVideos([v({ ...base })], 'calvin cycle', { now: NOW })[0];
  assert.deepEqual(Object.keys(top.scoreBreakdown), ['title', 'views', 'recency', 'duration']);
  assert.ok(top.score > 0 && top.score <= 1);
});

test('fetchYouTubeVideos calls search then videos.list and maps fields (fake fetch)', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    if (String(url).includes('/search?')) return { ok: true, json: async () => ({ items: [{ id: { videoId: 'abc' } }] }) };
    return { ok: true, json: async () => ({ items: [{ id: 'abc', snippet: { title: 'T', channelTitle: 'Ch', publishedAt: '2026-01-01T00:00:00Z' }, contentDetails: { duration: 'PT9M' }, statistics: { viewCount: '1234' } }] }) };
  };
  const r = await fetchYouTubeVideos('calvin', { fetchImpl, apiKey: 'k' });
  assert.deepEqual([r[0].videoId, r[0].seconds, r[0].views, r[0].url], ['abc', 540, 1234, 'https://www.youtube.com/watch?v=abc']);
  assert.match(urls[1], /id=abc/);
  await assert.rejects(fetchYouTubeVideos('q', { apiKey: '' }), /YOUTUBE_API_KEY/);
});

// ------------------------------------------------------------------ suggestions + orchestration
test('suggestion schema rejects URLs and trims counts', () => {
  assert.equal(suggestionsSchema.safeParse({ topics: [{ title: 'ATP', why: 'see https://x.org' }], books: [] }).success, false);
  const ok = suggestionsSchema.safeParse({ topics: Array.from({ length: 7 }, (_, i) => ({ title: `Topic ${i}` })), books: [{ title: 'Campbell Biology', author: 'Urry' }] });
  assert.equal(ok.data.topics.length, 5);
});

const doc = { title: 'Bio', keywords: [{ term: 'calvin cycle', score: 1 }, { term: 'atp', score: 0.5 }], topics: [{ id: 't0', label: 'light, carbon', topTerms: ['light', 'carbon'], size: 3 }] };
const sugOk = async () => ({ provider: 'gemini', data: { topics: [{ title: 'Krebs cycle', why: 'next' }], books: [{ title: 'Campbell Biology', author: 'Urry', why: '' }] } });

test('runResources: ranked videos + wikipedia links + clearly labeled suggestions', async () => {
  const r = await runResources({ doc }, {
    youtube: async () => [v({ title: 'Calvin cycle explained', videoId: 'a', seconds: 600 }), v({ title: 'Calvin cycle short', videoId: 's', seconds: 60 })],
    wikipedia: async () => [{ title: 'Calvin cycle', url: 'https://en.wikipedia.org/wiki/Calvin_cycle', snippet: 's' }],
    suggest: sugOk,
  });
  assert.deepEqual(r.youtube.map((x) => x.videoId), ['a']);
  assert.equal(r.wikipedia[0].type, 'wikipedia');
  assert.equal(r.suggestions.suggested, true);
  assert.match(r.suggestions.label, /not verified/);
  assert.equal(r.suggestions.books[0].title, 'Campbell Biology');
  assert.deepEqual(r.warnings, []);
});

test('runResources degrades gracefully: a failing part only adds a warning', async () => {
  const r = await runResources({ doc }, {
    youtube: async () => { throw new Error('YOUTUBE_API_KEY is not configured'); },
    wikipedia: async () => [{ title: 'ATP', url: 'https://en.wikipedia.org/wiki/ATP', snippet: '' }],
    suggest: async () => { throw new Error('both providers down'); },
  });
  assert.deepEqual(r.youtube, []);
  assert.equal(r.wikipedia.length, 1);
  assert.equal(r.suggestions, null);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings.join(), /YouTube.*YOUTUBE_API_KEY/);
});
