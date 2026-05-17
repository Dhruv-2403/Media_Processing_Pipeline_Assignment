import fs   from 'fs';
import Jimp from 'jimp';
import ImageJob from '../db/ImageJob.model';
import { AnalysisResult, AnalyzeOptions, CheckResult, ImageInfo, Verdict } from '../types';
function hasExifData(buffer: Buffer): boolean {
  for (let i = 0; i < Math.min(buffer.length - 10, 65536); i++) {
    if (
      buffer[i]     === 0xff &&
      buffer[i + 1] === 0xe1 &&
      buffer.toString('ascii', i + 4, i + 8) === 'Exif'
    ) {
      return true;
    }
  }
  return false;
}
function computeDHash(image: Jimp): string {
  const small = image.clone().resize(9, 8).greyscale();
  const bits: string[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left  = Jimp.intToRGBA(small.getPixelColor(x,     y)).r;
      const right = Jimp.intToRGBA(small.getPixelColor(x + 1, y)).r;
      bits.push(left > right ? '1' : '0');
    }
  }
  let hash = '';
  for (let i = 0; i < bits.length; i += 4) {
    hash += parseInt(bits.slice(i, i + 4).join(''), 2).toString(16);
  }
  return hash;
}
function hammingDistance(a: string, b: string): number {
  const len  = Math.min(a.length, b.length);
  let   dist = 0;
  for (let i = 0; i < len; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (xor) { dist += xor & 1; xor >>= 1; }
  }
  return dist;
}
// ─── Individual checks ────────────────────────────────────────────────────────
function fileSizeCheck(sizeBytes: number): CheckResult {
  const name  = 'file_size';
  const kb    = sizeBytes / 1024;
  const maxMB = Number(process.env.MAX_FILE_SIZE_MB) || 10;
  if (kb < 5) {
    return {
      name, passed: false, severity: 'critical',
      message: `File is too small (${kb.toFixed(1)} KB). Real vehicle photos are larger than 5 KB.`,
      detail:  { sizeKB: kb.toFixed(1) },
    };
  }
  if (sizeBytes > maxMB * 1024 * 1024) {
    return {
      name, passed: false, severity: 'warning',
      message: `File size ${(sizeBytes / 1024 / 1024).toFixed(1)} MB exceeds max ${maxMB} MB.`,
      detail:  { sizeKB: kb.toFixed(1) },
    };
  }
  return {
    name, passed: true, severity: 'ok',
    message: `File size is acceptable (${kb.toFixed(1)} KB).`,
    detail:  { sizeKB: kb.toFixed(1) },
  };
}
function dimensionCheck(image: Jimp): CheckResult {
  const name   = 'dimension';
  const width  = image.getWidth();
  const height = image.getHeight();
  const minW   = Number(process.env.MIN_WIDTH)  || 200;
  const minH   = Number(process.env.MIN_HEIGHT) || 200;
  if (width < minW || height < minH) {
    return {
      name, passed: false, severity: 'critical',
      message: `Image too small (${width}×${height}px). Minimum required: ${minW}×${minH}px.`,
      detail:  { width, height, minW, minH },
    };
  }
  return {
    name, passed: true, severity: 'ok',
    message: `Dimensions OK (${width}×${height}px).`,
    detail:  { width, height },
  };
}
function brightnessCheck(image: Jimp): CheckResult {
  const name   = 'brightness';
  const width  = image.getWidth();
  const height = image.getHeight();
  const min    = Number(process.env.BRIGHTNESS_MIN) || 40;
  const max    = Number(process.env.BRIGHTNESS_MAX) || 220;
  let totalLuma = 0;
  let count     = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const { r, g, b } = Jimp.intToRGBA(image.getPixelColor(x, y));
      totalLuma += 0.299 * r + 0.587 * g + 0.114 * b;
      count++;
    }
  }
  const avg = totalLuma / count;
  if (avg < min) {
    return {
      name, passed: false, severity: 'critical',
      message: `Image is too dark (luminance: ${avg.toFixed(1)}/255). Likely low-light or underexposed.`,
      detail:  { avgLuminance: avg.toFixed(1), min, max },
    };
  }
  if (avg > max) {
    return {
      name, passed: false, severity: 'warning',
      message: `Image is overexposed (luminance: ${avg.toFixed(1)}/255).`,
      detail:  { avgLuminance: avg.toFixed(1), min, max },
    };
  }
  return {
    name, passed: true, severity: 'ok',
    message: `Brightness is good (luminance: ${avg.toFixed(1)}/255).`,
    detail:  { avgLuminance: avg.toFixed(1) },
  };
}
function blurCheck(image: Jimp): CheckResult {
  const name      = 'blur_detection';
  const threshold = Number(process.env.BLUR_THRESHOLD) || 100;
  const grey      = image.clone()
    .resize(Math.min(image.getWidth(), 300), Math.min(image.getHeight(), 300))
    .greyscale();
  const w = grey.getWidth();
  const h = grey.getHeight();
  const luma: number[][] = [];
  for (let y = 0; y < h; y++) {
    luma[y] = [];
    for (let x = 0; x < w; x++) {
      luma[y][x] = Jimp.intToRGBA(grey.getPixelColor(x, y)).r;
    }
  }
  const laplacian: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const val =
        luma[y - 1][x] +
        luma[y + 1][x] +
        luma[y][x - 1] +
        luma[y][x + 1] -
        4 * luma[y][x];
      laplacian.push(val);
    }
  }
  const mean     = laplacian.reduce((s, v) => s + v, 0) / laplacian.length;
  const variance = laplacian.reduce((s, v) => s + (v - mean) ** 2, 0) / laplacian.length;
  if (variance < threshold) {
    return {
      name, passed: false, severity: 'warning',
      message: `Image appears blurry (Laplacian variance: ${variance.toFixed(1)}, threshold: ${threshold}).`,
      detail:  { laplacianVariance: variance.toFixed(1), threshold },
    };
  }
  return {
    name, passed: true, severity: 'ok',
    message: `Image is sharp (Laplacian variance: ${variance.toFixed(1)}).`,
    detail:  { laplacianVariance: variance.toFixed(1) },
  };
}
async function duplicateCheck(image: Jimp, jobId: string): Promise<CheckResult> {
  const name      = 'duplicate_detection';
  const hash      = computeDHash(image);
  const threshold = Number(process.env.DUPLICATE_THRESHOLD) || 8;
  await ImageJob.findOneAndUpdate({ jobId }, { phash: hash }).catch(() => undefined);
  let closestMatch: string | null = null;
  let minDist                     = Infinity;
  try {
    const candidates = await ImageJob.find(
      { jobId: { $ne: jobId }, phash: { $ne: null } },
      { jobId: 1, phash: 1, _id: 0 }
    ).lean();
    for (const doc of candidates) {
      if (!doc.phash) continue;
      const dist = hammingDistance(hash, doc.phash);
      if (dist < minDist) {
        minDist      = dist;
        closestMatch = doc.jobId;
      }
    }
  } catch {
    return {
      name, passed: true, severity: 'ok',
      message: 'Duplicate check skipped (DB query error — treated as no duplicate).',
      detail:  { hashPrefix: hash.slice(0, 8) },
    };
  }
  if (closestMatch !== null && minDist <= threshold) {
    return {
      name, passed: false, severity: 'warning',
      message: `Possible duplicate of job ${closestMatch} (hash distance: ${minDist}/${threshold}).`,
      detail:  { hammingDistance: minDist, matchedJobId: closestMatch, threshold },
    };
  }
  return {
    name, passed: true, severity: 'ok',
    message: 'No duplicate image detected.',
    detail:  { hashPrefix: hash.slice(0, 8) },
  };
}
function screenshotCheck(image: Jimp, buffer: Buffer): CheckResult {
  const name   = 'screenshot_detection';
  const width  = image.getWidth();
  const height = image.getHeight();
  const ratio  = width / height;
  const issues: string[] = [];
  if (!hasExifData(buffer)) {
    issues.push('no EXIF metadata — real camera photos always have it');
  }
  const commonWidths = [360, 375, 390, 412, 414, 768, 1080, 1280, 1366, 1440, 1920, 2560];
  if (commonWidths.includes(width)) {
    issues.push(`width ${width}px matches a common screen resolution`);
  }
  const commonRatios = [16 / 9, 9 / 16, 4 / 3, 3 / 4, 1 / 1];
  if (commonRatios.some((r) => Math.abs(ratio - r) < 0.03)) {
    issues.push(`aspect ratio ${ratio.toFixed(2)} matches a common screen ratio`);
  }
  if (issues.length >= 2) {
    return {
      name, passed: false, severity: 'warning',
      message: `Likely a screenshot — ${issues.length} indicators found: ${issues.join('; ')}.`,
      detail:  { indicators: issues, width, height, aspectRatio: ratio.toFixed(2) },
    };
  }
  return {
    name, passed: true, severity: 'ok',
    message: 'Image does not appear to be a screenshot.',
    detail:  { aspectRatio: ratio.toFixed(2), hasExif: hasExifData(buffer) },
  };
}
function numberPlateCheck(image: Jimp, originalName: string): CheckResult {
  const name   = 'number_plate_framing';
  const width  = image.getWidth();
  const height = image.getHeight();
  const ratio  = width / height;
  const issues: string[] = [];
  if (ratio < 1.0) issues.push('portrait orientation — vehicle photos should be landscape');
  if (ratio > 5.0) issues.push('extremely wide crop — looks like a banner strip, not a vehicle photo');
  const nameLower  = (originalName || '').toLowerCase();
  const suspicious = ['screenshot', 'edited', 'photoshop', 'copy', 'fake', 'sample', 'test', 'whatsapp', 'img-', 'photo-'];
  const found      = suspicious.find((k) => nameLower.includes(k));
  if (found) issues.push(`filename contains suspicious keyword: "${found}"`);
  const platePattern  = /[a-z]{2}\d{2}[a-z]{1,2}\d{4}/i;
  const plateHint     = platePattern.test(originalName || '');
  if (issues.length > 0) {
    return {
      name, passed: false, severity: 'warning',
      message: `Vehicle framing concerns: ${issues.join('; ')}.`,
      detail:  { issues, aspectRatio: ratio.toFixed(2), platePatternInFilename: plateHint },
    };
  }
  return {
    name, passed: true, severity: 'ok',
    message: 'Image framing is consistent with a vehicle photo.',
    detail:  { aspectRatio: ratio.toFixed(2), platePatternInFilename: plateHint },
  };
}
function deriveVerdict(checks: CheckResult[]): Verdict {
  if (checks.some((c) => !c.passed && c.severity === 'critical')) return 'rejected';
  if (checks.some((c) => !c.passed && c.severity === 'warning'))  return 'warning';
  return 'clean';
}
export async function analyzeImage(opts: AnalyzeOptions): Promise<AnalysisResult> {
  const { filePath, sizeBytes, originalName, jobId } = opts;
  const buffer = fs.readFileSync(filePath);
  const image  = await Jimp.read(filePath);
  const imageInfo: ImageInfo = {
    width:   image.getWidth(),
    height:  image.getHeight(),
    format:  image.getMIME(),
    hasExif: hasExifData(buffer),
  };
  const checks: CheckResult[] = [
    fileSizeCheck(sizeBytes),
    dimensionCheck(image),
    brightnessCheck(image),
    blurCheck(image),
    await duplicateCheck(image, jobId),
    screenshotCheck(image, buffer),
    numberPlateCheck(image, originalName),
  ];
  const verdict = deriveVerdict(checks);
  return { imageInfo, checks, verdict };
}
