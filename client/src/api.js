import axios from 'axios';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('docqa_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// an expired/invalid token anywhere logs the user out (AuthProvider listens for this)
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401 && !err.config?.url?.startsWith('/auth/')) {
      window.dispatchEvent(new Event('docqa:unauthorized'));
    }
    return Promise.reject(err);
  }
);

export const errorMessage = (err) =>
  err?.response?.data?.error || (err?.code === 'ERR_NETWORK' ? 'Cannot reach the server. Is it running?' : err?.message) || 'Something went wrong';

const data = (p) => p.then((r) => r.data);

// ---- auth
export const register = (name, email, password) => data(api.post('/auth/register', { name, email, password }));
export const login = (email, password) => data(api.post('/auth/login', { email, password }));

// ---- documents
export const listDocuments = () => data(api.get('/documents'));
export const getDocument = (id) => data(api.get(`/documents/${id}`));
export const deleteDocument = (id) => api.delete(`/documents/${id}`);
export const analyzeDocument = (id) => data(api.post(`/documents/${id}/analyze`, null, { timeout: 180000 }));
export const getAnalysis = (id) => data(api.get(`/documents/${id}/analysis`));
/** onProgress(0..100) reports real upload bytes; the server then extracts text before responding. */
export function uploadDocument({ file, text, title }, onProgress) {
  const form = new FormData();
  if (title) form.append('title', title);
  if (file) form.append('file', file);
  if (text) form.append('text', text);
  return data(
    api.post('/documents/upload', form, {
      timeout: 300000,
      onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
    })
  );
}

// ---- chat
export const sendChat = (body) => data(api.post('/chat', body, { timeout: 120000 }));
export const listSessions = (documentId) => data(api.get('/chat/sessions', { params: { documentId } }));
export const getSession = (id) => data(api.get(`/chat/sessions/${id}`));

// ---- quiz / practice / research / resources
export const createQuiz = (body) => data(api.post('/quiz', body, { timeout: 120000 }));
export const createPractice = (body) => data(api.post('/practice', body, { timeout: 120000 }));
export const listQuizzes = (documentId) => data(api.get('/quiz', { params: { documentId } }));
export const getQuiz = (id) => data(api.get(`/quiz/${id}`));
export const submitAttempt = (id, answers) => data(api.post(`/quiz/${id}/attempts`, { answers }));
export const getWeakAreas = (documentId) => data(api.get('/quiz/weak-areas', { params: { documentId } }));
export const runResearch = (documentId, query) => data(api.post('/research', { documentId, query: query || undefined }, { timeout: 120000 }));
export const runResources = (documentId, query) => data(api.post('/resources', { documentId, query: query || undefined }, { timeout: 120000 }));
