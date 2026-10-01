import mongoose from 'mongoose';

const sourceSchema = new mongoose.Schema(
  {
    label: Number, // 1-based chunk number cited in the answer, e.g. [3]
    chunkId: String,
    position: Number,
    heading: String,
    rank: Number,
    relevance: Number,
    finalScore: Number,
    cited: Boolean,
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },

    // ---- Part 3: chat metadata (set on assistant messages; `mode` also on user messages) ----
    mode: { type: String, enum: ['knowledge', 'exam'] },
    intent: { type: String, enum: ['question', 'doubt', 'quiz', 'practice', 'research', 'resources'] },
    provider: { type: String, default: null }, // 'gemini' | 'groq' | null (no LLM call)
    insufficient: { type: Boolean, default: false },
    sources: { type: [sourceSchema], default: undefined },
    payload: { type: mongoose.Schema.Types.Mixed, default: undefined }, // Part 4: quiz id / research sources / resources for UI cards
  },
  { _id: false }
);

const chatSessionSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mode: { type: String, enum: ['knowledge', 'exam'], default: 'knowledge' },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true }
);

export const ChatSession = mongoose.model('ChatSession', chatSessionSchema);
