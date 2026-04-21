"use strict";

/**
 * Future: centralized cleanup predicates (e.g. PGC success-path local file delete).
 * Production behavior today remains in server.js / per-scraper modules.
 *
 * This module only documents intent — it does not delete files.
 */

function describeCleanupPolicies() {
  return {
    note: "No cleanup invoked from parallel layer in this phase.",
    examples: [
      "server.js may delete local artifacts after successful upload linkage (e.g. PGC success path).",
      "Accela checkpoint screenshots under debug/ are diagnostic only.",
    ],
  };
}

module.exports = {
  describeCleanupPolicies,
};
