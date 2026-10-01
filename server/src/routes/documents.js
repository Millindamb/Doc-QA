import { Router } from 'express';
import fs from 'node:fs';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { Document } from '../models/Document.js';
import { ingestWithNlpService, analyzeWithNlpService } from '../services/nlpClient.js';
import { extractTextWithLlm } from '../services/llmOcr.js';
import { generateKeyPoints } from '../services/keyPoints.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

const MIME_TO_SOURCE_TYPE = {
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'text/plain': 'text',
};

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function applyIngestResult(doc, ingestResult) {
  doc.rawText = ingestResult.raw_text ?? '';
  doc.cleanedText = ingestResult.cleaned_text ?? '';
  doc.chunks = (ingestResult.chunks || []).map((c) => ({
    id: c.id,
    text: c.text,
    heading: c.heading || '',
    position: c.position,
    tokenCount: c.token_count,
  }));
  doc.headings = (ingestResult.headings || []).map((h) => ({
    text: h.text,
    level: h.level,
    blockIndex: h.block_index,
    charOffset: h.char_offset,
  }));
  doc.ocrConfidence = ingestResult.ocr_confidence ?? null;
  doc.needsLlmOcr = Boolean(ingestResult.needs_llm_ocr);
  doc.pageCount = ingestResult.page_count ?? 1;
  doc.warnings = ingestResult.warnings || [];
}

/**
 * POST /api/documents/upload
 * multipart/form-data with either:
 *   - `file`: a pdf/png/jpg/txt file, plus optional `title`
 *   - `text` + `title`: raw text, no file
 */
router.post('/upload', upload.single('file'), async (req, res, next) => {
  let doc;
  try {
    const { title, text } = req.body || {};
    const file = req.file;

    if (!file && (!text || !String(text).trim())) {
      return res.status(400).json({ error: 'provide either a `file` or non-empty `text`' });
    }

    const sourceType = file ? MIME_TO_SOURCE_TYPE[file.mimetype] : 'text';
    const resolvedTitle =
      (title && String(title).trim()) ||
      (file ? file.originalname : String(text).slice(0, 60)) ||
      'Untitled document';

    doc = await Document.create({
      userId: req.userId,
      title: resolvedTitle,
      sourceType,
      originalFilename: file ? file.originalname : null,
      status: 'processing',
    });

    let ingestResult = await ingestWithNlpService({
      filePath: file ? file.path : undefined,
      originalName: file ? file.originalname : undefined,
      mimeType: file ? file.mimetype : undefined,
      sourceType,
      text: file ? undefined : text,
    });

    let llmOcrUsed = false;
    let llmOcrProvider = null;

    // Local OCR/extraction wasn't confident enough: fall back to Gemini's
    // file input to re-extract text, then re-run our own cleaning/chunking
    // on that text. The uploaded file is still on disk at this point.
    if (ingestResult.needs_llm_ocr && file && (sourceType === 'pdf' || sourceType === 'image')) {
      try {
        const { text: extractedText, provider } = await extractTextWithLlm(file.path, file.mimetype);
        if (extractedText && extractedText.trim()) {
          ingestResult = await ingestWithNlpService({ sourceType: 'text', text: extractedText });
          llmOcrUsed = true;
          llmOcrProvider = provider;
        }
      } catch (err) {
        console.warn(`[upload] LLM OCR fallback failed for document ${doc._id}: ${err.message}`);
        ingestResult.warnings = [...(ingestResult.warnings || []), `LLM OCR fallback failed: ${err.message}`];
      }
    }

    applyIngestResult(doc, ingestResult);
    doc.llmOcrUsed = llmOcrUsed;
    doc.llmOcrProvider = llmOcrProvider;
    doc.status = 'ready';
    await doc.save();

    res.status(201).json(doc.toDetailJSON());
  } catch (err) {
    if (doc) {
      doc.status = 'failed';
      doc.errorMessage = err.message;
      await doc.save().catch(() => {});
    }
    next(err);
  } finally {
    if (req.file) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }
});

// GET /api/documents
router.get('/', async (req, res, next) => {
  try {
    const docs = await Document.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json(docs.map((d) => d.toSummaryJSON()));
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/:id
router.get('/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'invalid document id' });
    }
    const doc = await Document.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ error: 'document not found' });
    res.json(doc.toDetailJSON());
  } catch (err) {
    next(err);
  }
});

// DELETE /api/documents/:id
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'invalid document id' });
    }
    const doc = await Document.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ error: 'document not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents/:id/analyze
 * Runs keyword/topic/summary/importance analysis (nlp-service /analyze),
 * then generates LLM key points per topic, and stores everything.
 */
router.post('/:id/analyze', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'invalid document id' });
    }
    const doc = await Document.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ error: 'document not found' });
    if (!doc.chunks || doc.chunks.length === 0) {
      return res.status(400).json({ error: 'document has no chunks to analyze; is it still processing?' });
    }

    const analysis = await analyzeWithNlpService(doc.chunks, {
      topNSummary: config.analyzeSummaryTopN,
      topNKeywords: config.analyzeKeywordsTopN,
    });

    const embeddingByChunkId = new Map((analysis.embeddings || []).map((e) => [e.chunk_id, e.vector]));
    doc.chunks = doc.chunks.map((c) => {
      const plain = c.toObject ? c.toObject() : c;
      const vector = embeddingByChunkId.get(plain.id);
      return vector ? { ...plain, embedding: vector } : plain;
    });

    doc.keywords = (analysis.keywords || []).map((k) => ({
      term: k.term,
      score: k.score,
      sources: k.sources,
    }));
    doc.topics = (analysis.topics || []).map((t) => ({
      id: t.id,
      label: t.label,
      topTerms: t.top_terms,
      chunkIds: t.chunk_ids,
      size: t.size,
    }));
    doc.summarySentences = (analysis.summary_sentences || []).map((s) => ({
      text: s.text,
      score: s.score,
      position: s.position,
      chunkId: s.chunk_id,
    }));
    doc.importanceSentences = (analysis.importance_sentences || []).map((s) => ({
      text: s.text,
      chunkId: s.chunk_id,
      position: s.position,
      score: s.score,
      features: s.features,
    }));
    doc.importanceChunks = (analysis.importance_chunks || []).map((c) => ({
      chunkId: c.chunk_id,
      score: c.score,
      features: c.features,
    }));
    doc.embeddingModel = analysis.embedding_model;
    doc.embeddingDim = analysis.embedding_dim;
    doc.analysisWarnings = [...(analysis.warnings || [])];

    // key points: LLM sees only top TextRank sentences + keywords + topic labels
    const { keyPoints, provider, warnings: kpWarnings } = await generateKeyPoints({
      topics: doc.topics,
      keywords: doc.keywords,
      summarySentences: doc.summarySentences,
    });
    doc.keyPoints = keyPoints;
    doc.keyPointsProvider = provider;
    doc.analysisWarnings = [...doc.analysisWarnings, ...kpWarnings];
    doc.analyzedAt = new Date();

    await doc.save();
    res.json(doc.toAnalysisJSON());
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/:id/analysis — returns the stored analysis (run POST /analyze first)
router.get('/:id/analysis', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'invalid document id' });
    }
    const doc = await Document.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ error: 'document not found' });
    if (!doc.analyzedAt) {
      return res.status(404).json({
        error: 'document has not been analyzed yet; POST /api/documents/:id/analyze first',
      });
    }
    res.json(doc.toAnalysisJSON());
  } catch (err) {
    next(err);
  }
});

export default router;
