"use strict";

const { generateInvoicePayload } = require("./qb-invoice-payload.js");
const qbApi = require("./qb-api.service.js");
const { getDefaultItemId, getDefaultItemName } = require("./qb-config.js");
const {
  validateProjectClientPresent,
  resolveProjectQbCustomerId,
} = require("./qb-project-customer.service.js");

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
  "reimbursement_amount",
  "reimbursement_description",
].join(",");

class InvoiceTriggerError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [httpStatus]
   */
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = "InvoiceTriggerError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function normalizeMilestone(raw) {
  if (raw == null || typeof raw !== "string") return null;
  const m = raw.trim().toUpperCase();
  if (m === "M1" || m === "M2" || m === "M3") return m;
  return null;
}

function milestoneDuplicateBlocked(project, milestone) {
  if (milestone === "M1") {
    return Boolean(project.m1_triggered) || Boolean(project.qb_invoice_id_m1?.trim?.());
  }
  if (milestone === "M2") {
    return Boolean(project.m2_triggered) || Boolean(project.qb_invoice_id_m2?.trim?.());
  }
  if (milestone === "M3") {
    return Boolean(project.m3_triggered) || Boolean(project.qb_invoice_id_m3?.trim?.());
  }
  return false;
}

/**
 * Manual milestone invoice trigger (dry-run or QuickBooks draft invoice).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} body
 */
async function executeInvoiceTrigger(supabase, body) {
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

  const { data: project, error: fetchErr } = await supabase
    .from("projects")
    .select(PROJECT_SELECT_FOR_TRIGGER)
    .eq("id", projectId)
    .maybeSingle();

  if (fetchErr) {
    throw new InvoiceTriggerError(
      "invoice_trigger_failed",
      `Failed to load project: ${fetchErr.message}`,
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

  if (milestoneDuplicateBlocked(project, milestone)) {
    throw new InvoiceTriggerError(
      "invoice_already_triggered",
      `Invoice for ${milestone} has already been triggered or recorded for this project.`,
      409,
    );
  }

  const milestonePct = MILESTONE_PCT[milestone];
  const invoiceDate = new Date();

  const payloadProject = {
    name: project.name,
    permit_number: project.permit_number,
    contract_value: contractVal,
    service_type: project.service_type,
  };

  if (dryRun) {
    const qbCustomerId =
      project.qb_customer_id != null &&
      String(project.qb_customer_id).trim()
        ? String(project.qb_customer_id).trim()
        : "DRY_RUN_CUSTOMER";
    const qbItemIdResolved = qbItemIdBody || "DRY_RUN_ITEM";

    const { payload, totals } = generateInvoicePayload({
      project: payloadProject,
      milestone,
      milestonePct,
      reimbursementAmount: reimburseAmt,
      reimbursementDescription:
        reimburseAmt > 0 ? String(reimbursementDescription).trim() : "",
      qbCustomerId,
      qbItemId: qbItemIdResolved,
      invoiceDate,
    });

    return {
      dryRun: true,
      milestone,
      payload,
      totals,
    };
  }

  try {
    await qbApi.getValidConnection(supabase, {});
  } catch (e) {
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
    throw new InvoiceTriggerError(
      "quickbooks_item_missing",
      "Could not resolve a QuickBooks item ID (service_type match, QB_DEFAULT_ITEM_ID, or QB_DEFAULT_ITEM_NAME).",
      422,
    );
  }

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
      qbCustomerId: customerId,
      qbItemId: itemId,
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

  /** @type {Record<string, unknown>} */
  const patch = {
    reimbursement_amount: reimburseAmt,
    reimbursement_description:
      reimburseAmt > 0 ? String(reimbursementDescription).trim() : null,
  };

  if (milestone === "M1") {
    patch.qb_invoice_id_m1 = invoiceResult.id;
    patch.m1_triggered = true;
    patch.m1_triggered_at = new Date().toISOString();
    patch.m1_trigger_source = "manual";
  } else if (milestone === "M2") {
    patch.qb_invoice_id_m2 = invoiceResult.id;
    patch.m2_triggered = true;
    patch.m2_triggered_at = new Date().toISOString();
    patch.m2_trigger_source = "manual";
  } else if (milestone === "M3") {
    patch.qb_invoice_id_m3 = invoiceResult.id;
    patch.m3_triggered = true;
    patch.m3_triggered_at = new Date().toISOString();
    patch.m3_trigger_source = "manual";
  }

  const { error: upErr } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", projectId);

  if (upErr) {
    throw new InvoiceTriggerError(
      "invoice_trigger_failed",
      `Invoice was created in QuickBooks but saving project failed: ${upErr.message}. Invoice id: ${invoiceResult.id}`,
      502,
    );
  }

  return {
    dryRun: false,
    milestone,
    invoice: invoiceResult,
    totals,
  };
}

module.exports = {
  InvoiceTriggerError,
  executeInvoiceTrigger,
};
