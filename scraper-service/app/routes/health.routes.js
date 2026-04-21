"use strict";

const { Router } = require("express");

const router = Router();

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    layer: "parallel-app",
    pid: process.pid,
  });
});

module.exports = router;
