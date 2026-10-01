import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { Document as DocumentModel } from '../models/Document.js';
import { Quiz as QuizModel } from '../models/Quiz.js';
import { QuizAttempt as QuizAttemptModel } from '../models/QuizAttempt.js';
import { createQuestionSet, toClientQuiz } from '../services/quizService.js';
import { aggregateWeakAreas, gradeAttempt } from '../services/grading.js';
import { isValidObjectId, loadOwnedDocument } from './helpers.js';

const defaultDeps = { Document: DocumentModel, Quiz: QuizModel, QuizAttempt: QuizAttemptModel, createSet: createQuestionSet };

function generateHandler(kind, d) {
  return async (req, res, next) => {
    try {
      const { documentId, count, difficulty, type, mode } = req.body || {};
      const doc = await loadOwnedDocument(d.Document, req, res, documentId);
      if (!doc) return undefined;
      if (!doc.analyzedAt) {
        // works without analysis (evenly spaced chunks), but say so
        req.warnings = ['document has not been analyzed; questions are spread evenly instead of by importance/topic'];
      }
      const { quiz, provider, warnings } = await d.createSet({ doc, userId: req.userId, kind, count, difficulty, type, mode });
      return res.status(201).json({ ...toClientQuiz(quiz), provider, warnings: [...(req.warnings || []), ...warnings] });
    } catch (err) {
      return next(err);
    }
  };
}

/** POST /api/practice  (practice questions + model answers) */
export function createPracticeRouter(deps = {}) {
  const d = { ...defaultDeps, ...deps };
  const router = Router();
  router.use(requireAuth);
  router.post('/', generateHandler('practice', d));
  return router;
}

/**
 * /api/quiz
 *   POST /                    {documentId, count, difficulty, type, mode}  -> new quiz (answers hidden)
 *   GET  /?documentId=        list quizzes/practice sets of a document
 *   GET  /weak-areas?documentId=   per-topic accuracy across all attempts, weakest first
 *   GET  /:id                 quiz (answers hidden for kind=quiz)
 *   POST /:id/attempts        {answers:[{questionId,response}]} -> graded attempt (+ answers & explanations)
 *   GET  /:id/attempts        past attempts
 */
export function createQuizRouter(deps = {}) {
  const d = { ...defaultDeps, ...deps };
  const router = Router();
  router.use(requireAuth);

  router.post('/', generateHandler('quiz', d));

  router.get('/', async (req, res, next) => {
    try {
      const filter = { userId: req.userId };
      if (req.query.documentId) {
        if (!isValidObjectId(String(req.query.documentId))) return res.status(400).json({ error: 'invalid documentId' });
        filter.documentId = String(req.query.documentId);
      }
      const quizzes = await d.Quiz.find(filter).sort({ createdAt: -1 });
      return res.json(
        quizzes.map((q) => ({ id: String(q._id), kind: q.kind, mode: q.mode, difficulty: q.difficulty, type: q.type, count: q.questions.length, createdAt: q.createdAt }))
      );
    } catch (err) {
      return next(err);
    }
  });

  router.get('/weak-areas', async (req, res, next) => {
    try {
      const documentId = String(req.query.documentId || '');
      if (!isValidObjectId(documentId)) return res.status(400).json({ error: 'documentId query parameter is required' });
      const attempts = await d.QuizAttempt.find({ userId: req.userId, documentId }).sort({ createdAt: -1 });
      return res.json({ attempts: attempts.length, topics: aggregateWeakAreas(attempts) });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'invalid quiz id' });
      const quiz = await d.Quiz.findOne({ _id: req.params.id, userId: req.userId });
      if (!quiz) return res.status(404).json({ error: 'quiz not found' });
      return res.json(toClientQuiz(quiz));
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:id/attempts', async (req, res, next) => {
    try {
      if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'invalid quiz id' });
      const answers = req.body?.answers;
      if (!Array.isArray(answers) || answers.some((a) => !a || typeof a.questionId !== 'string')) {
        return res.status(400).json({ error: 'answers must be an array of {questionId, response}' });
      }
      const quiz = await d.Quiz.findOne({ _id: req.params.id, userId: req.userId });
      if (!quiz) return res.status(404).json({ error: 'quiz not found' });
      if (quiz.kind !== 'quiz') return res.status(409).json({ error: 'practice sets are not graded; use a quiz' });

      const graded = gradeAttempt(quiz, answers);
      const attempt = await d.QuizAttempt.create({
        userId: req.userId,
        documentId: quiz.documentId,
        quizId: quiz._id,
        answers: graded.items.map(({ questionId, response, correct, score, topicId, label }) => ({ questionId, response, correct, score, topicId, topicLabel: label })),
        score: graded.score,
        total: graded.total,
        percent: graded.percent,
        perTopic: graded.perTopic,
      });

      const byId = new Map(quiz.questions.map((q) => [q.id, q]));
      return res.status(201).json({
        attemptId: String(attempt._id),
        score: graded.score,
        total: graded.total,
        percent: graded.percent,
        perTopic: graded.perTopic,
        weakTopics: graded.perTopic.filter((t) => t.percent < 60),
        results: graded.items.map((it) => {
          const q = byId.get(it.questionId);
          return {
            questionId: it.questionId,
            response: it.response,
            correct: it.correct,
            score: it.score,
            missing: it.missing,
            answer: q.answer,
            explanation: q.explanation,
            sourceChunk: q.sourceChunk,
            topicLabel: q.topicLabel,
          };
        }),
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:id/attempts', async (req, res, next) => {
    try {
      if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'invalid quiz id' });
      const attempts = await d.QuizAttempt.find({ userId: req.userId, quizId: req.params.id }).sort({ createdAt: -1 });
      return res.json(attempts.map((a) => ({ id: String(a._id), score: a.score, total: a.total, percent: a.percent, perTopic: a.perTopic, createdAt: a.createdAt })));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
