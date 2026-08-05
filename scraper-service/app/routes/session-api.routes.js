"use strict";

const { Router } = require("express");
const { sessions, cleanupSession } = require("../session/in-memory-store.js");
const { getSupabaseAdmin } = require("../../lib/supabase-admin.js");
const {
  requestCancel,
} = require("../../lib/scrape-job-cancellation.js");

const router = Router();

router.get("/api/progress/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const interval = setInterval(() => {
    const s = sessions[sessionId];
    if (s) {
      res.write(
        `data: ${JSON.stringify({ status: s.status, message: s.message, progress: s.progress, total: s.total, jobId: s._scrapeJobId || null })}\n\n`,
      );
      if (s.status === "done" || s.status === "error" || s.status === "cancelled") {
        clearInterval(interval);
        res.end();
      }
    }
  }, 800);
  req.on("close", () => clearInterval(interval));
});

router.get("/api/data/:sessionId", (req, res) => {
  const s = sessions[req.params.sessionId];
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json({
    status: s.status,
    message: s.message,
    progress: s.progress,
    total: s.total,
    data: s.data,
    jobId: s._scrapeJobId || null,
  });
});

router.post("/api/scrape/cancel/:sessionId", async (req, res) => {
  const sessionId = `${req.params.sessionId || ""}`.trim();
  const s = sessions[sessionId];
  if (!s) return res.status(404).json({ error: "Session not found" });

  try {
    const supabase = getSupabaseAdmin();
    const result = await requestCancel({
      supabase,
      sessionId,
      jobId: s._scrapeJobId || null,
      projectId: s._scrapeProjectId || null,
      sessions,
      cleanupSession,
      userId: s.userId || null,
      closeBrowser: true,
      user_message: "Scrape cancelled by user",
    });
    console.log(`   🛑 Cancel requested for session ${sessionId}`);
    res.json({
      message: "Scrape cancelled",
      sessionId,
      jobId: result.jobId || s._scrapeJobId || null,
      status: result.status,
      success: true,
    });
  } catch (err) {
    console.warn("[scrape/cancel] failed:", err?.message || err);
    // Best-effort legacy signal even if durable cancel fails.
    s._cancelRequested = true;
    s.status = "cancelled";
    s.message = "Scrape cancelled by user";
    cleanupSession(sessionId, "http_cancel");
    res.json({
      message: "Scrape cancelled",
      sessionId,
      jobId: s._scrapeJobId || null,
      success: true,
    });
  }
});

router.post("/api/scrape-jobs/:jobId/cancel", async (req, res) => {
  const jobId = `${req.params.jobId || ""}`.trim();
  const projectId = `${req.body?.projectId || ""}`.trim();
  if (!jobId) {
    return res.status(400).json({ success: false, error: "jobId required" });
  }
  if (!projectId) {
    return res.status(400).json({ success: false, error: "projectId required" });
  }

  try {
    const supabase = getSupabaseAdmin();
    const result = await requestCancel({
      supabase,
      jobId,
      projectId,
      sessions,
      cleanupSession,
      userId: req.body?.userId || null,
      closeBrowser: true,
      user_message: "Scrape cancelled.",
    });

    return res.json({
      success: true,
      jobId: result.jobId || jobId,
      status: result.status || "cancelling",
      alreadyTerminal: Boolean(result.alreadyTerminal),
      cancellationReason: result.cancellationReason || "user_cancelled",
      localSessionSignaled: Boolean(result.localSessionSignaled),
    });
  } catch (err) {
    const code = err?.code || "";
    if (code === "JOB_NOT_FOUND") {
      return res.status(404).json({ success: false, error: "Scrape job not found" });
    }
    if (code === "PROJECT_MISMATCH") {
      return res
        .status(403)
        .json({ success: false, error: "Job does not belong to project" });
    }
    console.warn("[scrape-jobs/cancel] failed:", err?.message || err);
    return res.status(500).json({
      success: false,
      error: err?.message || "Failed to cancel scrape job",
    });
  }
});

router.post("/api/logout/:sessionId", (req, res) => {
  cleanupSession(req.params.sessionId, "http_logout");
  res.json({ message: "Closed" });
});

module.exports = router;
