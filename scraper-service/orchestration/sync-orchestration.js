"use strict";

const { hashPortalData, stableStringify } = require("../shared/hashing.js");

/**
 * Future: portal_data merge + Supabase project row updates after scrape.
 *
 * Today: merge/hash/sync live inside scraper-service/server.js alongside
 * live supabase client and session state — not duplicated here to avoid
 * divergent DB behavior.
 */

module.exports = {
  hashPortalData,
  stableStringify,
  /** Reserved for extracted merge from server.js */
  mergePortalDataIntoProject: null,
  migrationNote:
    "Wire server.js sync helpers here after adding regression tests; do not fork Supabase writes prematurely.",
};
