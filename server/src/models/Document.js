import mongoose from 'mongoose';

const chunkSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    heading: { type: String, default: '' },
    position: { type: Number, required: true },
    tokenCount: { type: Number, required: true },
    embedding: { type: [Number], default: undefined }, // set once /analyze has run
  },
  { _id: false }
);

const keywordSchema = new mongoose.Schema(
  {
    term: { type: String, required: true },
    score: { type: Number, required: true },
    sources: { type: [String], default: [] }, // subset of ['tfidf','rake','yake']
  },
  { _id: false }
);

const topicSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    topTerms: { type: [String], default: [] },
    chunkIds: { type: [String], default: [] },
    size: { type: Number, default: 0 },
  },
  { _id: false }
);

const summarySentenceSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    score: { type: Number, required: true },
    position: { type: Number, required: true },
    chunkId: { type: String, required: true },
  },
  { _id: false }
);

const importanceFeaturesSchema = new mongoose.Schema(
  {
    tfidf: Number,
    heading: Number,
    definition: Number,
    numeric: Number,
    position: Number,
    textrank: Number,
  },
  { _id: false }
);

const sentenceImportanceSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    chunkId: { type: String, required: true },
    position: { type: Number, required: true },
    score: { type: Number, required: true },
    features: importanceFeaturesSchema,
  },
  { _id: false }
);

const chunkImportanceSchema = new mongoose.Schema(
  {
    chunkId: { type: String, required: true },
    score: { type: Number, required: true },
    features: importanceFeaturesSchema,
  },
  { _id: false }
);

const keyPointsEntrySchema = new mongoose.Schema(
  {
    topic: { type: String, required: true },
    keyPoints: { type: [String], default: [] },
    importantTerms: { type: [String], default: [] },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    sourceType: { type: String, enum: ['pdf', 'image', 'text'], required: true },
    originalFilename: { type: String, default: null },

    rawText: { type: String, default: '' },
    cleanedText: { type: String, default: '' },

    chunks: { type: [chunkSchema], default: [] },
    headings: {
      type: [
        {
          text: String,
          level: Number,
          blockIndex: Number,
          charOffset: Number,
          _id: false,
        },
      ],
      default: [],
    },

    ocrConfidence: { type: Number, default: null },
    needsLlmOcr: { type: Boolean, default: false },
    llmOcrUsed: { type: Boolean, default: false },
    llmOcrProvider: { type: String, default: null },
    pageCount: { type: Number, default: 1 },
    warnings: { type: [String], default: [] },

    // ---- Part 2: analysis ----
    keywords: { type: [keywordSchema], default: [] },
    topics: { type: [topicSchema], default: [] },
    summarySentences: { type: [summarySentenceSchema], default: [] },
    importanceSentences: { type: [sentenceImportanceSchema], default: [] },
    importanceChunks: { type: [chunkImportanceSchema], default: [] },
    keyPoints: { type: [keyPointsEntrySchema], default: [] },
    embeddingModel: { type: String, default: null },
    embeddingDim: { type: Number, default: 0 },
    analyzedAt: { type: Date, default: null },
    keyPointsProvider: { type: String, default: null }, // 'gemini' | 'groq'
    analysisWarnings: { type: [String], default: [] },

    status: {
      type: String,
      enum: ['pending', 'processing', 'ready', 'failed'],
      default: 'pending',
    },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true }
);

documentSchema.index({ userId: 1, createdAt: -1 });

documentSchema.methods.toSummaryJSON = function toSummaryJSON() {
  return {
    id: this._id.toString(),
    title: this.title,
    sourceType: this.sourceType,
    status: this.status,
    pageCount: this.pageCount,
    chunkCount: this.chunks.length,
    needsLlmOcr: this.needsLlmOcr,
    analyzed: Boolean(this.analyzedAt),
    createdAt: this.createdAt,
  };
};

documentSchema.methods.toDetailJSON = function toDetailJSON() {
  return {
    id: this._id.toString(),
    userId: this.userId.toString(),
    title: this.title,
    sourceType: this.sourceType,
    originalFilename: this.originalFilename,
    rawText: this.rawText,
    cleanedText: this.cleanedText,
    chunks: this.chunks,
    headings: this.headings,
    ocrConfidence: this.ocrConfidence,
    needsLlmOcr: this.needsLlmOcr,
    llmOcrUsed: this.llmOcrUsed,
    llmOcrProvider: this.llmOcrProvider,
    pageCount: this.pageCount,
    warnings: this.warnings,
    status: this.status,
    errorMessage: this.errorMessage,
    analyzed: Boolean(this.analyzedAt),
    analyzedAt: this.analyzedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

/** Full analysis payload for GET /api/documents/:id/analysis */
documentSchema.methods.toAnalysisJSON = function toAnalysisJSON() {
  return {
    id: this._id.toString(),
    analyzedAt: this.analyzedAt,
    keywords: this.keywords,
    topics: this.topics,
    summarySentences: this.summarySentences,
    importance: {
      sentences: this.importanceSentences,
      chunks: this.importanceChunks,
    },
    keyPoints: this.keyPoints,
    keyPointsProvider: this.keyPointsProvider,
    embeddingModel: this.embeddingModel,
    embeddingDim: this.embeddingDim,
    warnings: this.analysisWarnings,
  };
};

export const Document = mongoose.model('Document', documentSchema);
