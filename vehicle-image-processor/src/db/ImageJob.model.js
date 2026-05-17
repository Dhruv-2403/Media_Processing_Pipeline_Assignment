// src/db/ImageJob.model.js

const mongoose = require("mongoose");

// Each analysis check produces one of these
const checkResultSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true },   
    passed:   { type: Boolean, required: true }, 
    severity: { type: String, enum: ["ok", "warning", "critical"], required: true },
    message:  { type: String, required: true },   
    detail:   { type: mongoose.Schema.Types.Mixed, default: null }, 
  },
  { _id: false }
);

const imageJobSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },

    // Upload metadata
    originalName: { type: String, required: true },
    mimeType:     { type: String, required: true },
    sizeBytes:    { type: Number, required: true },
    storagePath:  { type: String, required: true }, 

    // Processing state
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },
    attemptCount:  { type: Number, default: 0 },
    failureReason: { type: String, default: null },

    // Populated after analysis completes
    imageInfo: {
      width:   { type: Number, default: null },
      height:  { type: Number, default: null },
      format:  { type: String, default: null },
      hasExif: { type: Boolean, default: false },
    },

    checks: { type: [checkResultSchema], default: [] },

   
    verdict: {
      type: String,
      enum: ["clean", "warning", "rejected", null],
      default: null,
    },

    // Timing
    uploadedAt:          { type: Date, default: Date.now },
    processingStartedAt: { type: Date, default: null },
    completedAt:         { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ImageJob", imageJobSchema);