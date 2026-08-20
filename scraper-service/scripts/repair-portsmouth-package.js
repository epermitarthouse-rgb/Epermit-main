#!/usr/bin/env node
"use strict";

/**
 * Inspect and optionally repair Portsmouth Stage 3 package document references.
 * Usage:
 *   node scripts/repair-portsmouth-package.js [--repair] [--application-id=<uuid>]
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 */

const { createClient } = require("@supabase/supabase-js");
const {
  packageDocumentsNeedRepair,
  repairReviewedPackageDocuments,
  isPersistedProjectDocumentId,
} = require("../app/services/uci/uci-package-review.service.js");

const DEFAULT_APPLICATION_ID = "5c2321ce-1f29-412d-a9ca-102ee543e02e";

function parseArgs(argv) {
  const args = { repair: false, applicationId: DEFAULT_APPLICATION_ID };
  for (const arg of argv) {
    if (arg === "--repair") args.repair = true;
    else if (arg.startsWith("--application-id=")) {
      args.applicationId = arg.slice("--application-id=".length).trim();
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: application, error } = await supabase
    .from("coordination_applications")
    .select(
      "id, coordination_record_id, project_id, draft_status, package_documents, agent_draft_metadata, reviewed_by, reviewed_at",
    )
    .eq("id", args.applicationId)
    .maybeSingle();
  if (error) throw error;
  if (!application) {
    console.error(`Application not found: ${args.applicationId}`);
    process.exit(1);
  }

  const unresolved = packageDocumentsNeedRepair(application);
  const worksheet = (application.package_documents ?? []).find(
    (doc) => String(doc.key) === "load_calculation_worksheet",
  );

  console.log(
    JSON.stringify(
      {
        application_id: application.id,
        draft_status: application.draft_status,
        unresolved,
        worksheet_project_document_id: worksheet?.project_document_id ?? null,
        worksheet_id_valid: isPersistedProjectDocumentId(worksheet?.project_document_id),
      },
      null,
      2,
    ),
  );

  if (!args.repair) {
    if (unresolved.length > 0) {
      console.log("Run with --repair to persist worksheet project_document_id.");
    }
    return;
  }

  if (unresolved.length === 0) {
    console.log("Nothing to repair.");
    return;
  }

  const result = await repairReviewedPackageDocuments(supabase, {
    applicationId: application.id,
    application,
    userId: application.reviewed_by || "service-role-repair",
  });

  console.log(
    JSON.stringify(
      {
        repaired_keys: result.repaired_keys,
        worksheet_project_document_id: result.worksheet_project_document_id,
        draft_status: result.application.draft_status,
        requires_final_review: result.requires_final_review,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
