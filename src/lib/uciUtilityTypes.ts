import supportedUtilityTypes from "../../scraper-service/app/data/uci-utility-types.json";

export const UCI_SUPPORTED_UTILITY_TYPES = supportedUtilityTypes as readonly [
  "electric",
  "gas",
  "water",
  "sewer",
  "telecom",
];

export type UciUtilityType = (typeof UCI_SUPPORTED_UTILITY_TYPES)[number];

const supportedUtilityTypeSet = new Set<string>(UCI_SUPPORTED_UTILITY_TYPES);

export function isUciUtilityType(value: unknown): value is UciUtilityType {
  return supportedUtilityTypeSet.has(String(value ?? "").trim().toLowerCase());
}

export function normalizeUciUtilityType(value: unknown): UciUtilityType | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return isUciUtilityType(normalized) ? normalized : null;
}
