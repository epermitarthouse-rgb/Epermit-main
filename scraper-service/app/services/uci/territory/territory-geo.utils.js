"use strict";

const EARTH_RADIUS_MILES = 3958.7613;

/**
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 */
function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * @param {[number, number]} point [lng, lat]
 * @param {[number, number]} a
 * @param {[number, number]} b
 */
function pointToSegmentDistanceMiles(point, a, b) {
  const [px, py] = point;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    return haversineMiles(py, px, ay, ax);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return haversineMiles(py, px, projY, projX);
}

/**
 * @param {[number, number]} point [lng, lat]
 * @param {Array<Array<[number, number]>>} ring
 */
function minDistanceToRingMiles(point, ring) {
  if (!Array.isArray(ring) || ring.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const dist = pointToSegmentDistanceMiles(point, ring[i], ring[i + 1]);
    if (dist < min) min = dist;
  }
  return min;
}

/**
 * Ray-casting point-in-polygon for a single ring.
 * @param {[number, number]} point [lng, lat]
 * @param {Array<[number, number]>} ring
 */
function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * @param {[number, number]} point
 * @param {import('geojson').Polygon} polygon
 */
function pointInPolygon(point, polygon) {
  const rings = polygon.coordinates;
  if (!Array.isArray(rings) || rings.length === 0) return false;
  if (!pointInRing(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(point, rings[i])) return false;
  }
  return true;
}

/**
 * @param {[number, number]} point
 * @param {import('geojson').MultiPolygon} multiPolygon
 */
function pointInMultiPolygon(point, multiPolygon) {
  for (const polygonCoords of multiPolygon.coordinates) {
    if (pointInPolygon(point, { type: "Polygon", coordinates: polygonCoords })) {
      return true;
    }
  }
  return false;
}

/**
 * @param {[number, number]} point
 * @param {import('geojson').Geometry} geometry
 */
function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygon(point, geometry);
  if (geometry.type === "MultiPolygon") return pointInMultiPolygon(point, geometry);
  return false;
}

/**
 * Minimum distance from point to polygon outer boundary (miles).
 * @param {[number, number]} point
 * @param {import('geojson').Polygon | import('geojson').MultiPolygon} geometry
 */
function distanceToPolygonBoundaryMiles(point, geometry) {
  if (!geometry) return Infinity;
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  let min = Infinity;
  for (const coords of polygons) {
    const outer = coords[0];
    if (outer) {
      min = Math.min(min, minDistanceToRingMiles(point, outer));
    }
  }
  return min;
}

const US_STATE_NAME_TO_CODE = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  "DISTRICT OF COLUMBIA": "DC",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
};

const US_STATE_CODES = new Set(Object.values(US_STATE_NAME_TO_CODE));

/**
 * @param {string | null | undefined} state
 * @returns {string | null}
 */
function normalizeUsStateCode(state) {
  const raw = String(state ?? "").trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && US_STATE_CODES.has(upper)) {
    return upper;
  }

  const normalizedName = upper.replace(/\./g, "").replace(/\s+/g, " ");
  if (US_STATE_NAME_TO_CODE[normalizedName]) {
    return US_STATE_NAME_TO_CODE[normalizedName];
  }

  const trailingCode = normalizedName.match(/(?:^|[,\s])([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
  if (trailingCode && US_STATE_CODES.has(trailingCode[1])) {
    return trailingCode[1];
  }

  return null;
}

/**
 * @param {string | null | undefined} formatted
 * @returns {string | null}
 */
function extractStateCodeFromFormattedAddress(formatted) {
  const text = String(formatted ?? "").trim();
  if (!text) return null;
  const match = text.match(/,\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/);
  if (!match) return null;
  return normalizeUsStateCode(match[1]);
}

/**
 * @param {Record<string, unknown> | null | undefined} addressContext
 * @param {{ state_code?: string | null, formatted?: string | null } | null | undefined} [geocode]
 * @returns {string | null}
 */
function extractTerritoryStateCode(addressContext, geocode = null) {
  const address =
    addressContext?.address && typeof addressContext.address === "object" && !Array.isArray(addressContext.address)
      ? /** @type {{ parts?: Record<string, unknown>, formatted?: string | null }} */ (addressContext.address)
      : null;
  const structured =
    addressContext?.structured &&
    typeof addressContext.structured === "object" &&
    !Array.isArray(addressContext.structured)
      ? /** @type {{ parts?: Record<string, unknown>, formatted?: string | null }} */ (addressContext.structured)
      : null;

  const candidates = [
    geocode?.state_code,
    address?.parts && typeof address.parts === "object" ? address.parts.state : null,
    structured?.parts && typeof structured.parts === "object" ? structured.parts.state : null,
    geocode?.formatted,
    address?.formatted,
    structured?.formatted,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeUsStateCode(candidate);
    if (normalized) return normalized;
  }

  return (
    extractStateCodeFromFormattedAddress(geocode?.formatted) ||
    extractStateCodeFromFormattedAddress(address?.formatted) ||
    extractStateCodeFromFormattedAddress(structured?.formatted)
  );
}

/**
 * Normalize county names for EIA-861 / Census crosswalk lookups.
 * @param {string | null | undefined} county
 */
function normalizeCountyLookupName(county) {
  return String(county ?? "")
    .replace(/'/g, "")
    .replace(/ city$/i, "")
    .replace(/ County$/i, "")
    .trim();
}

module.exports = {
  EARTH_RADIUS_MILES,
  haversineMiles,
  pointInGeometry,
  distanceToPolygonBoundaryMiles,
  US_STATE_NAME_TO_CODE,
  US_STATE_CODES,
  normalizeUsStateCode,
  extractStateCodeFromFormattedAddress,
  extractTerritoryStateCode,
  normalizeCountyLookupName,
};
