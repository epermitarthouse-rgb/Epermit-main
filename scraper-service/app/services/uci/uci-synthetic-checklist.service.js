"use strict";

const {
  getApplicationById,
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
  SYNTHETIC_TEST_CHECKLIST_MODE,
  SYNTHETIC_TEST_CHECKLIST_LABEL,
  SIGNATURE_STATUSES,
  resolvePackageStatus,
} = require("./uci-application-builder.service.js");
const {
  refreshApplicationPackageDocumentSlots,
} = require("./uci-package-document-bridge.service.js");
const { getCoordinationRecordById } = require("./uci-records.service.js");

function applicationPackageMetadata(application) {
  const metadata =
    application?.agent_draft_metadata &&
    typeof application.agent_draft_metadata === "object" &&
    !Array.isArray(application.agent_draft_metadata)
      ? application.agent_draft_metadata
      : {};
  const pkg =
    metadata.application_package &&
    typeof metadata.application_package === "object" &&
    !Array.isArray(metadata.application_package)
      ? metadata.application_package
      : {};
  return { metadata, pkg };
}

function requireSyntheticChecklistApplication(application) {
  if (
    !application ||
    String(application.record_source) !== "agent_draft" ||
    String(application.idempotency_key) !== APPLICATION_PACKAGE_IDEMPOTENCY_KEY
  ) {
    const err = new Error("Application is not an Agent 3 application package");
    err.statusCode = 400;
    err.code = "NOT_APPLICATION_PACKAGE";
    throw err;
  }
  const { metadata, pkg } = applicationPackageMetadata(application);
  if (
    String(pkg.checklist_mode ?? "") !== SYNTHETIC_TEST_CHECKLIST_MODE ||
    pkg.authoritative_requirements !== false
  ) {
    const err = new Error("Action is available only for an explicit synthetic test checklist");
    err.statusCode = 400;
    err.code = "NOT_SYNTHETIC_TEST_CHECKLIST";
    throw err;
  }
  return { metadata, pkg };
}

async function approveSyntheticChecklist(supabase, params) {
  const application = await getApplicationById(supabase, params.applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const { metadata, pkg } = requireSyntheticChecklistApplication(application);
  const approvedAt = new Date().toISOString();
  const approvalNote = String(params.note ?? "").trim();
  const nextMetadata = {
    ...metadata,
    application_package: {
      ...pkg,
      synthetic_checklist: {
        status: "approved",
        label: SYNTHETIC_TEST_CHECKLIST_LABEL,
        approved_by_user_id: params.userId,
        approved_at: approvedAt,
        approval_note: approvalNote || "Approved for synthetic Stage 3 testing only",
      },
    },
  };

  const { error } = await supabase
    .from("coordination_applications")
    .update({ agent_draft_metadata: nextMetadata })
    .eq("id", params.applicationId);
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to approve synthetic checklist"), {
      cause: error,
      statusCode: 500,
      code: "SYNTHETIC_CHECKLIST_APPROVAL_FAILED",
    });
  }

  const refreshed = await refreshApplicationPackageDocumentSlots(supabase, {
    applicationId: params.applicationId,
    userId: params.userId,
  });
  return {
    ...refreshed,
    checklist_status: "approved",
    checklist_label: SYNTHETIC_TEST_CHECKLIST_LABEL,
    approved_at: approvedAt,
  };
}

async function setSyntheticSignatureStatus(supabase, params) {
  const application =
    params.application ?? (await getApplicationById(supabase, params.applicationId));
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  requireSyntheticChecklistApplication(application);

  const documentKey = String(params.documentKey ?? "").trim();
  const signatureStatus = String(params.signatureStatus ?? "").trim();
  const reviewNote = String(params.reviewNote ?? "").trim();
  if (!SIGNATURE_STATUSES.has(signatureStatus)) {
    const err = new Error("signature_status must be unknown, unsigned, or signed_manual_verified");
    err.statusCode = 400;
    err.code = "INVALID_SIGNATURE_STATUS";
    throw err;
  }
  if (signatureStatus === "signed_manual_verified" && !reviewNote) {
    const err = new Error("review_note is required for signed_manual_verified");
    err.statusCode = 400;
    err.code = "SIGNATURE_REVIEW_NOTE_REQUIRED";
    throw err;
  }

  const packageDocuments = Array.isArray(application.package_documents)
    ? application.package_documents
    : [];
  const target = packageDocuments.find((doc) => String(doc.key ?? "") === documentKey);
  if (!target || target.status !== "attached" || target.signature_required !== true) {
    const err = new Error("Attached signature-required package document not found");
    err.statusCode = 400;
    err.code = "SIGNATURE_DOCUMENT_NOT_READY";
    throw err;
  }

  const verifiedAt = new Date().toISOString();
  const nextDocuments = packageDocuments.map((doc) =>
    String(doc.key ?? "") === documentKey
      ? {
          ...doc,
          signature_status: signatureStatus,
          signature_verified_by:
            signatureStatus === "signed_manual_verified" ? params.userId : null,
          signature_verified_at:
            signatureStatus === "signed_manual_verified" ? verifiedAt : null,
          signature_review_note: reviewNote || null,
        }
      : doc,
  );

  const readinessStartedAt = Date.now();
  const { metadata, pkg } = applicationPackageMetadata(application);
  const signatureRequirements = Array.isArray(pkg.signature_requirements)
    ? pkg.signature_requirements
    : [];
  const existingRequirement = signatureRequirements.find(
    (requirement) => String(requirement?.document_key ?? "") === documentKey,
  );
  const requirementKey = String(
    existingRequirement?.requirement_key ?? `${documentKey}_signature`,
  );
  const satisfied = signatureStatus === "signed_manual_verified";
  const nextRequirement = {
    ...(existingRequirement &&
    typeof existingRequirement === "object" &&
    !Array.isArray(existingRequirement)
      ? existingRequirement
      : {}),
    document_key: documentKey,
    requirement_key: requirementKey,
    signature_status: signatureStatus,
    satisfied,
    verified_by: satisfied ? params.userId : null,
    verified_at: satisfied ? verifiedAt : null,
    review_note: reviewNote || null,
  };
  const nextSignatureRequirements = existingRequirement
    ? signatureRequirements.map((requirement) =>
        String(requirement?.document_key ?? "") === documentKey
          ? nextRequirement
          : requirement,
      )
    : [...signatureRequirements, nextRequirement];
  const priorMissingFields = Array.isArray(pkg.missing_fields) ? pkg.missing_fields : [];
  const nextMissingFields = priorMissingFields.filter(
    (field) => String(field) !== requirementKey,
  );
  if (!satisfied) nextMissingFields.push(requirementKey);
  const missingDocuments = Array.isArray(pkg.missing_documents) ? pkg.missing_documents : [];
  const packageStatus = resolvePackageStatus({
    missingDocuments,
    missingFields: nextMissingFields,
    loadSummary:
      application.load_summary &&
      typeof application.load_summary === "object" &&
      !Array.isArray(application.load_summary)
        ? application.load_summary
        : null,
    hasLoadProfileDraft: Boolean(pkg.load_profile_application_id),
    addressReviewRequired: pkg.address_review_required === true,
  });
  const nextMetadata = {
    ...metadata,
    application_package: {
      ...pkg,
      package_status: packageStatus,
      missing_fields: nextMissingFields,
      signature_requirements: nextSignatureRequirements,
    },
  };
  const readinessRecomputeMs = Date.now() - readinessStartedAt;

  const writeStartedAt = Date.now();
  const { data, error } = await supabase
    .from("coordination_applications")
    .update({
      package_documents: nextDocuments,
      agent_draft_metadata: nextMetadata,
      ...(String(application.draft_status) === "reviewed"
        ? { draft_status: "needs_changes", reviewed_by: null, reviewed_at: null }
        : {}),
    })
    .eq("id", params.applicationId)
    .select("*")
    .single();
  const dbWriteMs = Date.now() - writeStartedAt;
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to update signature status"), {
      cause: error,
      statusCode: 500,
      code: "SIGNATURE_UPDATE_FAILED",
    });
  }

  const { withPackageReviewSummary } = require("./uci-package-review.service.js");
  return {
    application: withPackageReviewSummary(data),
    package_status: packageStatus,
    missing_documents: missingDocuments,
    missing_fields: nextMissingFields,
    package_documents: nextDocuments,
    document_key: documentKey,
    signature_status: signatureStatus,
    signature_verified_at:
      signatureStatus === "signed_manual_verified" ? verifiedAt : null,
    timings: {
      readiness_recompute_ms: readinessRecomputeMs,
      db_write_ms: dbWriteMs,
    },
  };
}

async function exportSyntheticChecklistPackage(supabase, params) {
  const application = await getApplicationById(supabase, params.applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const { pkg } = requireSyntheticChecklistApplication(application);
  const record = await getCoordinationRecordById(
    supabase,
    String(application.coordination_record_id),
  );
  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", String(application.project_id))
    .maybeSingle();
  if (error || !project) {
    const err = new Error(error?.message || "Project not found");
    err.statusCode = 404;
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }

  return {
    export_version: "uci-synthetic-checklist-export-v1",
    exported_at: new Date().toISOString(),
    read_only: true,
    label: SYNTHETIC_TEST_CHECKLIST_LABEL,
    authoritative: false,
    external_submission_allowed: false,
    lifecycle_advanced: false,
    project: {
      id: project.id,
      name: project.name ?? null,
      address: pkg.project_address ?? null,
      project_type: project.project_type ?? null,
    },
    coordination: {
      id: application.coordination_record_id,
      provider_slug: application.provider_slug,
      utility_type: record?.utility_type ?? null,
      current_stage: record?.current_stage ?? null,
      current_stage_state: record?.current_stage_state ?? null,
    },
    package: {
      application_id: application.id,
      template_id: pkg.template_id ?? null,
      checklist_mode: pkg.checklist_mode,
      checklist_status: pkg.synthetic_checklist?.status ?? "draft",
      package_status: pkg.package_status ?? null,
      missing_fields: pkg.missing_fields ?? [],
      missing_documents: pkg.missing_documents ?? [],
      field_results: pkg.field_results ?? [],
      signature_requirements: pkg.signature_requirements ?? [],
      documents: application.package_documents ?? [],
      verified_load_snapshot: pkg.verified_load_snapshot ?? {},
      review: pkg.last_review ?? null,
      validation: application.agent_draft_metadata?.submission ?? null,
    },
  };
}

module.exports = {
  applicationPackageMetadata,
  requireSyntheticChecklistApplication,
  approveSyntheticChecklist,
  setSyntheticSignatureStatus,
  exportSyntheticChecklistPackage,
};
