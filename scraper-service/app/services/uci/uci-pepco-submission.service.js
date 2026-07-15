"use strict";

const fs = require("fs");
const path = require("path");
const { resolveAddressFromApplicationPackageSnapshot } = require("./uci-provider-setup.service.js");
const {
  buildSubmissionContext,
  runPepcoSubmissionOnPage,
} = require("../../../scrapers/pepco/submit-flow.js");

const SUBMISSION_MAPPINGS_ROOT = path.resolve(
  __dirname,
  "../../../../uci/application-templates/pepco",
);

/**
 * Live PEPCO portal submission is disabled by default.
 * Set UCI_PEPCO_LIVE_SUBMISSION_ENABLED=true only in controlled production environments.
 *
 * @returns {boolean}
 */
function isPepcoLiveSubmissionEnabled() {
  return process.env.UCI_PEPCO_LIVE_SUBMISSION_ENABLED === "true";
}

/**
 * @param {string} applicationType
 * @returns {Record<string, unknown> | null}
 */
function loadPepcoSubmissionMappings(applicationType = "new_service") {
  const filePath = path.join(SUBMISSION_MAPPINGS_ROOT, "submission-field-mappings.json");
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return /** @type {Record<string, unknown>} */ (parsed);
  } catch {
    return null;
  }
}

/**
 * @param {object} params
 * @param {Record<string, unknown>} params.application
 * @param {Record<string, unknown>} params.project
 */
function preparePepcoSubmissionContext(params) {
  const { application, project } = params;
  const applicationType = String(application.application_type ?? "new_service");
  const mapping = loadPepcoSubmissionMappings(applicationType);
  if (!mapping) {
    return {
      ok: false,
      code: "SUBMISSION_MAPPING_NOT_FOUND",
      message: "PEPCO submission field mappings are not available",
    };
  }

  const loadSummary =
    application.load_summary &&
    typeof application.load_summary === "object" &&
    !Array.isArray(application.load_summary)
      ? /** @type {Record<string, unknown>} */ (application.load_summary)
      : null;

  const packageDocuments = Array.isArray(application.package_documents)
    ? /** @type {Array<Record<string, unknown>>} */ (application.package_documents)
    : [];

  const context = buildSubmissionContext({
    project,
    loadSummary,
    packageDocuments,
    mapping,
    applicationType,
    resolveAddress: (proj) =>
      resolveAddressFromApplicationPackageSnapshot(application, proj)?.formatted || null,
  });

  if (!context.ok) {
    return context;
  }

  return {
    ok: true,
    context,
    mapping_version: context.mapping_version,
  };
}

/**
 * Validation-only dry run — no browser launched.
 *
 * @param {object} params
 * @param {Record<string, unknown>} params.application
 * @param {Record<string, unknown>} params.project
 */
function runPepcoValidationDryRun(params) {
  const prepared = preparePepcoSubmissionContext(params);
  if (!prepared.ok) {
    return prepared;
  }

  const ctx = prepared.context;
  return {
    ok: true,
    status: "human_required",
    reason: ctx.ready ? "pepco_dry_run_ready" : "pepco_validation_errors",
    dry_run: true,
    live_submission_enabled: isPepcoLiveSubmissionEnabled(),
    mapping_version: ctx.mapping_version,
    application_type: ctx.application_type,
    fields_to_submit: ctx.fields,
    attachments_to_submit: ctx.attachments,
    missing_fields: ctx.missing_fields,
    missing_attachments: ctx.missing_attachments,
    validation_errors: ctx.validation_errors,
    ready_for_portal_populate: ctx.ready,
    message: ctx.ready
      ? "Validation passed. Portal populate/submit requires explicit live confirmation and UCI_PEPCO_LIVE_SUBMISSION_ENABLED=true."
      : "Submission blocked — resolve missing fields and attachments before portal populate.",
  };
}

/**
 * Browser dry-run or live submit on an injectable Playwright page (tests / manual orchestration).
 *
 * @param {object} params
 * @param {import("playwright").Page} params.page
 * @param {Record<string, unknown>} params.application
 * @param {Record<string, unknown>} params.project
 * @param {boolean} [params.liveSubmissionConfirmed]
 * @param {(selector: string, fileName: string) => Promise<{ ok: boolean, error?: string }>} [params.uploadFn]
 */
async function runPepcoPortalSubmissionOnPage(params) {
  const { page, application, project, liveSubmissionConfirmed = false, uploadFn } = params;

  const prepared = preparePepcoSubmissionContext({ application, project });
  if (!prepared.ok) {
    return prepared;
  }

  const ctx = prepared.context;
  if (!ctx.ready) {
    return {
      ok: false,
      code: "SUBMISSION_VALIDATION_FAILED",
      message: "Submission validation failed — missing required fields or attachments",
      validation_errors: ctx.validation_errors,
      missing_fields: ctx.missing_fields,
      missing_attachments: ctx.missing_attachments,
    };
  }

  const allowFinalSubmit = isPepcoLiveSubmissionEnabled() && liveSubmissionConfirmed === true;
  const outcome = await runPepcoSubmissionOnPage(page, ctx, {
    allowFinalSubmit,
    uploadFn,
  });

  return {
    ok: true,
    ...outcome,
    live_submission_enabled: isPepcoLiveSubmissionEnabled(),
    live_submission_confirmed: liveSubmissionConfirmed,
    mapping_version: ctx.mapping_version,
    fields_to_submit: ctx.fields,
    attachments_to_submit: ctx.attachments,
  };
}

module.exports = {
  isPepcoLiveSubmissionEnabled,
  loadPepcoSubmissionMappings,
  preparePepcoSubmissionContext,
  runPepcoValidationDryRun,
  runPepcoPortalSubmissionOnPage,
};
