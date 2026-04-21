"use strict";

/**
 * Minimal request logging for the parallel app (no dependency on morgan).
 */

function requestLogging(req, res, next) {
  const t = new Date().toISOString();
  console.log(`[parallel-app] ${t} ${req.method} ${req.originalUrl}`);
  next();
}

module.exports = {
  requestLogging,
};
