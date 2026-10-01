import { answerFromDocument } from './documentQa.js';
import { renderPrompt } from './prompts.js';
import { extractTopic } from './queryBuilder.js';
import { parseQuizRequest } from './messageParsing.js';
import { formatSourcesMarkdown } from './researchService.js';

/**
 * Handler contract:  async (ctx, deps) => { answer, sources, provider, insufficient?, retrieval?, payload?, warnings? }
 *   ctx  = { intent, mode, doc, userId, message, history, routing }
 *   deps = { services: { createQuestionSet, runResearch, runResources }, retrieve, generate, ... }
 * `payload` is structured data for the UI (quiz id, research sources, ...); it is returned by /api/chat and stored
 * on the assistant message, so the client can render a card instead of parsing markdown.
 */
const TYPE_LABEL = { mcq: 'multiple-choice', short: 'short-answer', mixed: 'mixed-format' };

function questionSetHandler(kind) {
  return async (ctx, deps) => {
    const req = parseQuizRequest(ctx.message);
    const { quiz, provider, warnings } = await deps.services.createQuestionSet({
      doc: ctx.doc,
      userId: ctx.userId,
      kind,
      mode: ctx.mode,
      ...req,
    });
    const vars = {
      count: quiz.questions.length,
      difficulty: quiz.difficulty,
      type_label: TYPE_LABEL[quiz.type],
      title: ctx.doc.title,
      quiz_id: String(quiz._id),
    };
    return {
      answer: renderPrompt(kind === 'practice' ? 'practice_chat_reply' : 'quiz_chat_reply', vars),
      sources: [],
      provider,
      insufficient: false,
      payload: { kind, quizId: String(quiz._id), count: quiz.questions.length, difficulty: quiz.difficulty, type: quiz.type },
      warnings,
    };
  };
}

async function handleResearch(ctx, deps) {
  const topic = extractTopic(ctx.message);
  const r = await deps.services.runResearch({ doc: ctx.doc, query: topic || undefined });
  if (!r.summary) {
    return {
      answer: 'I could not reach any search provider right now, so I have nothing reliable to report. Please try again shortly.',
      sources: [],
      provider: null,
      payload: { kind: 'research', sources: [], queries: r.queries },
      warnings: r.warnings,
    };
  }
  return {
    answer: renderPrompt('research_chat_reply', { summary: r.summary, sources: formatSourcesMarkdown(r.sources) }),
    sources: [],
    provider: r.provider,
    payload: { kind: 'research', sources: r.sources, queries: r.queries },
    warnings: r.warnings,
  };
}

const bullets = (items) => items.map((i) => `- ${i}`).join('\n');

async function handleResources(ctx, deps) {
  const topic = extractTopic(ctx.message);
  const r = await deps.services.runResources({ doc: ctx.doc, query: topic || undefined });
  const videos = r.youtube.length
    ? `**Videos (YouTube)**\n${bullets(r.youtube.map((v) => `[${v.title}](${v.url}) - ${v.channel}, ${v.minutes} min`))}`
    : '**Videos (YouTube)**\nNone found (see warnings).';
  const wikipedia = r.wikipedia.length ? `**Wikipedia**\n${bullets(r.wikipedia.map((w) => `[${w.title}](${w.url})`))}` : '';
  const sug = r.suggestions
    ? `**Suggestions** *(AI-generated, not verified - check they exist)*\n${bullets([
        ...r.suggestions.topics.map((t) => `Topic: ${t.title}${t.why ? ` - ${t.why}` : ''}`),
        ...r.suggestions.books.map((b) => `Book: ${b.title}${b.author ? ` by ${b.author}` : ''}${b.why ? ` - ${b.why}` : ''}`),
      ])}`
    : '';
  return {
    answer: renderPrompt('resources_chat_reply', { title: ctx.doc.title, videos, wikipedia, suggestions: sug }).replace(/\n{3,}/g, '\n\n'),
    sources: [],
    provider: r.suggestions?.provider ?? null,
    payload: { kind: 'resources', ...r },
    warnings: r.warnings,
  };
}

export const handlers = {
  question: answerFromDocument,
  doubt: answerFromDocument,
  quiz: questionSetHandler('quiz'),
  practice: questionSetHandler('practice'),
  research: handleResearch,
  resources: handleResources,
};
