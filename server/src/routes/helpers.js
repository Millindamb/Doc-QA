import mongoose from 'mongoose';

export const isValidObjectId = (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);

/** Load the caller's own document (lean) or send the right 4xx and return null. */
export async function loadOwnedDocument(Document, req, res, documentId, { requireChunks = true } = {}) {
  if (!isValidObjectId(documentId)) {
    res.status(400).json({ error: 'documentId is required and must be a valid id' });
    return null;
  }
  const doc = await Document.findOne({ _id: documentId, userId: req.userId })
    .select('title status chunks importanceChunks embeddingModel topics keywords keyPoints analyzedAt')
    .lean();
  if (!doc) {
    res.status(404).json({ error: 'document not found' });
    return null;
  }
  if (requireChunks && (doc.status !== 'ready' || !doc.chunks?.length)) {
    res.status(409).json({ error: 'document is not ready (no chunks yet)' });
    return null;
  }
  return doc;
}
