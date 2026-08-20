#!/usr/bin/env node
"use strict";

/**
 * One-time cleanup for duplicate Stage 7/8 demo rows on Highland Springs electric.
 *
 * Keeps:
 *   - CIAC cost a34b927b-a299-469e-813f-1d9e7bf6f78d (estimate 1000, actual 1150)
 *   - transformer be303c60-6441-4643-9a2f-b0215a0b8fe8 (ETA 2026-12-15)
 *
 * Usage:
 *   node scripts/cleanup-highland-springs-stage7-duplicates.js [--dry-run]
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { createClient } = require("@supabase/supabase-js");
const { writeFileSync, mkdirSync } = require("fs");
const { join } = require("path");

const COORDINATION_ID = "1a2b4b06-a7f9-4b17-96ca-f757be8e0c69";
const KEEP_COST_ID = "a34b927b-a299-469e-813f-1d9e7bf6f78d";
const REMOVE_COST_IDS = [
  "797cecf5-3304-4fac-90d2-167ab7541446",
  "ce4c75d7-d3c9-4cf9-b307-772c989f7054",
  "05157ae6-42e4-49e9-a977-fafb4cc31230",
];
const KEEP_EQUIPMENT_ID = "be303c60-6441-4643-9a2f-b0215a0b8fe8";
const REMOVE_EQUIPMENT_IDS = ["1d65ad59-731d-4fe5-b5e5-8eb9e61f0d89"];

function parseArgs(argv) {
  return { dryRun: argv.includes("--dry-run") };
}

async function fetchRows(supabase, table, coordinationId) {
  const { data, error } = await supabase.from(table).select("*").eq("coordination_record_id", coordinationId);
  if (error) throw error;
  return data || [];
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, key);
  const { data: coord, error: coordErr } = await supabase
    .from("coordination_records")
    .select("id, project_id, utility_type, current_stage, current_stage_state")
    .eq("id", COORDINATION_ID)
    .maybeSingle();
  if (coordErr) throw coordErr;
  if (!coord) throw new Error(`Coordination ${COORDINATION_ID} not found`);
  if (String(coord.utility_type) !== "electric") {
    throw new Error(`Refusing cleanup: coordination utility_type is ${coord.utility_type}`);
  }

  const costsBefore = await fetchRows(supabase, "coordination_costs", COORDINATION_ID);
  const equipmentBefore = await fetchRows(supabase, "coordination_equipment", COORDINATION_ID);

  const keepCost = costsBefore.find((row) => row.id === KEEP_COST_ID);
  if (!keepCost) throw new Error(`Expected keep cost ${KEEP_COST_ID} missing`);
  const removeCosts = costsBefore.filter((row) => REMOVE_COST_IDS.includes(row.id));
  if (removeCosts.length !== REMOVE_COST_IDS.length) {
    const found = new Set(removeCosts.map((row) => row.id));
    const missing = REMOVE_COST_IDS.filter((id) => !found.has(id));
    throw new Error(`Expected ${REMOVE_COST_IDS.length} duplicate costs; missing ${missing.join(", ")}`);
  }

  const keepEquipment = equipmentBefore.find((row) => row.id === KEEP_EQUIPMENT_ID);
  if (!keepEquipment) throw new Error(`Expected keep equipment ${KEEP_EQUIPMENT_ID} missing`);
  const removeEquipment = equipmentBefore.filter((row) => REMOVE_EQUIPMENT_IDS.includes(row.id));
  if (removeEquipment.length !== REMOVE_EQUIPMENT_IDS.length) {
    throw new Error(`Expected ${REMOVE_EQUIPMENT_IDS.length} duplicate equipment rows`);
  }

  const audit = {
    at: new Date().toISOString(),
    coordination_id: COORDINATION_ID,
    project_id: coord.project_id,
    dry_run: dryRun,
    before: {
      costs: costsBefore.length,
      equipment: equipmentBefore.length,
    },
    kept: {
      cost_id: KEEP_COST_ID,
      equipment_id: KEEP_EQUIPMENT_ID,
    },
    removed: {
      cost_ids: REMOVE_COST_IDS,
      equipment_ids: REMOVE_EQUIPMENT_IDS,
      cost_rows: removeCosts,
      equipment_rows: removeEquipment,
    },
  };

  const artifactDir = join(__dirname, "..", "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(
    artifactDir,
    `highland-springs-stage7-cleanup-${dryRun ? "dry-run-" : ""}${Date.now()}.json`,
  );
  writeFileSync(artifactPath, JSON.stringify(audit, null, 2));

  if (dryRun) {
    console.log("[dry-run] would remove costs:", REMOVE_COST_IDS.join(", "));
    console.log("[dry-run] would remove equipment:", REMOVE_EQUIPMENT_IDS.join(", "));
    console.log("[dry-run] would keep cost:", KEEP_COST_ID);
    console.log("[dry-run] would keep equipment:", KEEP_EQUIPMENT_ID);
    console.log("[dry-run] audit artifact:", artifactPath);
    return;
  }

  const { error: costDeleteErr } = await supabase
    .from("coordination_costs")
    .delete()
    .in("id", REMOVE_COST_IDS)
    .eq("coordination_record_id", COORDINATION_ID);
  if (costDeleteErr) throw costDeleteErr;

  const { error: equipDeleteErr } = await supabase
    .from("coordination_equipment")
    .delete()
    .in("id", REMOVE_EQUIPMENT_IDS)
    .eq("coordination_record_id", COORDINATION_ID);
  if (equipDeleteErr) throw equipDeleteErr;

  const costsAfter = await fetchRows(supabase, "coordination_costs", COORDINATION_ID);
  const equipmentAfter = await fetchRows(supabase, "coordination_equipment", COORDINATION_ID);

  audit.after = {
    costs: costsAfter.length,
    equipment: equipmentAfter.length,
  };
  writeFileSync(artifactPath, JSON.stringify(audit, null, 2));

  console.log(JSON.stringify({
    coordination_id: COORDINATION_ID,
    costs_before: costsBefore.length,
    costs_after: costsAfter.length,
    equipment_before: equipmentBefore.length,
    equipment_after: equipmentAfter.length,
    kept_cost_id: KEEP_COST_ID,
    kept_equipment_id: KEEP_EQUIPMENT_ID,
    removed_cost_ids: REMOVE_COST_IDS,
    removed_equipment_ids: REMOVE_EQUIPMENT_IDS,
    artifact: artifactPath,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
