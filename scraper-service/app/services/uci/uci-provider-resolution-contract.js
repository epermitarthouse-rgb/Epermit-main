"use strict";

/** D2.2 resolver contract version — bump when shape or semantics change. */
const PROVIDER_RESOLUTION_VERSION = "d2.2-v1";

/** @typedef {"electric"|"gas"|"water"|"sewer"|"telecom"|string} ServiceType */

/** @typedef {"resolved"|"ambiguous"|"not_found"|"geocoding_failed"|"territory_data_unavailable"|"manual_confirmation_required"|"confirmed"|"overridden"} ProviderResolutionStatus */

/** @typedef {"point_in_polygon"|"boundary_buffer"|"county_fallback"|"zip_cache_suggestion"|"manual_selection"} ProviderResolutionMethod */

/** @typedef {"high"|"medium"|"low"|"none"} ProviderResolutionConfidence */

const RESOLUTION_STATUSES = Object.freeze([
  "resolved",
  "ambiguous",
  "not_found",
  "geocoding_failed",
  "territory_data_unavailable",
  "manual_confirmation_required",
  "confirmed",
  "overridden",
]);

const RESOLUTION_METHODS = Object.freeze([
  "point_in_polygon",
  "boundary_buffer",
  "county_fallback",
  "zip_cache_suggestion",
  "manual_selection",
]);

const RESOLUTION_CONFIDENCE = Object.freeze(["high", "medium", "low", "none"]);

const ADDRESS_SOURCES = Object.freeze(["project", "portal", "manual"]);

const PERMITPILOT_RESOLUTION_KEY = "uci_provider_resolution";

const TERRITORY_DATA_UNAVAILABLE_MESSAGE =
  "Automatic territory matching is not available yet. Select and confirm the utility serving this project.";

const AMBIGUOUS_CANDIDATES_MESSAGE =
  "Multiple possible providers were found. Review the candidates before continuing.";

const BOUNDARY_WARNING_MESSAGE =
  "This project is near a utility territory boundary. Human confirmation is required.";

const HUMAN_CONFIRMATION_REQUIRED_MESSAGE = "Human confirmation is required.";

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {unknown} serviceType
 * @returns {string}
 */
function normalizeServiceType(serviceType) {
  return String(serviceType ?? "")
    .trim()
    .toLowerCase();
}

/**
 * @param {unknown} status
 * @returns {status is ProviderResolutionStatus}
 */
function isValidResolutionStatus(status) {
  return typeof status === "string" && RESOLUTION_STATUSES.includes(/** @type {ProviderResolutionStatus} */ (status));
}

/**
 * @param {unknown} method
 * @returns {method is ProviderResolutionMethod | null}
 */
function isValidResolutionMethod(method) {
  return method == null || (typeof method === "string" && RESOLUTION_METHODS.includes(/** @type {ProviderResolutionMethod} */ (method)));
}

/**
 * @param {unknown} confidence
 * @returns {confidence is ProviderResolutionConfidence}
 */
function isValidConfidence(confidence) {
  return typeof confidence === "string" && RESOLUTION_CONFIDENCE.includes(/** @type {ProviderResolutionConfidence} */ (confidence));
}

/**
 * @param {unknown} candidate
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, errors: string[] }}
 */
function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, errors: ["candidate must be an object"] };
  }
  const rec = /** @type {Record<string, unknown>} */ (candidate);
  const errors = [];
  if (!isNonEmptyString(rec.provider_id)) errors.push("candidate.provider_id is required");
  if (!isNonEmptyString(rec.provider_slug)) errors.push("candidate.provider_slug is required");
  if (!isNonEmptyString(rec.display_name)) errors.push("candidate.display_name is required");
  if (!isNonEmptyString(rec.match_reason)) errors.push("candidate.match_reason is required");
  return errors.length ? { ok: false, errors } : { ok: true, value: rec };
}

/**
 * Validate a single service-type provider resolution result.
 *
 * @param {unknown} result
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, errors: string[] }}
 */
function validateProviderResolutionResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { ok: false, errors: ["result must be an object"] };
  }

  const rec = /** @type {Record<string, unknown>} */ (result);
  /** @type {string[]} */
  const errors = [];

  const serviceType = normalizeServiceType(rec.service_type);
  if (!serviceType) errors.push("service_type is required");

  if (!isValidResolutionStatus(rec.status)) {
    errors.push(`status must be one of: ${RESOLUTION_STATUSES.join(", ")}`);
  }

  if (rec.resolution_method != null && !isValidResolutionMethod(rec.resolution_method)) {
    errors.push(`resolution_method must be one of: ${RESOLUTION_METHODS.join(", ")}`);
  }

  if (!isValidConfidence(rec.confidence)) {
    errors.push(`confidence must be one of: ${RESOLUTION_CONFIDENCE.join(", ")}`);
  }

  const address = rec.address;
  if (!address || typeof address !== "object" || Array.isArray(address)) {
    errors.push("address is required");
  } else {
    const addr = /** @type {Record<string, unknown>} */ (address);
    if (addr.formatted != null && typeof addr.formatted !== "string") {
      errors.push("address.formatted must be a string or null");
    }
    if (addr.source != null && !ADDRESS_SOURCES.includes(String(addr.source))) {
      errors.push(`address.source must be one of: ${ADDRESS_SOURCES.join(", ")}`);
    }
  }

  if (!Array.isArray(rec.candidates)) {
    errors.push("candidates must be an array");
  } else {
    for (const [index, candidate] of rec.candidates.entries()) {
      const check = validateCandidate(candidate);
      if (!check.ok) {
        errors.push(...check.errors.map((entry) => `candidates[${index}].${entry}`));
      }
    }
  }

  if (rec.suggested_provider_id != null && !isNonEmptyString(rec.suggested_provider_id)) {
    errors.push("suggested_provider_id must be a non-empty string or null");
  }

  if (typeof rec.boundary_risk !== "boolean") {
    errors.push("boundary_risk must be a boolean");
  }

  if (typeof rec.requires_human_confirmation !== "boolean") {
    errors.push("requires_human_confirmation must be a boolean");
  }

  if (rec.resolver_version != null && !isNonEmptyString(rec.resolver_version)) {
    errors.push("resolver_version must be a non-empty string");
  }

  if (rec.resolved_at != null && !isNonEmptyString(rec.resolved_at)) {
    errors.push("resolved_at must be an ISO timestamp string or null");
  }

  if (rec.status === "ambiguous" && rec.requires_human_confirmation !== true) {
    errors.push("ambiguous status requires requires_human_confirmation=true");
  }

  if (rec.boundary_risk === true && rec.requires_human_confirmation !== true) {
    errors.push("boundary_risk requires requires_human_confirmation=true");
  }

  if (rec.status === "overridden" && !isNonEmptyString(rec.override_reason)) {
    errors.push("overridden status requires override_reason");
  }

  if (rec.status === "confirmed" && !isNonEmptyString(rec.confirmed_provider_id)) {
    errors.push("confirmed status requires confirmed_provider_id");
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  return { ok: true, value: rec };
}

/**
 * @param {unknown} store
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, errors: string[] }}
 */
function validateProviderResolutionStore(store) {
  if (!store || typeof store !== "object" || Array.isArray(store)) {
    return { ok: false, errors: ["store must be an object"] };
  }
  const rec = /** @type {Record<string, unknown>} */ (store);
  const byServiceType = rec.by_service_type;
  if (!byServiceType || typeof byServiceType !== "object" || Array.isArray(byServiceType)) {
    return { ok: false, errors: ["by_service_type must be an object"] };
  }

  /** @type {string[]} */
  const errors = [];
  for (const [serviceType, entry] of Object.entries(byServiceType)) {
    const check = validateProviderResolutionResult({ .../** @type {Record<string, unknown>} */ (entry), service_type: serviceType });
    if (!check.ok) {
      errors.push(...check.errors.map((item) => `${serviceType}.${item}`));
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: rec };
}

module.exports = {
  PROVIDER_RESOLUTION_VERSION,
  PERMITPILOT_RESOLUTION_KEY,
  RESOLUTION_STATUSES,
  RESOLUTION_METHODS,
  RESOLUTION_CONFIDENCE,
  ADDRESS_SOURCES,
  TERRITORY_DATA_UNAVAILABLE_MESSAGE,
  AMBIGUOUS_CANDIDATES_MESSAGE,
  BOUNDARY_WARNING_MESSAGE,
  HUMAN_CONFIRMATION_REQUIRED_MESSAGE,
  normalizeServiceType,
  isValidResolutionStatus,
  isValidResolutionMethod,
  validateProviderResolutionResult,
  validateProviderResolutionStore,
};
