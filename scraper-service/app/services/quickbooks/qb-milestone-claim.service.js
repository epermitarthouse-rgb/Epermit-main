"use strict";

const STALE_PROCESSING_MS = 15 * 60 * 1000;

/** @typedef {'M1'|'M2'|'M3'} Milestone */

const MILESTONE_FIELDS = {
  M1: {
    triggered: "m1_triggered",
    invoiceId: "qb_invoice_id_m1",
    status: "m1_invoice_trigger_status",
    pendingId: "m1_qb_pending_invoice_id",
    triggeredAt: "m1_triggered_at",
    triggerSource: "m1_trigger_source",
  },
  M2: {
    triggered: "m2_triggered",
    invoiceId: "qb_invoice_id_m2",
    status: "m2_invoice_trigger_status",
    pendingId: "m2_qb_pending_invoice_id",
    triggeredAt: "m2_triggered_at",
    triggerSource: "m2_trigger_source",
  },
  M3: {
    triggered: "m3_triggered",
    invoiceId: "qb_invoice_id_m3",
    status: "m3_invoice_trigger_status",
    pendingId: "m3_qb_pending_invoice_id",
    triggeredAt: "m3_triggered_at",
    triggerSource: "m3_trigger_source",
  },
};

class MilestoneClaimError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [httpStatus]
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, httpStatus = 409, details = undefined) {
    super(message);
    this.name = "MilestoneClaimError";
    this.code = code;
    this.httpStatus = httpStatus;
    if (details) this.details = details;
  }
}

/**
 * @param {Record<string, unknown>} project
 * @param {Milestone} milestone
 */
function readMilestoneState(project, milestone) {
  const f = MILESTONE_FIELDS[milestone];
  const statusRaw = project[f.status];
  const status =
    statusRaw != null && String(statusRaw).trim()
      ? String(statusRaw).trim()
      : null;
  const invoiceId =
    project[f.invoiceId] != null && String(project[f.invoiceId]).trim()
      ? String(project[f.invoiceId]).trim()
      : null;
  const pendingId =
    project[f.pendingId] != null && String(project[f.pendingId]).trim()
      ? String(project[f.pendingId]).trim()
      : null;
  return {
    triggered: Boolean(project[f.triggered]),
    invoiceId,
    status,
    pendingId,
    triggeredAt: project[f.triggeredAt] ?? null,
  };
}

/**
 * @param {Record<string, unknown>} project
 * @param {Milestone} milestone
 */
function assertMilestoneAvailable(project, milestone) {
  const st = readMilestoneState(project, milestone);
  if (st.triggered || st.invoiceId) {
    throw new MilestoneClaimError(
      "invoice_already_triggered",
      `Invoice for ${milestone} has already been triggered or recorded for this project.`,
    );
  }
  if (st.status === "completed") {
    throw new MilestoneClaimError(
      "invoice_already_triggered",
      `Invoice for ${milestone} is already marked completed for this project.`,
    );
  }
  if (st.status === "qb_uncertain" || st.pendingId) {
    throw new MilestoneClaimError(
      "invoice_trigger_uncertain",
      `A QuickBooks invoice may already exist for ${milestone}. Do not retry automatically — reconcile the pending invoice id with QuickBooks before triggering again.`,
      409,
      st.pendingId ? { pendingInvoiceId: st.pendingId } : undefined,
    );
  }
  if (st.status === "processing") {
    const triggeredAtMs = st.triggeredAt
      ? new Date(String(st.triggeredAt)).getTime()
      : NaN;
    const stale =
      Number.isFinite(triggeredAtMs) &&
      Date.now() - triggeredAtMs > STALE_PROCESSING_MS;
    if (!stale) {
      throw new MilestoneClaimError(
        "invoice_trigger_in_progress",
        `Invoice trigger for ${milestone} is already in progress. Wait for the current attempt to finish.`,
      );
    }
  }
}

/**
 * @param {unknown} result
 */
function parseClaimRpcResult(result) {
  if (!result || typeof result !== "object") return { claimed: false, reason: "claim_failed" };
  const obj = /** @type {Record<string, unknown>} */ (result);
  return {
    claimed: obj.claimed === true,
    reason: typeof obj.reason === "string" ? obj.reason : null,
    pendingInvoiceId:
      typeof obj.pending_invoice_id === "string" ? obj.pending_invoice_id : null,
  };
}

/**
 * Atomically claim a milestone for live invoice creation via RPC.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} projectId
 * @param {Milestone} milestone
 * @param {Record<string, unknown>} project
 */
async function claimMilestoneForInvoice(supabase, projectId, milestone, project) {
  assertMilestoneAvailable(project, milestone);

  const { data, error } = await supabase.rpc("claim_project_milestone_invoice", {
    p_project_id: projectId,
    p_milestone: milestone,
  });

  if (error) {
    if (/claim_project_milestone_invoice/i.test(error.message || "")) {
      throw new MilestoneClaimError(
        "invoice_trigger_failed",
        "Milestone claim RPC is unavailable. Apply the QuickBooks milestone claim migration before creating live invoices.",
        503,
      );
    }
    throw new MilestoneClaimError(
      "invoice_trigger_failed",
      `Failed to claim ${milestone} invoice trigger: ${error.message}`,
      502,
    );
  }

  const parsed = parseClaimRpcResult(data);
  if (parsed.claimed) {
    return { claimedAt: new Date().toISOString() };
  }

  if (parsed.reason === "qb_uncertain") {
    throw new MilestoneClaimError(
      "invoice_trigger_uncertain",
      `A QuickBooks invoice may already exist for ${milestone}. Reconcile before retrying.`,
      409,
      parsed.pendingInvoiceId ? { pendingInvoiceId: parsed.pendingInvoiceId } : undefined,
    );
  }
  if (parsed.reason === "in_progress") {
    throw new MilestoneClaimError(
      "invoice_trigger_in_progress",
      `Invoice trigger for ${milestone} is already in progress.`,
    );
  }
  if (parsed.reason === "already_triggered") {
    throw new MilestoneClaimError(
      "invoice_already_triggered",
      `Invoice for ${milestone} has already been triggered or recorded for this project.`,
    );
  }

  throw new MilestoneClaimError(
    "invoice_trigger_in_progress",
    `Invoice trigger for ${milestone} could not be claimed.`,
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} projectId
 * @param {Milestone} milestone
 */
async function releaseMilestoneClaim(supabase, projectId, milestone) {
  const f = MILESTONE_FIELDS[milestone];
  await supabase
    .from("projects")
    .update({ [f.status]: "failed" })
    .eq("id", projectId)
    .eq(f.status, "processing");
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} p
 */
async function completeMilestoneInvoice(supabase, p) {
  const f = MILESTONE_FIELDS[p.milestone];
  const patch = {
    [f.invoiceId]: p.invoiceId,
    [f.triggered]: true,
    [f.triggeredAt]: new Date().toISOString(),
    [f.triggerSource]: "manual",
    [f.status]: "completed",
    [f.pendingId]: null,
    reimbursement_amount: p.reimburseAmt,
    reimbursement_description:
      p.reimburseAmt > 0 ? String(p.reimbursementDescription || "").trim() : null,
  };

  const { error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", p.projectId)
    .eq(f.status, "processing");

  if (error) {
    await supabase
      .from("projects")
      .update({
        [f.status]: "qb_uncertain",
        [f.pendingId]: p.invoiceId,
      })
      .eq("id", p.projectId);

    throw new MilestoneClaimError(
      "invoice_trigger_uncertain",
      "Invoice was created in QuickBooks but saving the project failed. Record the invoice id and reconcile before retrying.",
      502,
      { pendingInvoiceId: p.invoiceId },
    );
  }
}

module.exports = {
  STALE_PROCESSING_MS,
  MILESTONE_FIELDS,
  MilestoneClaimError,
  readMilestoneState,
  assertMilestoneAvailable,
  parseClaimRpcResult,
  claimMilestoneForInvoice,
  releaseMilestoneClaim,
  completeMilestoneInvoice,
};
