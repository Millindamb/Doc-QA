import { generate } from './llm.js';

const SYSTEM_PROMPT = `You are an expert study assistant helping a student understand a document.
You will be given a list of topics found in the document, each with its label, its most
important terms, and a few representative sentences from the document.

For EACH topic, produce:
- "topic": the topic label, copied exactly as given
- "key_points": 3 to 6 short, self-contained bullet points capturing what a student
  should know about this topic (do not just copy sentences verbatim; synthesize them)
- "important_terms": 3 to 8 important terms or phrases a student should be able to define

Respond with ONLY a JSON array, one object per topic, in the same order as given.
No markdown code fences, no prose before or after the JSON.`;

export function buildPrompt({ topics, keywords, summarySentences }) {
  const topKeywordTerms = keywords.slice(0, 15).map((k) => k.term);

  const topicBlocks = topics.map((topic) => {
    const topicSentences = summarySentences
      .filter((s) => topic.chunkIds?.includes(s.chunkId))
      .slice(0, 5);
    const sentences = topicSentences.length
      ? topicSentences
      : summarySentences.slice(0, 3); // fallback: global top sentences

    return [
      `Topic label: ${topic.label}`,
      `Top terms: ${(topic.topTerms || []).join(', ')}`,
      `Representative sentences:`,
      ...sentences.map((s) => `- ${s.text}`),
    ].join('\n');
  });

  return [
    `Document-wide keywords: ${topKeywordTerms.join(', ')}`,
    '',
    `There are ${topics.length} topic(s):`,
    '',
    topicBlocks.join('\n\n'),
  ].join('\n');
}

export function isValidKeyPointsArray(value, expectedCount) {
  if (!Array.isArray(value)) return false;
  if (value.length !== expectedCount) return false;
  return value.every(
    (item) =>
      item &&
      typeof item.topic === 'string' &&
      Array.isArray(item.key_points) &&
      item.key_points.every((p) => typeof p === 'string') &&
      Array.isArray(item.important_terms) &&
      item.important_terms.every((t) => typeof t === 'string')
  );
}

/**
 * Generate {topic, key_points[], important_terms[]} for each topic, using
 * only the top TextRank summary sentences + keywords + topic labels (never
 * the full document) as LLM context. Retries once on invalid JSON/shape.
 *
 * @param {object} analysis - { topics, keywords, summarySentences } (camelCase, as stored in Mongo)
 * @returns {Promise<{ keyPoints: Array<{topic:string, keyPoints:string[], importantTerms:string[]}>, provider: string, warnings: string[] }>}
 */
export async function generateKeyPoints(analysis) {
  const { topics } = analysis;
  const warnings = [];

  if (!topics || topics.length === 0) {
    return { keyPoints: [], provider: null, warnings: ['no topics to generate key points for'] };
  }

  const prompt = buildPrompt(analysis);
  let lastProvider = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let result;
    try {
      result = await generate(prompt, { json: true, system: SYSTEM_PROMPT });
    } catch (err) {
      if (attempt === 1) throw err;
      continue; // retry once on transport/parse failure too
    }

    lastProvider = result.provider;
    if (isValidKeyPointsArray(result.json, topics.length)) {
      const keyPoints = result.json.map((item) => ({
        topic: item.topic,
        keyPoints: item.key_points,
        importantTerms: item.important_terms,
      }));
      return { keyPoints, provider: lastProvider, warnings };
    }

    warnings.push(`attempt ${attempt + 1}: LLM (${lastProvider}) returned an invalid key-points shape`);
  }

  // both attempts produced an invalid shape: degrade gracefully rather than
  // failing the whole /analyze request
  return {
    keyPoints: topics.map((t) => ({ topic: t.label, keyPoints: [], importantTerms: [] })),
    provider: lastProvider,
    warnings,
  };
}
