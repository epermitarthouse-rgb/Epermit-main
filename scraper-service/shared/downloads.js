"use strict";

const fs = require("fs");
const path = require("path");
const { getDownloadsDir } = require("../artifacts/paths");

/**
 * Ensure downloads directory exists (same pattern as server.js getDownloadsDir).
 * Does not change server.js behavior — parallel helper for future routes.
 */

function ensureDownloadsDir() {
  const dir = getDownloadsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} filename
 * @returns {string}
 */
function resolveDownloadPath(filename) {
  return path.join(getDownloadsDir(), filename);
}

module.exports = {
  ensureDownloadsDir,
  resolveDownloadPath,
  getDownloadsDir,
};
