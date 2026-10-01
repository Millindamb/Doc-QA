import { QUESTION_TYPES } from './quizService.js';

/** Pull count / difficulty / type out of a chat message like "quiz me with 8 hard multiple choice questions". */
export function parseQuizRequest(message, { maxCount = 20, defaultCount = 5 } = {}) {
  const m = String(message || '').toLowerCase();
  const num = m.match(/\b(\d{1,4})\b/);
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
  const wordNum = Object.entries(words).find(([w]) => new RegExp(`\\b${w}\\b`).test(m));
  let count = num ? Number(num[1]) : wordNum ? wordNum[1] : defaultCount;
  if (!Number.isFinite(count) || count < 1) count = defaultCount;
  count = Math.min(maxCount, count);

  const difficulty = /\b(easy|beginner|simple|basic)\b/.test(m) ? 'easy' : /\b(hard|difficult|challenging|advanced|tough)\b/.test(m) ? 'hard' : 'medium';
  let type = 'mixed';
  if (/\b(mcqs?|multiple[- ]choice)\b/.test(m)) type = 'mcq';
  else if (/\b(short[- ]answer|written|essay|viva|long[- ]answer|explain)\b/.test(m)) type = 'short';
  return { count, difficulty, type: QUESTION_TYPES.includes(type) ? type : 'mixed' };
}
