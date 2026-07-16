#!/usr/bin/env node
"use strict";

/**
 * Ingest EIA Form 861 Service Territory county mappings for D2.2 Tier 3 fallback.
 *
 * Official source (verified 2026-07-17):
 *   https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip
 *   Spreadsheet: Service_Territory_2024.xlsx (sheet Counties_States)
 *
 * Columns: Data Year, Utility Number, Utility Name, Short Form, State, County
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const { pipeline } = require("node:stream/promises");
const AdmZip = require("adm-zip");
const ExcelJS = require("exceljs");
const { reconcileEiaUtilityName } = require("../app/services/uci/territory/territory-eia-name-resolver.service.js");
const { normalizeCountyLookupName } = require("../app/services/uci/territory/territory-geo.utils.js");

const EIA861_ZIP_URL = "https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip";
const SERVICE_TERRITORY_XLSX = "Service_Territory_2024.xlsx";
const SCHEMA_VERSION = "d2.2-territory-v1";
const SCRIPT_VERSION = "1.0.0";

const DEFAULT_FOOTPRINT = [
  "DC", "MD", "VA", "WV", "DE", "PA", "NJ", "NY", "CT", "RI",
  "MA", "VT", "NH", "ME", "NC", "SC", "GA", "FL", "OH", "AL", "MS",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    state: null,
    states: null,
    all: false,
    outputDir: "scraper-service/data/territory/electric",
    year: 2024,
    dryRun: false,
    zipPath: null,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--state") out.state = String(args[++i] ?? "").toUpperCase();
    else if (arg === "--states") out.states = String(args[++i] ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (arg === "--all") out.all = true;
    else if (arg === "--output-dir") out.outputDir = String(args[++i] ?? out.outputDir);
    else if (arg === "--year") out.year = Number(args[++i]);
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--zip-path") out.zipPath = String(args[++i] ?? "");
    else if (arg === "--help") {
      console.log(`Usage: node ingest-eia861-county.js [--state MD] [--states MD,VA] [--all] [--output-dir DIR] [--zip-path PATH] [--dry-run]`);
      process.exit(0);
    }
  }
  if (!out.all && !out.states && !out.state) {
    console.error("Specify --state, --states, or --all");
    process.exit(2);
  }
  out.targetStates = out.all ? DEFAULT_FOOTPRINT : out.states ?? [out.state];
  return out;
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
          res.resume();
          return;
        }
        pipeline(res, file).then(resolve).catch(reject);
      })
      .on("error", reject);
  });
}

async function loadServiceTerritoryRows(zipPath) {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry(SERVICE_TERRITORY_XLSX);
  if (!entry) {
    throw new Error(`Missing ${SERVICE_TERRITORY_XLSX} in ${zipPath}`);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(entry.getData());
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values.slice(1);
    const [dataYear, utilityNumber, utilityName, shortForm, state, county] = values;
    if (!state || !county || !utilityName) return;
    rows.push({
      data_year: Number(dataYear),
      utility_id_eia: utilityNumber != null ? String(utilityNumber) : null,
      utility_name: String(utilityName).trim(),
      short_form: String(shortForm ?? "").trim(),
      state: String(state).trim().toUpperCase(),
      county: normalizeCountyLookupName(county),
    });
  });
  return rows;
}

function buildCountyMap(rows, targetStates) {
  const stateSet = new Set(targetStates.map((s) => s.toUpperCase()));
  /** @type {Map<string, { state: string, county: string, utilities: Set<string>, utility_ids: Set<string>, source_year: number | null }>} */
  const byKey = new Map();

  for (const row of rows) {
    if (!stateSet.has(row.state)) continue;
    const key = `${row.state}:${row.county}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        state: row.state,
        county: row.county,
        utilities: new Set(),
        utility_ids: new Set(),
        source_year: row.data_year ?? null,
      });
    }
    const entry = byKey.get(key);
    entry.utilities.add(row.utility_name);
    if (row.utility_id_eia) entry.utility_ids.add(row.utility_id_eia);
    if (row.data_year) entry.source_year = row.data_year;
  }

  /** @type {Record<string, Record<string, unknown>>} */
  const store = {};
  const unresolved = [];
  const ambiguous = [];

  for (const [key, entry] of byKey.entries()) {
    const utilities = [...entry.utilities].sort();
    const reconciled = utilities.map((name) => ({
      name,
      result: reconcileEiaUtilityName(name),
    }));
    const canonicalSlugs = new Set(
      reconciled.filter((r) => r.result.status === "resolved" && r.result.provider_slug).map((r) => r.result.provider_slug),
    );
    for (const r of reconciled) {
      if (r.result.status === "unresolved") unresolved.push({ county_key: key, utility_name: r.name, reason: r.result.reason });
      if (r.result.status === "ambiguous") ambiguous.push({ county_key: key, utility_name: r.name, candidates: r.result.candidate_slugs });
    }

    store[key] = {
      state: entry.state,
      county: entry.county,
      utilities,
      utility_ids_eia: [...entry.utility_ids].sort(),
      multi_utility: utilities.length > 1 || canonicalSlugs.size > 1,
      canonical_provider_slugs: [...canonicalSlugs].sort(),
      source_year: entry.source_year,
    };
  }

  return { store, unresolved, ambiguous, county_count: Object.keys(store).length };
}

async function main() {
  const args = parseArgs();
  const outputDir = path.resolve(args.outputDir);
  if (!args.dryRun) fs.mkdirSync(outputDir, { recursive: true });

  const tmpZip = args.zipPath
    ? path.resolve(args.zipPath)
    : path.join(outputDir, `.eia861-${args.year}.zip`);

  if (!args.zipPath && !fs.existsSync(tmpZip)) {
    console.log(`Downloading ${EIA861_ZIP_URL} ...`);
    await downloadFile(EIA861_ZIP_URL, tmpZip);
  }

  const rows = await loadServiceTerritoryRows(tmpZip);
  const { store, unresolved, ambiguous, county_count } = buildCountyMap(rows, args.targetStates);

  const payload = JSON.stringify(store, null, 2);
  const checksum = sha256Buffer(Buffer.from(payload));

  const report = {
    schema_version: SCHEMA_VERSION,
    ingestion_script_version: SCRIPT_VERSION,
    source_name: "EIA Form 861 Service Territory",
    source_url: EIA861_ZIP_URL,
    source_file: SERVICE_TERRITORY_XLSX,
    source_year: args.year,
    generated_at: new Date().toISOString(),
    states: args.targetStates,
    county_count,
    checksum_sha256: checksum,
    unresolved,
    ambiguous,
    totals: {
      unresolved: unresolved.length,
      ambiguous: ambiguous.length,
    },
  };

  if (args.dryRun) {
    console.log(JSON.stringify({ dry_run: true, county_count, states: args.targetStates, totals: report.totals }, null, 2));
    return;
  }

  fs.writeFileSync(path.join(outputDir, "county_utility.json"), payload);
  fs.writeFileSync(path.join(outputDir, "county_utility_report.json"), JSON.stringify(report, null, 2));

  const manifestPath = path.join(outputDir, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.county_fallback = {
      source_name: report.source_name,
      source_url: report.source_url,
      source_year: report.source_year,
      checksum_sha256: checksum,
      county_count,
      generated_at: report.generated_at,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  console.log(`Wrote county_utility.json (${county_count} counties) to ${outputDir}`);
  console.log(`Unresolved utility names: ${unresolved.length}, ambiguous: ${ambiguous.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
