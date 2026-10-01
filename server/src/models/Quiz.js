import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // q1, q2, ...
    type: { type: String, enum: ['mcq', 'short'], required: true },
    question: { type: String, required: true },
    options: { type: [String], default: [] },
    answer: { type: String, required: true }, // mcq: exact option text; short: model answer
    explanation: { type: String, default: '' },
    sourceChunk: { type: Number, default: null }, // 1-based chunk number, same as chat citations
    chunkId: { type: String, default: null },
    topicId: { type: String, default: null },
    topicLabel: { type: String, default: 'General' },
  },
  { _id: false }
);

const quizSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    kind: { type: String, enum: ['quiz', 'practice'], required: true },
    mode: { type: String, enum: ['knowledge', 'exam'], default: 'knowledge' },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    type: { type: String, enum: ['mcq', 'short', 'mixed'], default: 'mixed' },
    count: { type: Number, required: true },
    questions: { type: [questionSchema], default: [] },
    provider: { type: String, default: null },
    chunkIds: { type: [String], default: [] }, // chunks the questions were based on
  },
  { timestamps: true }
);

export const Quiz = mongoose.model('Quiz', quizSchema);
