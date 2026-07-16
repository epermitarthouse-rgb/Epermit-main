#!/usr/bin/env node
"use strict";

/**
 * Classify unresolved EIA/HIFLD utility names from a territory dataset directory.
 *
 * Usage:
 *   node scripts/classify-territory-unresolved-names.js --input-dir data/territory/electric-full-v2
 */

const fs = require("node:fs");
const path = require("node:path");
const { classifyTerritoryUtilityName } = require("../app/services/uci/territory/territory-unresolved-classifier.service.js");
const { reconcileEiaUtilityName } = require("../app/services/uci/territory/territory-eia-name-resolver.service.js");

function parseArgs() {
  const args = { inputDir: "data/territory/electric-full-v2", output: null };
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === "--input-dir") args.inputDir = String(process.argv[++i] ?? args.inputDir);
    else if (process.argv[i] === "--output") args.output = String(process.argv[++i] ?? "");
  }
  return args;
}

function loadNameMetadata(inputDir) {
  const ubs = JSON.parse(fs.readFileSync(path.join(inputDir, "utilities_by_state.json"), "utf8"));
  /** @type {Map<string, { states: Set<string>, feature_count: number, customers: number }>} */
  const meta = new Map();

  for (const [state, utilities] of Object.entries(ubs.states ?? {})) {
    for (const row of utilities ?? []) {
      const name = String(row.name ?? "").trim();
      if (!name) continue;
      if (!meta.has(name)) meta.set(name, { states: new Set(), feature_count: 0, customers: 0 });
      const entry = meta.get(name);
      entry.states.add(state);
      entry.feature_count += 1;
      entry.customers = Math.max(entry.customers, Number(row.customers) || 0);
    }
  }

  const countyStore = JSON.parse(fs.readFileSync(path.join(inputDir, "county_utility.json"), "utf8"));
  /** @type {Map<string, { county_count: number, utility_ids: Set<string> }>} */
  const countyMeta = new Map();
  for (const entry of Object.values(countyStore)) {
    for (const utilityName of entry.utilities ?? []) {
      const name = String(utilityName).trim();
      if (!meta.has(name)) meta.set(name, { states: new Set(), feature_count: 0, customers: 0 });
      meta.get(name).states.add(entry.state);
      if (!countyMeta.has(name)) countyMeta.set(name, { county_count: 0, utility_ids: new Set() });
      const cm = countyMeta.get(name);
      cm.county_count += 1;
      for (const id of entry.utility_ids_eia ?? []) cm.utility_ids.add(String(id));
    }
  }

  return { meta, countyMeta };
}

function main() {
  const args = parseArgs();
  const inputDir = path.resolve(args.inputDir);
  const unresolvedPath = path.join(inputDir, "unresolved_providers.json");
  if (!fs.existsSync(unresolvedPath)) {
    console.error(`Missing ${unresolvedPath}`);
    process.exit(1);
  }

  const reconcile = JSON.parse(fs.readFileSync(unresolvedPath, "utf8"));
  const polygonNames = new Set([
    ...(reconcile.resolved ?? []).map((r) => r.eia_legal_name),
    ...(reconcile.unresolved ?? []).map((r) => r.eia_legal_name),
    ...(reconcile.ambiguous ?? []).map((r) => r.eia_legal_name),
    ...(reconcile.unsupported_manual ?? []).map((r) => r.eia_legal_name),
  ]);

  const { meta, countyMeta } = loadNameMetadata(inputDir);
  const records = [];
  const totals = {
    existing_canonical_alias: 0,
    new_canonical_required: 0,
    manual_only: 0,
    ambiguous: 0,
    invalid_or_duplicate_source_record: 0,
  };

  for (const name of [...polygonNames].sort()) {
    const info = meta.get(name) ?? { states: new Set(), feature_count: 0, customers: 0 };
    const county = countyMeta.get(name) ?? { county_count: 0, utility_ids: new Set() };
    const reconciled = reconcileEiaUtilityName(name);
    const classification = classifyTerritoryUtilityName(name, {
      states: [...info.states],
      feature_count: info.feature_count,
      county_count: county.county_count,
      eia_utility_id: [...county.utility_ids][0] ?? null,
    });
    totals[classification.classification] = (totals[classification.classification] ?? 0) + 1;

    records.push({
      eia_legal_name: name,
      eia_utility_id: [...county.utility_ids][0] ?? null,
      states: [...info.states].sort(),
      feature_count: info.feature_count,
      customers: info.customers,
      county_count: county.county_count,
      existing_row3_candidate: reconciled.provider_slug ?? null,
      classification: classification.classification,
      reason: classification.reason,
      evidence_source: classification.evidence_source,
      manual_confirmation_required: classification.manual_confirmation_required !== false,
      candidate_slugs: classification.candidate_slugs ?? [],
    });
  }

  const report = {
    generated_at: new Date().toISOString(),
    input_dir: inputDir,
    totals,
    records,
  };

  const outPath = args.output || path.join(inputDir, "territory_unresolved_classification.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outPath, totals, record_count: records.length }, null, 2));
}

main();
