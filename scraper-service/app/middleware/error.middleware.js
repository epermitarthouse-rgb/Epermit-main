"use strict";

/**
 * Express error handler for the parallel app only.
 */

function errorMiddleware(err, req, res, _next) {
  console.error("[parallel-app]", err?.stack || err?.message || err);
  const status = err?.status || err?.statusCode || 500;
  const message =
    err?.message && typeof err.message === "string"
      ? err.message
      : "Internal error";
  res.status(status).json({ error: message, layer: "parallel-app" });
}

module.exports = {
  errorMiddleware,
};
