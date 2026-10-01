import { config } from '../config.js';
import { generate } from './llm.js';
import { retrieveWithNlpService } from './nlpClient.js';
import { loadPrompt, renderPrompt } from './prompts.js';

/** Must match the token the system_grounding.txt prompt tells the LLM to emit. */
export const INSUFFICIENT_MARKER = '[[INSUFFICIENT_CONTEXT]]';

// ---------------------------------------------------------------- follow-up detection
// Words that carry no topic on their own: function words plus the vocabulary of doubts /
// follow-ups ("I still don't get it", "explain that again"). If a message has <= 1 word left
// it has no searchable topic of its own and we borrow the previous user question.
// (Exactly zero: a one-word topic like "What is ATP?" is a perfectly good standalone query.)
const TOPICLESS = new Set(
  `a an the and or but so if then also of to in on at by for from with about into as is are was were be been am do does did
   dont don't doesnt doesn't didnt didn't not no yes ok okay i me my we you your it its this that these those they them their
   there here what which who how why when where can could would should will please pls just really still very much more less
   again once another other one ones same understand understood get got getting follow followed grasp see confusing confused
   confuse unclear clear explain explained explaining simpler simply simple easier easy mean means meant tell say said show
   step steps way words word example examples elaborate clarify rephrase repeat further deeper detail details thing things
   stuff mixing`.split(/\s+/)
);
const ANAPHORA = /\b(it|its|this|that|these|those|they|them|their|there|above|previous|earlier|former|latter|same)\b/i;
const CONNECTIVE = /^\s*(and|but|so|also|then|what about|how about)\b/i;

function words(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

export function contentWordCount(message) {
  return message
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w && !TOPICLESS.has(w)).length;
}

export function isFollowUp(message) {
  if (words(message).length === 0) return false;
  if (contentWordCount(message) === 0) return true;
  return words(message).length <= 8 && (ANAPHORA.test(message) || CONNECTIVE.test(message));
}

/**
 * Retrieval query. Follow-ups like "why?", "what about limitations?" or "I don't
 * understand" can't be searched alone, so they borrow the previous user question.
 */
export function buildRetrievalQuery(message, history = []) {
  const current = message.trim();
  if (!isFollowUp(current)) return current;
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  return lastUser ? `${lastUser.content.trim()} ${current}` : current;
}

// ---------------------------------------------------------------- prompt pieces
export function formatHistory(history = [], { maxMessages = config.chatHistoryMessages, maxChars = config.chatHistoryMaxChars } = {}) {
  const recent = history.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-maxMessages);
  if (recent.length === 0) return '(no previous messages)';
  return recent
    .map((m) => {
      const text = m.content.length > maxChars ? `${m.content.slice(0, maxChars)}...` : m.content;
      return `${m.role === 'user' ? 'Student' : 'Assistant'}: ${text}`;
    })
    .join('\n');
}

/** Human-facing chunk number: 1-based (chunk id "c0" is cited as [1]). */
export const chunkLabel = (chunk) => chunk.position + 1;

export function formatContext(chunks) {
  return chunks
    .map((c) => `[${chunkLabel(c)}]${c.heading ? ` (Section: ${c.heading})` : ''}\n${c.text.trim()}`)
    .join('\n\n');
}

export function topicsLine(doc) {
  const labels = (doc.topics || []).map((t) => t.label).filter(Boolean);
  return labels.length ? labels.join(', ') : '(document not analyzed yet)';
}

export function retrievalNote(retrieval, mode) {
  const parts = [];
  parts.push(
    retrieval.sufficient
      ? 'The excerpts match the question closely.'
      : 'Retrieval confidence is LOW - the excerpts may not answer the question. If they do not, start your reply with the insufficient-context token.'
  );
  if (mode === 'exam' && retrieval.reranked_by_importance) {
    parts.push('Excerpts were re-ranked so the most exam-relevant come first.');
  }
  return parts.join(' ');
}

/** Chunk numbers cited in an answer: handles [3], [2][5] and [2, 5]. */
export function extractCitations(answer) {
  const found = new Set();
  for (const m of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    m[1].split(',').forEach((n) => found.add(Number(n.trim())));
  }
  return found;
}

export function toSources(chunks, citedLabels, snippetChars = config.chatSourceSnippetChars) {
  return chunks.map((c) => ({
    label: chunkLabel(c),
    chunkId: c.id,
    position: c.position,
    heading: c.heading || '',
    snippet: c.text.length > snippetChars ? `${c.text.slice(0, snippetChars).trimEnd()}...` : c.text,
    rank: c.rank,
    bm25Score: c.bm25_score,
    cosine: c.cosine,
    relevance: c.relevance,
    importance: c.importance ?? null,
    finalScore: c.final_score,
    cited: citedLabels.has(chunkLabel(c)),
  }));
}

function promptNameFor(intent, mode) {
  if (intent === 'doubt') return 'doubt_answer';
  return mode === 'exam' ? 'exam_answer' : 'knowledge_answer';
}

// ---------------------------------------------------------------- handler for question / doubt
/**
 * Retrieve -> mode-specific prompt -> LLM, grounded in the retrieved chunks.
 * Handles both `question` and `doubt` intents (the doubt template rephrases simply,
 * step by step, and ends with a check question).
 */
export async function answerFromDocument(ctx, deps = { retrieve: retrieveWithNlpService, generate }) {
  const { intent, mode, doc, message, history } = ctx;
  const warnings = [];
  const topics = topicsLine(doc);

  if (!doc.analyzedAt) {
    warnings.push(
      'Document has not been analyzed (POST /api/documents/:id/analyze): retrieval falls back to BM25 + TF-IDF cosine and exam mode cannot re-rank by importance.'
    );
  }

  const query = buildRetrievalQuery(message, history);
  const importance = Object.fromEntries((doc.importanceChunks || []).map((c) => [c.chunkId, c.score]));

  const retrieval = await deps.retrieve({
    query,
    chunks: doc.chunks,
    mode,
    importance,
    embeddingModel: doc.embeddingModel || undefined,
  });
  warnings.push(...(retrieval.warnings || []));

  const retrievalMeta = {
    query,
    method: retrieval.retrieval_method,
    embeddingModel: retrieval.embedding_model,
    alpha: retrieval.alpha,
    topK: retrieval.top_k,
    rerankedByImportance: retrieval.reranked_by_importance,
    sufficient: retrieval.sufficient,
    maxCosine: retrieval.max_cosine,
    queryTermCoverage: retrieval.query_term_coverage,
  };

  // nothing in the document relates to the question: don't spend an LLM call, don't guess
  if (!retrieval.chunks.length) {
    return {
      answer: renderPrompt('no_context_answer', { document_title: doc.title, topics }),
      sources: [],
      provider: null,
      insufficient: true,
      retrieval: retrievalMeta,
      warnings,
    };
  }

  const prompt = renderPrompt(promptNameFor(intent, mode), {
    document_title: doc.title,
    topics,
    history: formatHistory(history),
    context: formatContext(retrieval.chunks),
    retrieval_note: retrievalNote(retrieval, mode),
    question: message.trim(),
  });

  let llmResult;
  try {
    llmResult = await deps.generate(prompt, { system: loadPrompt('system_grounding') });
  } catch (err) {
    err.status = err.status || 502;
    throw err;
  }

  const raw = String(llmResult.text || '');
  const insufficient = raw.includes(INSUFFICIENT_MARKER);
  let answer = raw.split(INSUFFICIENT_MARKER).join('').trim();
  if (insufficient) {
    answer = answer
      ? answer + renderPrompt('insufficient_context_footer', { topics })
      : renderPrompt('no_context_answer', { document_title: doc.title, topics });
  }

  return {
    answer,
    sources: toSources(retrieval.chunks, extractCitations(answer)),
    provider: llmResult.provider,
    insufficient,
    retrieval: retrievalMeta,
    warnings,
  };
}
