"use strict";

const { Router } = require("express");
const { sessions, cleanupSession } = require("../session/in-memory-store.js");

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
        `data: ${JSON.stringify({ status: s.status, message: s.message, progress: s.progress, total: s.total })}\n\n`,
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
  });
});

router.post("/api/scrape/cancel/:sessionId", (req, res) => {
  const s = sessions[req.params.sessionId];
  if (!s) return res.status(404).json({ error: "Session not found" });
  s._cancelRequested = true;
  s.status = "cancelled";
  s.message = "Scrape cancelled by user";
  console.log(`   🛑 Cancel requested for session ${req.params.sessionId}`);
  cleanupSession(req.params.sessionId, "http_cancel");
  res.json({ message: "Scrape cancelled", sessionId: req.params.sessionId });
});

router.post("/api/logout/:sessionId", (req, res) => {
  cleanupSession(req.params.sessionId, "http_logout");
  res.json({ message: "Closed" });
});

module.exports = router;
