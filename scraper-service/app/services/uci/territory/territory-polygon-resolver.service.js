"use strict";

const {
  pointInGeometry,
  distanceToPolygonBoundaryMiles,
} = require("./territory-geo.utils.js");
const { reconcileEiaUtilityName } = require("./territory-eia-name-resolver.service.js");

/**
 * @param {Record<string, unknown>} props
 */
function readFeatureProperties(props) {
  const p = props && typeof props === "object" ? props : {};
  return {
    eia_legal_name: String(p.NAME ?? p.name ?? "").trim(),
    eia_state: String(p.STATE ?? p.state ?? "").trim().toUpperCase(),
    utility_type: String(p.TYPE ?? p.type ?? "").trim(),
    holding_co: String(p.HOLDING_CO ?? p.holding_co ?? "").trim() || null,
    customers: p.CUSTOMERS ?? p.customers ?? null,
    source_date: p.SOURCEDATE ?? p.SOURCEDATE ?? null,
    supplement_reason: p._supplement_reason ?? null,
  };
}

/**
 * @param {Record<string, unknown>} geojson
 * @param {object} params
 * @param {number} params.longitude
 * @param {number} params.latitude
 * @param {number} [params.boundaryBufferMiles]
 */
function resolvePointInPolygonMatches(geojson, params) {
  const point = [params.longitude, params.latitude];
  const boundaryBufferMiles =
    typeof params.boundaryBufferMiles === "number" && Number.isFinite(params.boundaryBufferMiles)
      ? params.boundaryBufferMiles
      : Number(process.env.UCI_TERRITORY_BOUNDARY_BUFFER_MILES ?? 0.5);

  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  /** @type {Array<Record<string, unknown>>} */
  const containing = [];

  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const geometry = feature.geometry;
    if (!geometry || typeof geometry !== "object") continue;
    if (!pointInGeometry(point, geometry)) continue;

    const props = readFeatureProperties(
      /** @type {{ properties?: Record<string, unknown> }} */ (feature).properties ?? {},
    );
    const reconciled = reconcileEiaUtilityName(props.eia_legal_name);
    const boundaryDistanceMiles = distanceToPolygonBoundaryMiles(point, geometry);

    containing.push({
      ...props,
      reconciled,
      boundary_distance_miles: boundaryDistanceMiles,
      match_reason: "territory_polygon",
      geometry,
    });
  }

  /** Dedupe canonical electric matches by provider_slug */
  const bySlug = new Map();
  for (const match of containing) {
    const reconciled = /** @type {{ status: string, provider_slug?: string | null }} */ (match.reconciled);
    if (reconciled.status !== "resolved" || !reconciled.provider_slug) continue;
    const slug = String(reconciled.provider_slug).toLowerCase();
    const existing = bySlug.get(slug);
    if (!existing || Number(match.boundary_distance_miles) > Number(existing.boundary_distance_miles)) {
      bySlug.set(slug, match);
    }
  }

  const canonicalMatches = [...bySlug.values()];
  const unresolved = containing.filter(
    (m) => /** @type {{ status: string }} */ (m.reconciled).status === "unresolved",
  );
  const ambiguousNames = containing.filter(
    (m) => /** @type {{ status: string }} */ (m.reconciled).status === "ambiguous",
  );

  let boundaryRisk = false;
  let nearestCompeting = null;
  let minBoundaryDistance = Infinity;

  for (const match of canonicalMatches) {
    const dist = Number(match.boundary_distance_miles);
    if (Number.isFinite(dist)) {
      minBoundaryDistance = Math.min(minBoundaryDistance, dist);
      if (dist <= boundaryBufferMiles) boundaryRisk = true;
    }
  }

  if (canonicalMatches.length === 1 && boundaryRisk) {
    let nearestSlug = null;
    let nearestDist = Infinity;
    for (const feature of features) {
      const geometry = feature?.geometry;
      if (!geometry) continue;
      if (pointInGeometry(point, geometry)) continue;
      const dist = distanceToPolygonBoundaryMiles(point, geometry);
      if (dist < nearestDist) {
        nearestDist = dist;
        const props = readFeatureProperties(feature.properties ?? {});
        const reconciled = reconcileEiaUtilityName(props.eia_legal_name);
        if (reconciled.status === "resolved" && reconciled.provider_slug) {
          nearestSlug = {
            provider_slug: reconciled.provider_slug,
            display_name: reconciled.display_name,
            eia_legal_name: props.eia_legal_name,
            distance_miles: dist,
          };
        }
      }
    }
    nearestCompeting = nearestSlug;
  }

  return {
    boundary_buffer_miles: boundaryBufferMiles,
    boundary_risk: boundaryRisk || canonicalMatches.length > 1,
    boundary_distance_miles: Number.isFinite(minBoundaryDistance) ? minBoundaryDistance : null,
    nearest_competing_provider: nearestCompeting,
    canonical_matches: canonicalMatches,
    unresolved_eia_names: unresolved.map((m) => m.eia_legal_name).filter(Boolean),
    ambiguous_eia_names: ambiguousNames.map((m) => m.eia_legal_name).filter(Boolean),
    raw_match_count: containing.length,
  };
}

module.exports = {
  readFeatureProperties,
  resolvePointInPolygonMatches,
};
