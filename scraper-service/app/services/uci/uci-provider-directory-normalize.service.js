"use strict";

const CORPORATE_SUFFIX_PATTERN =
  /\b(incorporated|inc|llc|l\.l\.c|corp|corporation|company|co|coop|cooperative|assn|association)\b\.?/gi;

const PUNCTUATION_PATTERN = /[.,'"()]/g;

/**
 * Normalize a provider alias for deterministic exact matching.
 * Does not perform fuzzy/substring matching.
 * @param {string} input
 * @returns {string}
 */
function normalizeProviderAlias(input) {
  let hay = String(input ?? "")
    .trim()
    .toLowerCase();
  if (!hay) return "";

  hay = hay.replace(/&/g, " and ");
  hay = hay.replace(PUNCTUATION_PATTERN, " ");
  hay = hay.replace(CORPORATE_SUFFIX_PATTERN, " ");
  hay = hay.replace(/\s+/g, " ").trim();
  return hay;
}

/**
 * @param {string} slug
 * @returns {string}
 */
function normalizeProviderSlug(slug) {
  return String(slug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = {
  normalizeProviderAlias,
  normalizeProviderSlug,
};
