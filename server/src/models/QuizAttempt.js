import mongoose from 'mongoose';

const answerSchema = new mongoose.Schema(
  {
    questionId: String,
    response: { type: String, default: '' },
    correct: Boolean,
    score: Number, // 0..1 (short answers can earn partial credit)
    topicId: String,
    topicLabel: String,
  },
  { _id: false }
);

const topicScoreSchema = new mongoose.Schema(
  { topicId: String, label: String, earned: Number, total: Number, percent: Number },
  { _id: false }
);

const quizAttemptSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
    answers: { type: [answerSchema], default: [] },
    score: { type: Number, required: true }, // sum of per-question scores
    total: { type: Number, required: true },
    percent: { type: Number, required: true },
    perTopic: { type: [topicScoreSchema], default: [] },
  },
  { timestamps: true }
);

export const QuizAttempt = mongoose.model('QuizAttempt', quizAttemptSchema);
