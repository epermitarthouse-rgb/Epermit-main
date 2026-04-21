"use strict";

/**
 * Pure storage key sanitization — mirror of server.js.
 * Source mirror: scraper-service/server.js (~345–355).
 *
 * Full Supabase client, bucket ensure, and uploadToSupabaseStorage remain in server.js
 * (they depend on process.env and shared supabase instance side effects).
 */

function sanitizeStorageKey(key) {
  return key
    .split("/")
    .map((segment) =>
      segment.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, ""),
    )
    .join("/")
    .replace(/^\/+/, "");
}

module.exports = {
  sanitizeStorageKey,
};
