import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import chatRoutes from './routes/chat.js';
import { createQuizRouter, createPracticeRouter } from './routes/quiz.js';
import { createResearchRouter, createResourcesRouter } from './routes/study.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/quiz', createQuizRouter());
  app.use('/api/practice', createPracticeRouter());
  app.use('/api/research', createResearchRouter());
  app.use('/api/resources', createResourcesRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
