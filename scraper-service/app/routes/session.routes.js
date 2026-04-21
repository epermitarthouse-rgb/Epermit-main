"use strict";

const { Router } = require("express");
const { planLoginRequest } = require("../../orchestration/login-dispatch.js");

const router = Router();

/**
 * Planning endpoint — does not perform login (server.js owns POST /api/login).
 */
router.post("/plan/login", (req, res, next) => {
  try {
    res.json(planLoginRequest(req.body || {}));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
