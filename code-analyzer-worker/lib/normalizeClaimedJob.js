"use strict";

/**
 * PostgREST serializes SQL NULL composite returns as an object with null fields.
 * Treat that as "no job" so callers do not enter processing with job.id === null.
 */
function normalizeClaimedJob(data) {
  if (data == null || data.id == null) return null;
  return data;
}

module.exports = { normalizeClaimedJob };
