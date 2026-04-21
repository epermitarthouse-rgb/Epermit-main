"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");
const futureRoutes = require("./routes/index.js");
const { errorMiddleware } = require("./middleware/error.middleware.js");
const { requestLogging } = require("./middleware/request-logging.middleware.js");
const { getPublicDir } = require("../artifacts/paths.js");

/**
 * Parallel Express application — composition root for future migration.
 * Default production entry remains: node server.js (unchanged).
 *
 * Mount future/planning routes under /__future to avoid colliding with
 * legacy paths when both stacks are tested side-by-side on different ports.
 */

function createParallelApp(options = {}) {
  const { futurePrefix = "/__future", mountStatic = true } = options;

  const app = express();
  app.disable("x-powered-by");
  app.use(requestLogging);
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  if (mountStatic) {
    app.use(express.static(getPublicDir()));
  }

  app.use(futurePrefix, futureRoutes);

  app.get("/", (req, res) => {
    res.json({
      ok: true,
      layer: "parallel-app",
      message:
        "Parallel scraper platform shell. Use GET /__future/health. Production server remains server.js.",
    });
  });

  app.use(errorMiddleware);

  return app;
}

module.exports = {
  createParallelApp,
};
