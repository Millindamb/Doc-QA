import 'dotenv/config';

function required(name, fallback) {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}

export const config = {
  port: Number(process.env.PORT || 5000),
  mongoUri: required('MONGODB_URI', 'mongodb://localhost:27017/docqa'),
  jwtSecret: required('JWT_SECRET', 'dev_secret_change_me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  nlpServiceUrl: process.env.NLP_SERVICE_URL || 'http://localhost:8000',
  nlpInternalKey: process.env.NLP_INTERNAL_KEY || '',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 20),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  // ---- Part 2: LLM wrapper (Gemini primary, Groq fallback) ----
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 30000),
  llmMaxRetries: Number(process.env.LLM_MAX_RETRIES || 1),

  // ---- Part 3: chat ----
  nlpTimeoutMs: Number(process.env.NLP_TIMEOUT_MS || 30000),
  chatHistoryMessages: Number(process.env.CHAT_HISTORY_MESSAGES || 6),
  chatHistoryMaxChars: Number(process.env.CHAT_HISTORY_MAX_CHARS || 1500),
  chatMessageMaxChars: Number(process.env.CHAT_MESSAGE_MAX_CHARS || 4000),
  chatSourceSnippetChars: Number(process.env.CHAT_SOURCE_SNIPPET_CHARS || 240),

  // ---- Part 4: quiz / research / resources ----
  quizMaxCount: Number(process.env.QUIZ_MAX_COUNT || 20),
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  serpapiApiKey: process.env.SERPAPI_API_KEY || '',
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  searchTimeoutMs: Number(process.env.SEARCH_TIMEOUT_MS || 10000),
  researchMaxSources: Number(process.env.RESEARCH_MAX_SOURCES || 6),
  // YouTube ranking: weights are normalised, so they only need to be relative
  ytWeightTitle: Number(process.env.YT_WEIGHT_TITLE || 0.4),
  ytWeightViews: Number(process.env.YT_WEIGHT_VIEWS || 0.25),
  ytWeightRecency: Number(process.env.YT_WEIGHT_RECENCY || 0.2),
  ytWeightDuration: Number(process.env.YT_WEIGHT_DURATION || 0.15),
  ytMinMinutes: Number(process.env.YT_MIN_MINUTES || 5),
  ytMaxMinutes: Number(process.env.YT_MAX_MINUTES || 40),
  ytMaxResults: Number(process.env.YT_MAX_RESULTS || 6),

  // analysis defaults
  analyzeSummaryTopN: Number(process.env.ANALYZE_SUMMARY_TOP_N || 5),
  analyzeKeywordsTopN: Number(process.env.ANALYZE_KEYWORDS_TOP_N || 15),
};
