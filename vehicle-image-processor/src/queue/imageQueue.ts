import { EventEmitter } from 'events';
import ImageJob         from '../db/ImageJob.model';
import { analyzeImage }  from '../analysis/engine';
import logger           from '../utils/logger';
import { QueueStats }   from '../types';
class ImageQueue extends EventEmitter {
  private _pending: string[];
  private _active: number;
  private _concurrency: number;
  private _maxRetries: number;
  constructor() {
    super();
    this._pending     = [];
    this._active      = 0;
    this._concurrency = Number(process.env.QUEUE_CONCURRENCY)   || 2;
    this._maxRetries  = Number(process.env.QUEUE_RETRY_ATTEMPTS) || 3;
  }
  public enqueue(jobId: string): void {
    this._pending.push(jobId);
    logger.info('Job enqueued', { jobId, queueLength: this._pending.length });
    this._drain();
  }
  public stats(): QueueStats {
    return {
      queueLength:   this._pending.length,
      activeWorkers: this._active,
      concurrency:   this._concurrency,
    };
  }
  private _drain(): void {
    while (this._active < this._concurrency && this._pending.length > 0) {
      const jobId = this._pending.shift();
      if (!jobId) continue;
      this._active++;
      this._process(jobId).finally(() => {
        this._active--;
        this._drain();
      });
    }
  }
  private async _process(jobId: string, attempt = 1): Promise<void> {
    logger.info('Processing job', { jobId, attempt });
    try {
      const job = await ImageJob.findOneAndUpdate(
        { jobId, status: { $in: ['pending', 'processing'] } },
        {
          status: 'processing',
          processingStartedAt: new Date(),
          $inc: { attemptCount: 1 },
        },
        { new: true }
      );
      if (!job) {
        logger.warn('Job not found or already processed, skipping', { jobId });
        return;
      }
      const result = await analyzeImage({
        filePath:     job.storagePath,
        sizeBytes:    job.sizeBytes,
        originalName: job.originalName,
        jobId:        job.jobId,
      });
      await ImageJob.findOneAndUpdate(
        { jobId },
        {
          status:        'completed',
          imageInfo:     result.imageInfo,
          checks:        result.checks,
          verdict:       result.verdict,
          completedAt:   new Date(),
          failureReason: null,
        }
      );
      logger.info('Job completed', { jobId, verdict: result.verdict });
      this.emit('completed', jobId, result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Job processing error', { jobId, attempt, error: message });
      if (attempt < this._maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.info(`Retrying job in ${delay}ms`, { jobId, nextAttempt: attempt + 1 });
        await ImageJob.findOneAndUpdate({ jobId }, { status: 'pending' }).catch(() => undefined);
        await new Promise((r) => setTimeout(r, delay));
        return this._process(jobId, attempt + 1);
      }
      await ImageJob.findOneAndUpdate(
        { jobId },
        {
          status:        'failed',
          failureReason: message,
          completedAt:   new Date(),
        }
      ).catch(() => undefined);
      logger.error('Job permanently failed', { jobId, error: message });
      this.emit('failed', jobId, err);
    }
  }
}
const queue = new ImageQueue();
export default queue;
