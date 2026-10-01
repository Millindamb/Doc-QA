import mongoose from 'mongoose';
import { createApp } from './app.js';
import { config } from './config.js';

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log(`Connected to MongoDB at ${config.mongoUri}`);

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`docqa-server listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
