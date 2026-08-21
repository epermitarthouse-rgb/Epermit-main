#!/usr/bin/env node
"use strict";

/**
 * Clean-slate UCI reset for a project/coordination pair.
 *
 * Usage:
 *   node scripts/reset-uci-project-clean-slate.js \
 *     --project-id <uuid> \
 *     --coordination-id <uuid> \
 *     [--apply] \
 *     [--allow-production]
 *
 * Default is dry-run. Production apply requires UCI_CLEAN_SLATE_ALLOW_PRODUCTION=true
 * or --allow-production.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { writeFileSync, mkdirSync } = require("fs");
const { join } = require("path");
const { createClient } = require("@supabase/supabase-js");
const {
  executeCleanSlateReset,
  isProductionSupabaseHost,
} = require("../app/services/uci/uci-clean-slate-reset.service.js");

const DEFAULTS = {
  projectId: "13dbc43e-860f-435d-a8af-27dfe34f2322",
  coordinationId: "f656209f-8fb5-4711-98ad-3e65801505db",
  label: "portsmouth-va-lc-451554",
};

function parseArgs(argv) {
  const out = {
    projectId: DEFAULTS.projectId,
    coordinationId: DEFAULTS.coordinationId,
    apply: false,
    allowProduction: false,
    label: DEFAULTS.label,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") out.apply = true;
    else if (arg === "--allow-production") out.allowProduction = true;
    else if (arg === "--project-id") out.projectId = String(argv[++i] || "").trim();
    else if (arg === "--coordination-id") out.coordinationId = String(argv[++i] || "").trim();
    else if (arg === "--label") out.label = String(argv[++i] || "").trim();
  }
  return out;
}

function formatTableReport(audit) {
  const lines = ["| Table | Rows | Preserve/Delete | Reason |", "|---|---:|---|---|"];
  for (const row of audit.table_audit || []) {
    const action =
      row.action === "preserve" ? "preserve" : row.action === "reset" ? "reset" : "delete";
    lines.push(
      `| ${row.table} | ${row.rows ?? "n/a"} | ${action} | ${String(row.reason || "").replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push(
    `| storage:${audit.storage_audit?.bucket || "project-documents"} | ${audit.storage_audit?.object_count ?? 0} | delete | Exclusive project document objects |`,
  );
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(1);
  }

  const dryRun = !args.apply;
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

  const result = await executeCleanSlateReset(supabase, {
    projectId: args.projectId,
    coordinationId: args.coordinationId,
    dryRun,
    supabaseUrl: url,
    allowProductionApply: args.allowProduction,
    reason: `cli_clean_slate:${args.label}`,
  });

  const artifactDir = join(__dirname, "..", "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(
    artifactDir,
    `${args.label}-clean-slate-${dryRun ? "dry-run-" : "apply-"}${Date.now()}.json`,
  );
  writeFileSync(artifactPath, JSON.stringify(result, null, 2));

  const deleteRows = (result.table_audit || [])
    .filter((r) => r.action === "delete")
    .reduce((sum, r) => sum + (Number(r.rows) || 0), 0);

  const verdict =
    dryRun && (result.contamination_risk?.pre_reset_risks?.length || 0) > 0
      ? "SAFE TO CLEAN RESET (with documented mitigations)"
      : dryRun
        ? "SAFE TO CLEAN RESET"
        : result.applied
          ? "RESET APPLIED"
          : "NO OP";

  console.log(
    JSON.stringify(
      {
        label: args.label,
        dry_run: dryRun,
        applied: Boolean(result.applied),
        idempotent_skip: Boolean(result.idempotent_skip),
        project_id: args.projectId,
        coordination_id: args.coordinationId,
        host: new URL(url).host,
        delete_row_total: deleteRows,
        storage_objects: result.storage_audit?.object_count ?? 0,
        mailbox_connections_preserved: result.mailbox?.connections_preserved ?? null,
        verdict,
        artifact: artifactPath,
      },
      null,
      2,
    ),
  );
  console.log("\n--- Table audit ---\n");
  console.log(formatTableReport(result));

  if (result.contamination_risk) {
    console.log("\n--- Contamination safeguards ---\n");
    console.log(JSON.stringify(result.contamination_risk, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
