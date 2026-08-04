"use strict";

const { Router } = require("express");
const { sessions, cleanupSession } = require("../session/in-memory-store.js");
const { getSupabaseAdmin } = require("../../lib/supabase-admin.js");
const scrapeEvents = require("../../lib/scrape-events.js");

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
  const s = sessions[req.params.sessionId];
  if (!s) return res.status(404).json({ error: "Session not found" });
  s._cancelRequested = true;
  s.status = "cancelled";
  s.message = "Scrape cancelled by user";
  console.log(`   🛑 Cancel requested for session ${req.params.sessionId}`);

  if (s._scrapeJobId && s._scrapeProjectId) {
    try {
      const supabase = getSupabaseAdmin();
      const jurisdiction = `${s.jurisdiction || s.portalUrl || ""}`.toLowerCase();
      if (jurisdiction.includes("arlington")) {
        await supabase.rpc("cancel_arlington_scrape_job", {
          p_job_id: s._scrapeJobId,
          p_project_id: s._scrapeProjectId,
          p_user_id: s.userId || null,
        });
      } else {
        await scrapeEvents.markScrapeCancelled(
          supabase,
          s._scrapeJobId,
          s._scrapeProjectId,
          { user_message: "Scrape cancelled." },
        );
      }
      scrapeEvents.stopHeartbeat(s._scrapeJobId);
    } catch (err) {
      console.warn("[scrape-events] cancel persist failed:", err.message);
    }
  }

  cleanupSession(req.params.sessionId, "http_cancel");
  res.json({
    message: "Scrape cancelled",
    sessionId: req.params.sessionId,
    jobId: s._scrapeJobId || null,
  });
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
    const { data: jobRow, error: jobError } = await supabase
      .from("scrape_jobs")
      .select("id, jurisdiction, user_id, project_id")
      .eq("id", jobId)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!jobRow) {
      return res.status(404).json({ success: false, error: "Scrape job not found" });
    }
    if (`${jobRow.project_id}` !== projectId) {
      return res.status(403).json({ success: false, error: "Job does not belong to project" });
    }

    const jurisdiction = `${jobRow.jurisdiction || ""}`.toLowerCase();
    if (!jurisdiction.includes("arlington")) {
      await scrapeEvents.markScrapeCancelled(supabase, jobId, projectId, {
        user_message: "Scrape cancelled.",
      });
      scrapeEvents.stopHeartbeat(jobId);
      return res.json({
        success: true,
        jobId,
        status: "cancelled",
        alreadyTerminal: false,
        cancellationReason: "user_cancelled",
      });
    }

    const { data, error } = await supabase.rpc("cancel_arlington_scrape_job", {
      p_job_id: jobId,
      p_project_id: projectId,
      p_user_id: jobRow.user_id || null,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.already_terminal) {
      await scrapeEvents.emitScrapeEvent(supabase, jobId, projectId, {
        event_type: "scrape_cancelled",
        stage: "cancelled",
        status: "cancelled",
        user_message: "Arlington scrape cancelled by user.",
      });
    }
    scrapeEvents.stopHeartbeat(jobId);

    return res.json({
      success: true,
      jobId: row?.job_id || jobId,
      status: row?.status || "cancelled",
      alreadyTerminal: Boolean(row?.already_terminal),
      cancellationReason: row?.cancellation_reason || "user_cancelled",
    });
  } catch (err) {
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
