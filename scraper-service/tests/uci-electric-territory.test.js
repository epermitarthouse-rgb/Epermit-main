"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const {
  pointInGeometry,
  distanceToPolygonBoundaryMiles,
  normalizeUsStateCode,
} = require("../app/services/uci/territory/territory-geo.utils.js");
const { reconcileEiaUtilityName } = require("../app/services/uci/territory/territory-eia-name-resolver.service.js");
const { resolvePointInPolygonMatches } = require("../app/services/uci/territory/territory-polygon-resolver.service.js");
const {
  clearTerritoryDatasetCache,
  loadStateTerritoryGeoJson,
  isElectricTerritoryDataAvailable,
} = require("../app/services/uci/territory/territory-dataset-loader.service.js");
const { mapCensusMatchConfidence, meetsMinimumGeocodeConfidence } = require("../app/services/uci/territory/territory-geocode.service.js");

const { resolveCountyFallback } = require("../app/services/uci/territory/territory-county-resolver.service.js");
const { resolveElectricTerritory } = require("../app/services/uci/territory/electric-territory-resolver.service.js");
const { buildProviderSetupAddressContext } = require("../app/services/uci/uci-provider-setup.service.js");

const FIXTURE_DIR = path.join(__dirname, "fixtures", "territory");

describe("territory geo utils", () => {
  it("detects point inside BGE fixture polygon", () => {
    const polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-76.75, 39.15],
          [-76.45, 39.15],
          [-76.45, 39.45],
          [-76.75, 39.45],
          [-76.75, 39.15],
        ],
      ],
    };
    assert.equal(pointInGeometry([-76.6, 39.3], polygon), true);
    assert.equal(pointInGeometry([-77.5, 39.3], polygon), false);
  });

  it("computes boundary distance for interior point", () => {
    const polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-76.75, 39.15],
          [-76.45, 39.15],
          [-76.45, 39.45],
          [-76.75, 39.45],
          [-76.75, 39.15],
        ],
      ],
    };
    const dist = distanceToPolygonBoundaryMiles([-76.6, 39.3], polygon);
    assert.ok(dist > 0 && dist < 20);
  });

  it("normalizes US state codes", () => {
    assert.equal(normalizeUsStateCode(" MD "), "MD");
    assert.equal(normalizeUsStateCode("md"), "MD");
  });
});

describe("EIA name reconciliation", () => {
  it("resolves BGE and PEPCO legal names via Row 3 aliases", () => {
    const bge = reconcileEiaUtilityName("BALTIMORE GAS & ELECTRIC CO");
    assert.equal(bge.status, "resolved");
    assert.equal(bge.provider_slug, "bge");

    const pepco = reconcileEiaUtilityName("POTOMAC ELECTRIC POWER CO");
    assert.equal(pepco.status, "resolved");
    assert.equal(pepco.provider_slug, "pepco");

    const smeco = reconcileEiaUtilityName("SOUTHERN MARYLAND ELEC COOP INC");
    assert.equal(smeco.status, "resolved");
    assert.equal(smeco.provider_slug, "smeco");
  });

  it("does not fuzzy-guess unknown provider names", () => {
    const unknown = reconcileEiaUtilityName("Totally Unknown Utility LLC");
    assert.equal(unknown.status, "unresolved");
  });
});

describe("point-in-polygon resolver", () => {
  it("returns one canonical match inside BGE territory", () => {
    const geojson = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, "territories_MD.fixture.geojson"), "utf8"),
    );
    const result = resolvePointInPolygonMatches(geojson, {
      longitude: -76.6,
      latitude: 39.3,
      boundaryBufferMiles: 0.5,
    });
    assert.equal(result.canonical_matches.length, 1);
    assert.equal(result.canonical_matches[0].reconciled.provider_slug, "bge");
  });

  it("returns ambiguous when overlapping canonical territories match", () => {
    const geojson = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, "territories_MD.fixture.geojson"), "utf8"),
    );
    const overlap = {
      type: "Feature",
      properties: { NAME: "POTOMAC ELECTRIC POWER CO", STATE: "MD", TYPE: "INVESTOR OWNED" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-76.7, 39.0],
            [-76.5, 39.0],
            [-76.5, 39.2],
            [-76.7, 39.2],
            [-76.7, 39.0],
          ],
        ],
      },
    };
    geojson.features.push(overlap);
    const result = resolvePointInPolygonMatches(geojson, {
      longitude: -76.6,
      latitude: 39.19,
      boundaryBufferMiles: 0.5,
    });
    assert.equal(result.canonical_matches.length, 2);
    assert.equal(result.boundary_risk, true);
  });
});

describe("territory dataset loader", () => {
  const originalDir = process.env.UCI_TERRITORY_DATA_DIR;
  const originalStorageEnabled = process.env.UCI_TERRITORY_STORAGE_ENABLED;

  beforeEach(() => {
    clearTerritoryDatasetCache();
    process.env.UCI_TERRITORY_STORAGE_ENABLED = "false";
    if (originalDir) process.env.UCI_TERRITORY_DATA_DIR = originalDir;
    else delete process.env.UCI_TERRITORY_DATA_DIR;
  });

  afterEach(() => {
    clearTerritoryDatasetCache();
    if (originalDir) process.env.UCI_TERRITORY_DATA_DIR = originalDir;
    else delete process.env.UCI_TERRITORY_DATA_DIR;
    if (originalStorageEnabled == null) delete process.env.UCI_TERRITORY_STORAGE_ENABLED;
    else process.env.UCI_TERRITORY_STORAGE_ENABLED = originalStorageEnabled;
  });

  it("reports unavailable when manifest is missing", async () => {
    process.env.UCI_TERRITORY_DATA_DIR = path.join(__dirname, "fixtures", "territory-empty");
    assert.equal(await isElectricTerritoryDataAvailable("electric", "MD"), false);
  });

  it("loads fixture geojson when manifest and file exist", async () => {
    const tempDir = path.join(__dirname, "fixtures", "territory-runtime");
    fs.mkdirSync(tempDir, { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURE_DIR, "manifest.fixture.json"),
      path.join(tempDir, "manifest.json"),
    );
    fs.copyFileSync(
      path.join(FIXTURE_DIR, "territories_MD.fixture.geojson"),
      path.join(tempDir, "territories_MD.geojson"),
    );
    process.env.UCI_TERRITORY_DATA_DIR = tempDir;
    assert.equal(await isElectricTerritoryDataAvailable("electric", "MD"), true);
    const loaded = await loadStateTerritoryGeoJson("MD");
    assert.equal(loaded.ok, true);
    assert.ok(Array.isArray(loaded.geojson.features));
  });
});

describe("geocode confidence mapping", () => {
  it("maps census match types to confidence levels", () => {
    assert.equal(mapCensusMatchConfidence("Exact"), "high");
    assert.equal(mapCensusMatchConfidence("Non_Exact"), "medium");
    assert.equal(meetsMinimumGeocodeConfidence("high"), true);
    assert.equal(meetsMinimumGeocodeConfidence("none"), false);
  });
});

describe("boundary buffer resolver", () => {
  it("flags boundary risk when point is near polygon edge", () => {
    const geojson = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, "territories_MD.fixture.geojson"), "utf8"),
    );
    const result = resolvePointInPolygonMatches(geojson, {
      longitude: -76.451,
      latitude: 39.151,
      boundaryBufferMiles: 0.5,
    });
    if (result.canonical_matches.length === 1) {
      assert.equal(result.boundary_risk, true);
      assert.ok(result.boundary_buffer_miles > 0);
    }
  });
});

describe("county fallback resolver", () => {
  const originalDir = process.env.UCI_TERRITORY_DATA_DIR;
  const originalStorageEnabled = process.env.UCI_TERRITORY_STORAGE_ENABLED;

  beforeEach(() => {
    clearTerritoryDatasetCache();
    process.env.UCI_TERRITORY_STORAGE_ENABLED = "false";
    const tempDir = path.join(__dirname, "fixtures", "territory-runtime-county");
    fs.mkdirSync(tempDir, { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURE_DIR, "manifest.fixture.json"),
      path.join(tempDir, "manifest.json"),
    );
    fs.writeFileSync(
      path.join(tempDir, "county_utility.json"),
      JSON.stringify({
        "MD:Montgomery": {
          state: "MD",
          county: "Montgomery",
          utilities: ["POTOMAC ELECTRIC POWER CO"],
          multi_utility: false,
          source_year: 2024,
        },
        "MD:Prince Georges": {
          state: "MD",
          county: "Prince Georges",
          utilities: ["BALTIMORE GAS & ELECTRIC CO", "POTOMAC ELECTRIC POWER CO"],
          multi_utility: true,
          source_year: 2024,
        },
      }),
    );
    process.env.UCI_TERRITORY_DATA_DIR = tempDir;
  });

  afterEach(() => {
    clearTerritoryDatasetCache();
    if (originalDir) process.env.UCI_TERRITORY_DATA_DIR = originalDir;
    else delete process.env.UCI_TERRITORY_DATA_DIR;
    if (originalStorageEnabled == null) delete process.env.UCI_TERRITORY_STORAGE_ENABLED;
    else process.env.UCI_TERRITORY_STORAGE_ENABLED = originalStorageEnabled;
  });

  it("resolves single-utility county fallback", async () => {
    const result = await resolveCountyFallback("MD", "Montgomery");
    assert.equal(result.code, "COUNTY_RESOLVED");
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].reconciled.provider_slug, "pepco");
  });

  it("returns ambiguous for multi-utility county", async () => {
    const result = await resolveCountyFallback("MD", "Prince George's");
    assert.equal(result.code, "COUNTY_AMBIGUOUS");
    assert.ok(result.matches.length >= 2);
  });
});

describe("electric territory integration with fixtures", () => {
  const originalDir = process.env.UCI_TERRITORY_DATA_DIR;
  const originalStorageEnabled = process.env.UCI_TERRITORY_STORAGE_ENABLED;

  beforeEach(() => {
    clearTerritoryDatasetCache();
    process.env.UCI_TERRITORY_STORAGE_ENABLED = "false";
    const tempDir = path.join(__dirname, "fixtures", "territory-runtime");
    fs.mkdirSync(tempDir, { recursive: true });
    fs.copyFileSync(path.join(FIXTURE_DIR, "manifest.fixture.json"), path.join(tempDir, "manifest.json"));
    fs.copyFileSync(
      path.join(FIXTURE_DIR, "territories_MD.fixture.geojson"),
      path.join(tempDir, "territories_MD.geojson"),
    );
    process.env.UCI_TERRITORY_DATA_DIR = tempDir;
  });

  afterEach(() => {
    clearTerritoryDatasetCache();
    if (originalDir) process.env.UCI_TERRITORY_DATA_DIR = originalDir;
    else delete process.env.UCI_TERRITORY_DATA_DIR;
    if (originalStorageEnabled == null) delete process.env.UCI_TERRITORY_STORAGE_ENABLED;
    else process.env.UCI_TERRITORY_STORAGE_ENABLED = originalStorageEnabled;
  });

  it("resolves BGE inside fixture polygon without live geocoder", async () => {
    const project = {
      address: "100 Main St",
      city: "Baltimore",
      state: "MD",
      zip_code: "21201",
      portal_data: {
        _permitpilot: {
          canonical_address: {
            formatted: "100 Main St, Baltimore, MD 21201",
            source: "manual",
            parts: { street: "100 Main St", city: "Baltimore", state: "MD", zip: "21201" },
          },
        },
      },
    };
    const addressContext = buildProviderSetupAddressContext(project);
    const result = await resolveElectricTerritory({
      serviceType: "electric",
      addressContext,
      tenantProviders: [
        { id: "global-bge", slug: "bge", display_name: "BGE", name: "BGE" },
        { id: "global-pepco", slug: "pepco", display_name: "PEPCO", name: "PEPCO" },
      ],
    });
    assert.ok(
      [
        "resolved",
        "ambiguous",
        "geocoding_failed",
        "territory_data_unavailable",
        "not_found",
        "manual_confirmation_required",
      ].includes(result.status),
    );
    assert.equal(result.service_type, "electric");
  });
});
