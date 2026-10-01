import fs from 'node:fs';
import { config } from '../config.js';

/**
 * Send a file (pdf/image/text) to the nlp-service /ingest endpoint.
 * @param {object} params
 * @param {string} [params.filePath] - path to the uploaded file on disk (pdf/image)
 * @param {string} [params.originalName] - original filename (used to infer type)
 * @param {string} [params.mimeType] - multer-reported mime type
 * @param {string} [params.sourceType] - 'pdf' | 'image' | 'text' (explicit override)
 * @param {string} [params.text] - raw text payload, when sourceType === 'text'
 * @returns {Promise<object>} the nlp-service IngestResponse JSON
 */
export async function ingestWithNlpService({ filePath, originalName, mimeType, sourceType, text }) {
  const form = new FormData();

  if (sourceType) form.append('source_type', sourceType);

  if (sourceType === 'text' || (text !== undefined && !filePath)) {
    form.append('text', text ?? '');
  } else {
    if (!filePath) throw new Error('filePath is required for pdf/image ingestion');
    const buffer = await fs.promises.readFile(filePath);
    const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
    form.append('file', blob, originalName || 'upload');
  }

  const headers = {};
  if (config.nlpInternalKey) headers['X-Internal-Key'] = config.nlpInternalKey;

  const res = await fetch(`${config.nlpServiceUrl}/ingest`, {
    method: 'POST',
    headers,
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`nlp-service ingest failed (${res.status}): ${detail}`);
    err.status = 502;
    throw err;
  }

  return res.json();
}

/**
 * Send a document's chunks to the nlp-service /analyze endpoint.
 * @param {Array<{id:string,text:string,heading:string,position:number,tokenCount:number}>} chunks
 * @param {object} [opts]
 * @param {number} [opts.topNSummary]
 * @param {number} [opts.topNKeywords]
 * @returns {Promise<object>} the nlp-service AnalyzeResponse JSON
 */
export async function analyzeWithNlpService(chunks, { topNSummary, topNKeywords } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.nlpInternalKey) headers['X-Internal-Key'] = config.nlpInternalKey;

  const body = {
    chunks: chunks.map((c) => ({
      id: c.id,
      text: c.text,
      heading: c.heading || '',
      position: c.position,
      token_count: c.tokenCount ?? 0,
    })),
    ...(topNSummary ? { top_n_summary: topNSummary } : {}),
    ...(topNKeywords ? { top_n_keywords: topNKeywords } : {}),
  };

  const res = await fetch(`${config.nlpServiceUrl}/analyze`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`nlp-service analyze failed (${res.status}): ${detail}`);
    err.status = 502;
    throw err;
  }

  return res.json();
}

function nlpHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (config.nlpInternalKey) headers['X-Internal-Key'] = config.nlpInternalKey;
  return headers;
}

async function postJson(path, body) {
  let res;
  try {
    res = await fetch(`${config.nlpServiceUrl}${path}`, {
      method: 'POST',
      headers: nlpHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.nlpTimeoutMs),
    });
  } catch (cause) {
    const err = new Error(`nlp-service ${path} unreachable: ${cause.message}`);
    err.status = 502;
    throw err;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`nlp-service ${path} failed (${res.status}): ${detail}`);
    err.status = 502;
    throw err;
  }
  return res.json();
}

/**
 * Hybrid retrieval (BM25 + embedding cosine) over a document's chunks.
 * @param {object} params
 * @param {string} params.query
 * @param {Array<object>} params.chunks - stored chunks (with `embedding` once analyzed)
 * @param {'knowledge'|'exam'} params.mode
 * @param {Object<string, number>} [params.importance] - chunkId -> importance score (exam re-rank)
 * @param {string} [params.embeddingModel] - `embeddingModel` stored by /analyze
 * @param {number} [params.topK]
 * @param {number} [params.alpha]
 * @returns {Promise<object>} the nlp-service RetrieveResponse JSON
 */
export async function retrieveWithNlpService({ query, chunks, mode, importance, embeddingModel, topK, alpha }) {
  return postJson('/retrieve', {
    query,
    mode,
    chunks: chunks.map((c) => ({
      id: c.id,
      text: c.text,
      heading: c.heading || '',
      position: c.position,
      token_count: c.tokenCount ?? 0,
      embedding: c.embedding && c.embedding.length ? Array.from(c.embedding) : null,
    })),
    ...(importance && Object.keys(importance).length ? { importance } : {}),
    ...(embeddingModel ? { embedding_model: embeddingModel } : {}),
    ...(topK ? { top_k: topK } : {}),
    ...(alpha !== undefined ? { alpha } : {}),
  });
}

/**
 * Classify a user message into question | doubt | quiz | practice | research | resources.
 * @returns {Promise<{intent: string, confidence: number, method: string, matched_rules: string[]}>}
 */
export async function routeWithNlpService(query) {
  const r = await postJson('/route', { query });
  return { intent: r.intent, confidence: r.confidence, method: r.method, matchedRules: r.matched_rules || [] };
}
