import { config } from '../config.js';
import { generate as defaultGenerate } from './llm.js';
import { loadPrompt, renderPrompt } from './prompts.js';
import { buildResearchQueries } from './queryBuilder.js';
import { searchChain } from './searchProviders.js';

const normUrl = (u) => u.replace(/[).,;:!?'"\]]+$/g, '').replace(/\/$/, '').toLowerCase();

/**
 * "Never invent URLs": the LLM is told not to write any, and whatever it writes anyway is checked here.
 * URLs that match a real source become that source's [n]; unknown URLs are removed. Citations [k] that
 * point at a non-existent source are dropped.
 */
export function sanitizeSummary(text, sources) {
  const byUrl = new Map(sources.map((s) => [normUrl(s.url), s.n]));
  let removed = 0;
  let out = String(text).replace(/https?:\/\/[^\s<>"')\]]+/gi, (match) => {
    const trailing = match.match(/[.,;:!?]+$/)?.[0] || ''; // keep sentence punctuation that followed the URL
    const url = trailing ? match.slice(0, -trailing.length) : match;
    const n = byUrl.get(normUrl(url));
    if (n) return `[${n}]${trailing}`;
    removed += 1;
    return trailing;
  });
  out = out.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (m, list) => {
    const keep = list.split(',').map((x) => Number(x.trim())).filter((k) => k >= 1 && k <= sources.length);
    if (!keep.length) {
      removed += 1;
      return '';
    }
    return keep.map((k) => `[${k}]`).join('');
  });
  return { text: out.replace(/[ \t]{2,}/g, ' ').replace(/\(\s*\)/g, '').trim(), removed };
}

export const citedNumbers = (text) => new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));

/**
 * POST /api/research core.
 * @param {{doc: object, query?: string}} args
 * @param {{search?: Function, generate?: Function, fetchImpl?: Function}} [deps]
 */
export async function runResearch({ doc, query }, deps = {}) {
  const search = deps.search || ((q) => searchChain(q, { fetchImpl: deps.fetchImpl || fetch }));
  const generate = deps.generate || defaultGenerate;
  const warnings = [];

  const queries = buildResearchQueries(doc, query);
  if (!queries.length) {
    const e = new Error('nothing to research: analyze the document first or pass a query');
    e.status = 400;
    throw e;
  }

  const perQuery = await Promise.all(queries.map(async (q) => ({ q, ...(await search(q)) })));
  const providersUsed = perQuery.map((r) => ({ query: r.q, provider: r.provider, errors: r.errors }));

  // merge (round-robin so every query contributes), de-duplicate by URL, cap
  const seen = new Set();
  const merged = [];
  for (let i = 0; merged.length < config.researchMaxSources; i += 1) {
    let any = false;
    for (const r of perQuery) {
      const item = r.results?.[i];
      if (!item) continue;
      any = true;
      const key = normUrl(item.url);
      if (!seen.has(key) && merged.length < config.researchMaxSources) {
        seen.add(key);
        merged.push(item);
      }
    }
    if (!any) break;
  }
  const sources = merged.map((s, i) => ({ n: i + 1, ...s }));

  if (!sources.length) {
    warnings.push('no search provider returned results: ' + providersUsed.flatMap((p) => p.errors).join('; '));
    return { summary: null, sources: [], queries, providersUsed, provider: null, warnings };
  }

  const prompt = renderPrompt('research_summary', {
    document_title: doc.title,
    topics: (doc.topics || []).map((t) => t.label).join(' | ') || '(not analyzed)',
    focus: query?.trim() || queries[0],
    sources: sources.map((s) => `[${s.n}] ${s.title} - ${s.snippet}`).join('\n'),
  });
  const llm = await generate(prompt, { system: loadPrompt('system_research') });
  const { text, removed } = sanitizeSummary(llm.text, sources);
  if (removed) warnings.push(`${removed} unverifiable link/citation(s) were removed from the summary`);

  const cited = citedNumbers(text);
  return {
    summary: text,
    sources: sources.map((s) => ({ ...s, cited: cited.has(s.n) })),
    queries,
    providersUsed,
    provider: llm.provider,
    warnings,
  };
}

export function formatSourcesMarkdown(sources) {
  return sources.map((s) => `${s.n}. [${s.title}](${s.url}) - ${s.provider}`).join('\n');
}
