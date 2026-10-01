import { generate } from './llm.js';
import { retrieveWithNlpService, routeWithNlpService } from './nlpClient.js';
import { handlers } from './intentHandlers.js';
import { createQuestionSet } from './quizService.js';
import { runResearch } from './researchService.js';
import { runResources } from './resourcesService.js';

export const defaultDeps = {
  routeIntent: routeWithNlpService,
  retrieve: retrieveWithNlpService,
  generate,
  handlers,
  services: { createQuestionSet, runResearch, runResources },
};

/**
 * One chat turn, independent of Express/Mongo so it is easy to test:
 *   route intent -> dispatch to the intent's handler -> normalized result.
 *
 * @param {object} turn
 * @param {object} turn.doc      lean Document (title, chunks[], importanceChunks[], embeddingModel, topics[], analyzedAt)
 * @param {string} [turn.userId]  owner (needed by handlers that store things, e.g. quizzes)
 * @param {'knowledge'|'exam'} turn.mode
 * @param {string} turn.message
 * @param {Array<{role: string, content: string}>} turn.history  previous messages, oldest first
 * @param {object} [deps]        injectable for tests
 */
export async function runChatTurn({ doc, mode, message, history = [], userId }, deps = defaultDeps) {
  const warnings = [];

  let routing;
  try {
    routing = await deps.routeIntent(message);
  } catch (err) {
    routing = { intent: 'question', confidence: 0, method: 'fallback', matchedRules: [] };
    warnings.push(`intent routing failed (${err.message}); treating the message as a question`);
  }

  const handler = deps.handlers[routing.intent] || deps.handlers.question;
  const result = await handler({ intent: routing.intent, mode, doc, userId, message, history, routing }, deps);

  return {
    answer: result.answer,
    sources: result.sources || [],
    intent: routing.intent,
    routing: { confidence: routing.confidence, method: routing.method, matchedRules: routing.matchedRules || [] },
    provider: result.provider ?? null,
    mode,
    insufficient: Boolean(result.insufficient),
    payload: result.payload ?? null,
    retrieval: result.retrieval ?? null,
    warnings: [...warnings, ...(result.warnings || [])],
  };
}
