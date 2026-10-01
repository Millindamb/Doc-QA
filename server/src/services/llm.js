import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const EXT_TO_MIME = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain',
};

function fileMimeType(filePath, explicitMime) {
  if (explicitMime) return explicitMime;
  return EXT_TO_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Retries transient failures (429, 5xx, timeout/abort) with linear backoff. */
async function withRetry(fn, maxRetries) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = err.transient === true;
      if (!transient || attempt === maxRetries) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function parseJsonMaybe(text, json) {
  if (!json) return { text, json: undefined };
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  try {
    return { text, json: JSON.parse(cleaned) };
  } catch (err) {
    const parseErr = new Error(`LLM did not return valid JSON: ${err.message}`);
    parseErr.rawText = text;
    throw parseErr;
  }
}

async function callGemini(prompt, { json, files, system }) {
  if (!config.geminiApiKey) {
    const err = new Error('GEMINI_API_KEY is not configured');
    throw err;
  }

  const parts = [{ text: prompt }];
  for (const file of files) {
    const buffer = await fs.promises.readFile(file.path);
    parts.push({
      inline_data: {
        mime_type: fileMimeType(file.path, file.mimeType),
        data: buffer.toString('base64'),
      },
    });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
  };

  const call = async () => {
    const url = `${GEMINI_URL(config.geminiModel)}?key=${config.geminiApiKey}`;
    const res = await fetchWithTimeout(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      config.llmTimeoutMs
    ).catch((err) => {
      const wrapped = new Error(`Gemini request failed: ${err.message}`);
      wrapped.transient = true;
      throw wrapped;
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`Gemini responded ${res.status}: ${detail.slice(0, 500)}`);
      err.transient = res.status === 429 || res.status >= 500;
      throw err;
    }

    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .filter(Boolean)
      .join('\n');

    if (!text.trim()) {
      const err = new Error('Gemini returned an empty response');
      err.transient = true;
      throw err;
    }
    return text;
  };

  const text = await withRetry(call, config.llmMaxRetries);
  const parsed = parseJsonMaybe(text, json);
  return { ...parsed, provider: 'gemini' };
}

async function callGroq(prompt, { json, system }) {
  if (!config.groqApiKey) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const body = {
    model: config.groqModel,
    messages,
    temperature: 0.3,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };

  const call = async () => {
    const res = await fetchWithTimeout(
      GROQ_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.groqApiKey}`,
        },
        body: JSON.stringify(body),
      },
      config.llmTimeoutMs
    ).catch((err) => {
      const wrapped = new Error(`Groq request failed: ${err.message}`);
      wrapped.transient = true;
      throw wrapped;
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`Groq responded ${res.status}: ${detail.slice(0, 500)}`);
      err.transient = res.status === 429 || res.status >= 500;
      throw err;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (!text.trim()) {
      const err = new Error('Groq returned an empty response');
      err.transient = true;
      throw err;
    }
    return text;
  };

  const text = await withRetry(call, config.llmMaxRetries);
  const parsed = parseJsonMaybe(text, json);
  return { ...parsed, provider: 'groq' };
}

/**
 * Generate text (or JSON) from an LLM. Tries Gemini first (supports file
 * input via inline base64 data); falls back to Groq (text-only) on any
 * Gemini error, 429, timeout, or invalid/empty output.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {boolean} [opts.json] - request/parse a JSON response
 * @param {Array<{path: string, mimeType?: string}>} [opts.files] - files for Gemini (PDF/image)
 * @param {string} [opts.system] - system instruction
 * @param {'auto'|'gemini'|'groq'} [opts.provider] - 'auto' (default) = Gemini then Groq fallback;
 *   'gemini' / 'groq' call ONLY that provider and throw on failure (used by structured.js,
 *   which owns the retry / fallback policy for schema-validated output)
 * @returns {Promise<{text: string, json?: any, provider: 'gemini' | 'groq'}>}
 */
export async function generate(prompt, { json = false, files = [], system, provider = 'auto' } = {}) {
  if (provider === 'gemini') return callGemini(prompt, { json, files, system });
  if (provider === 'groq') {
    if (files.length > 0) throw new Error('Groq does not support file input');
    return callGroq(prompt, { json, system });
  }
  try {
    return await callGemini(prompt, { json, files, system });
  } catch (geminiErr) {
    console.warn(`[llm] Gemini failed (${geminiErr.message}); falling back to Groq`);

    if (files.length > 0) {
      const err = new Error(
        `Gemini failed and Groq fallback does not support file input: ${geminiErr.message}`
      );
      err.geminiError = geminiErr;
      throw err;
    }

    try {
      return await callGroq(prompt, { json, system });
    } catch (groqErr) {
      const err = new Error(
        `Both LLM providers failed. Gemini: ${geminiErr.message} | Groq: ${groqErr.message}`
      );
      err.geminiError = geminiErr;
      err.groqError = groqErr;
      throw err;
    }
  }
}
