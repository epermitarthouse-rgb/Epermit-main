"use strict";

const crypto = require("crypto");
const {
  stampCleanSlateMetadata,
  readCleanSlateBoundary,
} = require("./uci-clean-slate-run-boundary.util.js");

const STORAGE_BUCKET = "project-documents";
const UCI_PORTAL_SYNC_JOB_TYPE = "uci_portal_sync";

/** @type {Array<{ table: string; scope: "coordination" | "project" | "global"; action: "delete" | "reset" | "preserve"; reason: string; filter?: string }>} */
const RESET_SCOPE = Object.freeze([
  {
    table: "coordination_communications",
    scope: "coordination",
    action: "delete",
    reason: "All inbound/outbound UCI comms for fresh lifecycle",
  },
  {
    table: "coordination_applications",
    scope: "coordination",
    action: "delete",
    reason: "Load profile, package drafts, submission history",
  },
  {
    table: "coordination_stage_transitions",
    scope: "coordination",
    action: "delete",
    reason: "Lifecycle audit trail for prior run",
  },
  {
    table: "coordination_costs",
    scope: "coordination",
    action: "delete",
    reason: "CIAC and fee tracking from prior run",
  },
  {
    table: "coordination_equipment",
    scope: "coordination",
    action: "delete",
    reason: "Equipment ETA tracking from prior run",
  },
  {
    table: "coordination_milestones",
    scope: "coordination",
    action: "delete",
    reason: "Milestone sync rows from prior run",
  },
  {
    table: "coordination_cos_design_records",
    scope: "coordination",
    action: "delete",
    reason: "COS design review state",
  },
  {
    table: "submission_preparations",
    scope: "coordination",
    action: "delete",
    reason: "Stage 4 submission prep snapshots",
  },
  {
    table: "submission_validation_attempts",
    scope: "coordination",
    action: "delete",
    reason: "Submission validation evidence",
  },
  {
    table: "submission_transmission_attempts",
    scope: "coordination",
    action: "delete",
    reason: "Live email transmission attempts",
  },
  {
    table: "uci_coordination_document_links",
    scope: "coordination",
    action: "delete",
    reason: "Coordination document scope links",
  },
  {
    table: "uci_document_registry_entries",
    scope: "coordination",
    action: "delete",
    reason: "Document registry rows (new uploads get new UUIDs)",
  },
  {
    table: "uci_portal_harvest_links",
    scope: "coordination",
    action: "delete",
    reason: "Portal harvest associations for this coordination",
  },
  {
    table: "uci_unmatched_inbound_messages",
    scope: "project",
    action: "delete",
    reason: "Prevent stale Graph messages from re-matching after reset",
  },
  {
    table: "scrape_jobs",
    scope: "coordination",
    action: "delete",
    reason: "Durable uci_portal_sync jobs for this coordination",
    filter: `job_type=${UCI_PORTAL_SYNC_JOB_TYPE}`,
  },
  {
    table: "document_ingestion_jobs",
    scope: "project",
    action: "delete",
    reason: "RAG ingestion queue for project documents",
  },
  {
    table: "project_document_chunks",
    scope: "project",
    action: "delete",
    reason: "Vector/RAG chunks for project documents",
  },
  {
    table: "document_comments",
    scope: "project_documents",
    action: "delete",
    reason: "Comments on documents being removed",
  },
  {
    table: "document_annotations",
    scope: "project_documents",
    action: "delete",
    reason: "Annotations on documents being removed",
  },
  {
    table: "project_documents",
    scope: "project",
    action: "delete",
    reason: "All project documents (exclusive storage cleanup)",
  },
  {
    table: "coordination_records",
    scope: "coordination",
    action: "reset",
    reason: "Reset in place to stage 1 with clean_slate run boundary",
  },
  {
    table: "projects",
    scope: "project",
    action: "reset",
    reason: "Clear utility_coordination_completed_at rollup only",
  },
  {
    table: "projects",
    scope: "project",
    action: "preserve",
    reason: "Project record, name, address, client metadata, team access",
  },
  {
    table: "project_team_members",
    scope: "project",
    action: "preserve",
    reason: "User/team access unchanged",
  },
  {
    table: "utility_providers",
    scope: "global",
    action: "preserve",
    reason: "Provider directory and uci_application_templates",
  },
  {
    table: "microsoft_mailbox_connections",
    scope: "global",
    action: "preserve",
    reason: "Mailbox OAuth, delta/checkpoint, dedupe state must not reset",
  },
  {
    table: "portal_credentials",
    scope: "project",
    action: "preserve",
    reason: "Portal credential linkage for project",
  },
  {
    table: "uci_portal_harvest_items",
    scope: "global",
    action: "preserve",
    reason: "Provider-scoped harvest catalog, not run-specific",
  },
]);

/**
 * @param {string | null | undefined} supabaseUrl
 */
function isProductionSupabaseHost(supabaseUrl) {
  if (!supabaseUrl) return false;
  try {
    const host = new URL(supabaseUrl).hostname.toLowerCase();
    return !/(localhost|127\.0\.0\.1|\.local$)/.test(host);
  } catch {
    return true;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} table
 * @param {(q: import("@supabase/supabase-js").PostgrestFilterBuilder<any, any, any>) => import("@supabase/supabase-js").PostgrestFilterBuilder<any, any, any>} applyFilter
 */
async function countRows(supabase, table, applyFilter) {
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  query = applyFilter(query);
  const { count, error } = await query;
  if (error) {
    return { count: null, error: error.message };
  }
  return { count: count ?? 0, error: null };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function loadProjectDocuments(supabase, projectId) {
  const { data, error } = await supabase
    .from("project_documents")
    .select("id, file_path, file_name, document_type")
    .eq("project_id", projectId);
  if (error) throw Object.assign(new Error(error.message), { cause: error });
  return Array.isArray(data) ? data : [];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string[]} documentIds
 */
async function auditStorageObjects(supabase, documentIds, filePaths) {
  /** @type {Array<{ path: string; action: string; reason: string }>} */
  const objects = [];
  for (const docPath of filePaths) {
    if (!docPath) continue;
    objects.push({
      path: docPath,
      action: "delete",
      reason: "Exclusive project_documents storage object",
    });
  }
  return {
    bucket: STORAGE_BUCKET,
    object_count: objects.length,
    objects,
    shared_skipped: 0,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function validateResetTargets(supabase, params) {
  const projectId = String(params.projectId || "").trim();
  const coordinationId = String(params.coordinationId || "").trim();
  if (!projectId || !coordinationId) {
    const err = new Error("projectId and coordinationId are required");
    err.statusCode = 400;
    err.code = "INVALID_TARGETS";
    throw err;
  }

  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id, name, tenant_id, utility_coordination_completed_at, archived_at")
    .eq("id", projectId)
    .maybeSingle();
  if (projectErr) throw Object.assign(new Error(projectErr.message), { cause: projectErr });
  if (!project) {
    const err = new Error(`Project ${projectId} not found`);
    err.statusCode = 404;
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }

  const { data: coordination, error: coordErr } = await supabase
    .from("coordination_records")
    .select(
      "id, project_id, utility_provider_id, utility_type, scope_description, current_stage, current_stage_state, metadata",
    )
    .eq("id", coordinationId)
    .maybeSingle();
  if (coordErr) throw Object.assign(new Error(coordErr.message), { cause: coordErr });
  if (!coordination) {
    const err = new Error(`Coordination ${coordinationId} not found`);
    err.statusCode = 404;
    err.code = "COORDINATION_NOT_FOUND";
    throw err;
  }
  if (String(coordination.project_id) !== projectId) {
    const err = new Error(
      `Coordination ${coordinationId} belongs to project ${coordination.project_id}, not ${projectId}`,
    );
    err.statusCode = 409;
    err.code = "COORDINATION_PROJECT_MISMATCH";
    throw err;
  }

  return { project, coordination };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function auditCleanSlateReset(supabase, params) {
  const { project, coordination } = await validateResetTargets(supabase, params);
  const projectId = String(project.id);
  const coordinationId = String(coordination.id);
  const documents = await loadProjectDocuments(supabase, projectId);
  const documentIds = documents.map((d) => String(d.id));
  const filePaths = documents.map((d) => String(d.file_path || ""));

  /** @type {Array<Record<string, unknown>>} */
  const tableAudit = [];

  for (const entry of RESET_SCOPE) {
    if (entry.action === "preserve") {
      let countResult = { count: null, error: null };
      if (entry.scope === "global") {
        countResult = await countRows(supabase, entry.table, (q) => q);
      } else if (entry.scope === "project") {
        countResult = await countRows(supabase, entry.table, (q) => q.eq("project_id", projectId));
      }
      tableAudit.push({
        table: entry.table,
        rows: countResult.count,
        action: "preserve",
        reason: entry.reason,
        error: countResult.error,
      });
      continue;
    }

    if (entry.action === "reset") {
      tableAudit.push({
        table: entry.table,
        rows: entry.table === "coordination_records" ? 1 : 1,
        action: "reset",
        reason: entry.reason,
      });
      continue;
    }

    if (entry.scope === "coordination") {
      let apply = (q) => q.eq("coordination_record_id", coordinationId);
      if (entry.table === "scrape_jobs") {
        apply = (q) =>
          q
            .eq("coordination_record_id", coordinationId)
            .eq("job_type", UCI_PORTAL_SYNC_JOB_TYPE);
      }
      const countResult = await countRows(supabase, entry.table, apply);
      tableAudit.push({
        table: entry.table,
        rows: countResult.count,
        action: "delete",
        reason: entry.reason,
        filter: entry.filter || null,
        error: countResult.error,
      });
      continue;
    }

    if (entry.scope === "project") {
      const countResult = await countRows(supabase, entry.table, (q) =>
        q.eq("project_id", projectId),
      );
      tableAudit.push({
        table: entry.table,
        rows: countResult.count,
        action: "delete",
        reason: entry.reason,
        error: countResult.error,
      });
      continue;
    }

    if (entry.scope === "project_documents") {
      if (!documentIds.length) {
        tableAudit.push({
          table: entry.table,
          rows: 0,
          action: "delete",
          reason: entry.reason,
        });
        continue;
      }
      const countResult = await countRows(supabase, entry.table, (q) =>
        q.in("document_id", documentIds),
      );
      tableAudit.push({
        table: entry.table,
        rows: countResult.count,
        action: "delete",
        reason: entry.reason,
        error: countResult.error,
      });
    }
  }

  const { count: mailboxCount } = await countRows(supabase, "microsoft_mailbox_connections", (q) =>
    q,
  );

  const storageAudit = await auditStorageObjects(supabase, documentIds, filePaths);

  const priorBoundary = readCleanSlateBoundary(
    coordination.metadata && typeof coordination.metadata === "object"
      ? coordination.metadata
      : {},
  );

  const contamination = await assessContaminationRisk(supabase, {
    coordination,
    documents,
    tableAudit,
  });

  return {
    at: new Date().toISOString(),
    dry_run: params.dryRun !== false,
    project: {
      id: projectId,
      name: project.name,
      utility_coordination_completed_at: project.utility_coordination_completed_at,
    },
    coordination: {
      id: coordinationId,
      utility_type: coordination.utility_type,
      current_stage: coordination.current_stage,
      current_stage_state: coordination.current_stage_state,
      prior_clean_slate: priorBoundary,
    },
    table_audit: tableAudit,
    storage_audit: storageAudit,
    mailbox: {
      connections_preserved: mailboxCount,
      checkpoint_reset: false,
    },
    post_reset_expectations: {
      project_documents: 0,
      coordination_communications: 0,
      coordination_current_stage: 1,
      coordination_current_stage_state: "NOT_STARTED",
    },
    contamination_risk: contamination,
    scope_mapping: RESET_SCOPE,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function assessContaminationRisk(supabase, params) {
  const coordination = params.coordination;
  const meta =
    coordination.metadata && typeof coordination.metadata === "object"
      ? coordination.metadata
      : {};
  const lcInMeta = Boolean(meta.lc_number || meta.load_control_number || meta.LC);
  const { count: unmatchedCount } = await countRows(supabase, "uci_unmatched_inbound_messages", (q) =>
    q.eq("project_id", String(coordination.project_id)),
  );
  const { count: commCount } = await countRows(supabase, "coordination_communications", (q) =>
    q.eq("coordination_record_id", String(coordination.id)),
  );

  /** @type {string[]} */
  const risks = [];
  if (lcInMeta) {
    risks.push("LC number still in coordination metadata would allow stale DOM-DEMO matching");
  }
  if ((unmatchedCount ?? 0) > 0) {
    risks.push("Unmatched inbound queue rows could be manually reprocessed into a new run");
  }
  if ((commCount ?? 0) > 0) {
    risks.push("Existing coordination comms could auto-complete lifecycle if not deleted");
  }

  return {
    lc_in_metadata: lcInMeta,
    unmatched_inbound_count: unmatchedCount,
    coordination_communications_count: commCount,
    pre_reset_risks: risks,
    mitigations: [
      "Delete all coordination_communications and project-scoped uci_unmatched_inbound_messages",
      "Scrub LC/ticket keys from coordination metadata and stamp clean_slate_at boundary",
      "Preserve microsoft_mailbox_connections (Graph idempotency prevents re-ingest of old mail)",
      "Matcher skips records when inbound message_timestamp < clean_slate_at",
    ],
    safe_after_reset: true,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function executeCleanSlateReset(supabase, params) {
  const dryRun = params.dryRun !== false;
  const audit = await auditCleanSlateReset(supabase, { ...params, dryRun });
  const { project, coordination } = await validateResetTargets(supabase, params);
  const projectId = String(project.id);
  const coordinationId = String(coordination.id);
  const runId = params.runId ? String(params.runId) : crypto.randomUUID();
  const resetAt = params.resetAt ? String(params.resetAt) : new Date().toISOString();

  if (dryRun) {
    return {
      ...audit,
      applied: false,
      run_id: runId,
      reset_at: resetAt,
      idempotent_skip: false,
    };
  }

  assertProductionApplyAllowed(params);

  const priorBoundary = readCleanSlateBoundary(
    coordination.metadata && typeof coordination.metadata === "object"
      ? coordination.metadata
      : {},
  );
  if (
    params.idempotencyKey &&
    priorBoundary &&
    priorBoundary.run_id === String(params.idempotencyKey)
  ) {
    return {
      ...audit,
      applied: false,
      run_id: priorBoundary.run_id,
      reset_at: priorBoundary.at,
      idempotent_skip: true,
      message: "Coordination already reset with this run id",
    };
  }

  const documents = await loadProjectDocuments(supabase, projectId);
  const documentIds = documents.map((d) => String(d.id));

  // FK-safe delete sequence
  await deleteByCoordination(supabase, "submission_transmission_attempts", coordinationId);
  await deleteByCoordination(supabase, "submission_validation_attempts", coordinationId);
  await deleteByCoordination(supabase, "submission_preparations", coordinationId);
  await deleteByCoordination(supabase, "coordination_cos_design_records", coordinationId);
  await deleteByCoordination(supabase, "coordination_communications", coordinationId);
  await deleteByCoordination(supabase, "coordination_applications", coordinationId);
  await deleteByCoordination(supabase, "coordination_stage_transitions", coordinationId);
  await deleteByCoordination(supabase, "coordination_costs", coordinationId);
  await deleteByCoordination(supabase, "coordination_equipment", coordinationId);
  await deleteByCoordination(supabase, "coordination_milestones", coordinationId);
  await deleteByCoordination(supabase, "uci_document_registry_entries", coordinationId);
  await deleteByCoordination(supabase, "uci_coordination_document_links", coordinationId);
  await deleteByCoordination(supabase, "uci_portal_harvest_links", coordinationId);

  await supabase
    .from("scrape_jobs")
    .delete()
    .eq("coordination_record_id", coordinationId)
    .eq("job_type", UCI_PORTAL_SYNC_JOB_TYPE);

  await supabase.from("uci_unmatched_inbound_messages").delete().eq("project_id", projectId);

  if (documentIds.length) {
    await supabase.from("document_comments").delete().in("document_id", documentIds);
    await supabase.from("document_annotations").delete().in("document_id", documentIds);
    await supabase.from("project_document_chunks").delete().in("document_id", documentIds);
  }
  await supabase.from("document_ingestion_jobs").delete().eq("project_id", projectId);

  // Clear closeout doc FK before deleting documents
  await supabase
    .from("coordination_records")
    .update({ closeout_package_doc_id: null })
    .eq("id", coordinationId);

  if (documentIds.length) {
    await supabase.from("project_documents").delete().in("id", documentIds);
  }

  // Storage cleanup (best-effort; DB rows already removed)
  const storagePaths = documents.map((d) => String(d.file_path || "")).filter(Boolean);
  if (storagePaths.length) {
    await supabase.storage.from(STORAGE_BUCKET).remove(storagePaths);
  }

  const existingMeta =
    coordination.metadata && typeof coordination.metadata === "object"
      ? /** @type {Record<string, unknown>} */ (coordination.metadata)
      : {};
  const preservedResolution = existingMeta.uci_provider_resolution;
  const preservedSetup = existingMeta.provider_setup || existingMeta.uci_provider_setup;

  /** @type {Record<string, unknown>} */
  let nextMeta = stampCleanSlateMetadata(existingMeta, {
    runId,
    at: resetAt,
    reason: params.reason || "operator_clean_slate_reset",
    priorRunId: priorBoundary?.run_id || null,
  });
  if (preservedResolution) nextMeta.uci_provider_resolution = preservedResolution;
  if (preservedSetup) nextMeta.provider_setup = preservedSetup;

  const { error: coordUpdateErr } = await supabase
    .from("coordination_records")
    .update({
      current_stage: 1,
      current_stage_state: "NOT_STARTED",
      application_submitted_at: null,
      acknowledgment_received_at: null,
      class_of_service_issued_at: null,
      energization_target_date: null,
      energization_actual_date: null,
      predicted_p50_date: null,
      predicted_p90_date: null,
      predicted_p50_previous: null,
      predicted_p50_computed_at: null,
      inspection_release_received_at: null,
      meter_set_scheduled_at: null,
      site_readiness_confirmed_at: null,
      site_contact_name: null,
      site_contact_email: null,
      site_contact_phone: null,
      energization_date_conflict: false,
      closeout_package_doc_id: null,
      utility_account_number: null,
      utility_contact_name: null,
      utility_contact_email: null,
      utility_contact_phone: null,
      utility_project_manager: null,
      next_required_action: null,
      ack_sla_started_at: null,
      ack_sla_due_at: null,
      ack_sla_stopped_at: null,
      ack_sla_escalated_at: null,
      current_stage_entered_at: resetAt,
      prediction_baseline_source: null,
      prediction_sample_size: null,
      prediction_reason: {},
      last_error: null,
      agent_monitored: true,
      metadata: nextMeta,
      updated_at: resetAt,
    })
    .eq("id", coordinationId)
    .eq("project_id", projectId);

  if (coordUpdateErr) {
    throw Object.assign(new Error(coordUpdateErr.message || "Failed to reset coordination"), {
      cause: coordUpdateErr,
    });
  }

  await supabase
    .from("projects")
    .update({ utility_coordination_completed_at: null })
    .eq("id", projectId);

  const afterAudit = await auditCleanSlateReset(supabase, { ...params, dryRun: true });

  return {
    ...audit,
    applied: true,
    run_id: runId,
    reset_at: resetAt,
    idempotent_skip: false,
    after: afterAudit,
  };
}

/**
 * @param {object} params
 */
function assertProductionApplyAllowed(params) {
  const supabaseUrl = params.supabaseUrl || process.env.SUPABASE_URL || "";
  const isProd = isProductionSupabaseHost(supabaseUrl);
  if (!isProd) return;
  if (params.allowProductionApply === true) return;
  if (process.env.UCI_CLEAN_SLATE_ALLOW_PRODUCTION === "true") return;
  const err = new Error(
    "Production apply blocked. Set UCI_CLEAN_SLATE_ALLOW_PRODUCTION=true or pass allowProductionApply.",
  );
  err.statusCode = 403;
  err.code = "PRODUCTION_GUARD";
  throw err;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} table
 * @param {string} coordinationId
 */
async function deleteByCoordination(supabase, table, coordinationId) {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq("coordination_record_id", coordinationId);
  if (error) {
    throw Object.assign(new Error(`${table} delete failed: ${error.message}`), { cause: error });
  }
}

module.exports = {
  RESET_SCOPE,
  STORAGE_BUCKET,
  isProductionSupabaseHost,
  auditCleanSlateReset,
  executeCleanSlateReset,
  validateResetTargets,
  assessContaminationRisk,
};
