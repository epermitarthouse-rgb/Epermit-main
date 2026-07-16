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
  buildCountyUtilityPath,
  validateDatasetVersion,
} = require("../app/services/uci/territory/territory-storage-paths.service.js");
const {
  configureTerritoryStorageClient,
  fetchRemoteManifest,
  fetchRemoteStateGeoJson,
  fetchRemoteCountyUtilityStore,
  probeTerritoryStorageHealth,
  clearTerritoryStorageRuntimeState,
  sha256Buffer,
} = require("../app/services/uci/territory/territory-storage-client.service.js");
const {
  configureTerritoryDatasetLoader,
  clearTerritoryDatasetCache,
  loadStateTerritoryGeoJson,
  loadCountyUtilityEntry,
  validateTerritoryDatasetHealth,
  isElectricTerritoryDataAvailable,
} = require("../app/services/uci/territory/territory-dataset-loader.service.js");

const FIXTURE_DIR = path.join(__dirname, "fixtures", "territory");
const BUCKET = "project-documents";
const PREFIX = "uci-territory";
const VERSION = "2026-07-17-md-v1";

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * @param {Record<string, Buffer>} objects
 */
function makeTerritoryStorageSupabase(objects) {
  const downloads = [];
  const uploads = [];
  const supabase = {
    storage: {
      listBuckets: async () => ({ data: [{ id: BUCKET }], error: null }),
      from(bucket) {
        return {
          download: async (storagePath) => {
            downloads.push({ bucket, storagePath });
            const key = `${bucket}:${storagePath}`;
            const bytes = objects[key];
            if (!bytes) {
              return { data: null, error: { message: "not_found" } };
            }
            return { data: new Blob([bytes]), error: null };
          },
          upload: async (storagePath, body) => {
            uploads.push({ bucket, storagePath, body: Buffer.from(body) });
            objects[`${bucket}:${storagePath}`] = Buffer.from(body);
            return { data: { path: storagePath }, error: null };
          },
        };
      },
    },
  };
  return { supabase, downloads, uploads, objects };
}

function buildRemoteFixtures() {
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "manifest.fixture.json"), "utf8"));
  manifest.dataset_version = VERSION;
  manifest.source_vintage = "2025-08-21";
  const county = Buffer.from(
    JSON.stringify({
      "MD:Montgomery": {
        state: "MD",
        county: "Montgomery",
        utilities: ["POTOMAC ELECTRIC POWER CO"],
        multi_utility: false,
        source_year: 2024,
      },
    }),
  );
  const countyChecksum = sha256Buffer(county);
  manifest.county_fallback = {
    checksum_sha256: countyChecksum,
    county_count: 1,
  };

  const geojson = fs.readFileSync(path.join(FIXTURE_DIR, "territories_MD.fixture.geojson"));
  const geoChecksum = sha256Buffer(geojson);
  manifest.states.MD.checksum_sha256 = geoChecksum;

  const objects = {};
  const current = {
    dataset_version: VERSION,
    manifest_path: buildManifestPath(PREFIX, VERSION),
    activated_at: "2026-07-17T00:00:00.000Z",
    activated_by: "test",
    source_vintage: "2025-08-21",
  };
  objects[`${BUCKET}:${buildCurrentJsonPath(PREFIX)}`] = Buffer.from(JSON.stringify(current));
  objects[`${BUCKET}:${buildManifestPath(PREFIX, VERSION)}`] = Buffer.from(JSON.stringify(manifest));
  objects[`${BUCKET}:${buildStateGeoJsonPath(PREFIX, VERSION, "MD")}`] = geojson;
  objects[`${BUCKET}:${buildCountyUtilityPath(PREFIX, VERSION)}`] = county;

  return { manifest, objects, geoChecksum, countyChecksum };
}

describe("territory storage paths", () => {
  it("rejects path traversal in dataset versions", () => {
    assert.throws(() => validateDatasetVersion("../evil"), /Invalid dataset_version/);
  });

  it("builds versioned storage paths", () => {
    assert.equal(
      buildManifestPath("uci-territory", "2026-07-17-md-v1"),
      "uci-territory/electric/versions/2026-07-17-md-v1/manifest.json",
    );
  });
});

describe("territory storage remote loader", () => {
  const originalEnv = { ...process.env };
  /** @type {string[]} */
  let cacheDirsToCleanup = [];

  beforeEach(() => {
    clearTerritoryDatasetCache();
    clearTerritoryStorageRuntimeState();
    cacheDirsToCleanup = [];
    process.env.UCI_TERRITORY_STORAGE_ENABLED = "true";
    process.env.UCI_TERRITORY_STORAGE_BUCKET = BUCKET;
    process.env.UCI_TERRITORY_STORAGE_PREFIX = PREFIX;
    process.env.UCI_TERRITORY_DATASET_VERSION = "current";
    process.env.UCI_TERRITORY_ALLOW_LOCAL_FALLBACK = "false";
    const cacheDir = path.join(
      __dirname,
      "fixtures",
      "territory-storage-cache",
      crypto.randomUUID(),
    );
    cacheDirsToCleanup.push(cacheDir);
    process.env.UCI_TERRITORY_LOCAL_CACHE_DIR = cacheDir;
  });

  afterEach(() => {
    clearTerritoryDatasetCache();
    clearTerritoryStorageRuntimeState();
    for (const cacheDir of cacheDirsToCleanup) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("reads current.json and loads remote manifest", async () => {
    const { objects } = buildRemoteFixtures();
    const { supabase } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });

    const result = await fetchRemoteManifest(supabase);
    assert.equal(result.ok, true);
    assert.equal(result.datasetVersion, VERSION);
    assert.equal(result.manifest.schema_version, "d2.2-territory-v1");
  });

  it("supports explicit version pinning over current.json", async () => {
    const { objects } = buildRemoteFixtures();
    const { supabase } = makeTerritoryStorageSupabase(objects);
    process.env.UCI_TERRITORY_DATASET_VERSION = VERSION;
    configureTerritoryStorageClient({ supabase });

    const result = await fetchRemoteManifest(supabase);
    assert.equal(result.ok, true);
    assert.equal(result.datasetVersion, VERSION);
  });

  it("lazy-loads state geojson with checksum validation", async () => {
    const { objects } = buildRemoteFixtures();
    const { supabase } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });

    const loaded = await fetchRemoteStateGeoJson(supabase, "MD");
    assert.equal(loaded.ok, true);
    assert.ok(Array.isArray(loaded.geojson.features));
    assert.equal(loaded.code, "LOADED");
  });

  it("rejects checksum mismatches", async () => {
    const { objects, geoChecksum } = buildRemoteFixtures();
    const manifest = JSON.parse(objects[`${BUCKET}:${buildManifestPath(PREFIX, VERSION)}`].toString());
    manifest.states.MD.checksum_sha256 = "deadbeef";
    objects[`${BUCKET}:${buildManifestPath(PREFIX, VERSION)}`] = Buffer.from(JSON.stringify(manifest));
    const { supabase } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });

    const loaded = await fetchRemoteStateGeoJson(supabase, "MD");
    assert.equal(loaded.ok, false);
    assert.equal(loaded.code, "CHECKSUM_MISMATCH");
    assert.notEqual(loaded.actualChecksum, "deadbeef");
    assert.equal(loaded.actualChecksum, geoChecksum);
  });

  it("lazy-loads county mapping only when requested", async () => {
    const { objects } = buildRemoteFixtures();
    const { supabase } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });

    const county = await fetchRemoteCountyUtilityStore(supabase);
    assert.equal(county.ok, true);
    assert.ok(county.store["MD:Montgomery"]);
  });

  it("deduplicates concurrent manifest fetches", async () => {
    const { objects } = buildRemoteFixtures();
    const { supabase, downloads } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });

    const [a, b] = await Promise.all([
      fetchRemoteManifest(supabase),
      fetchRemoteManifest(supabase),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    const manifestDownloads = downloads.filter((d) => d.storagePath.endsWith("manifest.json"));
    assert.equal(manifestDownloads.length, 1);
  });

  it("reports unhealthy when remote artifact is missing", async () => {
    const { objects } = buildRemoteFixtures();
    delete objects[`${BUCKET}:${buildStateGeoJsonPath(PREFIX, VERSION, "MD")}`];
    const { supabase } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const loaded = await loadStateTerritoryGeoJson("MD");
    assert.equal(loaded.ok, false);
    assert.notEqual(loaded.code, "LOADED");
  });

  it("uses parsed cache after first remote load", async () => {
    const { objects } = buildRemoteFixtures();
    const { supabase, downloads } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const first = await loadStateTerritoryGeoJson("MD");
    const second = await loadStateTerritoryGeoJson("MD");
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.code, "CACHE_HIT");
    const mdDownloads = downloads.filter((d) => d.storagePath.includes("territories_MD.geojson"));
    assert.equal(mdDownloads.length, 1);
  });

  it("invalidates cache when dataset version changes", async () => {
    const { objects } = buildRemoteFixtures();
    const { supabase } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });
    configureTerritoryDatasetLoader({ supabase });

    const first = await loadStateTerritoryGeoJson("MD");
    const current = JSON.parse(objects[`${BUCKET}:${buildCurrentJsonPath(PREFIX)}`].toString());
    current.dataset_version = "2026-07-17-md-v2";
    objects[`${BUCKET}:${buildCurrentJsonPath(PREFIX)}`] = Buffer.from(JSON.stringify(current));
    clearTerritoryStorageRuntimeState();

    const manifest = JSON.parse(objects[`${BUCKET}:${buildManifestPath(PREFIX, VERSION)}`].toString());
    manifest.dataset_version = "2026-07-17-md-v2";
    objects[`${BUCKET}:${buildManifestPath(PREFIX, "2026-07-17-md-v2")}`] = Buffer.from(
      JSON.stringify(manifest),
    );
    objects[`${BUCKET}:${buildStateGeoJsonPath(PREFIX, "2026-07-17-md-v2", "MD")}`] =
      objects[`${BUCKET}:${buildStateGeoJsonPath(PREFIX, VERSION, "MD")}`];

    const second = await loadStateTerritoryGeoJson("MD", { forceReload: true });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.notEqual(second.code, "CACHE_HIT");
  });

  it("returns unavailable in production mode without local fallback", async () => {
    const { supabase } = makeTerritoryStorageSupabase({});
    configureTerritoryDatasetLoader({ supabase });
    process.env.UCI_TERRITORY_ALLOW_LOCAL_FALLBACK = "false";

    assert.equal(await isElectricTerritoryDataAvailable("electric", "MD"), false);
    const loaded = await loadStateTerritoryGeoJson("MD");
    assert.equal(loaded.ok, false);
    const county = await loadCountyUtilityEntry("MD", "Montgomery");
    assert.equal(county, null);
  });

  it("falls back to local development files when allowed", async () => {
    const tempDir = path.join(__dirname, "fixtures", "territory-runtime-storage-fallback");
    fs.mkdirSync(tempDir, { recursive: true });
    fs.copyFileSync(path.join(FIXTURE_DIR, "manifest.fixture.json"), path.join(tempDir, "manifest.json"));
    fs.copyFileSync(
      path.join(FIXTURE_DIR, "territories_MD.fixture.geojson"),
      path.join(tempDir, "territories_MD.geojson"),
    );
    process.env.UCI_TERRITORY_DATA_DIR = tempDir;
    process.env.UCI_TERRITORY_ALLOW_LOCAL_FALLBACK = "true";

    const { supabase } = makeTerritoryStorageSupabase({});
    configureTerritoryDatasetLoader({ supabase });

    const loaded = await loadStateTerritoryGeoJson("MD");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.source, "local");
  });

  it("reports storage health without exposing signed URLs", async () => {
    const { objects } = buildRemoteFixtures();
    const { supabase } = makeTerritoryStorageSupabase(objects);
    configureTerritoryStorageClient({ supabase });

    const health = await probeTerritoryStorageHealth(supabase);
    assert.equal(health.healthy, true);
    assert.equal(health.bucket, BUCKET);
    assert.equal(health.active_dataset_version, VERSION);
    assert.ok(Array.isArray(health.states));
    assert.equal(health.county_fallback_available, true);
    assert.ok(!JSON.stringify(health).includes("http"));
  });

  it("validateTerritoryDatasetHealth uses storage probe when enabled", async () => {
    const { objects } = buildRemoteFixtures();
    const { supabase } = makeTerritoryStorageSupabase(objects);
    configureTerritoryDatasetLoader({ supabase });

    const health = await validateTerritoryDatasetHealth();
    assert.equal(health.source, "storage");
    assert.equal(health.healthy, true);
  });
});

describe("upload-territory-dataset dry-run plan", () => {
  it("lists files, checksums, and destinations from local manifest", () => {
    const inputDir = FIXTURE_DIR;
    const manifest = JSON.parse(fs.readFileSync(path.join(inputDir, "manifest.fixture.json"), "utf8"));
    const artifacts = [
      { local: "manifest.fixture.json", remote: "manifest.json" },
      { local: "territories_MD.fixture.geojson", remote: "territories_MD.geojson" },
    ];
    const plan = artifacts.map(({ local, remote }) => {
      const bytes = fs.readFileSync(path.join(inputDir, local));
      return {
        file: remote,
        size: bytes.length,
        checksum_sha256: sha256Buffer(bytes),
        destination: `${PREFIX}/electric/versions/${VERSION}/${remote}`,
      };
    });
    assert.equal(plan.length, 2);
    assert.ok(plan.every((entry) => entry.checksum_sha256));
    assert.ok(manifest.schema_version);
  });
});
