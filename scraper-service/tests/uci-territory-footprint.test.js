"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  configureTerritoryDatasetLoader,
  clearTerritoryDatasetCache,
  loadStateTerritoryGeoJson,
  readManifest,
  manifestHasState,
  validateTerritoryDatasetHealth,
} = require("../app/services/uci/territory/territory-dataset-loader.service.js");
const { reconcileEiaUtilityName } = require("../app/services/uci/territory/territory-eia-name-resolver.service.js");
const { resolveProviderAlias } = require("../app/services/uci/uci-provider-directory.service.js");
const { AMBIGUOUS_PROVIDER_ALIASES } = require("../app/data/utility-provider-directory.catalog.js");
const { DEFAULT_FOOTPRINT_STATES } = require("../app/services/uci/territory/territory-sources.js");
const { validateManifestSchema } = require("../app/services/uci/territory/territory-storage-client.service.js");

const CLIENT_FOOTPRINT = ["DC", "MD", "VA", "WV", "NY", "NJ", "MA", "RI", "NC", "SC", "GA", "FL", "OH", "AL", "MS"];
const FULL_DATA_DIR = path.join(__dirname, "..", "data", "territory", "electric-full-v2");
const MD_DATA_DIR = path.join(__dirname, "..", "data", "territory", "electric");
const MD_CHECKSUM = "d39616c1612d9b0141ec4727e30276d6b09905a7a0d70d471548c1ac860f2006";

/** @type {Record<string, string | undefined>} */
let originalEnv;

describe("UCI territory client footprint (15-state batch)", () => {
  beforeEach(() => {
    originalEnv = { ...process.env };
    clearTerritoryDatasetCache();
    process.env.UCI_TERRITORY_ALLOW_LOCAL_FALLBACK = "true";
    process.env.UCI_TERRITORY_STORAGE_ENABLED = "false";
    configureTerritoryDatasetLoader({ supabase: null });
  });

  afterEach(() => {
    clearTerritoryDatasetCache();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("documents --all footprint mismatch vs client-required 15 states", () => {
    const extras = DEFAULT_FOOTPRINT_STATES.filter((st) => !CLIENT_FOOTPRINT.includes(st));
    const missing = CLIENT_FOOTPRINT.filter((st) => !DEFAULT_FOOTPRINT_STATES.includes(st));
    assert.deepEqual(missing, []);
    assert.deepEqual(extras.sort(), ["CT", "DE", "ME", "NH", "PA", "VT"].sort());
  });

  it("loads multi-state manifest with all 15 state artifacts", async () => {
    process.env.UCI_TERRITORY_DATA_DIR = FULL_DATA_DIR;
    const manifest = await readManifest();
    assert.ok(manifest);
    const schema = validateManifestSchema(manifest);
    assert.equal(schema.ok, true);
    for (const st of CLIENT_FOOTPRINT) {
      assert.ok(manifestHasState(manifest, st), `manifest missing ${st}`);
      const geoPath = path.join(FULL_DATA_DIR, `territories_${st}.geojson`);
      assert.ok(fs.existsSync(geoPath), `missing geojson for ${st}`);
    }
    assert.equal(Object.keys(manifest.states).length, 15);
  });

  it("preserves Maryland checksum parity with md-only dataset", async () => {
    process.env.UCI_TERRITORY_DATA_DIR = FULL_DATA_DIR;
    const manifest = await readManifest();
    assert.equal(manifest.states.MD.checksum_sha256, MD_CHECKSUM);
    const mdOnlyManifest = JSON.parse(fs.readFileSync(path.join(MD_DATA_DIR, "manifest.json"), "utf8"));
    assert.equal(manifest.states.MD.checksum_sha256, mdOnlyManifest.states.MD.checksum_sha256);
  });

  it("handles DC as single-feature territory without county polygon dependency", async () => {
    process.env.UCI_TERRITORY_DATA_DIR = FULL_DATA_DIR;
    const loaded = await loadStateTerritoryGeoJson("DC");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.geojson.features.length, 1);
    const name = loaded.geojson.features[0].properties.NAME;
    const reconciled = reconcileEiaUtilityName(name);
    assert.equal(reconciled.provider_slug, "pepco");
  });

  it("records PEPCO cross-border supplements for MD and VA", async () => {
    process.env.UCI_TERRITORY_DATA_DIR = FULL_DATA_DIR;
    const manifest = await readManifest();
    assert.deepEqual(manifest.states.MD.supplements_applied, ["pepco_dc_serves_md_suburbs"]);
    assert.deepEqual(manifest.states.VA.supplements_applied, ["pepco_dc_serves_northern_va"]);
  });

  it("records Appalachian and Wheeling WV supplements from Ohio-tagged geometry", async () => {
    process.env.UCI_TERRITORY_DATA_DIR = FULL_DATA_DIR;
    const manifest = await readManifest();
    assert.equal(manifest.states.WV.feature_count, 6);
    const reasons = manifest.states.WV.supplements_applied ?? [];
    assert.ok(reasons.includes("appalachian_oh_tagged_serves_wv"));
    assert.ok(reasons.includes("wheeling_oh_tagged_serves_wv"));
    const supplements = manifest.states.WV.cross_border_supplements ?? [];
    assert.equal(supplements.length, 2);
    assert.equal(supplements[0].source_state, "OH");
    assert.equal(supplements[0].target_state, "WV");
  });

  it("does not duplicate WV supplement geometry", async () => {
    process.env.UCI_TERRITORY_DATA_DIR = FULL_DATA_DIR;
    const loaded = await loadStateTerritoryGeoJson("WV");
    const names = loaded.geojson.features.map((f) => String(f.properties?.NAME ?? ""));
    assert.equal(names.filter((n) => n === "APPALACHIAN POWER CO").length, 1);
    assert.equal(names.filter((n) => n === "WHEELING POWER CO").length, 1);
    assert.equal(loaded.geojson.features.length, 6);
  });

  it("lazy-loads states independently with cache isolation", async () => {
    process.env.UCI_TERRITORY_DATA_DIR = FULL_DATA_DIR;
    const md = await loadStateTerritoryGeoJson("MD");
    const fl = await loadStateTerritoryGeoJson("FL");
    assert.equal(md.ok, true);
    assert.equal(fl.ok, true);
    assert.notEqual(md.geojson, fl.geojson);
    const mdCached = await loadStateTerritoryGeoJson("MD");
    assert.equal(mdCached.code, "CACHE_HIT");
  });

  it("keeps broad regional aliases ambiguous", () => {
    for (const alias of ["Dominion Energy", "Duke Energy", "National Grid"]) {
      const result = resolveProviderAlias(alias);
      assert.equal(result.status, "ambiguous", `${alias} should stay ambiguous`);
    }
  });

  it("separates Duke operating companies by legal name", () => {
    const carolinas = reconcileEiaUtilityName("DUKE ENERGY CAROLINAS, LLC");
    const florida = reconcileEiaUtilityName("DUKE ENERGY FLORIDA, LLC");
    const ohio = reconcileEiaUtilityName("DUKE ENERGY OHIO INC");
    assert.equal(carolinas.provider_slug, "duke-energy");
    assert.equal(florida.provider_slug, "duke-energy-florida");
    assert.equal(ohio.provider_slug, "duke-energy-ohio");
    assert.notEqual(carolinas.provider_slug, florida.provider_slug);
  });

  it("separates Dominion VA from Dominion SC", () => {
    const va = reconcileEiaUtilityName("VIRGINIA ELECTRIC & POWER CO");
    const sc = reconcileEiaUtilityName("DOMINION ENERGY SOUTH CAROLINA, INC");
    assert.equal(va.provider_slug, "dominion");
    assert.equal(sc.provider_slug, "dominion-energy-sc");
    assert.notEqual(va.provider_slug, sc.provider_slug);
  });

  it("reports health metadata for all ingested states", async () => {
    process.env.UCI_TERRITORY_DATA_DIR = FULL_DATA_DIR;
    const health = await validateTerritoryDatasetHealth();
    assert.equal(health.healthy, true);
    assert.equal(health.states.length, 15);
    for (const st of CLIENT_FOOTPRINT) {
      assert.ok(health.states.includes(st), `health missing ${st}`);
    }
  });

  it("supports rollback concept: md-only dir remains distinct version", async () => {
    process.env.UCI_TERRITORY_DATA_DIR = MD_DATA_DIR;
    const mdManifest = await readManifest();
    process.env.UCI_TERRITORY_DATA_DIR = FULL_DATA_DIR;
    clearTerritoryDatasetCache();
    const fullManifest = await readManifest();
    assert.notEqual(mdManifest.dataset_version, fullManifest.dataset_version);
    assert.equal(Object.keys(mdManifest.states).length, 1);
    assert.equal(Object.keys(fullManifest.states).length, 15);
  });

  it("fails health when manifest has no ingested states", async () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, "fixtures", "territory-footprint-"));
    const manifest = JSON.parse(fs.readFileSync(path.join(FULL_DATA_DIR, "manifest.json"), "utf8"));
    manifest.states = {};
    fs.writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify(manifest));
    process.env.UCI_TERRITORY_DATA_DIR = tmpDir;
    const health = await validateTerritoryDatasetHealth();
    assert.equal(health.healthy, false);
    assert.equal(health.code, "NO_STATES");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validates manifest checksums for geojson files", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(FULL_DATA_DIR, "manifest.json"), "utf8"));
    for (const [st, entry] of Object.entries(manifest.states)) {
      const filePath = path.join(FULL_DATA_DIR, String(entry.file));
      const checksum = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
      assert.equal(checksum, entry.checksum_sha256, `${st} checksum mismatch`);
    }
  });

  it("documents ambiguous alias registry includes National Grid and Duke families", () => {
    const aliases = AMBIGUOUS_PROVIDER_ALIASES.map((a) => a.alias);
    assert.ok(aliases.includes("National Grid"));
    assert.ok(aliases.includes("Duke Energy"));
    assert.ok(aliases.includes("Dominion Energy"));
  });
});
