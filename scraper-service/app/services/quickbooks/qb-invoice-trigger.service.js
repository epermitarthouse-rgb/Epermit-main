"use strict";

const { generateInvoicePayload } = require("./qb-invoice-payload.js");
const qbApi = require("./qb-api.service.js");
const { getDefaultItemId, getDefaultItemName, getEnvironment } = require("./qb-config.js");
const {
  validateProjectClientPresent,
  resolveProjectQbCustomerId,
} = require("./qb-project-customer.service.js");
const {
  MilestoneClaimError,
  assertMilestoneAvailable,
  claimMilestoneForInvoice,
  releaseMilestoneClaim,
  completeMilestoneInvoice,
} = require("./qb-milestone-claim.service.js");

const MILESTONE_PCT = {
  M1: 0.4,
  M2: 0.4,
  M3: 0.2,
};

const PROJECT_SELECT_FOR_TRIGGER = [
  "id",
  "name",
  "permit_number",
  "client_name",
  "client_email",
  "service_type",
  "contract_value",
  "qb_customer_id",
  "qb_invoice_id_m1",
  "qb_invoice_id_m2",
  "qb_invoice_id_m3",
  "m1_triggered",
  "m2_triggered",
  "m3_triggered",
  "m1_invoice_trigger_status",
  "m2_invoice_trigger_status",
  "m3_invoice_trigger_status",
  "m1_qb_pending_invoice_id",
  "m2_qb_pending_invoice_id",
  "m3_qb_pending_invoice_id",
  "m1_triggered_at",
  "m2_triggered_at",
  "m3_triggered_at",
  "reimbursement_amount",
  "reimbursement_description",
].join(",");

class InvoiceTriggerError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [httpStatus]
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, httpStatus = 400, details = undefined) {
    super(message);
    this.name = "InvoiceTriggerError";
    this.code = code;
    this.httpStatus = httpStatus;
    if (details) this.details = details;
  }
}

function normalizeMilestone(raw) {
  if (raw == null || typeof raw !== "string") return null;
  const m = raw.trim().toUpperCase();
  if (m === "M1" || m === "M2" || m === "M3") return m;
  return null;
}

/**
 * Manual milestone invoice trigger (dry-run or QuickBooks draft invoice).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} body
 * @param {{ userId: string }} [authContext] Authenticated caller — required for all triggers.
 */
async function executeInvoiceTrigger(supabase, body, authContext = undefined) {
  if (!authContext?.userId) {
    throw new InvoiceTriggerError(
      "UNAUTHENTICATED",
      "Authentication required.",
      401,
    );
  }

  if (!body || typeof body !== "object") {
    throw new InvoiceTriggerError(
      "invoice_trigger_validation_failed",
      "Request body must be a JSON object.",
    );
  }

  const projectId =
    typeof body.projectId === "string"
      ? body.projectId.trim()
      : body.projectId != null
        ? String(body.projectId).trim()
        : "";

  const milestone = normalizeMilestone(body.milestone);
  const dryRun = Boolean(body.dryRun);

  const reimbursementAmountRaw = body.reimbursementAmount;
  const reimbursementDescription =
    body.reimbursementDescription != null
      ? String(body.reimbursementDescription)
      : "";

  const qbItemIdBody =
    typeof body.qbItemId === "string"
      ? body.qbItemId.trim()
      : body.qbItemId != null
        ? String(body.qbItemId).trim()
        : "";

  if (!projectId) {
    throw new InvoiceTriggerError(
      "invoice_trigger_validation_failed",
      "projectId is required.",
    );
  }

  if (!milestone) {
    throw new InvoiceTriggerError(
      "invoice_trigger_validation_failed",
      'milestone must be "M1", "M2", or "M3".',
    );
  }

  const reimburseAmt = Number(reimbursementAmountRaw);
  if (!Number.isFinite(reimburseAmt) || reimburseAmt < 0) {
    throw new InvoiceTriggerError(
      "invoice_trigger_validation_failed",
      "reimbursementAmount must be a number greater than or equal to 0.",
    );
  }

  if (reimburseAmt > 0 && !String(reimbursementDescription).trim()) {
    throw new InvoiceTriggerError(
      "invoice_trigger_validation_failed",
      "reimbursementDescription is required when reimbursementAmount is greater than 0.",
    );
  }

  const { requireProjectEditorAccess } = require("../uci/uci-access.service.js");
  try {
    await requireProjectEditorAccess({
      supabase,
      userId: authContext.userId,
      projectId,
    });
  } catch (err) {
    const statusCode =
      typeof err.statusCode === "number" ? err.statusCode : 403;
    throw new InvoiceTriggerError(
      statusCode === 403 ? "PROJECT_EDITOR_ACCESS_DENIED" : "invoice_trigger_failed",
      statusCode === 403
        ? "Forbidden: editor access required for this project."
        : err.message || "Project access check failed.",
      statusCode,
    );
  }

  const { data: project, error: fetchErr } = await supabase
    .from("projects")
    .select(PROJECT_SELECT_FOR_TRIGGER)
    .eq("id", projectId)
    .maybeSingle();

  if (fetchErr) {
    throw new InvoiceTriggerError(
      "invoice_trigger_failed",
      "Failed to load project.",
      502,
    );
  }

  if (!project) {
    throw new InvoiceTriggerError(
      "invoice_trigger_validation_failed",
      "Project not found.",
      404,
    );
  }

  const contractVal = Number(project.contract_value);
  if (!Number.isFinite(contractVal) || contractVal <= 0) {
    throw new InvoiceTriggerError(
      "invoice_trigger_validation_failed",
      "Project contract_value must be set and greater than 0.",
    );
  }

  if (!validateProjectClientPresent(project)) {
    throw new InvoiceTriggerError(
      "invoice_trigger_validation_failed",
      "Project must have client_name and/or client_email.",
    );
  }

  try {
    assertMilestoneAvailable(project, milestone);
  } catch (err) {
    if (err instanceof MilestoneClaimError) {
      throw new InvoiceTriggerError(err.code, err.message, err.httpStatus, err.details);
    }
    throw err;
  }

  const milestonePct = MILESTONE_PCT[milestone];
  const invoiceDate = new Date();

  const payloadProject = {
    name: project.name,
    permit_number: project.permit_number,
    contract_value: contractVal,
    service_type: project.service_type,
  };

  const previewItemId = qbItemIdBody || getDefaultItemId() || "DRY_RUN_ITEM";
  const previewCustomerId =
    project.qb_customer_id != null && String(project.qb_customer_id).trim()
      ? String(project.qb_customer_id).trim()
      : "DRY_RUN_CUSTOMER";

  let payload;
  let totals;
  try {
    const gen = generateInvoicePayload({
      project: payloadProject,
      milestone,
      milestonePct,
      reimbursementAmount: reimburseAmt,
      reimbursementDescription:
        reimburseAmt > 0 ? String(reimbursementDescription).trim() : "",
      qbCustomerId: previewCustomerId,
      qbItemId: previewItemId,
      invoiceDate,
    });
    payload = gen.payload;
    totals = gen.totals;
  } catch (e) {
    throw new InvoiceTriggerError(
      "invoice_trigger_validation_failed",
      e.message || String(e),
    );
  }

  if (!Number.isFinite(totals.totalInvoiceAmount) || totals.totalInvoiceAmount <= 0) {
    throw new InvoiceTriggerError(
      "invoice_trigger_validation_failed",
      "Invoice total must be greater than zero.",
    );
  }

  if (dryRun) {
    return {
      dryRun: true,
      milestone,
      environment: getEnvironment(),
      payload,
      totals,
    };
  }

  try {
    await claimMilestoneForInvoice(supabase, projectId, milestone, project);
  } catch (err) {
    if (err instanceof MilestoneClaimError) {
      throw new InvoiceTriggerError(err.code, err.message, err.httpStatus, err.details);
    }
    throw err;
  }

  try {
    await qbApi.getValidConnection(supabase, {});
  } catch (e) {
    await releaseMilestoneClaim(supabase, projectId, milestone);
    if (e.code === "QB_NOT_CONNECTED") {
      throw new InvoiceTriggerError(
        "quickbooks_not_connected",
        e.message || "QuickBooks is not connected.",
        503,
      );
    }
    if (e.code === "QB_CONFIG_MISSING" || e.code === "QB_TOKEN_REFRESH_FAILED") {
      throw new InvoiceTriggerError(
        "invoice_trigger_failed",
        e.message || "QuickBooks authentication failed.",
        503,
      );
    }
    throw new InvoiceTriggerError(
      "invoice_trigger_failed",
      e.message || String(e),
      502,
    );
  }

  let customerId;
  try {
    customerId = await resolveProjectQbCustomerId(supabase, project, { projectId });
  } catch (e) {
    await releaseMilestoneClaim(supabase, projectId, milestone);
    const code = e && typeof e === "object" && e.code != null ? String(e.code) : "";
    if (code === "quickbooks_customer_missing") {
      throw new InvoiceTriggerError(
        "invoice_trigger_validation_failed",
        e.message || "Project must have client_name and/or client_email.",
      );
    }
    throw new InvoiceTriggerError(
      "invoice_trigger_failed",
      e.message || String(e),
      502,
    );
  }

  let itemId = qbItemIdBody || null;

  if (!itemId && project.service_type?.trim?.()) {
    try {
      itemId = await qbApi.getItemIdByName(supabase, {
        name: String(project.service_type).trim(),
      });
    } catch {
      itemId = null;
    }
  }

  if (!itemId) {
    const defaultId = getDefaultItemId();
    if (defaultId) itemId = defaultId;
  }

  if (!itemId) {
    const defaultName = getDefaultItemName();
    if (defaultName) {
      try {
        itemId = await qbApi.getItemIdByName(supabase, {
          name: defaultName,
        });
      } catch {
        itemId = null;
      }
    }
  }

  if (!itemId) {
    await releaseMilestoneClaim(supabase, projectId, milestone);
    throw new InvoiceTriggerError(
      "quickbooks_item_missing",
      "Could not resolve a QuickBooks item ID (service_type match, QB_DEFAULT_ITEM_ID, or QB_DEFAULT_ITEM_NAME).",
      422,
    );
  }

  try {
    const gen = generateInvoicePayload({
      project: payloadProject,
      milestone,
      milestonePct,
      reimbursementAmount: reimburseAmt,
      reimbursementDescription:
        reimburseAmt > 0 ? String(reimbursementDescription).trim() : "",
      qbCustomerId: customerId,
      qbItemId: itemId,
      invoiceDate,
    });
    payload = gen.payload;
    totals = gen.totals;
  } catch (e) {
    await releaseMilestoneClaim(supabase, projectId, milestone);
    throw new InvoiceTriggerError(
      "invoice_trigger_validation_failed",
      e.message || String(e),
    );
  }

  if (!Number.isFinite(totals.totalInvoiceAmount) || totals.totalInvoiceAmount <= 0) {
    await releaseMilestoneClaim(supabase, projectId, milestone);
    throw new InvoiceTriggerError(
      "invoice_trigger_validation_failed",
      "Invoice total must be greater than zero.",
    );
  }

  let invoiceResult;
  try {
    invoiceResult = await qbApi.createDraftInvoice(supabase, {
      customerId,
      lines: payload.Line,
      txnDate: payload.TxnDate,
      dueDate: payload.DueDate,
      privateNote: payload.PrivateNote,
      customerMemo: payload.CustomerMemo,
    });
  } catch (e) {
    await releaseMilestoneClaim(supabase, projectId, milestone);
    if (e instanceof qbApi.QuickBooksApiError) {
      throw new InvoiceTriggerError(
        "invoice_trigger_failed",
        e.message || "QuickBooks invoice creation failed.",
        typeof e.httpStatus === "number" &&
          e.httpStatus >= 400 &&
          e.httpStatus < 600
          ? e.httpStatus
          : 502,
      );
    }
    throw new InvoiceTriggerError(
      "invoice_trigger_failed",
      e.message || String(e),
      502,
    );
  }

  try {
    await completeMilestoneInvoice(supabase, {
      projectId,
      milestone,
      invoiceId: invoiceResult.id,
      reimburseAmt,
      reimbursementDescription:
        reimburseAmt > 0 ? String(reimbursementDescription).trim() : "",
    });
  } catch (err) {
    if (err instanceof MilestoneClaimError) {
      throw new InvoiceTriggerError(err.code, err.message, err.httpStatus, err.details);
    }
    throw err;
  }

  return {
    dryRun: false,
    milestone,
    environment: getEnvironment(),
    invoice: invoiceResult,
    totals,
  };
}

module.exports = {
  InvoiceTriggerError,
  executeInvoiceTrigger,
  MILESTONE_PCT,
};
