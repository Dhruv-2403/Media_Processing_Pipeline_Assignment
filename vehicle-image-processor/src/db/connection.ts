import mongoose from 'mongoose';
import logger   from '../utils/logger';
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;
export async function connectDB(attempt = 1): Promise<void> {
  const MONGO_URI = process.env.MONGODB_URI;
  if (!MONGO_URI) {
    throw new Error('MONGODB_URI is not defined in environment variables.');
  }
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS:          45000,
    });
    logger.info('MongoDB connected', {
      uri: MONGO_URI.replace(/\/\/.*@/, '//***@'),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`MongoDB connection attempt ${attempt} failed: ${message}`);
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY));
      return connectDB(attempt + 1);
    }
    throw new Error(`MongoDB failed to connect after ${MAX_RETRIES} attempts.`);
  }
}
process.on('SIGINT',  () => void mongoose.connection.close().then(() => process.exit(0)));
process.on('SIGTERM', () => void mongoose.connection.close().then(() => process.exit(0)));
