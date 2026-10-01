import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { Document as DocumentModel } from '../models/Document.js';
import { ChatSession as ChatSessionModel } from '../models/ChatSession.js';
import { runChatTurn } from '../services/chat.js';
import { config } from '../config.js';

const MODES = ['knowledge', 'exam'];
const isValidObjectId = (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);

/**
 * Factory so tests can inject in-memory models / a fake chat turn (no MongoDB needed).
 * The default export below wires the real ones.
 */
export function createChatRouter({ Document = DocumentModel, ChatSession = ChatSessionModel, runTurn = runChatTurn } = {}) {
  const router = Router();
  router.use(requireAuth);

  /**
   * POST /api/chat  { documentId, sessionId?, message, mode? }
   * -> { sessionId, answer, sources[], intent, provider, mode, insufficient, routing, retrieval, warnings }
   */
  router.post('/', async (req, res, next) => {
    try {
      const { documentId, sessionId, message, mode } = req.body || {};

      if (!isValidObjectId(documentId)) return res.status(400).json({ error: 'documentId is required and must be a valid id' });
      if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message must be a non-empty string' });
      if (message.length > config.chatMessageMaxChars) {
        return res.status(400).json({ error: `message is too long (max ${config.chatMessageMaxChars} characters)` });
      }
      if (mode !== undefined && !MODES.includes(mode)) {
        return res.status(400).json({ error: `mode must be one of: ${MODES.join(', ')}` });
      }
      if (sessionId !== undefined && sessionId !== null && !isValidObjectId(sessionId)) {
        return res.status(400).json({ error: 'sessionId must be a valid id' });
      }

      const doc = await Document.findOne({ _id: documentId, userId: req.userId })
        .select('title status chunks importanceChunks embeddingModel topics keywords keyPoints analyzedAt')
        .lean();
      if (!doc) return res.status(404).json({ error: 'document not found' });
      if (doc.status !== 'ready' || !doc.chunks?.length) {
        return res.status(409).json({ error: 'document is not ready (no chunks yet)' });
      }

      let session = null;
      if (sessionId) {
        session = await ChatSession.findOne({ _id: sessionId, userId: req.userId, documentId });
        if (!session) return res.status(404).json({ error: 'chat session not found for this document' });
      }

      const resolvedMode = mode ?? session?.mode ?? 'knowledge';
      // conversation memory: the last N messages BEFORE this one
      const history = (session?.messages ?? [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-config.chatHistoryMessages)
        .map((m) => ({ role: m.role, content: m.content }));

      const turn = await runTurn({ doc, mode: resolvedMode, message: message.trim(), history, userId: req.userId });

      const userMsg = { role: 'user', content: message.trim(), mode: resolvedMode };
      const assistantMsg = {
        role: 'assistant',
        content: turn.answer,
        mode: resolvedMode,
        intent: turn.intent,
        provider: turn.provider,
        insufficient: turn.insufficient,
        payload: turn.payload ?? undefined,
        sources: turn.sources.map(({ label, chunkId, position, heading, rank, relevance, finalScore, cited }) => ({
          label, chunkId, position, heading, rank, relevance, finalScore, cited,
        })),
      };

      if (session) {
        session.messages.push(userMsg, assistantMsg);
        session.mode = resolvedMode;
        await session.save();
      } else {
        session = await ChatSession.create({
          documentId,
          userId: req.userId,
          mode: resolvedMode,
          messages: [userMsg, assistantMsg],
        });
      }

      res.json({
        sessionId: String(session._id),
        answer: turn.answer,
        sources: turn.sources,
        intent: turn.intent,
        provider: turn.provider,
        mode: turn.mode,
        insufficient: turn.insufficient,
        payload: turn.payload,
        routing: turn.routing,
        retrieval: turn.retrieval,
        warnings: turn.warnings,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/chat/sessions?documentId=...
  router.get('/sessions', async (req, res, next) => {
    try {
      const filter = { userId: req.userId };
      if (req.query.documentId) {
        if (!isValidObjectId(String(req.query.documentId))) return res.status(400).json({ error: 'invalid documentId' });
        filter.documentId = String(req.query.documentId);
      }
      const sessions = await ChatSession.find(filter).sort({ updatedAt: -1 });
      res.json(
        sessions.map((s) => ({
          id: String(s._id),
          documentId: String(s.documentId),
          mode: s.mode,
          messageCount: s.messages.length,
          updatedAt: s.updatedAt,
        }))
      );
    } catch (err) {
      next(err);
    }
  });

  // GET /api/chat/sessions/:id
  router.get('/sessions/:id', async (req, res, next) => {
    try {
      if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'invalid session id' });
      const s = await ChatSession.findOne({ _id: req.params.id, userId: req.userId });
      if (!s) return res.status(404).json({ error: 'chat session not found' });
      res.json({
        id: String(s._id),
        documentId: String(s.documentId),
        mode: s.mode,
        messages: s.messages,
        updatedAt: s.updatedAt,
      });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/chat/sessions/:id
  router.delete('/sessions/:id', async (req, res, next) => {
    try {
      if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'invalid session id' });
      const s = await ChatSession.findOneAndDelete({ _id: req.params.id, userId: req.userId });
      if (!s) return res.status(404).json({ error: 'chat session not found' });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createChatRouter();
