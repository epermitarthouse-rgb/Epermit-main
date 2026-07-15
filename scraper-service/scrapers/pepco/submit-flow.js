"use strict";

/**
 * PEPCO portal submission flow helpers (D4).
 * Supports mocked/synthetic pages in tests — never assumes live portal connectivity.
 */

const DEFAULT_SUBMIT_BUTTON_SELECTOR = "#pepco-final-submit";
const DEFAULT_CONFIRMATION_TICKET_SELECTOR = "#pepco-confirmation-ticket";

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeApplicationType(value) {
  return String(value ?? "new_service").trim().toLowerCase() || "new_service";
}

/**
 * @param {Record<string, unknown>} project
 * @param {import("../../app/services/uci/uci-provider-setup.service.js")} providerSetup
 */
function resolveProjectAddress(project, resolveProjectAddressForProviderSetup) {
  const address = resolveProjectAddressForProviderSetup(project);
  return address.formatted || null;
}

/**
 * @param {object} params
 * @param {Record<string, unknown>} params.project
 * @param {Record<string, unknown> | null} params.loadSummary
 * @param {Array<Record<string, unknown>>} params.packageDocuments
 * @param {Record<string, unknown>} params.mapping
 * @param {string} params.applicationType
 * @param {(project: Record<string, unknown>) => { formatted?: string | null }} params.resolveAddress
 */
function buildSubmissionContext(params) {
  const {
    project,
    loadSummary,
    packageDocuments,
    mapping,
    applicationType,
    resolveAddress,
  } = params;

  const appTypes =
    mapping.application_types &&
    typeof mapping.application_types === "object" &&
    !Array.isArray(mapping.application_types)
      ? /** @type {Record<string, unknown>} */ (mapping.application_types)
      : {};

  const typeKey = normalizeApplicationType(applicationType);
  const typeMapping =
    appTypes[typeKey] && typeof appTypes[typeKey] === "object" && !Array.isArray(appTypes[typeKey])
      ? /** @type {Record<string, unknown>} */ (appTypes[typeKey])
      : null;

  if (!typeMapping) {
    return {
      ok: false,
      code: "SUBMISSION_MAPPING_NOT_FOUND",
      message: `No PEPCO submission mapping for application type ${typeKey}`,
    };
  }

  const address = resolveAddress(project);
  const { getVerifiedValuesForPackage, isConnectedLoadDataSatisfied } = require("../../app/services/uci/uci-load-candidate.service.js");
  const verified = getVerifiedValuesForPackage(loadSummary);
  const calculated =
    loadSummary &&
    typeof loadSummary === "object" &&
    !Array.isArray(loadSummary) &&
    loadSummary.calculated_values &&
    typeof loadSummary.calculated_values === "object" &&
    !Array.isArray(loadSummary.calculated_values)
      ? /** @type {Record<string, unknown>} */ (loadSummary.calculated_values)
      : {};

  const calculatedKeys = Object.keys(calculated).filter((k) => {
    const v = calculated[k];
    return v != null && v !== "";
  });
  const verifiedKeys = Object.keys(verified).filter((k) => {
    const v = verified[k];
    return v != null && v !== "";
  });

  /** @type {Array<Record<string, unknown>>} */
  const fields = [];
  /** @type {string[]} */
  const missingFields = [];
  /** @type {Array<Record<string, unknown>>} */
  const validationErrors = [];

  const fieldDefs = Array.isArray(typeMapping.fields)
    ? /** @type {Array<Record<string, unknown>>} */ (typeMapping.fields)
    : [];

  for (const def of fieldDefs) {
    const key = String(def.key ?? "");
    const label = String(def.label ?? key);
    const source = String(def.source ?? "");
    const required = def.required !== false;
    let value = null;
    let present = false;

    if (source === "project.address") {
      value = address;
      present = Boolean(value);
    } else if (source === "project.project_type") {
      value = project.project_type ?? null;
      present = Boolean(value);
    } else if (source === "project.description") {
      value = project.description ?? null;
      present = Boolean(value);
    } else if (
      source === "load_summary.calculated_values" ||
      source === "load_summary.verified_values"
    ) {
      if (key === "connected_load_data") {
        value = isConnectedLoadDataSatisfied(loadSummary) ? verified : null;
        present = isConnectedLoadDataSatisfied(loadSummary);
      } else {
        value = verifiedKeys.length ? verified : calculatedKeys.length ? calculated : null;
        present = verifiedKeys.length > 0 || calculatedKeys.length > 0;
      }
    }

    const entry = {
      key,
      label,
      portal_key: def.portal_key != null ? String(def.portal_key) : key,
      portal_selector: def.portal_selector != null ? String(def.portal_selector) : null,
      source,
      required,
      value,
      present,
      note: def.note != null ? String(def.note) : undefined,
    };
    fields.push(entry);

    if (required && !present) {
      missingFields.push(key);
      validationErrors.push({
        type: "missing_field",
        key,
        label,
        message: `Required field "${label}" is missing`,
      });
    }
  }

  /** @type {Array<Record<string, unknown>>} */
  const attachments = [];
  /** @type {string[]} */
  const missingAttachments = [];

  const attachmentDefs = Array.isArray(typeMapping.attachments)
    ? /** @type {Array<Record<string, unknown>>} */ (typeMapping.attachments)
    : [];

  const docsByKey = new Map();
  for (const doc of packageDocuments) {
    const docKey = String(doc.key ?? "");
    if (docKey) docsByKey.set(docKey, doc);
  }

  for (const def of attachmentDefs) {
    const key = String(def.key ?? "");
    const label = String(def.label ?? key);
    const packageKey = String(def.package_document_key ?? key);
    const required = def.required !== false;
    const matched = docsByKey.get(packageKey);
    const attached = matched && String(matched.status) === "attached";

    const entry = {
      key,
      label,
      portal_key: def.portal_key != null ? String(def.portal_key) : key,
      portal_selector: def.portal_selector != null ? String(def.portal_selector) : null,
      package_document_key: packageKey,
      required,
      status: attached ? "attached" : "missing",
      project_document_id:
        attached && matched?.project_document_id != null
          ? String(matched.project_document_id)
          : null,
      file_name: attached && matched?.file_name != null ? String(matched.file_name) : null,
      document_type:
        attached && matched?.document_type != null ? String(matched.document_type) : null,
    };
    attachments.push(entry);

    if (required && !attached) {
      missingAttachments.push(key);
      validationErrors.push({
        type: "missing_attachment",
        key,
        label,
        message: `Required attachment "${label}" is missing`,
      });
    }
  }

  return {
    ok: true,
    mapping_version: String(mapping.version ?? "unknown"),
    application_type: typeKey,
    portal_form_path:
      typeMapping.portal_form_path != null ? String(typeMapping.portal_form_path) : null,
    submit_button_selector:
      typeMapping.submit_button_selector != null
        ? String(typeMapping.submit_button_selector)
        : DEFAULT_SUBMIT_BUTTON_SELECTOR,
    confirmation_ticket_selector:
      typeMapping.confirmation_ticket_selector != null
        ? String(typeMapping.confirmation_ticket_selector)
        : DEFAULT_CONFIRMATION_TICKET_SELECTOR,
    fields,
    attachments,
    missing_fields: missingFields,
    missing_attachments: missingAttachments,
    validation_errors: validationErrors,
    ready: missingFields.length === 0 && missingAttachments.length === 0,
  };
}

/**
 * @param {import("playwright").Page} page
 * @param {Record<string, unknown>} context
 */
async function populatePepcoSubmissionForm(page, context) {
  const fields = Array.isArray(context.fields) ? context.fields : [];
  /** @type {Array<Record<string, unknown>>} */
  const populated = [];

  for (const field of fields) {
    const selector = field.portal_selector != null ? String(field.portal_selector) : "";
    if (!selector) continue;
    const value = field.value;
    if (value == null) continue;

    const textValue =
      typeof value === "object" && !Array.isArray(value)
        ? JSON.stringify(value)
        : String(value);

    const el = page.locator(selector).first();
    const count = await el.count();
    if (!count) {
      populated.push({
        key: field.key,
        portal_selector: selector,
        status: "selector_not_found",
      });
      continue;
    }

    await el.fill(textValue);
    populated.push({
      key: field.key,
      portal_selector: selector,
      status: "populated",
      value_preview: textValue.slice(0, 200),
    });
  }

  return populated;
}

/**
 * @param {import("playwright").Page} page
 * @param {Record<string, unknown>} context
 * @param {(selector: string, filePath: string) => Promise<{ ok: boolean, file_name?: string, error?: string }>} uploadFn
 */
async function uploadPepcoSubmissionAttachments(page, context, uploadFn) {
  const attachments = Array.isArray(context.attachments) ? context.attachments : [];
  /** @type {Array<Record<string, unknown>>} */
  const results = [];

  for (const attachment of attachments) {
    if (String(attachment.status) !== "attached") continue;
    const selector =
      attachment.portal_selector != null ? String(attachment.portal_selector) : "";
    if (!selector) continue;

    const fileName = attachment.file_name != null ? String(attachment.file_name) : "document.pdf";
    const uploadResult = await uploadFn(selector, fileName);
    results.push({
      key: attachment.key,
      portal_selector: selector,
      file_name: fileName,
      status: uploadResult.ok ? "uploaded" : "upload_failed",
      error: uploadResult.error ?? null,
    });
  }

  return results;
}

/**
 * @param {import("playwright").Page} page
 */
async function capturePepcoSubmissionEvidence(page) {
  const html = await page.content();
  let screenshotBase64 = null;
  try {
    const buffer = await page.screenshot({ fullPage: true, type: "png" });
    screenshotBase64 = buffer.toString("base64");
  } catch {
    screenshotBase64 = null;
  }

  return {
    html,
    screenshot_base64: screenshotBase64,
    captured_at: new Date().toISOString(),
    url: page.url(),
  };
}

/**
 * @param {import("playwright").Page} page
 * @param {Record<string, unknown>} context
 * @param {object} options
 * @param {boolean} [options.allowFinalSubmit]
 */
async function runPepcoSubmissionOnPage(page, context, options = {}) {
  const allowFinalSubmit = options.allowFinalSubmit === true;
  const submitSelector =
    context.submit_button_selector != null
      ? String(context.submit_button_selector)
      : DEFAULT_SUBMIT_BUTTON_SELECTOR;

  const populatedFields = await populatePepcoSubmissionForm(page, context);
  const uploadedAttachments = await uploadPepcoSubmissionAttachments(
    page,
    context,
    options.uploadFn ||
      (async () => ({
        ok: true,
      })),
  );

  const preSubmitEvidence = await capturePepcoSubmissionEvidence(page);

  if (!allowFinalSubmit) {
    return {
      status: "human_required",
      reason: "pepco_dry_run_stop_before_submit",
      populated_fields: populatedFields,
      uploaded_attachments: uploadedAttachments,
      evidence: preSubmitEvidence,
      would_submit: {
        fields: context.fields,
        attachments: context.attachments,
        submit_button_selector: submitSelector,
      },
      final_submit_clicked: false,
    };
  }

  const submitBtn = page.locator(submitSelector).first();
  const submitCount = await submitBtn.count();
  if (!submitCount) {
    return {
      status: "failed",
      reason: "submit_button_not_found",
      populated_fields: populatedFields,
      uploaded_attachments: uploadedAttachments,
      evidence: preSubmitEvidence,
      final_submit_clicked: false,
    };
  }

  await submitBtn.click();
  try {
    await page.waitForSelector(
      context.confirmation_ticket_selector != null
        ? String(context.confirmation_ticket_selector)
        : DEFAULT_CONFIRMATION_TICKET_SELECTOR,
      { timeout: 2000 },
    );
  } catch {
    await page.waitForTimeout(200);
  }

  const postSubmitEvidence = await capturePepcoSubmissionEvidence(page);
  const confirmation = await extractPepcoConfirmation(
    page,
    context.confirmation_ticket_selector != null
      ? String(context.confirmation_ticket_selector)
      : DEFAULT_CONFIRMATION_TICKET_SELECTOR,
  );

  return {
    status: confirmation.ticket_number ? "confirmed" : "submitted_pending_confirmation",
    reason: confirmation.ticket_number ? "confirmation_captured" : "confirmation_not_found",
    populated_fields: populatedFields,
    uploaded_attachments: uploadedAttachments,
    evidence: postSubmitEvidence,
    confirmation,
    final_submit_clicked: true,
  };
}

/**
 * @param {import("playwright").Page} page
 * @param {string} ticketSelector
 */
async function extractPepcoConfirmation(page, ticketSelector) {
  const selector = ticketSelector || DEFAULT_CONFIRMATION_TICKET_SELECTOR;
  const ticketEl = page.locator(selector).first();
  const count = await ticketEl.count();
  let ticketNumber = null;
  if (count) {
    ticketNumber = (await ticketEl.textContent())?.trim() || null;
  }

  const referenceEl = page.locator("[data-pepco-reference], #pepco-application-reference").first();
  const refCount = await referenceEl.count();
  const applicationReference =
    refCount > 0 ? (await referenceEl.textContent())?.trim() || null : null;

  return {
    ticket_number: ticketNumber,
    application_reference: applicationReference,
    captured_at: new Date().toISOString(),
    page_url: page.url(),
  };
}

module.exports = {
  DEFAULT_SUBMIT_BUTTON_SELECTOR,
  DEFAULT_CONFIRMATION_TICKET_SELECTOR,
  normalizeApplicationType,
  buildSubmissionContext,
  populatePepcoSubmissionForm,
  uploadPepcoSubmissionAttachments,
  capturePepcoSubmissionEvidence,
  runPepcoSubmissionOnPage,
  extractPepcoConfirmation,
};
