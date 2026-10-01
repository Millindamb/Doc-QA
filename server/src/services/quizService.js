import { config } from '../config.js';
import { Quiz as QuizModel } from '../models/Quiz.js';
import { generateStructured } from './structured.js';
import { loadPrompt, renderPrompt } from './prompts.js';
import { chunkTopicMap, formatQuestionContext, selectChunks } from './questionSelect.js';
import { buildQuestionsSchema } from './questionSchema.js';

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const QUESTION_TYPES = ['mcq', 'short', 'mixed'];
export const MODES = ['knowledge', 'exam'];

export function normalizeOptions({ count = 5, difficulty = 'medium', type = 'mixed', mode = 'knowledge' } = {}) {
  const n = Math.round(Number(count));
  if (!Number.isFinite(n) || n < 1 || n > config.quizMaxCount) {
    const e = new Error(`count must be an integer between 1 and ${config.quizMaxCount}`);
    e.status = 400;
    throw e;
  }
  for (const [name, value, allowed] of [['difficulty', difficulty, DIFFICULTIES], ['type', type, QUESTION_TYPES], ['mode', mode, MODES]]) {
    if (!allowed.includes(value)) {
      const e = new Error(`${name} must be one of: ${allowed.join(', ')}`);
      e.status = 400;
      throw e;
    }
  }
  return { count: n, difficulty, type, mode };
}

/**
 * Generate + validate + store a quiz (kind 'quiz') or practice set (kind 'practice').
 * @param {object} args  { doc, userId, kind, count, difficulty, type, mode }
 * @param {object} [deps] injectable for tests: { generate, Quiz }
 * @returns {Promise<{quiz: object, provider: string, warnings: string[]}>}
 */
export async function createQuestionSet({ doc, userId, kind = 'quiz', ...opts }, deps = {}) {
  const { count, difficulty, type, mode } = normalizeOptions(opts);
  const Quiz = deps.Quiz || QuizModel;

  const selected = selectChunks(doc, { mode, count });
  if (!selected.length) {
    const e = new Error('document has no chunks to base questions on');
    e.status = 409;
    throw e;
  }
  const labels = selected.map((c) => c.label);

  const prompt = renderPrompt(kind === 'practice' ? 'practice_generate' : 'quiz_generate', {
    document_title: doc.title,
    count,
    difficulty_guidance: loadPrompt(`quiz_difficulty_${difficulty}`).trim(),
    type_guidance: loadPrompt(`quiz_type_${type}`).trim(),
    mode_guidance: loadPrompt(`quiz_mode_${mode}`).trim(),
    context: formatQuestionContext(selected),
  });

  const result = await generateStructured(prompt, {
    schema: buildQuestionsSchema({ type, count, labels }),
    system: loadPrompt('system_json'),
    generate: deps.generate,
  });

  const byLabel = new Map(selected.map((c) => [c.label, c]));
  const topicOf = chunkTopicMap(doc);
  const warnings = [];
  if (result.data.length < count) warnings.push(`only ${result.data.length} of ${count} requested questions were produced`);
  if (result.data.some((q) => q.sourceChunk === null)) warnings.push('some questions did not cite a valid source chunk');
  if (result.fellBack) warnings.push(`primary provider failed; answered by ${result.provider}`);

  const questions = result.data.map((q, i) => {
    const chunk = q.sourceChunk ? byLabel.get(q.sourceChunk) : null;
    const topic = chunk ? topicOf.get(chunk.id) : null;
    return {
      id: `q${i + 1}`,
      ...q,
      chunkId: chunk?.id ?? null,
      topicId: topic?.id ?? null,
      topicLabel: topic?.label ?? 'General',
    };
  });

  const quiz = await Quiz.create({
    userId,
    documentId: doc._id,
    kind,
    mode,
    difficulty,
    type,
    count: questions.length,
    questions,
    provider: result.provider,
    chunkIds: selected.map((c) => c.id),
  });

  return { quiz: quiz.toObject ? quiz.toObject() : quiz, provider: result.provider, warnings };
}

/**
 * What the client may see. While a quiz is being taken, answers/explanations stay server-side
 * (they come back with the graded attempt). Practice sets ship model answers up front.
 */
export function toClientQuiz(quiz, { reveal = quiz.kind === 'practice' } = {}) {
  return {
    id: String(quiz._id),
    documentId: String(quiz.documentId),
    kind: quiz.kind,
    mode: quiz.mode,
    difficulty: quiz.difficulty,
    type: quiz.type,
    count: quiz.questions.length,
    provider: quiz.provider,
    createdAt: quiz.createdAt,
    questions: quiz.questions.map((q) => ({
      id: q.id,
      type: q.type,
      question: q.question,
      options: q.options,
      sourceChunk: q.sourceChunk,
      topicLabel: q.topicLabel,
      ...(reveal ? { answer: q.answer, explanation: q.explanation } : {}),
    })),
  };
}
