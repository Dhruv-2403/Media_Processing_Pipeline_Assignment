import mongoose, { Document, Schema } from 'mongoose';
import { CheckResult, ImageInfo, JobStatus, Verdict } from '../types';
export interface IImageJob extends Document {
  jobId:               string;
  originalName:        string;
  mimeType:            string;
  sizeBytes:           number;
  storagePath:         string;
  status:              JobStatus;
  attemptCount:        number;
  failureReason:       string | null;
  imageInfo:           ImageInfo;
  checks:              CheckResult[];
  phash:               string | null;
  verdict:             Verdict | null;
  uploadedAt:          Date;
  processingStartedAt: Date | null;
  completedAt:         Date | null;
}
const checkResultSchema = new Schema<CheckResult>(
  {
    name:     { type: String, required: true },
    passed:   { type: Boolean, required: true },
    severity: { type: String, enum: ['ok', 'warning', 'critical'], required: true },
    message:  { type: String, required: true },
    detail:   { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);
const imageJobSchema = new Schema<IImageJob>(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    originalName: { type: String, required: true },
    mimeType:     { type: String, required: true },
    sizeBytes:    { type: Number, required: true },
    storagePath:  { type: String, required: true },
    status: {
      type:    String,
      enum:    ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index:   true,
    },
    attemptCount:  { type: Number, default: 0 },
    failureReason: { type: String, default: null },
    imageInfo: {
      width:   { type: Number, default: null },
      height:  { type: Number, default: null },
      format:  { type: String, default: null },
      hasExif: { type: Boolean, default: false },
    },
    checks: { type: [checkResultSchema], default: [] },
    phash:   { type: String, default: null, index: true },
    verdict: {
      type:    String,
      enum:    ['clean', 'warning', 'rejected', null],
      default: null,
    },
    uploadedAt:          { type: Date, default: Date.now },
    processingStartedAt: { type: Date, default: null },
    completedAt:         { type: Date, default: null },
  },
  { timestamps: true }
);
export default mongoose.model<IImageJob>('ImageJob', imageJobSchema);
