#!/usr/bin/env node
"use strict";

/**
 * Remove unintended Agent 1 gas/water/sewer Stage 1 BLOCKED coverage rows
 * created before explicit provider initialization.
 *
 * Usage:
 *   node scripts/cleanup-faulty-stage1-coverage-records.js \
 *     --project-id <uuid> \
 *     [--apply] \
 *     [--allow-production]
 *
 * Default is dry-run.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { createClient } = require("@supabase/supabase-js");
const { isProductionSupabaseHost } = require("../app/services/uci/uci-clean-slate-reset.service.js");

const DEFAULT_PROJECT_ID = "13dbc43e-860f-435d-a8af-27dfe34f2322";
const PRESERVE_COORDINATION_IDS = new Set(["f656209f-8fb5-4711-98ad-3e65801505db"]);
const FAULTY_UTILITY_TYPES = new Set(["gas", "water", "sewer", "telecom"]);

function parseArgs(argv) {
  const out = {
    projectId: DEFAULT_PROJECT_ID,
    apply: false,
    allowProduction: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") out.apply = true;
    else if (arg === "--allow-production") out.allowProduction = true;
    else if (arg === "--project-id") out.projectId = String(argv[++i] || "").trim();
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(1);
  }

  if (args.apply && isProductionSupabaseHost(url) && !args.allowProduction) {
    if (process.env.UCI_CLEAN_SLATE_ALLOW_PRODUCTION !== "true") {
      console.error(
        "Refusing production --apply without UCI_CLEAN_SLATE_ALLOW_PRODUCTION=true or --allow-production",
      );
      process.exit(1);
    }
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error } = await supabase
    .from("coordination_records")
    .select("id, utility_type, current_stage, current_stage_state, utility_provider_id, scope_description, metadata")
    .eq("project_id", args.projectId)
    .eq("scope_description", "");

  if (error) {
    console.error("Failed to load coordination records:", error.message);
    process.exit(1);
  }

  const candidates = (rows ?? []).filter((row) => {
    if (PRESERVE_COORDINATION_IDS.has(String(row.id))) return false;
    const utilityType = String(row.utility_type ?? "").trim().toLowerCase();
    if (!FAULTY_UTILITY_TYPES.has(utilityType)) return false;
    if (Number(row.current_stage) !== 1) return false;
    const state = String(row.current_stage_state ?? "").trim().toUpperCase();
    if (state !== "BLOCKED" && state !== "NOT_STARTED") return false;
    const mapping = row.metadata?.uci_provider_mapping;
    const humanInit = mapping && typeof mapping === "object" && mapping.confirmed === true;
    return !humanInit;
  });

  console.log(JSON.stringify({ project_id: args.projectId, dry_run: !args.apply, candidates }, null, 2));

  if (!args.apply) {
    console.log(`Dry run complete — ${candidates.length} record(s) would be deleted.`);
    return;
  }

  for (const row of candidates) {
    const coordinationId = String(row.id);
    const { error: transitionErr } = await supabase
      .from("coordination_stage_transitions")
      .delete()
      .eq("coordination_record_id", coordinationId);
    if (transitionErr) {
      console.error(`Failed to delete transitions for ${coordinationId}:`, transitionErr.message);
      process.exit(1);
    }
    const { error: deleteErr } = await supabase.from("coordination_records").delete().eq("id", coordinationId);
    if (deleteErr) {
      console.error(`Failed to delete coordination record ${coordinationId}:`, deleteErr.message);
      process.exit(1);
    }
    console.log(`Deleted ${coordinationId} (${row.utility_type})`);
  }

  console.log(`Applied cleanup — deleted ${candidates.length} record(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
