"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  buildCurrentJsonPath,
  buildManifestPath,
  buildStateGeoJsonPath,
} = require("../app/services/uci/territory/territory-storage-paths.service.js");
const {
  configureTerritoryStorageClient,
  fetchRemoteManifest,
  fetchRemoteStateGeoJson,
  clearTerritoryStorageRuntimeState,
  sha256Buffer,
} = require("../app/services/uci/territory/territory-storage-client.service.js");
const {
  configureTerritoryDatasetLoader,
  clearTerritoryDatasetCache,
  checkElectricTerritoryAvailability,
  loadStateTerritoryGeoJson,
  loadTerritoryManifest,
} = require("../app/services/uci/territory/territory-dataset-loader.service.js");
const { resolveElectricTerritory } = require("../app/services/uci/territory/electric-territory-resolver.service.js");
const { buildProviderSetupAddressContext } = require("../app/services/uci/uci-provider-setup.service.js");
const {
  normalizeTerritoryManifest,
  listManifestStateCodes,
  manifestHasState,
} = require("../app/services/uci/territory/territory-manifest.service.js");
const { normalizeUsStateCode } = require("../app/services/uci/territory/territory-geo.utils.js");

const CLIENT_FOOTPRINT = ["DC", "MD", "VA", "WV", "NY", "NJ", "MA", "RI", "NC", "SC", "GA", "FL", "OH", "AL", "MS"];
const FULL_DATA_DIR = path.join(__dirname, "..", "data", "territory", "electric-full-v2");
const BUCKET = "uci-territory-datasets";
const PREFIX = "uci-territory";
const VERSION = "2026-07-17-client-footprint-v2";

function makeTerritoryStorageSupabase(objects) {
  const downloads = [];
  const supabase = {
    storage: {
      from() {
        return {
          download: async (storagePath) => {
            downloads.push(storagePath);
            const key = `${BUCKET}:${storagePath}`;
            const bytes = objects[key];
            if (!bytes) return { data: null, error: { message: "not_found" } };
            return { data: new Blob([bytes]), error: null };
          },
        };
      },
    },
  };
  return { supabase, downloads };
}

function buildV2RemoteFixtures() {
  const manifest = normalizeTerritoryManifest(
    JSON.parse(fs.readFileSync(path.join(FULL_DATA_DIR, "manifest.json"), "utf8")),
  );
  assert.ok(manifest);
  manifest.dataset_version = VERSION;

  const objects = {};
  objects[`${BUCKET}:${buildCurrentJsonPath(PREFIX)}`] = Buffer.from(
    JSON.stringify({ dataset_version: VERSION }),
  );
  objects[`${BUCKET}:${buildManifestPath(PREFIX, VERSION)}`] = Buffer.from(JSON.stringify(manifest));

  for (const state of CLIENT_FOOTPRINT) {
    const fileName = `territories_${state}.geojson`;
    const geoPath = path.join(FULL_DATA_DIR, fileName);
    const bytes = fs.readFileSync(geoPath);
    manifest.states[state].checksum_sha256 = sha256Buffer(bytes);
    objects[`${BUCKET}:${buildStateGeoJsonPath(PREFIX, VERSION, state)}`] = bytes;
  }

  objects[`${BUCKET}:${buildManifestPath(PREFIX, VERSION)}`] = Buffer.from(JSON.stringify(manifest));
  return { manifest, objects };
}

function buildV2RemoteFixturesWithInternalVersionMismatch() {
  const rawManifest = JSON.parse(fs.readFileSync(path.join(FULL_DATA_DIR, "manifest.json"), "utf8"));
  assert.notEqual(rawManifest.dataset_version, VERSION);

  const objects = {};
  objects[`${BUCKET}:${buildCurrentJsonPath(PREFIX)}`] = Buffer.from(
    JSON.stringify({ dataset_version: VERSION }),
  );
  objects[`${BUCKET}:${buildManifestPath(PREFIX, VERSION)}`] = Buffer.from(JSON.stringify(rawManifest));

  for (const state of CLIENT_FOOTPRINT) {
    const fileName = `territories_${state}.geojson`;
    const geoPath = path.join(FULL_DATA_DIR, fileName);
    if (!fs.existsSync(geoPath)) continue;
    const bytes = fs.readFileSync(geoPath);
    rawManifest.states[state].checksum_sha256 = sha256Buffer(bytes);
    objects[`${BUCKET}:${buildStateGeoJsonPath(PREFIX, VERSION, state)}`] = bytes;
  }

  objects[`${BUCKET}:${buildManifestPath(PREFIX, VERSION)}`] = Buffer.from(JSON.stringify(rawManifest));
  return { manifest: rawManifest, objects };
}

describe("UCI multi-state territory regression", () => {
  /** @type {Record<string, string | undefined>} */
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    clearTerritoryDatasetCache();
    clearTerritoryStorageRuntimeState();
    process.env.UCI_TERRITORY_STORAGE_ENABLED = "true";
    process.env.UCI_TERRITORY_STORAGE_BUCKET = BUCKET;
    process.env.UCI_TERRITORY_STORAGE_PREFIX = PREFIX;
    process.env.UCI_TERRITORY_DATASET_VERSION = "current";
    process.env.UCI_TERRITORY_ALLOW_LOCAL_FALLBACK = "false";
    process.env.UCI_TERRITORY_DATA_DIR = path.join(__dirname, "..", "data", "territory", "electric");
    process.env.UCI_TERRITORY_LOCAL_CACHE_DIR = path.join(
      __dirname,
      "fixtures",
      "territory-runtime-storage-fallback",
    );
  });

  afterEach(() => {
    clearTerritoryDatasetCache();
    clearTerritoryStorageRuntimeState();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("recognizes all 15 client footprint states in the actual v2 manifest", () => {
    const manifest = normalizeTerritoryManifest(
      JSON.parse(fs.readFileSync(path.join(FULL_DATA_DIR, "manifest.json"), "utf8")),
    );
    assert.ok(manifest);
    for (const state of CLIENT_FOOTPRINT) {
      assert.ok(manifestHasState(manifest, state), `missing ${state}`);
    }
    assert.deepEqual(listManifestStateCodes(manifest).sort(), [...CLIENT_FOOTPRINT].sort());
  });

  it("normalizes Virginia and legacy manifest shapes", () => {
    assert.equal(normalizeUsStateCode("Virginia"), "VA");
    const legacyArrayManifest = normalizeTerritoryManifest({
      schema_version: "d2.2-territory-v1",
      dataset_version: "legacy-array",
      states: ["MD", "VA"],
    });
    assert.ok(manifestHasState(legacyArrayManifest, "VA"));
  });

  it("lazy-fetches territories_VA.geojson for Virginia in storage mode", async () => {
    const cacheDir = path.join(__dirname, "fixtures", "territory-storage-cache", crypto.randomUUID());
    fs.mkdirSync(cacheDir, { recursive: true });
    process.env.UCI_TERRITORY_LOCAL_CACHE_DIR = cacheDir;

    const { objects } = buildV2RemoteFixtures();
    const { supabase, downloads } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const availability = await checkElectricTerritoryAvailability("electric", "Virginia");
    assert.equal(availability.available, true);
    assert.equal(availability.stateCode, "VA");
    assert.equal(availability.artifactFile, "territories_VA.geojson");

    const loaded = await loadStateTerritoryGeoJson("VA", { forceReload: true });
    assert.equal(loaded.ok, true);
    assert.ok(downloads.some((entry) => entry.endsWith("territories_VA.geojson")));

    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it("returns STATE_NOT_IN_MANIFEST for missing states without fetching artifacts", async () => {
    const { objects } = buildV2RemoteFixtures();
    const { supabase, downloads } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const availability = await checkElectricTerritoryAvailability("electric", "CA");
    assert.equal(availability.available, false);
    assert.equal(availability.code, "STATE_NOT_IN_MANIFEST");
    assert.equal(
      downloads.some((entry) => entry.includes("territories_CA.geojson")),
      false,
    );
  });

  it("does not use Maryland-only local files when storage mode is enabled", async () => {
    const { objects } = buildV2RemoteFixtures();
    const { supabase } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const availability = await checkElectricTerritoryAvailability("electric", "VA");
    assert.equal(availability.available, true);
    assert.equal(availability.code, "OK");
  });

  it("deduplicates current.json and manifest downloads within one resolve flow", async () => {
    const cacheDir = path.join(__dirname, "fixtures", "territory-storage-cache", crypto.randomUUID());
    fs.mkdirSync(cacheDir, { recursive: true });
    process.env.UCI_TERRITORY_LOCAL_CACHE_DIR = cacheDir;

    const { objects } = buildV2RemoteFixtures();
    const { supabase, downloads } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const project = {
      address: "5710 Telegraph Rd",
      city: "Alexandria",
      state: "Virginia",
      zip_code: "22303",
      portal_data: {
        _permitpilot: {
          canonical_address: {
            formatted: "5710 TELEGRAPH RD, ALEXANDRIA, VA 22303",
            source: "manual",
            parts: { street: "5710 Telegraph Rd", city: "Alexandria", state: "Virginia", zip: "22303" },
          },
        },
      },
    };

    const result = await resolveElectricTerritory({
      projectId: "project-va-1",
      addressContext: buildProviderSetupAddressContext(project),
      tenantProviders: [{ id: "dominion-id", slug: "dominion", display_name: "Dominion", name: "Dominion" }],
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.address.state_code, "VA");
    const currentDownloads = downloads.filter((entry) => entry.endsWith("current.json"));
    const manifestDownloads = downloads.filter((entry) => entry.endsWith("manifest.json"));
    const vaDownloads = downloads.filter((entry) => entry.endsWith("territories_VA.geojson"));
    assert.equal(currentDownloads.length, 1);
    assert.equal(manifestDownloads.length, 1);
    assert.equal(vaDownloads.length, 1);

    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it("still resolves Maryland PEPCO addresses from the v2 dataset", async () => {
    const { objects } = buildV2RemoteFixtures();
    const { supabase } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const project = {
      address: "100 Main St",
      city: "Bethesda",
      state: "MD",
      zip_code: "20814",
      portal_data: {
        _permitpilot: {
          canonical_address: {
            formatted: "100 Main St, Bethesda, MD 20814",
            source: "manual",
            parts: { street: "100 Main St", city: "Bethesda", state: "MD", zip: "20814" },
          },
        },
      },
    };

    const result = await resolveElectricTerritory({
      projectId: "project-md-1",
      addressContext: buildProviderSetupAddressContext(project),
      tenantProviders: [{ id: "pepco-id", slug: "pepco", display_name: "PEPCO", name: "PEPCO" }],
    });

    assert.notEqual(result.status, "territory_data_unavailable");
  });

  it("invalidates cached manifest when current.json version changes", async () => {
    const { objects } = buildV2RemoteFixtures();
    const { supabase } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const first = await fetchRemoteManifest(supabase);
    assert.equal(first.ok, true);

    const nextVersion = "2026-07-17-client-footprint-v3";
    objects[`${BUCKET}:${buildCurrentJsonPath(PREFIX)}`] = Buffer.from(
      JSON.stringify({ dataset_version: nextVersion }),
    );
    const manifest = JSON.parse(objects[`${BUCKET}:${buildManifestPath(PREFIX, VERSION)}`].toString());
    manifest.dataset_version = nextVersion;
    objects[`${BUCKET}:${buildManifestPath(PREFIX, nextVersion)}`] = Buffer.from(JSON.stringify(manifest));
    objects[`${BUCKET}:${buildStateGeoJsonPath(PREFIX, nextVersion, "VA")}`] =
      objects[`${BUCKET}:${buildStateGeoJsonPath(PREFIX, VERSION, "VA")}`];
    clearTerritoryStorageRuntimeState();

    const second = await fetchRemoteManifest(supabase, { forceReload: true });
    assert.equal(second.ok, true);
    assert.equal(second.datasetVersion, nextVersion);
  });

  it("aligns internal dataset_version mismatch instead of returning MANIFEST_MISSING", async () => {
    const { objects } = buildV2RemoteFixturesWithInternalVersionMismatch();
    const { supabase, downloads } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const loaded = await loadTerritoryManifest();
    assert.equal(loaded.ok, true);
    assert.equal(loaded.code, "LOADED");
    assert.equal(loaded.datasetVersion, VERSION);
    assert.equal(Object.keys(loaded.manifest.states).length, 15);

    const availability = await checkElectricTerritoryAvailability("electric", "VA");
    assert.equal(availability.available, true);
    assert.notEqual(availability.code, "MANIFEST_MISSING");

    const manifestDownloads = downloads.filter((entry) => entry.endsWith("manifest.json"));
    assert.equal(manifestDownloads.length, 1);
  });

  it("returns MANIFEST_PARSE_FAILED for invalid manifest JSON", async () => {
    const { objects } = buildV2RemoteFixtures();
    objects[`${BUCKET}:${buildManifestPath(PREFIX, VERSION)}`] = Buffer.from("{not-json");
    const { supabase } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const loaded = await loadTerritoryManifest();
    assert.equal(loaded.ok, false);
    assert.equal(loaded.code, "MANIFEST_PARSE_FAILED");
    assert.equal(loaded.manifest, null);
  });

  it("returns MANIFEST_INVALID for schema validation failures", async () => {
    const { objects } = buildV2RemoteFixtures();
    objects[`${BUCKET}:${buildManifestPath(PREFIX, VERSION)}`] = Buffer.from(
      JSON.stringify({ schema_version: "wrong", dataset_version: VERSION, states: {} }),
    );
    const { supabase } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const loaded = await loadTerritoryManifest();
    assert.equal(loaded.ok, false);
    assert.equal(loaded.code, "MANIFEST_INVALID");
    assert.equal(loaded.manifest, null);
  });

  it("uses manifest cache on subsequent loadTerritoryManifest calls", async () => {
    const { objects } = buildV2RemoteFixtures();
    const { supabase, downloads } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const first = await loadTerritoryManifest();
    assert.equal(first.ok, true);
    assert.equal(first.code, "LOADED");

    const second = await loadTerritoryManifest();
    assert.equal(second.ok, true);
    assert.equal(second.code, "CACHE_HIT");
    assert.equal(Object.keys(second.manifest.states).length, 15);

    const manifestDownloads = downloads.filter((entry) => entry.endsWith("manifest.json"));
    assert.equal(manifestDownloads.length, 1);
  });

  it("deduplicates parallel manifest fetches via in-flight join", async () => {
    const { objects } = buildV2RemoteFixtures();
    const { supabase, downloads } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    clearTerritoryStorageRuntimeState();
    const [a, b, c] = await Promise.all([
      loadTerritoryManifest(),
      loadTerritoryManifest(),
      loadTerritoryManifest(),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(c.ok, true);
    const manifestDownloads = downloads.filter((entry) => entry.endsWith("manifest.json"));
    assert.equal(manifestDownloads.length, 1);
  });

  it("does not clear manifest cache when configureTerritoryDatasetLoader is called again", async () => {
    const { objects } = buildV2RemoteFixtures();
    const { supabase, downloads } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    await loadTerritoryManifest();
    configureTerritoryDatasetLoader({ supabase });
    const cached = await loadTerritoryManifest();
    assert.equal(cached.code, "CACHE_HIT");

    const manifestDownloads = downloads.filter((entry) => entry.endsWith("manifest.json"));
    assert.equal(manifestDownloads.length, 1);
  });

  it("lazy-fetches territories_DC.geojson and resolves PEPCO for Washington DC", async () => {
    const cacheDir = path.join(__dirname, "fixtures", "territory-storage-cache", crypto.randomUUID());
    fs.mkdirSync(cacheDir, { recursive: true });
    process.env.UCI_TERRITORY_LOCAL_CACHE_DIR = cacheDir;

    const { objects } = buildV2RemoteFixtures();
    const { supabase, downloads } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const availability = await checkElectricTerritoryAvailability("electric", "DC");
    assert.equal(availability.available, true);
    assert.equal(availability.stateCode, "DC");

    const project = {
      address: "301 Sheridan St NW",
      city: "Washington",
      state: "DC",
      zip_code: "20011",
      portal_data: {
        _permitpilot: {
          canonical_address: {
            formatted: "301 SHERIDAN ST NW WASHINGTON, DC 20011",
            source: "manual",
            parts: { street: "301 Sheridan St NW", city: "Washington", state: "DC", zip: "20011" },
          },
        },
      },
    };

    const result = await resolveElectricTerritory({
      projectId: "project-dc-1",
      addressContext: buildProviderSetupAddressContext(project),
      tenantProviders: [{ id: "pepco-id", slug: "pepco", display_name: "PEPCO", name: "PEPCO" }],
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.address.state_code, "DC");
    assert.equal(result.suggested_provider_slug, "pepco");
    assert.ok(downloads.some((entry) => entry.endsWith("territories_DC.geojson")));

    fs.rmSync(cacheDir, { recursive: true, force: true });
  });
});
