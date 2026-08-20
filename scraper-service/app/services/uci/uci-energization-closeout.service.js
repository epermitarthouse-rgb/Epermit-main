"use strict";

/**
 * Agent 12 — energization capture + closeout package.
 * Hard-block without utility confirmation, final meter reading, commissioning sign-off,
 * and five-section PDF archived. Project complete only when ALL records are Stage 10 COMPLETED.
 */

const { emitUciEvent } = require("./uci-events.service.js");
const { recordSystemTransition } = require("./uci-transitions.service.js");
const { updateCoordinationRecordFields } = require("./uci-record-write.service.js");
const { raiseUciAlert } = require("./uci-alerts.service.js");
const { buildCloseoutPdf } = require("./uci-closeout-pdf.service.js");
const { storeUciPortalDocument } = require("./uci-document-storage.service.js");
const { buildEvidenceRef, mergeCloseoutArtifact } = require("./uci-evidence.service.js");
const {
  canCompleteStage10,
  isProjectUtilityCoordinationComplete,
  hasUtilityConfirmationEvidence,
  hasFinalMeterReading,
  hasCommissioningSignOff,
  stage9CompletedForCloseout,
} = require("./uci-lifecycle-guards.service.js");
const { BLOCKED_REASON_CODES, UCI_LIFECYCLE_EVENTS } = require("./uci-lifecycle-constants.js");
const { UCI_DOCUMENTS_STORAGE_BUCKET } = require("./uci-document-storage.service.js");

function asMeta(record) {
  if (record?.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)) {
    return { ...record.metadata };
  }
  return {};
}

async function loadRecord(supabase, id) {
  const { data } = await supabase.from("coordination_records").select("*").eq("id", id).maybeSingle();
  return data || null;
}

async function loadProject(supabase, projectId) {
  const { data } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
  return data || {};
}

async function loadUtilityProvider(supabase, providerId) {
  if (!providerId) return {};
  const { data } = await supabase
    .from("utility_providers")
    .select("id, name, slug, ownership_type")
    .eq("id", providerId)
    .maybeSingle();
  return data || {};
}

async function loadBundle(supabase, record) {
  const id = String(record.id);
  const projectId = String(record.project_id);
  const [transitions, communications, costs] = await Promise.all([
    supabase
      .from("coordination_stage_transitions")
      .select("*")
      .eq("coordination_record_id", id)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("coordination_communications")
      .select("*")
      .eq("coordination_record_id", id)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("coordination_costs")
      .select("*")
      .eq("coordination_record_id", id)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
  ]);
  return {
    transitions: Array.isArray(transitions.data) ? transitions.data : [],
    communications: Array.isArray(communications.data) ? communications.data : [],
    costs: Array.isArray(costs.data) ? costs.data : [],
  };
}

function missingCloseoutArtifacts(record, costs) {
  /** @type {string[]} */
  const missing = [];
  if (!record.energization_actual_date) missing.push("energization_actual_date");
  if (record.energization_date_conflict === true) missing.push("date_conflict");
  if (!hasUtilityConfirmationEvidence(record)) missing.push("utility_confirmation");
  if (!hasFinalMeterReading(record)) missing.push("final_meter_reading");
  if (!hasCommissioningSignOff(record)) missing.push("commissioning_signoff");
  if (!record.closeout_package_doc_id) missing.push("closeout_pdf");
  const unpaid = (Array.isArray(costs) ? costs : []).filter((c) => c && !c.paid_at);
  if (unpaid.length) missing.push("paid_receipts");
  return missing;
}

/**
 * Capture energization_actual_date. Conflict with target date → block.
 */
async function captureEnergizationDate(supabase, params) {
  const { coordinationRecordId, actualDate, source = "operator", communicationId = null } = params;
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const actual = String(actualDate).slice(0, 10);
  const target = record.energization_target_date ? String(record.energization_target_date).slice(0, 10) : null;
  const conflict = Boolean(target && actual && target !== actual);

  const { record: updated } = await updateCoordinationRecordFields(supabase, {
    coordinationRecordId,
    fields: {
      energization_actual_date: actual,
      energization_date_conflict: conflict,
    },
    eventName: UCI_LIFECYCLE_EVENTS.ENERGIZATION_CAPTURED,
    eventPayload: { actual_date: actual, conflict, source, communication_id: communicationId },
  });

  if (conflict) {
    await raiseUciAlert(supabase, {
      record: updated,
      severity: "P1",
      code: BLOCKED_REASON_CODES.CLOSEOUT_DATE_CONFLICT,
      message: `Energization date ${actual} conflicts with target ${target}`,
    });
    emitUciEvent(
      UCI_LIFECYCLE_EVENTS.CLOSEOUT_BLOCKED,
      {
        coordination_record_id: coordinationRecordId,
        project_id: record.project_id,
        reason: "date_conflict",
      },
      { supabase },
    );
  }

  if (Number(updated.current_stage) < 10 && !conflict) {
    try {
      await recordSystemTransition(supabase, {
        coordinationRecordId,
        toStage: 10,
        toState: "IN_PROGRESS",
        reason: "Energization date captured — closeout in progress",
      });
    } catch {
      // Entry guard may block until Stage 9 is complete; capture still persisted.
    }
  }

  return { record: (await loadRecord(supabase, coordinationRecordId)) || updated, conflict };
}

async function resolveEnergizationDateConflict(supabase, params) {
  const { coordinationRecordId, keep = "actual", userId = null } = params;
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  /** @type {Record<string, unknown>} */
  const fields = { energization_date_conflict: false };
  if (keep === "target" && record.energization_target_date) {
    fields.energization_actual_date = record.energization_target_date;
  }
  return updateCoordinationRecordFields(supabase, {
    coordinationRecordId,
    fields,
    metadataPatch: { date_conflict_resolved_by: userId, date_conflict_keep: keep },
  });
}

async function attachCloseoutArtifact(supabase, params) {
  const {
    coordinationRecordId,
    kind,
    docId = null,
    label = null,
    source = "operator",
    communicationId = null,
    confirmedBy = null,
  } = params;
  const allowed = new Set(["utility_confirmation", "final_meter_reading", "commissioning_signoff"]);
  if (!allowed.has(String(kind))) {
    const err = new Error("artifact kind must be utility_confirmation, final_meter_reading, or commissioning_signoff");
    err.statusCode = 400;
    err.code = "INVALID_ARTIFACT";
    throw err;
  }
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const kindStr = String(kind);
  const alreadyPresent =
    (kindStr === "utility_confirmation" && hasUtilityConfirmationEvidence(record)) ||
    (kindStr === "final_meter_reading" && hasFinalMeterReading(record)) ||
    (kindStr === "commissioning_signoff" && hasCommissioningSignOff(record));
  if (alreadyPresent) {
    return { record, previous: record, idempotent: true };
  }
  const evidence = buildEvidenceRef({ kind, source, docId, label, communicationId, confirmedBy });
  const nextMeta = mergeCloseoutArtifact(record, kind, evidence);
  return updateCoordinationRecordFields(supabase, {
    coordinationRecordId,
    fields: {},
    metadataPatch: nextMeta,
  });
}

function resolveStoredCloseoutStoragePath(stored) {
  const entry = stored?.fileEntry;
  if (!entry || typeof entry !== "object") return null;
  if (String(entry.storageStatus || "") !== "stored") return null;
  const storagePath = String(entry.storagePath || "").trim();
  return storagePath || null;
}

function resolveCloseoutPdfStoragePath(record, projectDocument = null) {
  const docPath = projectDocument?.file_path ? String(projectDocument.file_path).trim() : "";
  if (docPath) return docPath;
  const closeout = asMeta(record).uci_closeout_package;
  const packagePath =
    closeout && typeof closeout === "object" && !Array.isArray(closeout)
      ? String(/** @type {Record<string, unknown>} */ (closeout).storage_path || "").trim()
      : "";
  return packagePath || null;
}

async function archiveCloseoutPdf(supabase, params) {
  const { record, project, buffer, hash, userId = null } = params;
  let stored = { fileEntry: {}, storageAction: "skipped" };
  try {
    stored = await storeUciPortalDocument({
      supabase,
      buffer,
      projectId: String(record.project_id),
      coordinationRecordId: String(record.id),
      providerSlug: "uci",
      externalApplicationId: `closeout-${record.id}`,
      documentName: "uci-closeout-package.pdf",
      fileName: `uci-closeout-${hash.slice(0, 12)}.pdf`,
      isPdf: true,
    });
  } catch (err) {
    stored = {
      fileEntry: { storageStatus: "failed", storageError: err instanceof Error ? err.message : String(err) },
      storageAction: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const storagePath = resolveStoredCloseoutStoragePath(stored);
  const archivedFileName = String(
    stored.fileEntry?.fileName || `uci-closeout-${hash.slice(0, 12)}.pdf`,
  );
  if (!storagePath) {
    return {
      document_id: null,
      reused: false,
      storage: stored,
      error: stored.error || "closeout_storage_failed",
      hash,
    };
  }

  const { data: existingDoc } = await supabase
    .from("project_documents")
    .select("id, description, file_path, file_name")
    .eq("project_id", record.project_id)
    .eq("document_type", "uci_closeout_package")
    .limit(20);

  const already = (Array.isArray(existingDoc) ? existingDoc : []).find(
    (row) => String(row.description || "").includes(hash),
  );
  if (already?.id) {
    const { error: updateError } = await supabase
      .from("project_documents")
      .update({
        file_path: storagePath,
        file_name: archivedFileName,
        file_size: buffer.length,
        file_type: "application/pdf",
      })
      .eq("id", already.id);
    if (updateError) {
      return {
        document_id: already.id,
        reused: true,
        storage: stored,
        error: updateError.message,
        hash,
        file_path: storagePath,
        file_name: archivedFileName,
      };
    }
    return {
      document_id: already.id,
      reused: true,
      storage: stored,
      hash,
      file_path: storagePath,
      file_name: archivedFileName,
    };
  }

  const { data: inserted, error } = await supabase
    .from("project_documents")
    .insert({
      project_id: record.project_id,
      user_id: userId || record.user_id || project.user_id,
      file_name: archivedFileName,
      file_path: storagePath,
      file_size: buffer.length,
      file_type: "application/pdf",
      document_type: "uci_closeout_package",
      description: `UCI closeout package hash=${hash}`,
    })
    .select("id")
    .single();

  if (error) {
    return {
      document_id: null,
      reused: false,
      storage: stored,
      error: error.message,
      hash,
      file_path: storagePath,
      file_name: archivedFileName,
    };
  }
  return {
    document_id: inserted.id,
    reused: false,
    storage: stored,
    hash,
    file_path: storagePath,
    file_name: archivedFileName,
  };
}

/**
 * Generate / archive PDF. Hard-blocks without the three artifacts + no date conflict.
 */
async function generateAndArchiveCloseout(supabase, params) {
  const { coordinationRecordId, userId = null } = params;
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const project = await loadProject(supabase, String(record.project_id));
  const provider = await loadUtilityProvider(supabase, record.utility_provider_id);
  const bundle = await loadBundle(supabase, record);

  if (!stage9CompletedForCloseout(record)) {
    const err = new Error(
      "Closeout PDF cannot be generated until Stage 9 is completed. Start Stage 9 and finish meter-set coordination first.",
    );
    err.statusCode = 409;
    err.code = "STAGE_9_INCOMPLETE_FOR_CLOSEOUT";
    throw err;
  }

  const missing = missingCloseoutArtifacts(
    { ...record, closeout_package_doc_id: record.closeout_package_doc_id || "pending" },
    bundle.costs,
  ).filter((k) => k !== "closeout_pdf");

  if (missing.length) {
    await raiseUciAlert(supabase, {
      record,
      severity: "P1",
      code: BLOCKED_REASON_CODES.CLOSEOUT_MISSING_ARTIFACT,
      message: `Closeout blocked — missing ${missing.join(", ")}`,
    });
    const err = new Error(`Closeout is blocked until these are on file: ${missing.join(", ")}`);
    err.statusCode = 409;
    err.code = "CLOSEOUT_HARD_BLOCK";
    err.missing = missing;
    throw err;
  }

  const pdf = await buildCloseoutPdf({
    project,
    provider,
    record,
    transitions: bundle.transitions,
    communications: bundle.communications,
    costs: bundle.costs,
    energization: asMeta(record).closeout_artifacts || {},
  });

  const archived = await archiveCloseoutPdf(supabase, {
    record,
    project,
    buffer: pdf.buffer,
    hash: pdf.hash,
    userId,
  });

  if (!archived.document_id || !archived.file_path) {
    const err = new Error(
      archived.error
        ? `Closeout PDF storage failed: ${archived.error}`
        : "Closeout PDF could not be archived to project storage",
    );
    err.statusCode = 500;
    err.code = "CLOSEOUT_STORAGE_FAILED";
    throw err;
  }

  const { record: updated } = await updateCoordinationRecordFields(supabase, {
    coordinationRecordId,
    fields: { closeout_package_doc_id: archived.document_id },
    metadataPatch: {
      uci_closeout_package: {
        hash: pdf.hash,
        sections: pdf.sections,
        document_id: archived.document_id,
        storage_path: archived.file_path,
        file_name: archived.file_name,
        generated_at: new Date().toISOString(),
      },
    },
    eventName: UCI_LIFECYCLE_EVENTS.CLOSEOUT_ARCHIVED,
    eventPayload: { hash: pdf.hash, document_id: archived.document_id, reused: archived.reused === true },
  });

  return {
    record: updated,
    pdf,
    archived,
    sections: pdf.sections,
  };
}

async function maybeMarkProjectComplete(supabase, projectId) {
  const { data: records } = await supabase
    .from("coordination_records")
    .select("id, current_stage, current_stage_state")
    .eq("project_id", projectId);
  const rows = Array.isArray(records) ? records : [];
  const complete = isProjectUtilityCoordinationComplete(rows);
  const completedCount = rows.filter(
    (r) => Number(r.current_stage) === 10 && String(r.current_stage_state) === "COMPLETED",
  ).length;
  if (complete) {
    await supabase
      .from("projects")
      .update({ utility_coordination_completed_at: new Date().toISOString() })
      .eq("id", projectId);
    emitUciEvent(
      UCI_LIFECYCLE_EVENTS.PROJECT_UCI_COMPLETE,
      { project_id: projectId, completed_count: completedCount, total: rows.length },
      { supabase },
    );
  }
  return {
    complete,
    completed_count: completedCount,
    total: rows.length,
    banner: `${completedCount} of ${rows.length} utilities closed`,
  };
}

async function completeStage10IfReady(supabase, params) {
  const { coordinationRecordId, userId = null } = params;
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const bundle = await loadBundle(supabase, record);
  if (!canCompleteStage10(record, bundle.costs)) {
    const missing = missingCloseoutArtifacts(record, bundle.costs);
    const err = new Error(`Stage 10 cannot complete — missing ${missing.join(", ") || "required closeout items"}`);
    err.statusCode = 409;
    err.code = "STAGE_10_INCOMPLETE";
    err.missing = missing;
    throw err;
  }
  const transition = await recordSystemTransition(supabase, {
    coordinationRecordId,
    toStage: 10,
    toState: "COMPLETED",
    reason: "Energization closeout package archived",
    triggeredByType: userId ? "user" : "system",
    triggeredById: userId,
  });
  const rollup = await maybeMarkProjectComplete(supabase, String(record.project_id));
  return { ...transition, project_rollup: rollup };
}

function closeoutStatus(record, costs = []) {
  const missing = missingCloseoutArtifacts(record, costs);
  if (!stage9CompletedForCloseout(record)) {
    return {
      status: "stage_9_incomplete",
      missing: ["stage_9_completed", ...missing.filter((m) => m !== "closeout_pdf")],
      actions: ["enter_stage_9", "complete_stage_9"],
    };
  }
  if (record.energization_date_conflict === true) {
    return { status: "date_conflict", missing, actions: ["resolve_date_conflict"] };
  }
  if (missing.filter((m) => m !== "closeout_pdf").length) {
    return { status: "artifacts_incomplete", missing, actions: ["attach_artifacts", "capture_energization"] };
  }
  if (!record.closeout_package_doc_id) {
    return { status: "ready_to_generate_pdf", missing, actions: ["generate_closeout_pdf"] };
  }
  if (Number(record.current_stage) === 10 && String(record.current_stage_state) === "COMPLETED") {
    return { status: "completed", missing: [], actions: [] };
  }
  return { status: "ready_to_complete_stage_10", missing: [], actions: ["complete_stage_10"] };
}

/**
 * Resolve the stored closeout PDF for authorized inline viewing.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function resolveCloseoutPdfForOpen(supabase, params) {
  const { coordinationRecordId } = params;
  const record = await loadRecord(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const docId = record.closeout_package_doc_id;
  if (!docId) {
    const err = new Error("Closeout PDF is not archived for this record");
    err.statusCode = 404;
    err.code = "CLOSEOUT_PDF_NOT_FOUND";
    throw err;
  }
  const { data: projectDocument, error } = await supabase
    .from("project_documents")
    .select("id, project_id, file_name, file_path, file_type, document_type")
    .eq("id", docId)
    .eq("project_id", record.project_id)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load closeout PDF document"), {
      statusCode: 500,
      code: "CLOSEOUT_DOCUMENT_LOOKUP_FAILED",
    });
  }
  if (!projectDocument) {
    const err = new Error("Closeout PDF document record not found");
    err.statusCode = 404;
    err.code = "CLOSEOUT_PDF_NOT_FOUND";
    throw err;
  }
  const storagePath = resolveCloseoutPdfStoragePath(record, projectDocument);
  if (!storagePath) {
    const err = new Error("Closeout PDF storage path is missing");
    err.statusCode = 404;
    err.code = "CLOSEOUT_PDF_PATH_MISSING";
    throw err;
  }
  const { data: blob, error: downloadError } = await supabase.storage
    .from(UCI_DOCUMENTS_STORAGE_BUCKET)
    .download(storagePath);
  if (downloadError || !blob) {
    const err = new Error(downloadError?.message || "Closeout PDF object not found in storage");
    err.statusCode = 404;
    err.code = "CLOSEOUT_PDF_OBJECT_NOT_FOUND";
    throw err;
  }
  const buffer = Buffer.from(await blob.arrayBuffer());
  const fileName = String(projectDocument.file_name || "uci-closeout-package.pdf").replace(/["\r\n]/g, "_");
  return {
    buffer,
    fileName,
    contentType: String(projectDocument.file_type || "application/pdf"),
    storagePath,
    documentId: String(projectDocument.id),
  };
}

module.exports = {
  captureEnergizationDate,
  resolveEnergizationDateConflict,
  attachCloseoutArtifact,
  generateAndArchiveCloseout,
  completeStage10IfReady,
  maybeMarkProjectComplete,
  missingCloseoutArtifacts,
  closeoutStatus,
  loadBundle,
  resolveCloseoutPdfForOpen,
  resolveCloseoutPdfStoragePath,
};
