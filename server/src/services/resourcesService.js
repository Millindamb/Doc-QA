import { z } from 'zod';
import { generate as defaultGenerate } from './llm.js';
import { generateStructured } from './structured.js';
import { loadPrompt, renderPrompt } from './prompts.js';
import { buildResearchQueries, topKeywords } from './queryBuilder.js';
import { searchWikipedia } from './searchProviders.js';
import { fetchYouTubeVideos, rankVideos } from './youtube.js';

export const SUGGESTION_LABEL = 'AI-generated suggestions - not verified links. Search for them yourself and check they exist before relying on them.';

const noUrl = (s) => !/https?:\/\/|www\./i.test(s);
const text = (max) => z.string().trim().min(2).max(max).refine(noUrl, 'must not contain URLs');
// optional free text: may be omitted or empty (note: `.min()` + `.default('')` would reject the default itself)
const optionalText = (max) => z.string().trim().max(max).refine(noUrl, 'must not contain URLs').optional().default('');

export const suggestionsSchema = z
  .object({
    topics: z.array(z.object({ title: text(120), why: optionalText(240) })).min(1).max(8),
    books: z.array(z.object({ title: text(160), author: text(120).optional().default(''), why: optionalText(240) })).max(6).default([]),
  })
  .transform((v) => ({ topics: v.topics.slice(0, 5), books: v.books.slice(0, 4) }));

/**
 * POST /api/resources core. YouTube, Wikipedia and LLM suggestions run independently:
 * one failing (e.g. no YOUTUBE_API_KEY) never blocks the others; it just adds a warning.
 */
export async function runResources({ doc, query }, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const youtube = deps.youtube || ((q) => fetchYouTubeVideos(q, { fetchImpl }));
  const wikipedia = deps.wikipedia || ((q) => searchWikipedia(q, { max: 4, fetchImpl }));
  const suggest = deps.suggest || ((prompt) => generateStructured(prompt, { schema: suggestionsSchema, system: loadPrompt('system_json'), generate: deps.generate || defaultGenerate }));

  const queries = buildResearchQueries(doc, query, { max: 2 });
  if (!queries.length) {
    const e = new Error('nothing to search for: analyze the document first or pass a query');
    e.status = 400;
    throw e;
  }
  const warnings = [];

  const ytTask = (async () => {
    const pool = (await Promise.all(queries.map((q) => youtube(`${q} tutorial`)))).flat();
    return rankVideos(pool, queries.join(' '));
  })();
  const wikiTask = (async () => {
    const all = (await Promise.all(queries.map((q) => wikipedia(q)))).flat();
    const seen = new Set();
    return all.filter((r) => !seen.has(r.url) && seen.add(r.url)).slice(0, 5).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet, type: 'wikipedia' }));
  })();
  const sugTask = (async () => {
    const prompt = renderPrompt('resources_suggest', {
      document_title: doc.title,
      topics: (doc.topics || []).map((t) => t.label).join(' | ') || '(not analyzed)',
      keywords: topKeywords(doc, 8).join(', ') || '(none)',
      focus_line: query ? `The student especially wants: ${query}` : '',
    });
    return suggest(prompt);
  })();

  const [yt, wiki, sug] = await Promise.allSettled([ytTask, wikiTask, sugTask]);
  if (yt.status === 'rejected') warnings.push(`YouTube: ${yt.reason.message}`);
  if (wiki.status === 'rejected') warnings.push(`Wikipedia: ${wiki.reason.message}`);
  if (sug.status === 'rejected') warnings.push(`Suggestions: ${sug.reason.message}`);
  if (yt.status === 'fulfilled' && !yt.value.length) warnings.push('YouTube: no videos matched the 5-40 minute / title-match filters');

  return {
    queries,
    youtube: yt.status === 'fulfilled' ? yt.value : [],
    wikipedia: wiki.status === 'fulfilled' ? wiki.value : [],
    suggestions:
      sug.status === 'fulfilled'
        ? { label: SUGGESTION_LABEL, suggested: true, provider: sug.value.provider, topics: sug.value.data.topics, books: sug.value.data.books }
        : null,
    warnings,
  };
}
