import express, { Request, Response } from 'express';
import ImageJob from '../db/ImageJob.model';
import queue    from '../queue/imageQueue';
import logger   from '../utils/logger';
const router = express.Router();
function jobNotFound(res: Response, jobId: string) {
  return res.status(404).json({ success: false, error: `Job '${jobId}' not found.` });
}
router.get('/status/:jobId', async (req: Request, res: Response): Promise<void> => {
  const jobId = req.params.jobId as string;
  try {
    const job = await ImageJob.findOne({ jobId }).select(
      'jobId status attemptCount failureReason uploadedAt processingStartedAt completedAt'
    ).lean();
    if (!job) {
      jobNotFound(res, jobId);
      return;
    }
    const payload: any = {
      success:             true,
      jobId:               job.jobId,
      status:              job.status,
      attemptCount:        job.attemptCount,
      uploadedAt:          job.uploadedAt,
      processingStartedAt: job.processingStartedAt,
      completedAt:         job.completedAt,
    };
    if (job.status === 'failed') {
      payload.failureReason = job.failureReason;
    }
    res.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Error fetching status', { jobId, error: message });
    res.status(500).json({ success: false, error: 'Failed to fetch job status.' });
  }
});
router.get('/result/:jobId', async (req: Request, res: Response): Promise<void> => {
  const jobId = req.params.jobId as string;
  try {
    const job = await ImageJob.findOne({ jobId }).lean();
    if (!job) {
      jobNotFound(res, jobId);
      return;
    }
    if (job.status === 'pending' || job.status === 'processing') {
      res.status(409).json({
        success: false,
        jobId,
        status:  job.status,
        error:   'Analysis is not yet complete. Poll /api/status/:jobId for updates.',
      });
      return;
    }
    if (job.status === 'failed') {
      res.status(422).json({
        success:       false,
        jobId,
        status:        'failed',
        failureReason: job.failureReason,
        attemptCount:  job.attemptCount,
      });
      return;
    }
    const failed   = job.checks.filter((c) => !c.passed);
    const warnings = failed.filter((c) => c.severity === 'warning');
    const critical = failed.filter((c) => c.severity === 'critical');
    const processingMs = job.processingStartedAt && job.completedAt
      ? new Date(job.completedAt).getTime() - new Date(job.processingStartedAt).getTime()
      : null;
    res.json({
      success:     true,
      jobId,
      status:      job.status,
      verdict:     job.verdict,
      imageInfo:   job.imageInfo,
      checks:      job.checks,
      summary: {
        totalChecks:    job.checks.length,
        passed:         job.checks.filter((c) => c.passed).length,
        warnings:       warnings.length,
        critical:       critical.length,
        criticalIssues: critical.map((c) => c.message),
        warningIssues:  warnings.map((c) => c.message),
      },
      timing: {
        uploadedAt:          job.uploadedAt,
        processingStartedAt: job.processingStartedAt,
        completedAt:         job.completedAt,
        processingMs,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Error fetching result', { jobId, error: message });
    res.status(500).json({ success: false, error: 'Failed to fetch job result.' });
  }
});
router.get('/jobs', async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string;
    const page  = Math.max(1, parseInt(req.query.page as string,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip  = (page - 1) * limit;
    const filter: any = {};
    const VALID_STATUSES = ['pending', 'processing', 'completed', 'failed'];
    if (status && VALID_STATUSES.includes(status)) filter.status = status;
    const [jobs, total] = await Promise.all([
      ImageJob.find(filter)
        .sort({ uploadedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('jobId originalName mimeType sizeBytes status verdict uploadedAt completedAt')
        .lean(),
      ImageJob.countDocuments(filter),
    ]);
    res.json({
      success: true,
      total,
      page,
      limit,
      pages:     Math.ceil(total / limit),
      queueStats: queue.stats(),
      jobs,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Error listing jobs', { error: message });
    res.status(500).json({ success: false, error: 'Failed to list jobs.' });
  }
});
export default router;
