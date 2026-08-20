"use strict";

/**
 * Stage 4 P0 — Submission and Confirmation Tracker validation-only path.
 * Never calls Graph, portal, email, or advances Stage 4/5.
 * Never sets submitted_at / utility ticket / fabricated external refs.
 */

const {
  getApplicationById,
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
} = require("./uci-application-builder.service.js");
const { summarizePackageReview, isPersistedProjectDocumentId } = require("./uci-package-review.service.js");

const VALIDATION_VERSION = "stage4-validation-p0-v1";
const GENERATED_BY = "agent_4_submission_confirmation_tracker";
const INTENDED_SUBMISSION_MODE = "unavailable_not_configured";

const NO_SIDE_EFFECTS = Object.freeze({
  email_sent: false,
  portal_touched: false,
  live_submission_attempted: false,
  lifecycle_advanced: false,
  graph_called: false,
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/**
 * @param {Record<string, unknown>} application
 */
function isDominionSyntheticPackage(application) {
  const pkg = asObject(asObject(application.agent_draft_metadata).application_package);
  return (
    String(application.provider_slug ?? "").trim().toLowerCase() === "dominion" &&
    String(pkg.checklist_mode ?? "") === "synthetic_test" &&
    pkg.authoritative_requirements === false
  );
}

/**
 * Entry gates for Stage 4 validation (server-enforced).
 * @param {Record<string, unknown>} application
 */
function validateSubmissionValidationEligibility(application) {
  const blockers = [];

  if (String(application.record_source) !== "agent_draft") {
    blockers.push({
      code: "NOT_AGENT_DRAFT",
      message: "Only agent draft application packages can be validated for submission",
    });
  }

  if (String(application.idempotency_key) !== APPLICATION_PACKAGE_IDEMPOTENCY_KEY) {
    blockers.push({
      code: "NOT_APPLICATION_PACKAGE",
      message: "Application is not an Application Builder package draft",
    });
  }

  if (application.submitted_at) {
    blockers.push({
      code: "ALREADY_SUBMITTED",
      message: "Application already has a submitted_at timestamp — validation tracker does not re-submit",
    });
  }

  const reviewSummary = summarizePackageReview(application);
  const packageCorrection = asObject(reviewSummary.package_correction);
  const packageCorrectionActive = packageCorrection.active === true;

  if (String(application.draft_status) === "draft") {
    blockers.push({
      code: "DRAFT_NOT_REVIEWED",
      message: "Package is still a draft — mark it Reviewed before validating for submission",
    });
  }

  if (
    String(application.draft_status) === "needs_changes" ||
    reviewSummary.status === "needs_changes"
  ) {
    blockers.push({
      code: "NEEDS_CHANGES",
      message: "Package needs changes — resolve corrections and re-review before validating",
    });
  }

  if (reviewSummary.status !== "reviewed") {
    blockers.push({
      code: "REVIEW_REQUIRED",
      message: "Package must be Reviewed with an immutable reviewed snapshot before validation",
    });
  }

  if (!reviewSummary.reviewed_snapshot) {
    blockers.push({
      code: "REVIEWED_SNAPSHOT_REQUIRED",
      message: "Reviewed snapshot is missing — mark the package Reviewed again",
    });
  }

  if (reviewSummary.active_correction_count > 0 || packageCorrectionActive) {
    blockers.push({
      code: "ACTIVE_CORRECTIONS",
      message: "Active package corrections must be cleared before validating for submission",
      details: {
        active_correction_count: reviewSummary.active_correction_count,
        package_correction_active: packageCorrectionActive,
      },
    });
  }

  const unique = [];
  const seen = new Set();
  for (const blocker of blockers) {
    if (seen.has(blocker.code)) continue;
    seen.add(blocker.code);
    unique.push(blocker);
  }

  if (unique.length > 0) {
    return { ok: false, blockers: unique, review_summary: reviewSummary };
  }

  return { ok: true, blockers: [], review_summary: reviewSummary };
}

/**
 * @param {Record<string, unknown>} application
 * @param {ReturnType<typeof summarizePackageReview>} reviewSummary
 */
function collectAttachments(application, reviewSummary) {
  const snapshotDocs = Array.isArray(reviewSummary.reviewed_snapshot?.package_documents)
    ? reviewSummary.reviewed_snapshot.package_documents
    : Array.isArray(reviewSummary.reviewed_snapshot?.documents)
      ? reviewSummary.reviewed_snapshot.documents
      : null;
  const liveDocs = Array.isArray(application.package_documents)
    ? application.package_documents
    : [];
  const source = snapshotDocs && snapshotDocs.length > 0 ? snapshotDocs : liveDocs;

  return source.map((doc) => {
    const row = asObject(doc);
    return {
      key: row.key != null ? String(row.key) : null,
      label: row.label != null ? String(row.label) : null,
      file_name: row.file_name != null ? String(row.file_name) : null,
      status: row.status != null ? String(row.status) : null,
      document_type: row.document_type != null ? String(row.document_type) : null,
      project_document_id:
        row.project_document_id != null ? String(row.project_document_id) : null,
      signature_status:
        row.signature_status != null ? String(row.signature_status) : null,
    };
  });
}

/**
 * Ensure every attached required document has a persisted project_documents UUID.
 * @param {Array<Record<string, unknown>>} attachments
 */
function validateAttachmentDocumentReferences(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  /** @type {Array<{ code: string; key: string | null; message: string }>} */
  const errors = [];
  for (const raw of list) {
    const row = asObject(raw);
    const key = row.key != null ? String(row.key) : null;
    if (String(row.status ?? "") !== "attached") {
      errors.push({
        code: "ATTACHMENT_NOT_ATTACHED",
        key,
        message: `Required attachment is not attached: ${key || row.label || "unknown"}`,
      });
      continue;
    }
    if (!isPersistedProjectDocumentId(row.project_document_id)) {
      errors.push({
        code: "ATTACHMENT_DOCUMENT_ID_MISSING",
        key,
        message: `Attachment missing persisted project_document_id: ${key || row.label || row.file_name || "unknown"}`,
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

function assertAttachmentDocumentReferences(attachments) {
  const result = validateAttachmentDocumentReferences(attachments);
  if (result.ok) return result;
  const first = result.errors[0];
  throw Object.assign(new Error(first.message), {
    statusCode: 409,
    code: first.code === "ATTACHMENT_NOT_ATTACHED" ? "ATTACHMENT_NOT_ATTACHED" : "ATTACHMENT_RESOLVE_FAILED",
    details: { attachment_errors: result.errors },
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function persistValidationAttempt(supabase, params) {
  const {
    application,
    metadata,
    attemptRow,
    latestValidation,
  } = params;

  const priorHistory = Array.isArray(metadata.submission_validation_attempts)
    ? metadata.submission_validation_attempts
    : [];

  const historyEntry = {
    id: attemptRow.id,
    mode: "validation_only",
    result: attemptRow.result,
    provider_slug: attemptRow.provider_slug,
    package_snapshot_id: attemptRow.package_snapshot_id,
    package_snapshot_version: attemptRow.package_snapshot_version,
    package_snapshot_captured_at: attemptRow.package_snapshot_captured_at,
    intended_submission_mode: attemptRow.intended_submission_mode,
    operator_user_id: attemptRow.operator_user_id,
    validated_at: attemptRow.validated_at,
    blockers: attemptRow.blockers,
    warnings: attemptRow.warnings,
    attachments: attemptRow.attachments,
    external_side_effects: attemptRow.external_side_effects,
    validation_only: true,
  };

  // Append-only JSONB history. Do NOT overwrite real submission success fields.
  // Keep `submission` untouched as a non-authoritative legacy pointer if present;
  // Stage 4 P0 source of truth is submission_validation_attempts + this array.
  const updatedAgentMetadata = {
    ...metadata,
    submission_validation_attempts: [...priorHistory, historyEntry],
    latest_validation: latestValidation,
  };

  const { data, error } = await supabase
    .from("coordination_applications")
    .update({
      agent_draft_metadata: updatedAgentMetadata,
      // Explicitly never touch submission columns on validation-only.
    })
    .eq("id", String(application.id))
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to persist validation attempt metadata"), {
      cause: error,
      statusCode: 500,
      code: "VALIDATION_ATTEMPT_METADATA_UPDATE_FAILED",
    });
  }

  return data;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.applicationId
 * @param {string} params.userId
 */
async function validateSubmissionPackage(supabase, params) {
  const { applicationId, userId } = params;
  const application = await getApplicationById(supabase, applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const eligibility = validateSubmissionValidationEligibility(application);
  const metadata = asObject(application.agent_draft_metadata);
  const pkg = asObject(metadata.application_package);
  const reviewSummary = eligibility.review_summary;
  const synthetic = isDominionSyntheticPackage(application);
  const validatedAt = new Date().toISOString();
  const snapshot = asObject(reviewSummary.reviewed_snapshot);
  const packageSnapshotId =
    snapshot.id != null
      ? String(snapshot.id)
      : snapshot.snapshot_id != null
        ? String(snapshot.snapshot_id)
        : application.id
          ? `reviewed:${application.id}:${snapshot.captured_at ?? "unknown"}`
          : null;
  const packageSnapshotVersion =
    snapshot.snapshot_version != null
      ? String(snapshot.snapshot_version)
      : "agent-3-reviewed-package-snapshot-v1";

  const attachments = eligibility.ok
    ? collectAttachments(application, reviewSummary)
    : [];

  const attachmentReferenceCheck = eligibility.ok
    ? validateAttachmentDocumentReferences(attachments)
    : { ok: true, errors: [] };

  const packageValidationErrors = eligibility.ok
    ? [
        ...(Array.isArray(pkg.missing_fields) ? pkg.missing_fields : []),
        ...(Array.isArray(pkg.missing_documents) ? pkg.missing_documents : []),
        ...attachmentReferenceCheck.errors.map((entry) => entry.key || entry.code),
      ]
    : [];

  const readinessOk =
    eligibility.ok &&
    packageValidationErrors.length === 0 &&
    attachmentReferenceCheck.ok &&
    String(pkg.package_status ?? "") === "ready_for_review";

  const warnings = [];
  if (synthetic) {
    warnings.push({
      code: "SYNTHETIC_TEST",
      message: "SYNTHETIC TEST — NO EXTERNAL SUBMISSION",
    });
  }
  warnings.push({
    code: "SUBMISSION_NOT_CONFIGURED",
    message:
      "Actual utility submission is not configured or enabled. This action only validates the reviewed package.",
  });

  const result = !eligibility.ok ? "blocked" : readinessOk ? "passed" : "failed";

  const validationPayload = {
    version: VALIDATION_VERSION,
    generated_by: GENERATED_BY,
    validation_only: true,
    mode: "validation_only",
    provider_slug: String(application.provider_slug ?? ""),
    package_snapshot_id: packageSnapshotId,
    package_snapshot_version: packageSnapshotVersion,
    package_snapshot_captured_at: snapshot.captured_at ?? null,
    intended_submission_mode: INTENDED_SUBMISSION_MODE,
    synthetic_test: synthetic,
    checklist_label: pkg.checklist_label ?? null,
    readiness: {
      ok: readinessOk,
      package_status: pkg.package_status ?? null,
      field_count: Array.isArray(pkg.field_results) ? pkg.field_results.length : 0,
      attached_document_count: attachments.filter((doc) => doc.status === "attached").length,
      signature_requirements: pkg.signature_requirements ?? [],
      validation_errors: packageValidationErrors,
      attachment_reference_errors: attachmentReferenceCheck.errors,
      review_status: reviewSummary.status,
      active_correction_count: reviewSummary.active_correction_count,
    },
    attachments,
    blockers: eligibility.blockers,
    warnings,
    external_side_effects: { ...NO_SIDE_EFFECTS },
    validated_at: validatedAt,
  };

  const insertRow = {
    application_id: String(application.id),
    coordination_record_id: String(application.coordination_record_id),
    project_id: String(application.project_id),
    attempt_mode: "validation_only",
    result,
    provider_slug: String(application.provider_slug ?? ""),
    package_snapshot_id: packageSnapshotId,
    package_snapshot_version: packageSnapshotVersion,
    package_snapshot_captured_at: snapshot.captured_at ?? null,
    intended_submission_mode: INTENDED_SUBMISSION_MODE,
    operator_user_id: userId,
    blockers: eligibility.blockers,
    warnings,
    attachments,
    external_side_effects: { ...NO_SIDE_EFFECTS },
    validation_payload: validationPayload,
    validated_at: validatedAt,
  };

  const { data: attemptRow, error: insertError } = await supabase
    .from("submission_validation_attempts")
    .insert(insertRow)
    .select("*")
    .single();

  if (insertError) {
    // Fallback: still append JSONB history if table is not migrated yet.
    const fallbackId = `local-${validatedAt}-${Math.random().toString(36).slice(2, 10)}`;
    const fallbackAttempt = {
      id: fallbackId,
      ...insertRow,
      created_at: validatedAt,
    };
    const updatedApp = await persistValidationAttempt(supabase, {
      application,
      metadata,
      attemptRow: fallbackAttempt,
      latestValidation: validationPayload,
    });

    return buildValidationResponse({
      result,
      application: updatedApp,
      attempt: fallbackAttempt,
      validationPayload,
      synthetic,
      tablePersisted: false,
      message: insertError.message
        ? `Validation recorded in application history (table insert deferred: ${insertError.message})`
        : undefined,
    });
  }

  const updatedApp = await persistValidationAttempt(supabase, {
    application,
    metadata,
    attemptRow,
    latestValidation: validationPayload,
  });

  // Hard no-side-effect assertions for callers/tests.
  if (updatedApp.submitted_at) {
    const err = new Error("Invariant violated: validation_only must leave submitted_at null");
    err.statusCode = 500;
    err.code = "VALIDATION_SIDE_EFFECT_INVARIANT";
    throw err;
  }

  return buildValidationResponse({
    result,
    application: updatedApp,
    attempt: attemptRow,
    validationPayload,
    synthetic,
    tablePersisted: true,
  });
}

function buildValidationResponse(params) {
  const { result, application, attempt, validationPayload, synthetic, tablePersisted, message } =
    params;
  const status =
    result === "passed"
      ? "validation_passed"
      : result === "failed"
        ? "validation_failed"
        : "validation_blocked";

  return {
    status,
    result,
    validation_only: true,
    mode: "validation_only",
    intended_submission_mode: INTENDED_SUBMISSION_MODE,
    dry_run: true,
    lifecycle_advanced: false,
    portal_adapter_used: false,
    submission_method: "validation_only",
    external_side_effects: { ...NO_SIDE_EFFECTS },
    synthetic_test: synthetic === true,
    synthetic_banner:
      synthetic === true ? "SYNTHETIC TEST — NO EXTERNAL SUBMISSION" : null,
    capability: "Submission and Confirmation Tracker",
    primary_state: "not_submitted",
    secondary_state:
      result === "passed"
        ? "validation_passed"
        : result === "failed"
          ? "validation_failed"
          : "validation_blocked",
    provider_slug: validationPayload.provider_slug,
    package_snapshot: {
      id: validationPayload.package_snapshot_id,
      version: validationPayload.package_snapshot_version,
      captured_at: validationPayload.package_snapshot_captured_at,
    },
    attachments: validationPayload.attachments,
    readiness: validationPayload.readiness,
    blockers: validationPayload.blockers,
    warnings: validationPayload.warnings,
    validated_at: validationPayload.validated_at,
    attempt,
    table_persisted: tablePersisted !== false,
    application,
    submission_metadata: validationPayload,
    message:
      message ||
      (result === "passed"
        ? "Validation passed. Package remains Not submitted — actual submission is not configured."
        : result === "failed"
          ? "Validation failed. Package remains Not submitted — no external submission was attempted."
          : "Validation blocked by readiness gates. Package remains Not submitted."),
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} applicationId
 */
async function listSubmissionValidationAttempts(supabase, applicationId) {
  const application = await getApplicationById(supabase, applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const { data, error } = await supabase
    .from("submission_validation_attempts")
    .select("*")
    .eq("application_id", applicationId)
    .order("validated_at", { ascending: false });

  const metadata = asObject(application.agent_draft_metadata);
  const jsonHistory = Array.isArray(metadata.submission_validation_attempts)
    ? clone(metadata.submission_validation_attempts).reverse()
    : [];

  if (error) {
    return {
      application_id: applicationId,
      attempts: jsonHistory,
      latest_validation: metadata.latest_validation ?? null,
      primary_state: application.submitted_at ? "submitted" : "not_submitted",
      source: "agent_draft_metadata",
      table_error: error.message,
    };
  }

  return {
    application_id: applicationId,
    attempts: data ?? [],
    latest_validation: metadata.latest_validation ?? null,
    primary_state: application.submitted_at ? "submitted" : "not_submitted",
    source: "submission_validation_attempts",
    submitted_at: application.submitted_at ?? null,
    application,
  };
}

module.exports = {
  VALIDATION_VERSION,
  GENERATED_BY,
  INTENDED_SUBMISSION_MODE,
  NO_SIDE_EFFECTS,
  isDominionSyntheticPackage,
  validateSubmissionValidationEligibility,
  validateSubmissionPackage,
  listSubmissionValidationAttempts,
  collectAttachments,
  validateAttachmentDocumentReferences,
  assertAttachmentDocumentReferences,
};
