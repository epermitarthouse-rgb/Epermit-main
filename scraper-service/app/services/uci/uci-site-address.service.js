"use strict";

/**
 * Canonical geocoded site address snapshot for UCI Agents 1–6.
 * Stored on projects.portal_data.uci_site_address and copied onto each
 * coordination_records.metadata.uci_site_address.
 */

const { geocodeUsAddressWithCensus } = require("./territory/territory-geocode.service.js");
const {
  resolveAndNormalizeProjectAddress,
} = require("../project-address.service.js");

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  return {};
}

function snapshotFromGeocode(formatted, geocode) {
  return {
    formatted: geocode.formatted || formatted || null,
    source: "us_census",
    latitude: geocode.latitude ?? null,
    longitude: geocode.longitude ?? null,
    geocode_provider: geocode.geocode_provider || "us_census",
    geocoded_at: geocode.geocoded_at || new Date().toISOString(),
    confidence: geocode.confidence || "none",
    match_type: geocode.match_type || null,
    state_code: geocode.state_code || null,
    county_name: geocode.county_name || null,
    ok: geocode.ok === true,
    code: geocode.code || null,
    requires_human_confirmation: geocode.requires_human_confirmation === true || geocode.ok !== true,
  };
}

/**
 * @param {Record<string, unknown>} project
 * @param {{ geocodeFn?: Function }} [deps]
 */
async function resolveSiteAddressSnapshot(project, deps = {}) {
  const resolution = resolveAndNormalizeProjectAddress({ project });
  const formatted = resolution.formatted || resolution.canonical_formatted || null;
  const geocodeFn = typeof deps.geocodeFn === "function" ? deps.geocodeFn : geocodeUsAddressWithCensus;

  if (!formatted) {
    return {
      formatted: null,
      source: "none",
      latitude: null,
      longitude: null,
      geocode_provider: null,
      geocoded_at: new Date().toISOString(),
      ok: false,
      code: "MISSING_ADDRESS",
      requires_human_confirmation: true,
    };
  }

  const geocode = await geocodeFn(formatted);
  return snapshotFromGeocode(formatted, geocode || {});
}

/**
 * Persist snapshot onto projects.portal_data.uci_site_address (merge, no clobber of other keys).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} project
 * @param {Record<string, unknown>} snapshot
 */
async function persistProjectSiteAddress(supabase, project, snapshot) {
  const portalData = asObject(project.portal_data);
  const nextPortal = {
    ...portalData,
    uci_site_address: snapshot,
  };
  const { data, error } = await supabase
    .from("projects")
    .update({ portal_data: nextPortal })
    .eq("id", String(project.id))
    .select("*")
    .single();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to persist site address"), {
      cause: error,
      statusCode: 500,
      code: "SITE_ADDRESS_PERSIST_FAILED",
    });
  }
  return data || { ...project, portal_data: nextPortal };
}

function mergeRecordSiteAddress(metadata, snapshot) {
  return {
    ...asObject(metadata),
    uci_site_address: snapshot,
  };
}

module.exports = {
  resolveSiteAddressSnapshot,
  persistProjectSiteAddress,
  mergeRecordSiteAddress,
  snapshotFromGeocode,
};
