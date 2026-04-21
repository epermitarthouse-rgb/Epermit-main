"use strict";

const { Router } = require("express");

const router = Router();

router.get("/plan/export", (req, res) => {
  res.json({
    kind: "export-plan",
    note:
      "Session Excel export is implemented in scraper-service/server.js (GET /api/export/:sessionId).",
    execution: {
      status: "blocked-on-server-js",
    },
  });
});

module.exports = router;
