"use strict";

const {
  getApplicationById,
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
  SIGNATURE_STATUSES,
  resolvePackageStatus,
} = require("./uci-application-builder.service.js");
const {
  refreshApplicationPackageDocumentSlots,
} = require("./uci-package-document-bridge.service.js");
const {
  registerProjectDocument,
} = require("./uci-document-registry.service.js");

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

function requireApplicationPackage(application) {
  if (
    !application ||
    String(application.record_source) !== "agent_draft" ||
    String(application.idempotency_key) !== APPLICATION_PACKAGE_IDEMPOTENCY_KEY
  ) {
    const err = new Error("Application is not an Application Builder package");
    err.statusCode = 400;
    err.code = "NOT_APPLICATION_PACKAGE";
    throw err;
  }
  return applicationPackageMetadata(application);
}

/**
 * Generic package document signature verification — works for production templates
 * (e.g. Dominion LOA) and synthetic test checklists.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function setPackageDocumentSignatureStatus(supabase, params) {
  const application =
    params.application ?? (await getApplicationById(supabase, params.applicationId));
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  if (String(application.draft_status) === "reviewed") {
    throw Object.assign(new Error("Reopen review before changing signature verification"), {
      statusCode: 409,
      code: "PACKAGE_REVIEW_LOCKED",
    });
  }
  requireApplicationPackage(application);

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
  if (!satisfied && !nextMissingFields.includes(requirementKey)) {
    nextMissingFields.push(requirementKey);
  }
  const missingDocuments = Array.isArray(pkg.missing_documents) ? pkg.missing_documents : [];
  const packageStatus = resolvePackageStatus({
    missingDocuments,
    missingFields: nextMissingFields,
    loadSummary: null,
    hasLoadProfileDraft: true,
    addressReviewRequired: false,
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

  const dbWriteStartedAt = Date.now();
  const { error } = await supabase
    .from("coordination_applications")
    .update({
      package_documents: nextDocuments,
      agent_draft_metadata: nextMetadata,
    })
    .eq("id", params.applicationId);
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to update signature status"), {
      cause: error,
      statusCode: 500,
      code: "SIGNATURE_UPDATE_FAILED",
    });
  }

  const projectDocumentId =
    target.project_document_id != null ? String(target.project_document_id) : null;
  if (
    projectDocumentId &&
    application.coordination_record_id &&
    signatureStatus === "signed_manual_verified"
  ) {
    try {
      await registerProjectDocument(supabase, {
        coordinationRecordId: String(application.coordination_record_id),
        projectDocumentId,
        provenance: "loa_signed",
        hintRole: "letter_of_authorization",
        userId: params.userId,
      });
      await supabase
        .from("uci_document_registry_entries")
        .update({ signature_status: "signed_manual_verified" })
        .eq("coordination_record_id", String(application.coordination_record_id))
        .eq("project_document_id", projectDocumentId);
    } catch (registryErr) {
      console.warn("[uci-package-signature] registry update failed", registryErr);
    }
  }

  const refreshed = await refreshApplicationPackageDocumentSlots(supabase, {
    applicationId: params.applicationId,
    userId: params.userId,
    packageDocumentsSeed: nextDocuments,
  });

  return {
    ...refreshed,
    document_key: documentKey,
    signature_status: signatureStatus,
    timings: {
      readiness_recompute_ms: Date.now() - readinessStartedAt,
      db_write_ms: Date.now() - dbWriteStartedAt,
    },
  };
}

module.exports = {
  setPackageDocumentSignatureStatus,
};
