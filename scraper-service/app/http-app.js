"use strict";

const path = require("path");
const express = require("express");
const cors = require("cors");

/**
 * Shared Express application shell: global middleware, static assets, root route,
 * and session API routes. Execution routes are registered by
 * app/register-execution-routes.js (called from server.js).
 *
 * @param {{ scraperServiceRoot?: string }} [options]
 * @returns {import("express").Express}
 */
function createSharedHttpApp(options = {}) {
  const scraperServiceRoot =
    options.scraperServiceRoot || path.join(__dirname, "..");

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.static(path.join(scraperServiceRoot, "public")));
  app.use(
    "/view-file",
    express.static(path.join(scraperServiceRoot, "downloads")),
  );

  app.get("/", (req, res) =>
    res.sendFile(path.join(scraperServiceRoot, "public", "index.html")),
  );

  app.use(require("./routes/session-api.routes.js"));

  return app;
}

module.exports = {
  createSharedHttpApp,
};
