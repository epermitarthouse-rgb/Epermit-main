"use strict";

const UCI_SUPPORTED_UTILITY_TYPES = Object.freeze(
  require("../../data/uci-utility-types.json"),
);
const SUPPORTED_SET = new Set(UCI_SUPPORTED_UTILITY_TYPES);

function normalizeUtilityType(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isSupportedUtilityType(value) {
  return SUPPORTED_SET.has(normalizeUtilityType(value));
}

function requireSupportedUtilityType(value, fieldName = "utility_type") {
  const normalized = normalizeUtilityType(value);
  if (!SUPPORTED_SET.has(normalized)) {
    const err = new Error(
      `${fieldName} must be one of: ${UCI_SUPPORTED_UTILITY_TYPES.join(", ")}`,
    );
    err.statusCode = 400;
    err.code = "UNSUPPORTED_UTILITY_TYPE";
    throw err;
  }
  return normalized;
}

module.exports = {
  UCI_SUPPORTED_UTILITY_TYPES,
  normalizeUtilityType,
  isSupportedUtilityType,
  requireSupportedUtilityType,
};
