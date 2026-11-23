"use strict";

/**
 * One portal login at a time across the manual scraper and the automated permit-sync worker (D-061), per portal
 * (DC; Montgomery County MD; Prince George's County ePlans). Uses existing tables only:
 *   - automated side: permit_sync_jobs (status 'running' with an unexpired lease)
 *   - manual side:    scrape_jobs (queued/running with a heartbeat in the last FRESH_SCRAPE_MS)
 * "Same login" = any portal_credentials row with that portal's jurisdiction and the same portal_username.
 * Every function takes an optional portal ("dc" when omitted, which is the original DC behaviour).
 */

const DC_JURISDICTION = /washington\s*dc/i;
const FRESH_SCRAPE_MS = 10 * 60 * 1000;
const WORKER_SESSION_PREFIX = "permit-sync:";

const PORTALS = Object.freeze({
  dc: Object.freeze({
    credentialJurisdiction: DC_JURISDICTION,
    scrapeJurisdiction: (q) => q.eq("jurisdiction", "Washington DC"),
    subtype: "dc-planreview",
    hosts: Object.freeze(["washington-dc-us.avolvecloud.com", "planreview.dob.dc.gov"]),
  }),
  montgomery: Object.freeze({
    credentialJurisdiction: /montgomery/i,
    // Manual Montgomery scrape_jobs carry the credential's jurisdiction text ("Montgomery County ...").
    scrapeJurisdiction: (q) => q.ilike("jurisdiction", "%montgomery%"),
    subtype: "montgomery-projectdox",
    hosts: Object.freeze(["montgomeryco-md-us.avolvecloud.com", "montgomeryco-md-us-projectdoxwebui.avolvecloud.com"]),
  }),
  pgc: Object.freeze({
    credentialJurisdiction: /prince\s*george/i,
    scrapeJurisdiction: (q) => q.ilike("jurisdiction", "%prince george%"),
    subtype: "pgc-eplan",
    hosts: Object.freeze(["eplans.princegeorgescountymd.gov"]),
  }),
});

function portalConfig(portal = "dc") {
  const p = PORTALS[portal];
  if (!p) throw new Error(`unknown portal lock ${portal}`);
  return p;
}

function isDcJurisdiction(jurisdiction) {
  return DC_JURISDICTION.test(String(jurisdiction || ""));
}

/** The lock portal ("dc" | "montgomery" | "pgc") a login URL belongs to, or null. */
function portalForUrl(url) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return Object.keys(PORTALS).find((k) => PORTALS[k].hosts.includes(host)) || null;
  } catch (_) {
    return null;
  }
}

/** DC ProjectDox login URLs: the Avolve tenant (the saved credential's login_url / the default) and the ePlan dashboard. */
function isDcPortalUrl(url) {
  return portalForUrl(url) === "dc";
}

/** Credential ids that log in to the portal with the same username. */
async function sameLoginCredentialIds(supabase, username, portal = "dc") {
  const cfg = portalConfig(portal);
  const u = String(username || "").trim();
  if (!u) return [];
  const { data, error } = await supabase
    .from("portal_credentials")
    .select("id, jurisdiction")
    .eq("portal_username", u);
  if (error) throw new Error(`portal_credentials: ${error.message}`);
  return (data || []).filter((c) => cfg.credentialJurisdiction.test(String(c.jurisdiction || ""))).map((c) => c.id);
}

/**
 * HTTP side: true while an automated sync holds a live lease on this login.
 * A lookup error does not block the manual scraper (its behaviour before this lock); it is logged.
 */
async function automatedDcSyncActive(supabase, { username, credentialIds = null, now = new Date(), portal = "dc" } = {}) {
  try {
    const ids = credentialIds || (await sameLoginCredentialIds(supabase, username, portal));
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
 * Worker side: true while a manual scrape of this portal that may use this login is queued or running with a
 * fresh heartbeat. Manual sessions do not record a credential id, so a row without one also counts
 * (conservative: the worker only waits). The worker's own rows (scraper_session_id prefix) are ignored.
 * Lookup errors propagate: the worker defers rather than risk a second login.
 */
async function manualDcScrapeActive(supabase, { credentialIds = [], now = new Date(), freshMs = FRESH_SCRAPE_MS, portal = "dc" } = {}) {
  const cfg = portalConfig(portal);
  const since = new Date(now.getTime() - freshMs).toISOString();
  const q = cfg.scrapeJurisdiction(supabase
    .from("scrape_jobs")
    .select("id, credential_id, scraper_session_id, metadata"));
  const { data, error } = await q
    .in("status", ["queued", "running"])
    .gt("last_heartbeat_at", since)
    .limit(50);
  if (error) throw new Error(`scrape_jobs: ${error.message}`);
  return (data || []).some((j) => {
    if (String(j.scraper_session_id || "").startsWith(WORKER_SESSION_PREFIX)) return false;
    const subtype = j.metadata && j.metadata.portal_subtype;
    if (subtype && subtype !== cfg.subtype) return false;
    return !j.credential_id || credentialIds.includes(j.credential_id);
  });
}

module.exports = {
  FRESH_SCRAPE_MS,
  WORKER_SESSION_PREFIX,
  PORTALS,
  isDcJurisdiction,
  isDcPortalUrl,
  portalForUrl,
  sameLoginCredentialIds,
  automatedDcSyncActive,
  manualDcScrapeActive,
};
