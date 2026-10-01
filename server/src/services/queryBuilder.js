import { contentStems, uniq } from './textUtil.js';

const MAX_QUERY_WORDS = 8;

/** Top keywords: highest score first, dropping terms already contained in a better-ranked one. */
export function topKeywords(doc, n = 6) {
  const sorted = [...(doc.keywords || [])].sort((a, b) => b.score - a.score).map((k) => k.term.trim()).filter(Boolean);
  const picked = [];
  for (const term of sorted) {
    const t = term.toLowerCase();
    if (picked.some((p) => p.toLowerCase().includes(t) || t.includes(p.toLowerCase()))) continue;
    picked.push(term);
    if (picked.length >= n) break;
  }
  return picked;
}

/** Topic labels look like "light, carbon, atp" (top TF-IDF terms); returns their terms per topic. */
export function topicTerms(doc) {
  return (doc.topics || [])
    .slice()
    .sort((a, b) => (b.size || 0) - (a.size || 0))
    .map((t) => (t.topTerms?.length ? t.topTerms : String(t.label).split(',')).map((x) => x.trim()).filter(Boolean));
}

const FILLER = /\b(please|can you|could you|research|look (?:it |this |that )?up|look into|search( for| the web for)?|find( out)?( about| more about)?|investigate|tell me about|more about|latest( on| news on)?|online|on the web|beyond the document|resources?|videos?|tutorials?|for me|study|learn)\b/gi;

/** Strip command words: "research the latest on artificial photosynthesis" -> "artificial photosynthesis". */
export function extractTopic(message) {
  let cleaned = String(message || '')
    .replace(FILLER, ' ')
    .replace(/[?!.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lead = /^(about|on|into|of|the|to|this|that|it|some|more|a|an|for|and|me|please)\b\s*/i;
  while (lead.test(cleaned)) cleaned = cleaned.replace(lead, '');
  return contentStems(cleaned).length >= 1 ? cleaned.split(' ').slice(0, 12).join(' ') : '';
}

function clip(q) {
  return q.split(/\s+/).filter(Boolean).slice(0, MAX_QUERY_WORDS).join(' ');
}

function similar(a, b) {
  const A = new Set(contentStems(a));
  const B = new Set(contentStems(b));
  if (!A.size || !B.size) return a.toLowerCase() === b.toLowerCase();
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / (A.size + B.size - inter) > 0.7;
}

/**
 * Build 2-3 distinct search queries from the document's top keywords and topic labels
 * (plus the user's own query when given).
 */
export function buildResearchQueries(doc, userQuery = '', { max = 3 } = {}) {
  const kws = topKeywords(doc, 6);
  const topics = topicTerms(doc);
  const candidates = [];
  const user = String(userQuery || '').trim();

  if (user) {
    candidates.push(user);
    if (kws[0] && !user.toLowerCase().includes(kws[0].toLowerCase())) candidates.push(`${user} ${kws[0]}`);
    if (topics[0]?.[0]) candidates.push(`${user} ${topics[0][0]} overview`);
  } else {
    if (kws.length) candidates.push(kws.slice(0, 3).join(' '));
    if (topics[0]?.length) candidates.push(`${topics[0].slice(0, 2).join(' ')}${kws[0] ? ` ${kws[0]}` : ''}`);
    if (topics[1]?.length) candidates.push(`${topics[1].slice(0, 2).join(' ')} explained`);
    if (kws.length > 3) candidates.push(kws.slice(3, 5).join(' '));
    if (!candidates.length && doc.title) candidates.push(doc.title);
  }

  const out = [];
  for (const c of candidates.map(clip).filter(Boolean)) {
    if (!out.some((o) => similar(o, c))) out.push(c);
    if (out.length >= max) break;
  }
  return uniq(out);
}
