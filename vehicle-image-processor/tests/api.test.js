const http = require("http");
const fs = require("fs");
const path = require("path");

const BASE = `http://localhost:${process.env.TEST_PORT || 3000}`;
let passed = 0;
let failed = 0;

// ANSI color codes
const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const YELLOW = (text) => `\x1b[33m${text}\x1b[0m`;

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${urlPath}`, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on("error", reject);
  });
}
function postMultipart(urlPath, filePath, fieldName = "image") {
  return new Promise((resolve, reject) => {
    const boundary = `----FormBoundary${Date.now()}`;
    const filename = path.basename(filePath);
    const fileData = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    let mime = "image/jpeg";
    if (ext === ".png") mime = "image/png";
    if (ext === ".txt") mime = "text/plain";
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, fileData, footer]);
    const options = {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
    };
    const req = http.request(`${BASE}${urlPath}`, options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
function assert(condition, label) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}`);
    failed++;
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function makeTinyJpeg(outPath) {
  const jpeg = Buffer.from(
    "FFD8FFE000104A46494600010100000100010000FFDB004300080606070605080707070909080A0C140D0C0B0B0C1912130F141D1A1F1E1D1A1C1C20242E2720222C231C1C2837292C30313434341F27393D38323C2E333432FFD8FFE000104A4649460001010001000100FFDB0043000D0909090C0B0C180D0D1832211C213232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232FFC0000B080002000201011100FFC4001F0000010501010101010100000000000000000102030405060708090A0BFFC40000FFC4001F0100000305010101010101000000000000000102030405060708090AFFC40000FFDA00030101003F00F87BA7FFFFD9",
    "hex"
  );
  fs.writeFileSync(outPath, jpeg);
}
async function testHealth() {
  console.log(YELLOW("\n[1] Health check"));
  const { status, body } = await get("/health");
  assert(status === 200, "returns HTTP 200");
  assert(body.status === "ok", "body.status === 'ok'");
}
async function testUpload(imagePath) {
  console.log(YELLOW("\n[2] Upload endpoint"));
  const { status, body } = await postMultipart("/api/upload", imagePath);
  assert(status === 202, "returns HTTP 202 Accepted");
  assert(body.success === true, "body.success === true");
  assert(typeof body.jobId === "string" && body.jobId.length > 0, "returns a jobId");
  assert(body.status === "pending", "initial status is 'pending'");
  return body.jobId;
}
async function testBadUpload() {
  console.log(YELLOW("\n[3] Upload — invalid file type"));
  const txtPath = "/tmp/fake.txt";
  fs.writeFileSync(txtPath, "this is not an image");
  const { status, body } = await postMultipart("/api/upload", txtPath, "image");
  assert(status === 400, "returns HTTP 400 for unsupported type");
  assert(body.success === false, "body.success === false");
}
async function testStatus(jobId) {
  console.log(YELLOW("\n[4] Status endpoint"));
  const { status, body } = await get(`/api/status/${jobId}`);
  assert(status === 200, "returns HTTP 200");
  assert(body.jobId === jobId, "returns correct jobId");
  assert(["pending", "processing", "completed", "failed"].includes(body.status), "status is a valid state");
}
async function testStatusNotFound() {
  console.log(YELLOW("\n[5] Status — not found"));
  const { status, body } = await get("/api/status/non-existent-job-id");
  assert(status === 404, "returns HTTP 404");
  assert(body.success === false, "body.success === false");
}
async function testResultBeforeCompletion(jobId) {
  console.log(YELLOW("\n[6] Result before completion (should 409)"));
  const { body: statusBody } = await get(`/api/status/${jobId}`);
  if (statusBody.status !== "completed" && statusBody.status !== "failed") {
    const { status, body } = await get(`/api/result/${jobId}`);
    assert(status === 409, "returns HTTP 409 when not yet complete");
    assert(body.success === false, "body.success === false");
  } else {
    console.log("  (job already completed — skipping pre-completion check)");
  }
}
async function testResultAfterCompletion(jobId) {
  console.log(YELLOW("\n[7] Result after completion"));
  console.log("    Waiting up to 30 s for job to complete…");
  let job;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const { body } = await get(`/api/status/${jobId}`);
    if (body.status === "completed" || body.status === "failed") {
      job = body;
      break;
    }
    process.stdout.write(".");
  }
  console.log();
  if (!job) {
    console.log(`  ${FAIL} Job did not complete within 30 s`);
    failed++;
    return;
  }
  const { status, body } = await get(`/api/result/${jobId}`);
  assert(status === 200 || status === 422, "result endpoint reachable after processing");
  if (status === 200) {
    assert(body.success === true, "body.success === true");
    assert(["clean", "warning", "rejected"].includes(body.verdict), "verdict is valid");
    assert(Array.isArray(body.checks) && body.checks.length >= 4, "at least 4 checks returned");
    assert(typeof body.summary === "object", "summary object present");
    assert(typeof body.timing.processingMs === "number", "processingMs is a number");
    console.log(`    Verdict: ${body.verdict} | Checks: ${body.checks.length}`);
  } else {
    console.log(`    Job failed (expected in test env): ${body.failureReason}`);
  }
}
async function testJobsList() {
  console.log(YELLOW("\n[8] Jobs listing endpoint"));
  const { status, body } = await get("/api/jobs?limit=5");
  assert(status === 200, "returns HTTP 200");
  assert(body.success === true, "body.success === true");
  assert(typeof body.total === "number", "total count present");
  assert(Array.isArray(body.jobs), "jobs array present");
  assert(typeof body.queueStats === "object", "queueStats included");
}
(async () => {
  console.log(`\nRunning API tests against ${BASE}`);
  const testImage = "/tmp/test_vehicle.jpg";
  makeTinyJpeg(testImage);
  try {
    await testHealth();
    const jobId = await testUpload(testImage);
    await testBadUpload();
    await testStatus(jobId);
    await testStatusNotFound();
    await testResultBeforeCompletion(jobId);
    await testResultAfterCompletion(jobId);
    await testJobsList();
  } catch (err) {
    console.error("\nFATAL: Test suite crashed:", err.message);
    console.error("Is the server running? npm run dev");
    process.exit(1);
  }
  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${PASS} ${passed} passed  ${FAIL} ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
