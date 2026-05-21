import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { connectDB } from './db/connection';
import logger from './utils/logger';
import uploadRouter from './api/upload';
import jobsRouter from './api/jobs';
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, '../public')));

app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});
app.use('/api', uploadRouter);
app.use('/api', jobsRouter);
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: 'Route not found.' });
});
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({ success: false, error: 'Internal server error.' });
});
async function start() {
  await connectDB();
  app.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
    logger.info('Available routes:');
    logger.info('  POST /api/upload');
    logger.info('  GET  /api/status/:jobId');
    logger.info('  GET  /api/result/:jobId');
    logger.info('  GET  /api/jobs');
    logger.info('  GET  /health');
  });
}
start().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('Startup failed', { error: message });
  process.exit(1);
});
