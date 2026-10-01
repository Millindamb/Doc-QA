import { config } from '../config.js';

/**
 * Web search providers (all return [{title, url, snippet, provider}]).
 * Chain order per the spec: Tavily -> Wikipedia -> SerpAPI.
 * `fetchImpl` is injectable so tests never touch the network.
 */
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();

export function isHttpUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

async function getJson(fetchImpl, url, init = {}) {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(config.searchTimeoutMs) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} responded ${res.status}`);
  return res.json();
}

export async function searchTavily(query, { max = 5, fetchImpl = fetch, apiKey = config.tavilyApiKey } = {}) {
  if (!apiKey) throw new Error('TAVILY_API_KEY is not configured');
  const data = await getJson(fetchImpl, 'https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: max, search_depth: 'basic', include_answer: false }),
  });
  return (data.results || [])
    .filter((r) => isHttpUrl(r.url))
    .map((r) => ({ title: stripHtml(r.title), url: r.url, snippet: stripHtml(r.content).slice(0, 500), provider: 'tavily' }));
}

export async function searchWikipedia(query, { max = 5, fetchImpl = fetch } = {}) {
  const url =
    'https://en.wikipedia.org/w/api.php?' +
    new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: String(max), format: 'json', origin: '*' });
  const data = await getJson(fetchImpl, url, { headers: { 'User-Agent': 'DocQA/1.0 (study assistant)' } });
  return (data.query?.search || []).map((r) => ({
    title: r.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    snippet: stripHtml(r.snippet),
    provider: 'wikipedia',
  }));
}

export async function searchSerpApi(query, { max = 5, fetchImpl = fetch, apiKey = config.serpapiApiKey } = {}) {
  if (!apiKey) throw new Error('SERPAPI_API_KEY is not configured');
  const url = 'https://serpapi.com/search.json?' + new URLSearchParams({ engine: 'google', q: query, num: String(max), api_key: apiKey });
  const data = await getJson(fetchImpl, url);
  return (data.organic_results || [])
    .filter((r) => isHttpUrl(r.link))
    .slice(0, max)
    .map((r) => ({ title: stripHtml(r.title), url: r.link, snippet: stripHtml(r.snippet), provider: 'serpapi' }));
}

export const DEFAULT_CHAIN = [
  { name: 'tavily', fn: searchTavily },
  { name: 'wikipedia', fn: searchWikipedia },
  { name: 'serpapi', fn: searchSerpApi },
];

/**
 * Walk the chain for one query: the first provider that returns results wins.
 * A provider that is unconfigured, errors, or returns nothing hands over to the next one.
 */
export async function searchChain(query, { chain = DEFAULT_CHAIN, max = 5, fetchImpl = fetch } = {}) {
  const errors = [];
  for (const { name, fn } of chain) {
    try {
      const results = await fn(query, { max, fetchImpl });
      if (results.length) return { results, provider: name, errors };
      errors.push(`${name}: no results`);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  return { results: [], provider: null, errors };
}
