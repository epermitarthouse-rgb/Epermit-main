"use strict";

const {
  getApplicationById,
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
} = require("./uci-application-builder.service.js");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const { recordUserTransition } = require("./uci-transitions.service.js");

const SUBMIT_VERSION = "d4-v1";
const GENERATED_BY = "agent_4_submission";

/** Providers without portal submit automation use email-intent fallback. */
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

  if (String(application.draft_status) !== "reviewed") {
    return {
      ok: false,
      code: "REVIEW_REQUIRED",
      message: "Application must be reviewed before submission",
    };
  }

  if (application.submitted_at) {
    return {
      ok: false,
      code: "ALREADY_SUBMITTED",
      message: "Application has already been submitted",
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

  if (String(pkg.package_status) === "blocked") {
    return {
      ok: false,
      code: "PACKAGE_BLOCKED",
      message: "Application package is blocked and cannot be submitted",
    };
  }

  return { ok: true };
}

/**
 * @param {string} providerSlug
 * @returns {"portal" | "email_intent"}
 */
function resolveSubmissionMethod(providerSlug) {
  const slug = String(providerSlug ?? "").trim().toLowerCase();
  if (PORTAL_SUBMIT_ADAPTERS.has(slug)) {
    return "portal";
  }
  return "email_intent";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string} params.applicationId
 * @param {string} params.userId
 */
async function submitApplicationPackage(supabase, params) {
  const { applicationId, userId } = params;

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
  const record = await getCoordinationRecordById(supabase, coordinationRecordId);
  if (!record) {
    const err = new Error("Coordination record not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const providerSlug = String(application.provider_slug ?? "").trim().toLowerCase();
  const submissionMethod = resolveSubmissionMethod(providerSlug);

  if (submissionMethod === "portal") {
    const err = new Error(
      "PEPCO portal submission automation is not implemented — use email fallback utilities or wait for D4 adapter",
    );
    err.statusCode = 501;
    err.code = "SUBMIT_ADAPTER_NOT_IMPLEMENTED";
    throw err;
  }

  const submittedAt = new Date().toISOString();
  const metadata =
    application.agent_draft_metadata &&
    typeof application.agent_draft_metadata === "object" &&
    !Array.isArray(application.agent_draft_metadata)
      ? /** @type {Record<string, unknown>} */ (application.agent_draft_metadata)
      : {};

  const submissionMetadata = {
    version: SUBMIT_VERSION,
    method: submissionMethod,
    provider_slug: providerSlug || null,
    submitted_at: submittedAt,
    submitted_by_user_id: userId,
    generated_by: GENERATED_BY,
    confirmation: {
      status: "email_intent_recorded",
      utility_ticket_number: null,
      notes: [
        "D4 foundation — outbound email not sent automatically",
        "Human must send utility application email and capture confirmation",
      ],
    },
  };

  const updatedAgentMetadata = {
    ...metadata,
    submission: submissionMetadata,
  };

  const { data: updatedApp, error: updateErr } = await supabase
    .from("coordination_applications")
    .update({
      draft_status: "submitted",
      submission_method: submissionMethod,
      submitted_at: submittedAt,
      submitted_by: userId,
      agent_draft_metadata: updatedAgentMetadata,
    })
    .eq("id", applicationId)
    .select("*")
    .single();

  if (updateErr) {
    throw Object.assign(new Error(updateErr.message || "Failed to record submission"), {
      cause: updateErr,
      statusCode: 500,
      code: "SUBMIT_UPDATE_FAILED",
    });
  }

  const { record: updatedRecord, transition: stage4Transition } = await recordUserTransition(
    supabase,
    {
      coordinationRecordId,
      userId,
      toStage: 4,
      toState: "COMPLETED",
      reason: "Application submission recorded (email intent — D4 foundation)",
    },
  );

  const { record: finalRecord, transition: stage5Transition } = await recordUserTransition(
    supabase,
    {
      coordinationRecordId,
      userId,
      toStage: 5,
      toState: "AWAITING_UTILITY",
      reason: "Awaiting utility acknowledgment after submission intent",
    },
  );

  return {
    application: updatedApp,
    submission_method: submissionMethod,
    submission_metadata: submissionMetadata,
    coordination_record: finalRecord,
    transitions: [stage4Transition, stage5Transition],
    portal_adapter_used: false,
  };
}

module.exports = {
  SUBMIT_VERSION,
  GENERATED_BY,
  PORTAL_SUBMIT_ADAPTERS,
  validateSubmitEligibility,
  resolveSubmissionMethod,
  submitApplicationPackage,
};
