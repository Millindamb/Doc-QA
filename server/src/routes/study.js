import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { Document as DocumentModel } from '../models/Document.js';
import { runResearch } from '../services/researchService.js';
import { runResources } from '../services/resourcesService.js';
import { loadOwnedDocument } from './helpers.js';

function studyHandler(Document, run) {
  return async (req, res, next) => {
    try {
      const { documentId, query } = req.body || {};
      if (query !== undefined && (typeof query !== 'string' || query.length > 300)) {
        return res.status(400).json({ error: 'query must be a string of at most 300 characters' });
      }
      const doc = await loadOwnedDocument(Document, req, res, documentId, { requireChunks: false });
      if (!doc) return undefined;
      if (!doc.analyzedAt && !query?.trim()) {
        return res.status(409).json({ error: 'analyze the document first (POST /api/documents/:id/analyze) or pass a query' });
      }
      return res.json(await run({ doc, query: query?.trim() || undefined }));
    } catch (err) {
      return next(err);
    }
  };
}

/** POST /api/research  {documentId, query?}  -> cited summary + real source links */
export function createResearchRouter({ Document = DocumentModel, run = runResearch } = {}) {
  const router = Router();
  router.use(requireAuth);
  router.post('/', studyHandler(Document, run));
  return router;
}

/** POST /api/resources  {documentId, query?}  -> ranked YouTube videos, Wikipedia links, labeled AI suggestions */
export function createResourcesRouter({ Document = DocumentModel, run = runResources } = {}) {
  const router = Router();
  router.use(requireAuth);
  router.post('/', studyHandler(Document, run));
  return router;
}

