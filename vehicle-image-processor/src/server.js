// src/server.js

require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const { connectDB } = require("./db/connection");
const logger  = require("./utils/logger");

const uploadRouter = require("./api/upload");
const jobsRouter   = require("./api/jobs");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});


app.use("/api", uploadRouter);
app.use("/api", jobsRouter);


app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});


app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Route not found." });
});


app.use((err, _req, res, _next) => {
  logger.error("Unhandled error", { error: err.message });
  res.status(500).json({ success: false, error: "Internal server error." });
});

async function start() {
  await connectDB();
  app.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
    logger.info("Available routes:");
    logger.info("  POST /api/upload");
    logger.info("  GET  /api/status/:jobId");
    logger.info("  GET  /api/result/:jobId");
    logger.info("  GET  /api/jobs");
    logger.info("  GET  /health");
  });
}

start().catch((err) => {
  logger.error("Startup failed", { error: err.message });
  process.exit(1);
});