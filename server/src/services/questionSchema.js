import { z } from 'zod';

const LETTER = /^\(?([A-Fa-f])[).:]?\)?$|^option\s+([A-Fa-f])$/i;
const stripLetterPrefix = (s) => s.replace(/^\s*\(?[A-Fa-f][).:]\s+/, '').trim();
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Resolve an MCQ answer ("B", "Option B", "B) text" or the exact text) to the exact option text, or null. */
export function resolveMcqAnswer(answer, options) {
  const a = answer.trim();
  const letter = a.match(LETTER);
  if (letter) {
    const idx = (letter[1] || letter[2]).toUpperCase().charCodeAt(0) - 65;
    return options[idx] ?? null;
  }
  const exact = options.find((o) => norm(o) === norm(a) || norm(o) === norm(stripLetterPrefix(a)));
  return exact ?? null;
}

/**
 * zod schema for the LLM's question list.
 * Accepts either {"questions":[...]} (what our prompts ask for; Groq's JSON mode needs an object)
 * or a bare array, and normalises to an array of clean questions.
 *
 * @param {{type: 'mcq'|'short'|'mixed', count: number, labels: number[]}} opts
 *   labels = chunk numbers that were shown to the model (sourceChunk must be one of them, else null)
 */
export function buildQuestionsSchema({ type, count, labels }) {
  const allowed = new Set(labels);

  const item = z
    .object({
      question: z.string({ required_error: 'question is required' }).trim().min(8, 'question is too short'),
      options: z.array(z.string().trim().min(1)).max(6).nullish(),
      answer: z.string({ required_error: 'answer is required' }).trim().min(1, 'answer is empty'),
      explanation: z.string({ required_error: 'explanation is required' }).trim().min(3, 'explanation is too short'),
      sourceChunk: z.union([z.number(), z.string()]).nullish(),
    })
    .transform((q, ctx) => {
      const options = (q.options ?? []).map(stripLetterPrefix);
      const isMcq = type === 'mcq' || (type === 'mixed' && options.length >= 2);

      let answer = q.answer;
      let finalOptions = [];
      if (isMcq) {
        if (options.length < 2) {
          ctx.addIssue({ code: 'custom', message: 'multiple-choice question needs at least 2 options' });
          return z.NEVER;
        }
        if (new Set(options.map(norm)).size !== options.length) {
          ctx.addIssue({ code: 'custom', message: 'options must be distinct' });
          return z.NEVER;
        }
        const resolved = resolveMcqAnswer(q.answer, options);
        if (!resolved) {
          ctx.addIssue({ code: 'custom', message: '"answer" must be exactly one of the options' });
          return z.NEVER;
        }
        answer = resolved;
        finalOptions = options;
      }

      const n = q.sourceChunk === null || q.sourceChunk === undefined ? NaN : Number(String(q.sourceChunk).replace(/[^\d]/g, ''));
      return {
        type: isMcq ? 'mcq' : 'short',
        question: q.question,
        options: finalOptions,
        answer,
        explanation: q.explanation,
        sourceChunk: allowed.has(n) ? n : null,
      };
    });

  return z
    .union([z.array(item), z.object({ questions: z.array(item) })], {
      errorMap: () => ({ message: 'expected {"questions":[...]} with valid question objects' }),
    })
    .transform((v) => (Array.isArray(v) ? v : v.questions))
    .refine((qs) => qs.length >= 1, { message: 'no questions returned' })
    .refine((qs) => qs.length >= Math.ceil(count * 0.6), {
      message: `expected about ${count} questions but got too few`,
    })
    .transform((qs) => qs.slice(0, count));
}
