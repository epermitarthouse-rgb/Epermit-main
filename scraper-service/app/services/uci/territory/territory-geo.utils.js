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

/**
 * @param {string | null | undefined} state
 */
function normalizeUsStateCode(state) {
  return String(state ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
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
  normalizeUsStateCode,
  normalizeCountyLookupName,
};
