#!/usr/bin/env node
"use strict";

/**
 * Upload immutable UCI electric territory dataset versions to Supabase Storage.
 *
 * Layout:
 *   <prefix>/electric/versions/<version>/...
 *   <prefix>/electric/current.json
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const {
  uploadBufferToSupabaseStorage,
  downloadFromSupabaseStorage,
  ensureStorageBucketExists,
} = require("../shared/supabase-storage-upload.js");
const {
  buildCurrentJsonPath,
  buildManifestPath,
  buildVersionArtifactPath,
  buildVersionRootPath,
  validateDatasetVersion,
} = require("../app/services/uci/territory/territory-storage-paths.service.js");
const { validateManifestSchema } = require("../app/services/uci/territory/territory-storage-client.service.js");

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseArgs(argv) {
  const args = {
    inputDir: "scraper-service/data/territory/electric",
    bucket: process.env.UCI_TERRITORY_STORAGE_BUCKET || "",
    prefix: process.env.UCI_TERRITORY_STORAGE_PREFIX || "uci-territory",
    version: null,
    dryRun: false,
    activate: false,
    activateExisting: false,
    activatedBy: process.env.USER || "upload-territory-dataset",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input-dir") args.inputDir = String(argv[++i] ?? args.inputDir);
    else if (arg === "--bucket") args.bucket = String(argv[++i] ?? "");
    else if (arg === "--prefix") args.prefix = String(argv[++i] ?? args.prefix);
    else if (arg === "--version") args.version = String(argv[++i] ?? "");
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--activate") args.activate = true;
    else if (arg === "--activate-existing") args.activateExisting = true;
    else if (arg === "--activated-by") args.activatedBy = String(argv[++i] ?? args.activatedBy);
    else if (arg === "--help") {
      console.log(`Usage: node upload-territory-dataset.js \\
  --input-dir <dir> --bucket <bucket> --prefix <prefix> --version <version> \\
  [--dry-run] [--activate] [--activate-existing] [--activated-by <name>]`);
      process.exit(0);
    }
  }

  if (!args.version) {
    console.error("--version is required");
    process.exit(2);
  }
  if (!args.bucket) {
    console.error("--bucket is required (or set UCI_TERRITORY_STORAGE_BUCKET)");
    process.exit(2);
  }
  if (args.activate && args.activateExisting) {
    console.error("Use either --activate or --activate-existing, not both");
    process.exit(2);
  }

  args.version = validateDatasetVersion(args.version);
  return args;
}

function listLocalArtifacts(inputDir, manifest) {
  const files = ["manifest.json"];
  if (fs.existsSync(path.join(inputDir, "utilities_by_state.json"))) {
    files.push("utilities_by_state.json");
  }
  if (fs.existsSync(path.join(inputDir, "county_utility.json"))) {
    files.push("county_utility.json");
  }

  const states = manifest.states && typeof manifest.states === "object" ? manifest.states : {};
  for (const entry of Object.values(states)) {
    if (entry && typeof entry === "object" && entry.file) {
      files.push(String(entry.file));
    }
  }

  return [...new Set(files)];
}

async function readRemoteBytes(supabase, bucket, storagePath) {
  const result = await downloadFromSupabaseStorage({ supabase, bucket, storagePath });
  if (!result.ok || !result.data) {
    throw new Error(`Failed to read remote object ${storagePath}: ${result.errorMessage || "unknown"}`);
  }
  return Buffer.from(await result.data.arrayBuffer());
}

async function verifyRemoteVersion(supabase, bucket, prefix, version) {
  const manifestPath = buildManifestPath(prefix, version);
  const manifestBytes = await readRemoteBytes(supabase, bucket, manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const schema = validateManifestSchema(manifest);
  if (!schema.ok) {
    throw new Error(`Remote manifest invalid: ${schema.reason}`);
  }

  const artifacts = listLocalArtifacts(".", manifest);
  const verified = [];
  for (const fileName of artifacts) {
    const storagePath = buildVersionArtifactPath(prefix, version, fileName);
    const bytes = await readRemoteBytes(supabase, bucket, storagePath);
    const checksum = sha256Buffer(bytes);
    verified.push({ fileName, storagePath, size: bytes.length, checksum_sha256: checksum });
  }

  return { manifest, verified };
}

async function main() {
  const args = parseArgs(process.argv);
  const inputDir = path.resolve(args.inputDir);

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(2);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const bucketReady = await ensureStorageBucketExists(supabase, args.bucket);
  if (!bucketReady) {
    console.error(`Bucket unavailable: ${args.bucket}`);
    process.exit(1);
  }

  let manifest;
  let artifacts;

  if (args.activateExisting) {
    const remote = await verifyRemoteVersion(supabase, args.bucket, args.prefix, args.version);
    manifest = remote.manifest;
    artifacts = remote.verified;
    console.log(
      JSON.stringify(
        {
          mode: "activate_existing",
          bucket: args.bucket,
          prefix: args.prefix,
          version: args.version,
          artifacts,
          activate: args.activateExisting,
        },
        null,
        2,
      ),
    );
    if (args.dryRun) return;
    if (!args.activateExisting) return;
  } else {
    const manifestPath = path.join(inputDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      console.error(`Missing manifest at ${manifestPath}`);
      process.exit(1);
    }

    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const schema = validateManifestSchema(manifest);
    if (!schema.ok) {
      console.error(`Local manifest invalid: ${schema.reason}`);
      process.exit(1);
    }

    const fileNames = listLocalArtifacts(inputDir, manifest);
    artifacts = [];
    for (const fileName of fileNames) {
      const localPath = path.join(inputDir, fileName);
      if (!fs.existsSync(localPath)) {
        console.error(`Missing artifact: ${localPath}`);
        process.exit(1);
      }
      const bytes = fs.readFileSync(localPath);
      const checksum = sha256Buffer(bytes);
      artifacts.push({
        fileName,
        localPath,
        bytes,
        size: bytes.length,
        checksum_sha256: checksum,
        storagePath: buildVersionArtifactPath(args.prefix, args.version, fileName),
      });
    }

    for (const artifact of artifacts) {
      if (artifact.fileName === "manifest.json") continue;
      const manifestEntry = findManifestChecksumTarget(manifest, artifact.fileName);
      if (manifestEntry?.expected && manifestEntry.expected !== artifact.checksum_sha256) {
        console.error(
          `Checksum mismatch for ${artifact.fileName}: manifest=${manifestEntry.expected} actual=${artifact.checksum_sha256}`,
        );
        process.exit(1);
      }
    }

    const plan = {
      mode: "upload",
      dry_run: args.dryRun,
      bucket: args.bucket,
      prefix: args.prefix,
      version: args.version,
      version_root: buildVersionRootPath(args.prefix, args.version),
      activate: args.activate,
      artifacts: artifacts.map((a) => ({
        file: a.fileName,
        size: a.size,
        checksum_sha256: a.checksum_sha256,
        destination: a.storagePath,
      })),
    };
    console.log(JSON.stringify(plan, null, 2));

    if (args.dryRun) return;

    for (const artifact of artifacts) {
      try {
        const existing = await readRemoteBytes(supabase, args.bucket, artifact.storagePath);
        const existingChecksum = sha256Buffer(existing);
        if (existingChecksum === artifact.checksum_sha256) {
          console.log(`Skipping identical artifact ${artifact.fileName}`);
          continue;
        }
        console.error(
          `Refusing overwrite for ${artifact.fileName}: existing checksum ${existingChecksum} differs`,
        );
        process.exit(1);
      } catch {
        // object missing — safe to upload
      }

      const upload = await uploadBufferToSupabaseStorage({
        supabase,
        bucket: args.bucket,
        storagePath: artifact.storagePath,
        body: artifact.bytes,
        contentType: artifact.fileName.endsWith(".geojson") ? "application/geo+json" : "application/json",
        upsert: false,
        cacheControl: "31536000",
      });
      if (!upload.ok) {
        console.error(`Upload failed for ${artifact.fileName}: ${upload.errorMessage}`);
        process.exit(1);
      }

      const verifyBytes = await readRemoteBytes(supabase, args.bucket, artifact.storagePath);
      const verifyChecksum = sha256Buffer(verifyBytes);
      if (verifyChecksum !== artifact.checksum_sha256) {
        console.error(`Remote verification failed for ${artifact.fileName}`);
        process.exit(1);
      }
    }
  }

  if (!args.activate && !args.activateExisting) {
    console.log("Upload complete. Activation skipped (pass --activate to publish current.json).");
    return;
  }

  const remote = await verifyRemoteVersion(supabase, args.bucket, args.prefix, args.version);
  if (!remote.verified.length) {
    console.error("Activation refused: no verified artifacts");
    process.exit(1);
  }

  const current = {
    dataset_version: args.version,
    manifest_path: buildManifestPath(args.prefix, args.version),
    activated_at: new Date().toISOString(),
    activated_by: args.activatedBy,
    source_vintage: remote.manifest.source_vintage ?? null,
  };

  const currentPath = buildCurrentJsonPath(args.prefix);
  const currentBytes = Buffer.from(JSON.stringify(current, null, 2));
  const uploadCurrent = await uploadBufferToSupabaseStorage({
    supabase,
    bucket: args.bucket,
    storagePath: currentPath,
    body: currentBytes,
    contentType: "application/json",
    upsert: true,
    cacheControl: "60",
  });
  if (!uploadCurrent.ok) {
    console.error(`Failed to activate current.json: ${uploadCurrent.errorMessage}`);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        activated: true,
        bucket: args.bucket,
        current_path: currentPath,
        current,
      },
      null,
      2,
    ),
  );
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string} fileName
 */
function findManifestChecksumTarget(manifest, fileName) {
  if (fileName === "manifest.json") return null;
  if (fileName === "county_utility.json") {
    const county = manifest.county_fallback;
    if (county && typeof county === "object" && !Array.isArray(county)) {
      return { expected: /** @type {{ checksum_sha256?: string }} */ (county).checksum_sha256 ?? null };
    }
    return null;
  }

  const states = manifest.states;
  if (!states || typeof states !== "object" || Array.isArray(states)) return null;
  for (const entry of Object.values(states)) {
    if (entry && typeof entry === "object" && entry.file === fileName) {
      return { expected: entry.checksum_sha256 ?? null };
    }
  }
  return null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
