#!/usr/bin/env node
"use strict";

/**
 * Reconcile EIA legal names against Row 3 canonical alias resolver (catalog-only).
 *
 * Modes:
 *   --input-dir <dir>   Read local territory artifacts; write reports; log progress.
 *   stdin JSON array    Pipe names on stdin; write reconcile report JSON to stdout (ingestion subprocess).
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  reconcileTerritoryProviderNames,
} = require("../app/services/uci/territory/territory-provider-reconciliation.service.js");
const { reconcileEiaUtilityName } = require("../app/services/uci/territory/territory-eia-name-resolver.service.js");
const { UTILITY_PROVIDER_DIRECTORY } = require("../app/data/utility-provider-directory.catalog.js");

const STDIN_READ_TIMEOUT_MS = 5000;

/**
 * @param {string} message
 */
function logProgress(message) {
  process.stderr.write(`[reconcile-territory] ${message}\n`);
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const args = {
    inputDir: null,
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input-dir") {
      args.inputDir = String(argv[++i] ?? "").trim();
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

/**
 * @param {number} [timeoutMs]
 */
function readStdinText(timeoutMs = STDIN_READ_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }

    /** @type {Buffer[]} */
    const chunks = [];
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.destroy();
      finish(new Error(`stdin_read_timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => finish(null, Buffer.concat(chunks).toString("utf8").trim()));
    process.stdin.on("error", (err) => finish(err));
    process.stdin.resume();
  });
}

/**
 * @param {string} inputDir
 */
function loadPolygonUtilityNames(inputDir) {
  const utilitiesPath = path.join(inputDir, "utilities_by_state.json");
  if (fs.existsSync(utilitiesPath)) {
    const payload = JSON.parse(fs.readFileSync(utilitiesPath, "utf8"));
    const names = new Set();
    const states = payload.states;
    if (states && typeof states === "object" && !Array.isArray(states)) {
      for (const stateRows of Object.values(states)) {
        if (!Array.isArray(stateRows)) continue;
        for (const row of stateRows) {
          if (row && typeof row === "object" && row.name) {
            names.add(String(row.name).trim());
          }
        }
      }
    }
    return [...names].sort();
  }

  const names = new Set();
  for (const fileName of fs.readdirSync(inputDir)) {
    if (!/^territories_[A-Z]{2}\.geojson$/i.test(fileName)) continue;
    const geojson = JSON.parse(fs.readFileSync(path.join(inputDir, fileName), "utf8"));
    for (const feature of geojson.features ?? []) {
      const props = feature?.properties ?? {};
      const legalName = props.eia_legal_name ?? props.NAME ?? props.name;
      if (legalName) names.add(String(legalName).trim());
    }
  }
  return [...names].sort();
}

/**
 * @param {string} inputDir
 */
function loadCountyUtilityStore(inputDir) {
  const countyPath = path.join(inputDir, "county_utility.json");
  if (!fs.existsSync(countyPath)) return null;
  return JSON.parse(fs.readFileSync(countyPath, "utf8"));
}

/**
 * @param {Record<string, { utilities?: string[] }>} countyStore
 */
function buildCountyReconcileReport(countyStore) {
  /** @type {Array<{ county_key: string, utility_name: string, reason: string | null | undefined }>} */
  const unresolved = [];
  /** @type {Array<{ county_key: string, utility_name: string, candidates: string[] }>} */
  const ambiguous = [];
  const uniqueNames = new Set();

  for (const [countyKey, entry] of Object.entries(countyStore)) {
    const utilities = Array.isArray(entry?.utilities) ? entry.utilities : [];
    for (const utilityName of utilities) {
      const name = String(utilityName ?? "").trim();
      if (!name) continue;
      uniqueNames.add(name);
      const result = reconcileEiaUtilityName(name);
      if (result.status === "unresolved") {
        unresolved.push({
          county_key: countyKey,
          utility_name: name,
          reason: result.reason ?? "no_matching_alias",
        });
      } else if (result.status === "ambiguous") {
        ambiguous.push({
          county_key: countyKey,
          utility_name: name,
          candidates: result.candidate_slugs ?? [],
        });
      }
    }
  }

  const unique_utilities = reconcileTerritoryProviderNames([...uniqueNames].sort());

  return {
    unique_utilities,
    unresolved,
    ambiguous,
    totals: {
      unique_utility_names: uniqueNames.size,
      unresolved: unresolved.length,
      ambiguous: ambiguous.length,
      resolved: unique_utilities.totals.resolved,
    },
  };
}

/**
 * @param {string} inputDir
 */
function runInputDirMode(inputDir) {
  const resolvedDir = path.resolve(inputDir);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Input directory not found: ${resolvedDir}`);
  }

  logProgress(`reading input files from ${resolvedDir}`);
  const polygonNames = loadPolygonUtilityNames(resolvedDir);
  logProgress(`loaded ${polygonNames.length} polygon utility name(s)`);

  logProgress("loading provider catalog (in-memory Row 3 directory)");
  const catalogCount = UTILITY_PROVIDER_DIRECTORY.length;
  logProgress(`catalog loaded: ${catalogCount} canonical provider(s), no remote requests`);

  logProgress("reconciling polygon utility names");
  const polygonReport = reconcileTerritoryProviderNames(polygonNames);

  let countyReport = null;
  const countyStore = loadCountyUtilityStore(resolvedDir);
  if (countyStore) {
    logProgress("reconciling county utility names");
    countyReport = buildCountyReconcileReport(countyStore);
    logProgress(
      `county utilities: ${countyReport.totals.unique_utility_names} unique, ${countyReport.totals.unresolved} unresolved`,
    );
  } else {
    logProgress("county_utility.json not found — skipping county reconciliation");
  }

  const combined = {
    generated_at: new Date().toISOString(),
    input_dir: resolvedDir,
    polygon: polygonReport,
    county: countyReport,
    totals: {
      polygon: polygonReport.totals,
      county: countyReport
        ? {
            unique_utility_names: countyReport.totals.unique_utility_names,
            unresolved: countyReport.totals.unresolved,
            ambiguous: countyReport.totals.ambiguous,
            resolved: countyReport.totals.resolved,
          }
        : null,
    },
  };

  logProgress("writing report");
  const polygonReportPath = path.join(resolvedDir, "unresolved_providers.json");
  fs.writeFileSync(polygonReportPath, `${JSON.stringify(polygonReport, null, 2)}\n`);
  logProgress(`wrote polygon report: ${polygonReportPath}`);

  if (countyReport) {
    const countyReportPath = path.join(resolvedDir, "county_provider_reconcile_report.json");
    fs.writeFileSync(countyReportPath, `${JSON.stringify(countyReport, null, 2)}\n`);
    logProgress(`wrote county report: ${countyReportPath}`);
  }

  process.stdout.write(`${JSON.stringify(combined, null, 2)}\n`);
  logProgress(
    `complete: polygon ${polygonReport.totals.resolved} resolved / ${polygonReport.totals.unresolved} unresolved` +
      (countyReport
        ? `; county ${countyReport.totals.unresolved} unresolved`
        : ""),
  );
}

/**
 * @param {string} raw
 */
function runStdinMode(raw) {
  const names = raw ? JSON.parse(raw) : [];
  const report = reconcileTerritoryProviderNames(names);
  process.stdout.write(JSON.stringify(report, null, 2));
}

function printUsage() {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/reconcile-territory-provider-names.js --input-dir <dir>",
      "  echo '[\"BGE\"]' | node scripts/reconcile-territory-provider-names.js",
      "",
    ].join("\n"),
  );
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printUsage();
    return;
  }

  if (args.inputDir) {
    runInputDirMode(args.inputDir);
    return;
  }

  if (process.stdin.isTTY) {
    printUsage();
    throw new Error("No --input-dir provided and stdin is interactive (nothing to reconcile)");
  }

  logProgress("reading names from stdin");
  const raw = await readStdinText();
  logProgress(`reconciling ${raw ? "piped" : "empty"} stdin payload`);
  runStdinMode(raw);
  logProgress("complete");
}

if (require.main === module) {
  main()
    .then(() => {
      // Allow stderr/stdout flush before natural exit.
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logProgress(`error: ${message}`);
      console.error(err);
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs,
  readStdinText,
  loadPolygonUtilityNames,
  loadCountyUtilityStore,
  buildCountyReconcileReport,
  runInputDirMode,
  runStdinMode,
  STDIN_READ_TIMEOUT_MS,
};
