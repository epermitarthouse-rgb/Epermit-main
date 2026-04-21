"use strict";

const { Router } = require("express");
const { planScrapeRequest } = require("../../orchestration/scrape-dispatch.js");

const router = Router();

/**
 * Planning endpoint — body: { session, permitNumber?, projectId?, ... }
 * Does not run Playwright (server.js owns POST /api/scrape).
 */
router.post("/plan/scrape", (req, res, next) => {
  try {
    const body = req.body || {};
    const plan = planScrapeRequest(body.session, body);
    const status = plan.httpStatus;
    if (status && !plan.ok) {
      return res.status(status).json(plan);
    }
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
