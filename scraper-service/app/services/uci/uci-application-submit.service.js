"use strict";

const {
  getApplicationById,
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
} = require("./uci-application-builder.service.js");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const { recordUserTransition } = require("./uci-transitions.service.js");
const {
  isPepcoLiveSubmissionEnabled,
  runPepcoValidationDryRun,
  runPepcoPortalSubmissionOnPage,
} = require("./uci-pepco-submission.service.js");
const { sendUtilitySubmissionEmail, EMAIL_SUBMIT_VERSION } = require("./uci-email-submission.service.js");

const SUBMIT_VERSION = "d4-v1";
const GENERATED_BY = "agent_4_submission";

/** Providers with portal submit automation. */
const PORTAL_SUBMIT_ADAPTERS = new Set(["pepco"]);

/**
 * @param {Record<string, unknown>} application
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
function validateSubmitEligibility(application) {
  if (String(application.record_source) !== "agent_draft") {
    return {
      ok: false,
      code: "NOT_AGENT_DRAFT",
      message: "Only agent draft applications can be submitted",
    };
  }

  if (String(application.idempotency_key) !== APPLICATION_PACKAGE_IDEMPOTENCY_KEY) {
    return {
      ok: false,
      code: "NOT_APPLICATION_PACKAGE",
      message: "Application is not an Agent 3 application package draft",
    };
  }

  if (application.submitted_at) {
    return {
      ok: false,
      code: "ALREADY_SUBMITTED",
      message: "Application has already been submitted",
    };
  }

  if (String(application.draft_status) !== "reviewed") {
    return {
      ok: false,
      code: "REVIEW_REQUIRED",
      message: "Application must be reviewed before submission",
    };
  }

  const metadata =
    application.agent_draft_metadata &&
    typeof application.agent_draft_metadata === "object" &&
    !Array.isArray(application.agent_draft_metadata)
      ? /** @type {Record<string, unknown>} */ (application.agent_draft_metadata)
      : {};
  const pkg =
    metadata.application_package &&
    typeof metadata.application_package === "object" &&
    !Array.isArray(metadata.application_package)
      ? /** @type {Record<string, unknown>} */ (metadata.application_package)
      : {};

  if (String(pkg.package_status) !== "ready_for_review") {
    return {
      ok: false,
      code: "PACKAGE_NOT_READY",
      message: "Application package must be ready_for_review before validation or submission",
    };
  }

  const priorSubmission =
    metadata.submission &&
    typeof metadata.submission === "object" &&
    !Array.isArray(metadata.submission)
      ? /** @type {Record<string, unknown>} */ (metadata.submission)
      : null;

  if (
    priorSubmission &&
    String(priorSubmission.confirmation_status) === "confirmed" &&
    priorSubmission.submitted_at
  ) {
    return {
      ok: false,
      code: "ALREADY_SUBMITTED",
      message: "Application submission is already confirmed",
    };
  }

  return { ok: true };
}

async function runSyntheticChecklistValidationDryRun(supabase, params) {
  const { application, userId } = params;
  const metadata =
    application.agent_draft_metadata &&
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
  const generatedAt = new Date().toISOString();
  const fieldResults = Array.isArray(pkg.field_results) ? pkg.field_results : [];
  const documents = Array.isArray(application.package_documents)
    ? application.package_documents
    : [];
  const validationErrors = [
    ...(Array.isArray(pkg.missing_fields) ? pkg.missing_fields : []),
    ...(Array.isArray(pkg.missing_documents) ? pkg.missing_documents : []),
  ];
  const submissionMetadata = {
    version: SUBMIT_VERSION,
    method: "validation_only",
    provider_slug: String(application.provider_slug ?? ""),
    generated_by: GENERATED_BY,
    generated_at: generatedAt,
    submitted_by_user_id: userId,
    dry_run: true,
    validation_only: true,
    synthetic_test: true,
    checklist_label: pkg.checklist_label ?? "SYNTHETIC TEST CHECKLIST — NOT DOMINION PROVIDED",
    confirmation_status: "dry_run",
    external_side_effects: {
      email_sent: false,
      portal_touched: false,
      live_submission_attempted: false,
      lifecycle_advanced: false,
    },
    validation: {
      ok: validationErrors.length === 0 && String(pkg.package_status) === "ready_for_review",
      package_status: pkg.package_status ?? null,
      field_count: fieldResults.length,
      attached_document_count: documents.filter((doc) => doc.status === "attached").length,
      signature_requirements: pkg.signature_requirements ?? [],
      validation_errors: validationErrors,
    },
  };

  await persistSubmissionAttempt(supabase, {
    applicationId: String(application.id),
    application,
    metadata,
    submissionMetadata,
  });

  return {
    status: "validation_passed",
    reason: "synthetic_dominion_validation_only",
    submission_method: "validation_only",
    dry_run: true,
    validation_only: true,
    lifecycle_advanced: false,
    external_side_effects: submissionMetadata.external_side_effects,
    application,
    submission_metadata: submissionMetadata,
    message:
      "Synthetic checklist validation passed. No email was sent, no portal was touched, and lifecycle was not advanced.",
  };
}

/**
 * @param {string} providerSlug
 * @returns {"portal" | "email"}
 */
function resolveSubmissionMethod(providerSlug) {
  const slug = String(providerSlug ?? "").trim().toLowerCase();
  if (PORTAL_SUBMIT_ADAPTERS.has(slug)) {
    return "portal";
  }
  return "email";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.applicationId
 * @param {Record<string, unknown>} params.application
 * @param {Record<string, unknown>} params.metadata
 * @param {Record<string, unknown>} params.submissionMetadata
 */
async function persistSubmissionAttempt(supabase, params) {
  const { applicationId, metadata, submissionMetadata } = params;
  const updatedAgentMetadata = {
    ...metadata,
    submission: submissionMetadata,
  };

  const patch = {
    agent_draft_metadata: updatedAgentMetadata,
  };

  if (submissionMetadata.confirmation_status === "confirmed") {
    Object.assign(patch, {
      draft_status: "submitted",
      submission_method: submissionMetadata.method,
      submitted_at: submissionMetadata.submitted_at,
      submitted_by: submissionMetadata.submitted_by_user_id,
      utility_ticket_number: submissionMetadata.utility_ticket_number ?? null,
      last_error: null,
    });
  } else if (submissionMetadata.confirmation_status === "failed") {
    Object.assign(patch, {
      last_error: submissionMetadata.failure_message ?? "Submission failed",
    });
  }

  const { data, error } = await supabase
    .from("coordination_applications")
    .update(patch)
    .eq("id", applicationId)
    .select("*")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to persist submission attempt"), {
      cause: error,
      statusCode: 500,
      code: "SUBMIT_UPDATE_FAILED",
    });
  }

  return data;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function advanceLifecycleAfterConfirmedSubmission(supabase, params) {
  const { coordinationRecordId, userId, submissionMethod, reasonSuffix } = params;

  const { record: updatedRecord, transition: stage4Transition } = await recordUserTransition(
    supabase,
    {
      coordinationRecordId,
      userId,
      toStage: 4,
      toState: "COMPLETED",
      reason: `Application submission confirmed (${submissionMethod}${reasonSuffix ? ` — ${reasonSuffix}` : ""})`,
    },
  );

  const { record: finalRecord, transition: stage5Transition } = await recordUserTransition(
    supabase,
    {
      coordinationRecordId,
      userId,
      toStage: 5,
      toState: "AWAITING_UTILITY",
      reason: "Awaiting utility acknowledgment after confirmed submission",
    },
  );

  return {
    coordination_record: finalRecord,
    transitions: [stage4Transition, stage5Transition],
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {Record<string, unknown>} params.application
 * @param {Record<string, unknown>} params.project
 * @param {Record<string, unknown>} params.record
 * @param {string} params.userId
 * @param {Record<string, unknown>} [params.options]
 * @param {Record<string, unknown>} [params.deps]
 */
async function submitViaPepcoPortal(supabase, params) {
  const { application, project, record, userId, options = {}, deps = {} } = params;
  const providerSlug = String(application.provider_slug ?? "pepco").toLowerCase();
  const metadata =
    application.agent_draft_metadata &&
    typeof application.agent_draft_metadata === "object" &&
    !Array.isArray(application.agent_draft_metadata)
      ? /** @type {Record<string, unknown>} */ (application.agent_draft_metadata)
      : {};

  const liveConfirmed = options.live_submission_confirmed === true;
  const portalPopulate = options.portal_populate === true;
  const liveEnabled = isPepcoLiveSubmissionEnabled();

  if (liveConfirmed && !liveEnabled) {
    const err = new Error(
      "Live PEPCO submission is disabled — set UCI_PEPCO_LIVE_SUBMISSION_ENABLED=true to enable",
    );
    err.statusCode = 403;
    err.code = "LIVE_SUBMISSION_DISABLED";
    throw err;
  }

  if (liveConfirmed && !portalPopulate) {
    const err = new Error(
      "Live PEPCO submission requires portal_populate=true and explicit live_submission_confirmed=true",
    );
    err.statusCode = 400;
    err.code = "LIVE_CONFIRMATION_INCOMPLETE";
    throw err;
  }

  /** @type {Record<string, unknown>} */
  let portalOutcome;

  if (portalPopulate && deps.page) {
    portalOutcome = await runPepcoPortalSubmissionOnPage({
      page: deps.page,
      application,
      project,
      liveSubmissionConfirmed: liveConfirmed,
      uploadFn: deps.uploadFn,
    });
  } else if (portalPopulate && typeof deps.runBrowserPopulate === "function") {
    portalOutcome = await deps.runBrowserPopulate({
      application,
      project,
      liveSubmissionConfirmed: liveConfirmed,
    });
  } else {
    portalOutcome = runPepcoValidationDryRun({ application, project });
  }

  if (portalOutcome.ok === false && portalOutcome.code) {
    const err = new Error(portalOutcome.message || "PEPCO submission validation failed");
    err.statusCode = portalOutcome.code === "SUBMISSION_VALIDATION_FAILED" ? 400 : 500;
    err.code = portalOutcome.code;
    err.details = {
      validation_errors: portalOutcome.validation_errors,
      missing_fields: portalOutcome.missing_fields,
      missing_attachments: portalOutcome.missing_attachments,
    };
    throw err;
  }

  const generatedAt = new Date().toISOString();
  const isConfirmed =
    portalOutcome.status === "confirmed" ||
    (portalOutcome.confirmation &&
      typeof portalOutcome.confirmation === "object" &&
      /** @type {{ ticket_number?: unknown }} */ (portalOutcome.confirmation).ticket_number);

  if (!isConfirmed) {
    const dryRunMetadata = {
      version: SUBMIT_VERSION,
      method: "portal",
      provider_slug: providerSlug,
      generated_by: GENERATED_BY,
      generated_at: generatedAt,
      submitted_by_user_id: userId,
      dry_run: true,
      live_submission_enabled: liveEnabled,
      live_submission_confirmed: liveConfirmed,
      portal_populate: portalPopulate,
      confirmation_status: "dry_run",
      portal_outcome: {
        status: portalOutcome.status,
        reason: portalOutcome.reason,
        fields_to_submit: portalOutcome.fields_to_submit,
        attachments_to_submit: portalOutcome.attachments_to_submit,
        missing_fields: portalOutcome.missing_fields,
        missing_attachments: portalOutcome.missing_attachments,
        validation_errors: portalOutcome.validation_errors,
        populated_fields: portalOutcome.populated_fields,
        uploaded_attachments: portalOutcome.uploaded_attachments,
        would_submit: portalOutcome.would_submit,
        evidence: portalOutcome.evidence
          ? {
              captured_at: portalOutcome.evidence.captured_at,
              url: portalOutcome.evidence.url,
              html_length:
                portalOutcome.evidence.html != null
                  ? String(portalOutcome.evidence.html).length
                  : 0,
              has_screenshot: Boolean(portalOutcome.evidence.screenshot_base64),
            }
          : null,
      },
    };

    await persistSubmissionAttempt(supabase, {
      applicationId: String(application.id),
      application,
      metadata,
      submissionMetadata: dryRunMetadata,
    });

    return {
      status: portalOutcome.status || "human_required",
      reason: portalOutcome.reason || "pepco_dry_run",
      submission_method: "portal",
      dry_run: true,
      live_submission_enabled: liveEnabled,
      application: application,
      submission_metadata: dryRunMetadata,
      fields_to_submit: portalOutcome.fields_to_submit,
      attachments_to_submit: portalOutcome.attachments_to_submit,
      validation_errors: portalOutcome.validation_errors,
      missing_fields: portalOutcome.missing_fields,
      missing_attachments: portalOutcome.missing_attachments,
      portal_adapter_used: portalPopulate,
      lifecycle_advanced: false,
      message: portalOutcome.message,
    };
  }

  const confirmation =
    portalOutcome.confirmation && typeof portalOutcome.confirmation === "object"
      ? /** @type {Record<string, unknown>} */ (portalOutcome.confirmation)
      : {};
  const ticketNumber =
    confirmation.ticket_number != null ? String(confirmation.ticket_number) : null;

  const submissionMetadata = {
    version: SUBMIT_VERSION,
    method: "portal",
    provider_slug: providerSlug,
    submitted_at: generatedAt,
    submitted_by_user_id: userId,
    generated_by: GENERATED_BY,
    confirmation_status: "confirmed",
    utility_ticket_number: ticketNumber,
    external_application_reference:
      confirmation.application_reference != null
        ? String(confirmation.application_reference)
        : null,
    submitted_field_snapshot: portalOutcome.fields_to_submit,
    submitted_attachments_snapshot: portalOutcome.attachments_to_submit,
    evidence: portalOutcome.evidence
      ? {
          captured_at: portalOutcome.evidence.captured_at,
          url: portalOutcome.evidence.url,
          html_excerpt:
            portalOutcome.evidence.html != null
              ? String(portalOutcome.evidence.html).slice(0, 4000)
              : null,
          screenshot_base64: portalOutcome.evidence.screenshot_base64 ?? null,
        }
      : null,
    portal_outcome: {
      status: portalOutcome.status,
      reason: portalOutcome.reason,
      final_submit_clicked: portalOutcome.final_submit_clicked === true,
    },
  };

  const updatedApp = await persistSubmissionAttempt(supabase, {
    applicationId: String(application.id),
    application,
    metadata,
    submissionMetadata,
  });

  const lifecycle = await advanceLifecycleAfterConfirmedSubmission(supabase, {
    coordinationRecordId: String(record.id),
    userId,
    submissionMethod: "portal",
    reasonSuffix: ticketNumber ? `ticket ${ticketNumber}` : undefined,
  });

  return {
    status: "confirmed",
    submission_method: "portal",
    dry_run: false,
    application: updatedApp,
    submission_metadata: submissionMetadata,
    utility_ticket_number: ticketNumber,
    coordination_record: lifecycle.coordination_record,
    transitions: lifecycle.transitions,
    portal_adapter_used: true,
    lifecycle_advanced: true,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function submitViaEmail(supabase, params) {
  const { application, project, record, userId, deps = {} } = params;
  const providerSlug = String(application.provider_slug ?? "").trim().toLowerCase() || "utility";
  const metadata =
    application.agent_draft_metadata &&
    typeof application.agent_draft_metadata === "object" &&
    !Array.isArray(application.agent_draft_metadata)
      ? /** @type {Record<string, unknown>} */ (application.agent_draft_metadata)
      : {};

  const emailResult = await sendUtilitySubmissionEmail(supabase, {
    application,
    project,
    userId,
    providerSlug,
    sendMailFn: deps.sendMailFn,
    resolveAttachmentsFn: deps.resolveAttachmentsFn,
    getAccessTokenFn: deps.getAccessTokenFn,
  });

  const generatedAt = new Date().toISOString();

  if (!emailResult.ok) {
    const failureMetadata = {
      version: SUBMIT_VERSION,
      method: "email",
      email_version: EMAIL_SUBMIT_VERSION,
      provider_slug: providerSlug,
      generated_at: generatedAt,
      submitted_by_user_id: userId,
      generated_by: GENERATED_BY,
      confirmation_status: emailResult.status === "human_required" ? "human_required" : "failed",
      failure_code: emailResult.code,
      failure_message: emailResult.message,
      retryable: emailResult.retryable === true,
    };

    if (emailResult.status === "human_required") {
      await persistSubmissionAttempt(supabase, {
        applicationId: String(application.id),
        application,
        metadata,
        submissionMetadata: failureMetadata,
      });

      return {
        status: "human_required",
        reason: emailResult.code || "mailbox_not_connected",
        submission_method: "email",
        dry_run: false,
        application,
        submission_metadata: failureMetadata,
        lifecycle_advanced: false,
        message: emailResult.message,
      };
    }

    await persistSubmissionAttempt(supabase, {
      applicationId: String(application.id),
      application,
      metadata,
      submissionMetadata: failureMetadata,
    });

    const err = new Error(emailResult.message || "Email submission failed");
    err.statusCode = 502;
    err.code = emailResult.code || "EMAIL_SEND_FAILED";
    err.details = { retryable: emailResult.retryable === true };
    throw err;
  }

  const submissionMetadata = {
    version: SUBMIT_VERSION,
    method: "email",
    email_version: EMAIL_SUBMIT_VERSION,
    provider_slug: providerSlug,
    submitted_at: generatedAt,
    submitted_by_user_id: userId,
    generated_by: GENERATED_BY,
    confirmation_status: "confirmed",
    utility_ticket_number: null,
    email: {
      message_id: emailResult.message_id,
      subject: emailResult.subject,
      attachment_count: emailResult.attachment_count,
      referenced_documents: emailResult.referenced_documents,
    },
  };

  const updatedApp = await persistSubmissionAttempt(supabase, {
    applicationId: String(application.id),
    application,
    metadata,
    submissionMetadata,
  });

  const lifecycle = await advanceLifecycleAfterConfirmedSubmission(supabase, {
    coordinationRecordId: String(record.id),
    userId,
    submissionMethod: "email",
    reasonSuffix: emailResult.message_id ? `message ${emailResult.message_id}` : undefined,
  });

  return {
    status: "confirmed",
    submission_method: "email",
    dry_run: false,
    application: updatedApp,
    submission_metadata: submissionMetadata,
    coordination_record: lifecycle.coordination_record,
    transitions: lifecycle.transitions,
    portal_adapter_used: false,
    lifecycle_advanced: true,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.applicationId
 * @param {string} params.userId
 * @param {Record<string, unknown>} [params.options]
 * @param {Record<string, unknown>} [params.deps]
 */
async function submitApplicationPackage(supabase, params) {
  const { applicationId, userId, options = {}, deps = {} } = params;

  const application = await getApplicationById(supabase, applicationId);
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const eligibility = validateSubmitEligibility(application);
  if (!eligibility.ok) {
    const err = new Error(eligibility.message);
    err.statusCode = 400;
    err.code = eligibility.code;
    throw err;
  }

  const coordinationRecordId = String(application.coordination_record_id);
  const projectId = String(application.project_id);

  const [record, projectResult] = await Promise.all([
    getCoordinationRecordById(supabase, coordinationRecordId),
    supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
  ]);

  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  if (projectResult.error || !projectResult.data) {
    const err = new Error("Project not found");
    err.statusCode = 404;
    err.code = "PROJECT_NOT_FOUND";
    throw err;
  }

  const providerSlug = String(application.provider_slug ?? "").trim().toLowerCase();
  const packageMeta =
    application.agent_draft_metadata?.application_package &&
    typeof application.agent_draft_metadata.application_package === "object"
      ? application.agent_draft_metadata.application_package
      : {};
  if (
    providerSlug === "dominion" &&
    String(packageMeta.checklist_mode ?? "") === "synthetic_test" &&
    packageMeta.authoritative_requirements === false
  ) {
    return runSyntheticChecklistValidationDryRun(supabase, {
      application,
      userId,
    });
  }
  const submissionMethod = resolveSubmissionMethod(providerSlug);

  if (submissionMethod === "portal") {
    return submitViaPepcoPortal(supabase, {
      application,
      project: projectResult.data,
      record,
      userId,
      options,
      deps,
    });
  }

  return submitViaEmail(supabase, {
    application,
    project: projectResult.data,
    record,
    userId,
    deps,
  });
}

module.exports = {
  SUBMIT_VERSION,
  GENERATED_BY,
  PORTAL_SUBMIT_ADAPTERS,
  validateSubmitEligibility,
  resolveSubmissionMethod,
  submitApplicationPackage,
  submitViaPepcoPortal,
  submitViaEmail,
  runSyntheticChecklistValidationDryRun,
  persistSubmissionAttempt,
  advanceLifecycleAfterConfirmedSubmission,
  isPepcoLiveSubmissionEnabled,
};
