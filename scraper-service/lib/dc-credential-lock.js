"use strict";

/**
 * One DC portal login at a time across the manual scraper and the automated permit-sync worker (D-061).
 * Uses existing tables only:
 *   - automated side: permit_sync_jobs (status 'running' with an unexpired lease)
 *   - manual side:    scrape_jobs (queued/running with a heartbeat in the last FRESH_SCRAPE_MS)
 * "Same login" = any portal_credentials row with a DC jurisdiction and the same portal_username.
 */

const DC_JURISDICTION = /washington\s*dc/i;
const FRESH_SCRAPE_MS = 10 * 60 * 1000;
const WORKER_SESSION_PREFIX = "permit-sync:";

function isDcJurisdiction(jurisdiction) {
  return DC_JURISDICTION.test(String(jurisdiction || ""));
}

/** DC ProjectDox login URLs: the Avolve tenant (the saved credential's login_url / the default) and the ePlan dashboard. */
function isDcPortalUrl(url) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return host === "washington-dc-us.avolvecloud.com" || host === "planreview.dob.dc.gov";
  } catch (_) {
    return false;
  }
}

/** Credential ids that log in to DC with the same username. */
async function sameLoginCredentialIds(supabase, username) {
  const u = String(username || "").trim();
  if (!u) return [];
  const { data, error } = await supabase
    .from("portal_credentials")
    .select("id, jurisdiction")
    .eq("portal_username", u);
  if (error) throw new Error(`portal_credentials: ${error.message}`);
  return (data || []).filter((c) => isDcJurisdiction(c.jurisdiction)).map((c) => c.id);
}

/**
 * HTTP side: true while an automated sync holds a live lease on this DC login.
 * A lookup error does not block the manual scraper (its behaviour before this lock); it is logged.
 */
async function automatedDcSyncActive(supabase, { username, credentialIds = null, now = new Date() } = {}) {
  try {
    const ids = credentialIds || (await sameLoginCredentialIds(supabase, username));
    if (!ids.length) return false;
    const { data, error } = await supabase
      .from("permit_sync_jobs")
      .select("id")
      .in("credential_id", ids)
      .eq("status", "running")
      .gt("lease_expires_at", now.toISOString())
      .limit(1);
    if (error) throw new Error(`permit_sync_jobs: ${error.message}`);
    return Boolean(data && data.length);
  } catch (err) {
    console.warn(`[dc-credential-lock] automated-sync check skipped: ${err && err.message ? err.message : err}`);
    return false;
  }
}

/**
 * Worker side: true while a manual DC scrape that may use this login is queued or running with a fresh
 * heartbeat. Manual DC sessions do not record a credential id, so a DC scrape_jobs row without one also
 * counts (conservative: the worker only waits). The worker's own rows (scraper_session_id prefix) are ignored.
 * Lookup errors propagate: the worker defers rather than risk a second login.
 */
async function manualDcScrapeActive(supabase, { credentialIds = [], now = new Date(), freshMs = FRESH_SCRAPE_MS } = {}) {
  const since = new Date(now.getTime() - freshMs).toISOString();
  const { data, error } = await supabase
    .from("scrape_jobs")
    .select("id, credential_id, scraper_session_id, metadata")
    .eq("jurisdiction", "Washington DC")
    .in("status", ["queued", "running"])
    .gt("last_heartbeat_at", since)
    .limit(50);
  if (error) throw new Error(`scrape_jobs: ${error.message}`);
  return (data || []).some((j) => {
    if (String(j.scraper_session_id || "").startsWith(WORKER_SESSION_PREFIX)) return false;
    const subtype = j.metadata && j.metadata.portal_subtype;
    if (subtype && subtype !== "dc-planreview") return false;
    return !j.credential_id || credentialIds.includes(j.credential_id);
  });
}

module.exports = {
  FRESH_SCRAPE_MS,
  WORKER_SESSION_PREFIX,
  isDcJurisdiction,
  isDcPortalUrl,
  sameLoginCredentialIds,
  automatedDcSyncActive,
  manualDcScrapeActive,
};
