#!/usr/bin/env node
"use strict";

/**
 * Verify Portsmouth document registry without resetting UCI state.
 * Usage: node scripts/verify-portsmouth-document-registry.js
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const COORDINATION_ID = "f656209f-8fb5-4711-98ad-3e65801505db";
const PROJECT_ID = "13dbc43e-860f-435d-a8af-27dfe34f2322";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const { count: docCount, error: docErr } = await supabase
    .from("project_documents")
    .select("id", { count: "exact", head: true })
    .eq("project_id", PROJECT_ID);
  if (docErr) throw docErr;

  const { data: registryRows, error: regErr } = await supabase
    .from("uci_document_registry_entries")
    .select("project_document_id, effective_role, role_confidence, classification_review")
    .eq("coordination_record_id", COORDINATION_ID);
  if (regErr) {
    if (/does not exist|schema cache/i.test(regErr.message)) {
      console.log(JSON.stringify({
        ok: false,
        migration_applied: false,
        project_documents_count: docCount,
        message: "uci_document_registry_entries table not found — apply migration 20260820220000",
      }, null, 2));
      return;
    }
    throw regErr;
  }

  const {
    listDocumentRegistry,
    getProviderRequirementsStatus,
    syncRegistryForCoordination,
  } = require("../app/services/uci/uci-document-registry.service.js");
  const { getCoordinationRecordById } = require("../app/services/uci/uci-records.service.js");

  const record = await getCoordinationRecordById(supabase, COORDINATION_ID);
  if (!record) throw new Error("Coordination record not found");

  if (!registryRows?.length) {
    await syncRegistryForCoordination(supabase, {
      coordinationRecordId: COORDINATION_ID,
      record,
    });
  }

  const registry = await listDocumentRegistry(supabase, { coordinationRecordId: COORDINATION_ID });
  const requirements = await getProviderRequirementsStatus(supabase, {
    coordinationRecordId: COORDINATION_ID,
  });

  console.log(JSON.stringify({
    ok: true,
    migration_applied: true,
    project_documents_count: docCount,
    registry_count: registry.total_count,
    needs_review_count: registry.needs_review.length,
    roles: registry.documents.map((d) => ({
      file: d.project_document?.file_name,
      role: d.effective_role,
      confidence: d.role_confidence,
      review: d.classification_review,
    })),
    provider_readiness: requirements.readiness,
    missing_slots: requirements.missing_slots,
    signature_required_slots: requirements.signature_required_slots,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
