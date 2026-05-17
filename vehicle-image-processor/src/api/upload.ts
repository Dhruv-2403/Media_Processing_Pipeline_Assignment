import express, { Request, Response, NextFunction } from 'express';
import multer   from 'multer';
import path     from 'path';
import fs       from 'fs';
import { v4 as uuidv4 } from 'uuid';
import ImageJob from '../db/ImageJob.model';
import queue    from '../queue/imageQueue';
import logger   from '../utils/logger';
const router = express.Router();
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES    = (Number(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024;
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const ext    = path.extname(file.originalname).toLowerCase() || '.jpg';
    const unique = `${Date.now()}-${uuidv4()}${ext}`;
    cb(null, unique);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: JPEG, PNG, WEBP, GIF.`));
    }
  },
});
router.post('/upload', (req: Request, res: Response, next: NextFunction): void => {
  upload.single('image')(req, res, (multerErr: any) => {
    if (multerErr) {
      logger.warn('Upload rejected by multer', { error: multerErr.message });
      const status = multerErr.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      res.status(status).json({ success: false, error: multerErr.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ success: false, error: "No image file provided. Use field name 'image'." });
      return;
    }
    const jobId = uuidv4();
    ImageJob.create({
      jobId,
      originalName: req.file.originalname,
      mimeType:     req.file.mimetype,
      sizeBytes:    req.file.size,
      storagePath:  req.file.path,
      status:       'pending',
    }).then(() => {
      queue.enqueue(jobId);
      logger.info('Upload accepted', {
        jobId,
        originalName: req.file!.originalname,
        sizeBytes:    req.file!.size,
      });
      res.status(202).json({
        success: true,
        jobId,
        status:  'pending',
        message: 'Image uploaded successfully. Use /api/status/:jobId to track processing.',
      });
    }).catch((err: unknown) => {
      fs.unlink(req.file!.path, () => undefined);
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to create job in DB', { error: message });
      next(err);
    });
  });
});
export default router;
