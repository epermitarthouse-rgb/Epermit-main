"use strict";

const crypto = require("crypto");

/**
 * Stable JSON stringify + portal_data hash — mirror of server.js helpers.
 * Source mirror: scraper-service/server.js (~192–213).
 * Keep in sync when migrating server.js to import from here.
 */

function stableStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  if (typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") +
      "}"
    );
  }
  return JSON.stringify(obj);
}

function hashPortalData(data) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(data))
    .digest("hex");
}

module.exports = {
  stableStringify,
  hashPortalData,
};
