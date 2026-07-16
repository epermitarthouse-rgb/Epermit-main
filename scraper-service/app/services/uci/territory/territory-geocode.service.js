"use strict";

const { PROVIDER_RESOLUTION_VERSION } = require("../uci-provider-resolution-contract.js");
const { normalizeCountyLookupName } = require("./territory-geo.utils.js");

const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const DEFAULT_BENCHMARK = "Public_AR_Current";
const DEFAULT_VINTAGE = "Current_Current";
const DEFAULT_MIN_CONFIDENCE = String(process.env.UCI_GEOCODE_MIN_CONFIDENCE ?? "medium")
  .trim()
  .toLowerCase();

const CONFIDENCE_RANK = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * @param {unknown} matchType
 * @returns {"high"|"medium"|"low"|"none"}
 */
function mapCensusMatchConfidence(matchType) {
  const normalized = String(matchType ?? "").trim().toLowerCase();
  if (!normalized || normalized === "none") return "medium";
  if (normalized.includes("non_exact") || normalized.includes("non-exact")) return "medium";
  if (normalized.includes("exact")) return "high";
  if (normalized.includes("tie")) return "low";
  return "low";
}

/**
 * @param {string | null | undefined} name
 */
function normalizeCensusCountyName(name) {
  return normalizeCountyLookupName(name);
}

/**
 * @param {"high"|"medium"|"low"|"none"} confidence
 */
function meetsMinimumGeocodeConfidence(confidence) {
  const minRank = CONFIDENCE_RANK[/** @type {keyof typeof CONFIDENCE_RANK} */ (DEFAULT_MIN_CONFIDENCE)] ?? 2;
  return (CONFIDENCE_RANK[confidence] ?? 0) >= minRank;
}

/**
 * @param {string} address
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 */
async function geocodeUsAddressWithCensus(address, options = {}) {
  const formatted = String(address ?? "").trim();
  if (!formatted) {
    return {
      ok: false,
      code: "MISSING_ADDRESS",
      confidence: "none",
      formatted: null,
      latitude: null,
      longitude: null,
      geocode_provider: "us_census",
      geocoded_at: new Date().toISOString(),
      match_type: null,
      provider_response_id: null,
      candidates: [],
    };
  }

  const timeoutMs = options.timeoutMs ?? 12000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const params = new URLSearchParams({
      address: formatted,
      benchmark: DEFAULT_BENCHMARK,
      vintage: DEFAULT_VINTAGE,
      format: "json",
    });
    const res = await fetch(`${CENSUS_GEOCODER_URL}?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        code: res.status === 429 ? "RATE_LIMIT" : "GEOCODER_HTTP_ERROR",
        confidence: "none",
        formatted,
        latitude: null,
        longitude: null,
        geocode_provider: "us_census",
        geocoded_at: new Date().toISOString(),
        match_type: null,
        provider_response_id: null,
        http_status: res.status,
        candidates: [],
      };
    }

    const body = await res.json();
    const matches = Array.isArray(body?.result?.addressMatches) ? body.result.addressMatches : [];
    if (matches.length === 0) {
      return {
        ok: false,
        code: "NO_MATCH",
        confidence: "none",
        formatted,
        latitude: null,
        longitude: null,
        geocode_provider: "us_census",
        geocoded_at: new Date().toISOString(),
        match_type: null,
        provider_response_id: null,
        candidates: [],
      };
    }

    if (matches.length > 1) {
      const mapped = matches.slice(0, 5).map((match) => {
        const coords = match?.coordinates ?? {};
        const geographies =
          match?.geographies && typeof match.geographies === "object" ? match.geographies : {};
        const stateEntry = Array.isArray(geographies.States) ? geographies.States[0] : null;
        const countyEntry = Array.isArray(geographies.Counties) ? geographies.Counties[0] : null;
        return {
          formatted: String(match?.matchedAddress ?? formatted),
          latitude: Number(coords.y),
          longitude: Number(coords.x),
          match_type: String(match?.matchType ?? ""),
          confidence: mapCensusMatchConfidence(match?.matchType),
          state_code: stateEntry?.STUSAB ? String(stateEntry.STUSAB).toUpperCase() : null,
          county_name: countyEntry?.NAME ? normalizeCensusCountyName(countyEntry.NAME) : null,
        };
      });
      const best = mapped[0];
      const confidence = mapCensusMatchConfidence(matches[0]?.matchType);
      const ok =
        meetsMinimumGeocodeConfidence(confidence) &&
        mapped.length === 1 &&
        Number.isFinite(best.latitude) &&
        Number.isFinite(best.longitude);
      return {
        ok,
        code: mapped.length > 1 ? "MULTIPLE_MATCHES" : ok ? "OK" : "LOW_CONFIDENCE",
        confidence,
        formatted: best.formatted,
        latitude: Number.isFinite(best.latitude) ? best.latitude : null,
        longitude: Number.isFinite(best.longitude) ? best.longitude : null,
        geocode_provider: "us_census",
        geocoded_at: new Date().toISOString(),
        match_type: best.match_type,
        provider_response_id: String(matches[0]?.tigerLine?.tigerLineId ?? "") || null,
        state_code: best.state_code ?? null,
        county_name: best.county_name ?? null,
        candidates: mapped,
        requires_human_confirmation: mapped.length > 1 || !meetsMinimumGeocodeConfidence(confidence),
      };
    }

    const match = matches[0];
    const coords = match?.coordinates ?? {};
    const latitude = Number(coords.y);
    const longitude = Number(coords.x);
    const confidence = mapCensusMatchConfidence(match?.matchType);
    const ok = Number.isFinite(latitude) && Number.isFinite(longitude) && meetsMinimumGeocodeConfidence(confidence);

    const geographies = match?.geographies && typeof match.geographies === "object" ? match.geographies : {};
    const stateEntry = Array.isArray(geographies.States) ? geographies.States[0] : null;
    const countyEntry = Array.isArray(geographies.Counties) ? geographies.Counties[0] : null;

    return {
      ok,
      code: ok ? "OK" : Number.isFinite(latitude) ? "LOW_CONFIDENCE" : "INVALID_COORDINATES",
      confidence,
      formatted: String(match?.matchedAddress ?? formatted),
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      geocode_provider: "us_census",
      geocoded_at: new Date().toISOString(),
      match_type: String(match?.matchType ?? ""),
      provider_response_id: String(match?.tigerLine?.tigerLineId ?? "") || null,
      state_code: stateEntry?.STUSAB ? String(stateEntry.STUSAB).toUpperCase() : null,
      county_name: countyEntry?.NAME ? normalizeCensusCountyName(countyEntry.NAME) : null,
      candidates: [
        {
          formatted: String(match?.matchedAddress ?? formatted),
          latitude,
          longitude,
          match_type: String(match?.matchType ?? ""),
          confidence,
        },
      ],
      requires_human_confirmation: !ok,
      resolver_version: PROVIDER_RESOLUTION_VERSION,
    };
  } catch (err) {
    const aborted = err && typeof err === "object" && /** @type {{ name?: string }} */ (err).name === "AbortError";
    return {
      ok: false,
      code: aborted ? "TIMEOUT" : "GEOCODER_ERROR",
      confidence: "none",
      formatted,
      latitude: null,
      longitude: null,
      geocode_provider: "us_census",
      geocoded_at: new Date().toISOString(),
      match_type: null,
      provider_response_id: null,
      error: err instanceof Error ? err.message : String(err),
      candidates: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  CENSUS_GEOCODER_URL,
  mapCensusMatchConfidence,
  meetsMinimumGeocodeConfidence,
  geocodeUsAddressWithCensus,
};
