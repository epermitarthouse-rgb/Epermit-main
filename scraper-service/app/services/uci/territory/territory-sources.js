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
  MD: [{ where: "STATE = 'DC' AND NAME = 'POTOMAC ELECTRIC POWER CO'", reason: "pepco_dc_serves_md_suburbs" }],
  VA: [{ where: "STATE = 'DC' AND NAME = 'POTOMAC ELECTRIC POWER CO'", reason: "pepco_dc_serves_northern_va" }],
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
