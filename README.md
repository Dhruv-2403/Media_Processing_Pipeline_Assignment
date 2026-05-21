# Vehicle Image Processing Pipeline

A backend system that accepts uploaded vehicle images and processes them **asynchronously** to detect quality issues, duplicates, and suspicious content.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Processing Flow](#processing-flow)
3. [Queue Strategy & Design Decisions](#queue-strategy--design-decisions)
4. [Image Analysis Checks](#image-analysis-checks)
5. [API Reference](#api-reference)
6. [Running Locally](#running-locally)
7. [Project Structure](#project-structure)
8. [AI Usage Disclosure](#ai-usage-disclosure)
9. [Trade-offs & Future Work](#trade-offs--future-work)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client / Caller                      │
└───────────────────────────┬─────────────────────────────────┘
                            │  POST /api/upload (multipart)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Express HTTP Server                      │
│  ┌─────────────┐   ┌───────────────┐   ┌────────────────┐  │
│  │ Upload API  │   │  Status API   │   │  Results API   │  │
│  │ POST/upload │   │ GET /status/* │   │ GET /result/*  │  │
│  └──────┬──────┘   └───────────────┘   └────────────────┘  │
└─────────┼───────────────────────────────────────────────────┘
          │ 1. Save file to disk                               
          │ 2. Write ImageJob{status:"pending"} to MongoDB     
          │ 3. queue.enqueue(jobId)  ← returns immediately     
          │ 4. HTTP 202 → client                               
          ▼
┌─────────────────────────────────────────────────────────────┐
│               In-Memory Async Queue                         │
│   ┌──────────────────────────────────────────────────────┐  │
│   │  FIFO pending list  ·  concurrency cap  ·  retries   │  │
│   └────────────────────────────┬─────────────────────────┘  │
└────────────────────────────────┼────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│                   Analysis Engine                           │
│  blur · brightness · dimensions · file-size · duplicate     │
│  screenshot-heuristics · vehicle-framing                    │
└────────────────────────────────┬────────────────────────────┘
                                 │ Write result back
                                 ▼
                         ┌───────────────┐
                         │   MongoDB     │
                         │  ImageJob     │
                         └───────────────┘
```

**Key component responsibilities:**

| Component | Responsibility |
|---|---|
| `src/api/upload.js` | Validates, stores image, writes DB record, enqueues job |
| `src/api/jobs.js` | Status, full result, and paginated listing endpoints |
| `src/queue/imageQueue.js` | In-memory FIFO queue with concurrency control and retries |
| `src/analysis/engine.js` | Runs all image checks, returns structured check list + verdict |
| `src/db/ImageJob.model.js` | Mongoose schema for jobs, checks, status, timing |
| `src/db/connection.js` | MongoDB connect with retry and graceful shutdown |
| `src/utils/logger.js` | Winston structured logger (JSON in prod, readable in dev) |

---

## Processing Flow

```
POST /api/upload
  │
  ├── multer validates: MIME type (JPEG/PNG/WEBP/GIF), file size ≤ MAX_FILE_SIZE_MB
  ├── File saved to ./uploads/<timestamp>-<uuid>.<ext>
  ├── MongoDB: ImageJob { status: "pending", ... }
  ├── queue.enqueue(jobId)
  └── HTTP 202 { jobId, status: "pending" }

Queue Worker (background)
  │
  ├── MongoDB: status → "processing", processingStartedAt = now, attemptCount++
  ├── analyzeImage() runs 7 checks (see below)
  ├── MongoDB: status → "completed", checks[], verdict, imageInfo, completedAt
  └── On error → retry with exponential back-off → "failed" after max retries

Client polls GET /api/status/:jobId
  └── When status === "completed" → GET /api/result/:jobId
```

---

## Queue Strategy & Design Decisions

### Why an in-memory queue (not BullMQ/Redis)?

The assignment explicitly notes *"choice matters less than reasoning"*. For a local take-home demo, introducing Redis as a required external dependency adds setup friction and operational complexity without meaningfully demonstrating engineering quality. The in-memory queue implements **the same semantic contract** as BullMQ:

- FIFO ordering
- Configurable concurrency (`QUEUE_CONCURRENCY`, default 2)
- Per-job retry with **exponential back-off** (2 s → 4 s → 8 s)
- `pending → processing → completed/failed` state machine persisted in MongoDB

The queue is a drop-in: swapping `queue.enqueue()` with a BullMQ `Queue.add()` call, and the worker loop with a BullMQ `Worker`, would require **zero changes** to the API or analysis layer.

### Concurrency set to 2

Image analysis is CPU-bound (pixel iteration for blur/brightness). Running more than 2 parallel analyses per process would cause significant event-loop lag. Horizontal scaling (multiple processes/containers) is the correct answer for throughput.

### MongoDB for persistence

Document model fits naturally: the job record, its embedded checks array, and timing fields are always read and written together. There is no relational join requirement. Schema is versioned — the `checks` field is a typed array of `{ name, passed, severity, message, detail }` so new checks can be added without a migration.

---

## Image Analysis Checks

All checks are implemented in `src/analysis/engine.js` using **Jimp** (pure Node.js — no native binaries required).

| # | Check | Method | Flags |
|---|---|---|---|
| 1 | **File Size** | Byte count vs thresholds | `critical` if < 5 KB, `warning` if > MAX_MB |
| 2 | **Dimensions** | Jimp width/height vs min | `critical` if < 200×200 px |
| 3 | **Brightness** | Per-pixel luma (BT.601 weighted) sampled every 4 px | `critical` if too dark, `warning` if overexposed |
| 4 | **Blur Detection** | Laplacian variance on greyscale thumbnail | `warning` if variance < threshold (100) |
| 5 | **Duplicate Detection** | Perceptual dHash (9×8 → 64-bit) + Hamming distance ≤ 8 | `warning` on near-match |
| 6 | **Screenshot Detection** | EXIF presence + common screen widths + aspect ratio matching | `warning` on ≥ 2 indicators |
| 7 | **Vehicle Framing** | Aspect ratio range + suspicious filename keywords | `warning` on violations |

**Verdict derivation:**
- Any `critical` failure → `"rejected"`
- Any `warning` failure → `"warning"`
- All passed → `"clean"`

---

## API Reference

### `POST /api/upload`
Upload an image for processing.

```
Content-Type: multipart/form-data
Field:        image  (JPEG / PNG / WEBP / GIF, max 10 MB by default)
```

**202 Response:**
```json
{
  "success": true,
  "jobId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "status": "pending",
  "message": "Image uploaded successfully. Use /api/status/:jobId to track processing."
}
```

**Error codes:** `400` (missing file / bad type) · `413` (size exceeded)

---

### `GET /api/status/:jobId`
Poll for processing state.

```json
{
  "success": true,
  "jobId": "3fa85f64-...",
  "status": "completed",
  "attemptCount": 1,
  "uploadedAt": "2024-01-15T10:30:00.000Z",
  "processingStartedAt": "2024-01-15T10:30:00.120Z",
  "completedAt": "2024-01-15T10:30:02.450Z"
}
```

When `status === "failed"`, a `failureReason` string is included.

---

### `GET /api/result/:jobId`
Fetch the full analysis report.

**409** if still processing · **422** if failed · **200** if complete:

```json
{
  "success": true,
  "jobId": "3fa85f64-...",
  "status": "completed",
  "verdict": "warning",
  "imageInfo": { "width": 1280, "height": 720, "format": "image/jpeg", "hasExif": true },
  "checks": [
    { "name": "file_size",      "passed": true,  "severity": "ok",      "message": "File size is acceptable (240.3 KB).", "detail": { "sizeKB": "240.3" } },
    { "name": "dimension",      "passed": true,  "severity": "ok",      "message": "Dimensions OK (1280×720px).", "detail": { "width": 1280, "height": 720 } },
    { "name": "brightness",     "passed": false, "severity": "critical", "message": "Image is too dark (luminance: 28.4/255).", "detail": { "avgLuminance": "28.4" } },
    { "name": "blur_detection", "passed": true,  "severity": "ok",      "message": "Image is sharp (Laplacian variance: 312.7).", "detail": { "laplacianVariance": "312.7" } },
    { "name": "duplicate_detection", "passed": true, "severity": "ok",  "message": "No duplicate image detected.", "detail": {} },
    { "name": "screenshot_detection", "passed": true, "severity": "ok", "message": "Image does not appear to be a screenshot.", "detail": {} },
    { "name": "number_plate_framing", "passed": true, "severity": "ok", "message": "Image framing is consistent with a vehicle photo.", "detail": {} }
  ],
  "summary": {
    "totalChecks": 7,
    "passed": 6,
    "warnings": 0,
    "critical": 1,
    "criticalIssues": ["Image is too dark (luminance: 28.4/255)."],
    "warningIssues": []
  },
  "timing": {
    "uploadedAt": "2024-01-15T10:30:00.000Z",
    "processingStartedAt": "2024-01-15T10:30:00.120Z",
    "completedAt": "2024-01-15T10:30:02.450Z",
    "processingMs": 2330
  }
}
```

---

### `GET /api/jobs`
Paginated list of all jobs.

Query params: `status` · `page` (default 1) · `limit` (default 20, max 100)

```json
{
  "success": true,
  "total": 47,
  "page": 1,
  "limit": 20,
  "pages": 3,
  "queueStats": { "queueLength": 0, "activeWorkers": 0, "concurrency": 2 },
  "jobs": [ { "jobId": "...", "originalName": "car.jpg", "status": "completed", "verdict": "clean", ... } ]
}
```

---

### `GET /health`
```json
{ "status": "ok", "timestamp": "2024-01-15T10:30:00.000Z" }
```

---

## Running Locally

### Prerequisites
- **Node.js** ≥ 18
- **MongoDB** — either a local instance or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster

### 1. Clone & install

```bash
git clone [<repo-url>](https://github.com/Dhruv-2403/Media_Processing_Pipeline_Assignment)
cd vehicle-image-processor
npm install
```

### 2. Configure environment

Environment variables has mongodb uri so edit the .env file as per requirement.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `MONGODB_URI` | *(required)* | MongoDB connection string |
| `UPLOAD_DIR` | `./uploads` | Where images are saved |
| `MAX_FILE_SIZE_MB` | `10` | Maximum upload size |
| `QUEUE_CONCURRENCY` | `2` | Parallel analysis workers |
| `QUEUE_RETRY_ATTEMPTS` | `3` | Max retries on failure |
| `BLUR_THRESHOLD` | `100` | Laplacian variance cut-off |
| `BRIGHTNESS_MIN` | `40` | Minimum average luma |
| `BRIGHTNESS_MAX` | `220` | Maximum average luma |
| `DUPLICATE_THRESHOLD` | `8` | Max Hamming distance for duplicate |
| `MIN_WIDTH` | `200` | Minimum image width (px) |
| `MIN_HEIGHT` | `200` | Minimum image height (px) |

### 3. Start the server

```bash
npm run dev      
npm start        # production
```

### 4. Upload an image

```bash
curl -X POST http://localhost:3000/api/upload \
  -F "image=@/path/to/car.jpg"
```

### 5. Poll for status

```bash
curl http://localhost:3000/api/status/<jobId>
```

### 6. Fetch the result

```bash
curl http://localhost:3000/api/result/<jobId>
```

### 7. Run the test suite

```bash
# In one terminal: npm run dev
# In another:
npm test
```

---

## Project Structure

```
vehicle-image-processor/
├── src/
│   ├── server.js               # Express bootstrap, routes, global error handler
│   ├── api/
│   │   ├── upload.js           # POST /api/upload
│   │   └── jobs.js             # GET /api/status, /api/result, /api/jobs
│   ├── analysis/
│   │   └── engine.js           # All 7 image checks + verdict logic
│   ├── db/
│   │   ├── connection.js       # MongoDB connect with retry
│   │   └── ImageJob.model.js   # Mongoose schema
│   ├── queue/
│   │   └── imageQueue.js       # In-memory async queue with concurrency + retries
│   └── utils/
│       └── logger.js           # Winston structured logger
├── tests/
│   └── api.test.js             # End-to-end test script (no framework needed)
├── uploads/                    # Stored images (git-ignored)
├── logs/                       # Winston log files (git-ignored)
├── .env                        # Environment config (git-ignored)
├── .gitignore
└── package.json
```

---

## AI Usage Disclosure

### Where AI was used

| Area | How AI helped |
|---|---|
| **Queue architecture** | Used AI to reason through BullMQ vs in-memory trade-offs for a local demo; validated the exponential back-off formula manually |
| **Laplacian variance blur detection** | AI suggested the kernel approach; I cross-referenced with academic references and verified the pixel iteration logic produces meaningful variance differences on real blurry vs sharp images |
| **dHash implementation** | AI provided the 9×8 resize → per-row gradient → hex encoding pattern; I traced through the Hamming distance calculation by hand for a 2-hash test case |
| **Mongoose schema design** | AI helped draft the embedded `checkResult` sub-document approach; I adjusted the `verdict` enum and null handling for unprocessed jobs |
| **Winston logger config** | AI generated the dual-transport (file + console) setup; I added the production guard and rotated file transport limits |


### How AI outputs were validated

- Ran blur detection against a clearly blurry JPEG vs a sharp JPEG and confirmed the variance scores fell on the expected sides of the threshold.
- Read the full generated queue module line-by-line before accepting it.

---

## Trade-offs & Future Work

### Intentionally simplified

| Simplification | Reason |
|---|---|
| In-memory queue instead of Redis/BullMQ | Removes external dependency for local demo; semantics are identical |
| Local disk storage instead of S3 | No cloud credentials needed; the `storagePath` field in the schema is cloud-URL-ready |

### What I would add with more time

- **Rate limiting** (`express-rate-limit`) — prevent upload abuse
- **Docker Compose** — single `docker compose up` to start app + MongoDB
- **Structured error codes** — machine-readable error codes alongside messages
- **Automated confidence scoring** — each check produces a 0–1 confidence value rather than a binary pass/fail

### Scalability concerns

- The in-memory queue is **single-process only**. Multiple Node.js instances would each have their own queue with no coordination. BullMQ + Redis solves this.
- Jimp (Javascript Image Processing Library) is pure JavaScript and slower than native libraries (libvips/OpenCV). For high throughput, replace with `sharp` for pre-processing and a native addon or worker_threads for the Laplacian kernel.
- MongoDB indexes on `jobId` (unique) and `status` are already defined in the schema.
