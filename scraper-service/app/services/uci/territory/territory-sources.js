"use strict";

/** Verified 2026-07-17 against ArcGIS REST metadata. */
const EIA_OFFICIAL_FEATURE_SERVER =
  "https://services3.arcgis.com/OYP7N6mAJJCyH6hd/ArcGIS/rest/services/Electric_Retail_Service_Territories_HIFLD/FeatureServer";
const EIA_OFFICIAL_LAYER_ID = 0;
const EIA_OFFICIAL_LAYER_URL = `${EIA_OFFICIAL_FEATURE_SERVER}/${EIA_OFFICIAL_LAYER_ID}`;
const EIA_OFFICIAL_SERVICE_ITEM_ID = "597555ce8e4a4892a030784a7c657fdd";

/** Archived HIFLD mirror — explicit fallback only. */
const HIFLD_FALLBACK_LAYER_URL =
  "https://maps.nccs.nasa.gov/mapping/rest/services/hifld_open/energy/FeatureServer/26";

const TERRITORY_SCHEMA_VERSION = "d2.2-territory-v1";
const INGESTION_SCRIPT_VERSION = "2.0.0";

const DEFAULT_FOOTPRINT_STATES = [
  "DC",
  "MD",
  "VA",
  "WV",
  "DE",
  "PA",
  "NJ",
  "NY",
  "CT",
  "RI",
  "MA",
  "VT",
  "NH",
  "ME",
  "NC",
  "SC",
  "GA",
  "FL",
  "OH",
  "AL",
  "MS",
];

/**
 * Cross-border supplements: utilities tagged to adjacent states but serving
 * footprint addresses (e.g. PEPCO tagged STATE=DC serves Maryland suburbs).
 */
const CROSS_BORDER_SUPPLEMENTS = {
  MD: [{
    where: "STATE = 'DC' AND NAME = 'POTOMAC ELECTRIC POWER CO'",
    reason: "pepco_dc_serves_md_suburbs",
    source_state: "DC",
    target_state: "MD",
    source_legal_name: "POTOMAC ELECTRIC POWER CO",
    canonical_provider_slug: "pepco",
  }],
  VA: [{
    where: "STATE = 'DC' AND NAME = 'POTOMAC ELECTRIC POWER CO'",
    reason: "pepco_dc_serves_northern_va",
    source_state: "DC",
    target_state: "VA",
    source_legal_name: "POTOMAC ELECTRIC POWER CO",
    canonical_provider_slug: "pepco",
  }],
  WV: [
    {
      where: "STATE = 'OH' AND NAME = 'APPALACHIAN POWER CO'",
      reason: "appalachian_oh_tagged_serves_wv",
      source_state: "OH",
      target_state: "WV",
      source_legal_name: "APPALACHIAN POWER CO",
      canonical_provider_slug: "appalachian-power",
    },
    {
      where: "STATE = 'OH' AND NAME = 'WHEELING POWER CO'",
      reason: "wheeling_oh_tagged_serves_wv",
      source_state: "OH",
      target_state: "WV",
      source_legal_name: "WHEELING POWER CO",
      canonical_provider_slug: "wheeling-power",
    },
  ],
};

const EIA_QUERY_FIELDS = [
  "OBJECTID",
  "ID",
  "NAME",
  "STATE",
  "TYPE",
  "HOLDING_CO",
  "CUSTOMERS",
  "REGULATED",
  "SOURCEDATE",
  "SOURCE",
  "YEAR",
];

module.exports = {
  EIA_OFFICIAL_FEATURE_SERVER,
  EIA_OFFICIAL_LAYER_ID,
  EIA_OFFICIAL_LAYER_URL,
  EIA_OFFICIAL_SERVICE_ITEM_ID,
  HIFLD_FALLBACK_LAYER_URL,
  TERRITORY_SCHEMA_VERSION,
  INGESTION_SCRIPT_VERSION,
  DEFAULT_FOOTPRINT_STATES,
  CROSS_BORDER_SUPPLEMENTS,
  EIA_QUERY_FIELDS,
};
