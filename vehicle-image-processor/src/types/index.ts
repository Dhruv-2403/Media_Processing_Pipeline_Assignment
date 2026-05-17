export type Severity = 'ok' | 'warning' | 'critical';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type Verdict   = 'clean' | 'warning' | 'rejected';
export interface CheckResult {
  name:     string;
  passed:   boolean;
  severity: Severity;
  message:  string;
  detail:   Record<string, unknown> | null;
}
export interface ImageInfo {
  width:   number | null;
  height:  number | null;
  format:  string | null;
  hasExif: boolean;
}
export interface AnalysisResult {
  imageInfo: ImageInfo;
  checks:    CheckResult[];
  verdict:   Verdict;
}
export interface AnalyzeOptions {
  filePath:     string;
  sizeBytes:    number;
  originalName: string;
  jobId:        string;
}
export interface QueueStats {
  queueLength:   number;
  activeWorkers: number;
  concurrency:   number;
}
