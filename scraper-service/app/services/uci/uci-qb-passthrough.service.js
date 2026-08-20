"use strict";

/**
 * UCI passthrough invoice — create client invoice AFTER utility paid_at.
 * RequestId = coordination_costs.id. Uncertain QB: query by RequestId; never duplicate.
 */

const qbApi = require("../quickbooks/qb-api.service.js");
const { getDefaultItemId, getDefaultItemName } = require("../quickbooks/qb-config.js");
const { emitUciEvent } = require("./uci-events.service.js");
const { UCI_LIFECYCLE_EVENTS } = require("./uci-lifecycle-constants.js");

function requestIdForCost(cost) {
  return String(cost.id);
}

function memoForCost(project, record, cost) {
  const projectName = project?.name || project?.permit_number || String(cost.project_id);
  const recordScope = record?.scope_description || record?.utility_type || String(cost.coordination_record_id);
  return `UCI passthrough ${cost.cost_type || "cost"} · ${projectName} · ${recordScope} · RequestId=${requestIdForCost(cost)}`;
}

function extractInvoiceId(json) {
  if (!json || typeof json !== "object") return null;
  if (json.Invoice && json.Invoice.Id) return String(json.Invoice.Id);
  const qr = json.QueryResponse;
  if (qr && Array.isArray(qr.Invoice) && qr.Invoice[0]?.Id) return String(qr.Invoice[0].Id);
  if (json.id) return String(json.id);
  return null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function queryInvoiceByRequestId(supabase, params) {
  const { requestId, queryFn } = params;
  const q = `select * from Invoice where PrivateNote like '%RequestId=${String(requestId)}%'`;
  try {
    const fn =
      typeof queryFn === "function"
        ? queryFn
        : async () =>
            qbApi.quickBooksRequest(supabase, {
              method: "GET",
              path: "/query",
              query: { query: q },
            });
    const json = await fn(q);
    const id = extractInvoiceId(json);
    return { found: Boolean(id), invoice_id: id, raw: json };
  } catch (err) {
    return {
      found: false,
      invoice_id: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function loadProjectAndRecord(supabase, cost) {
  const [{ data: project }, { data: record }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", cost.project_id).maybeSingle(),
    supabase
      .from("coordination_records")
      .select("*")
      .eq("id", cost.coordination_record_id)
      .maybeSingle(),
  ]);
  return { project: project || {}, record: record || {} };
}

/**
 * Persist paid_at first (caller), then create the client invoice.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function createUciPassthroughInvoice(supabase, params) {
  const { cost, createInvoiceFn = null, queryFn = null, userId = null } = params;
  if (!cost?.id) {
    return { created: false, reason: "missing_cost" };
  }
  if (!cost.paid_at) {
    return { created: false, reason: "not_paid" };
  }
  if (cost.quickbooks_invoice_id) {
    return { created: false, reason: "already_invoiced", invoice_id: cost.quickbooks_invoice_id };
  }
  if (cost.billing_hold === true && !cost.human_override_bill_at) {
    return { created: false, reason: "billing_hold" };
  }
  if (Number(cost.actual_amount) == null || !Number.isFinite(Number(cost.actual_amount))) {
    return { created: false, reason: "no_actual_amount" };
  }

  const requestId = requestIdForCost(cost);
  await supabase
    .from("coordination_costs")
    .update({
      qb_sync_status: "pending",
      qb_attempt_count: Number(cost.qb_attempt_count || 0) + 1,
    })
    .eq("id", cost.id);

  const existing = await queryInvoiceByRequestId(supabase, { requestId, queryFn });
  if (existing.found && existing.invoice_id) {
    const billedAt = new Date().toISOString();
    const { data: updated } = await supabase
      .from("coordination_costs")
      .update({
        quickbooks_invoice_id: existing.invoice_id,
        client_billed_at: cost.client_billed_at || billedAt,
        qb_sync_status: "succeeded",
        qb_last_error: null,
      })
      .eq("id", cost.id)
      .select("*")
      .single();
    emitUciEvent(
      UCI_LIFECYCLE_EVENTS.COST_BILLED,
      {
        coordination_record_id: cost.coordination_record_id,
        project_id: cost.project_id,
        cost_id: cost.id,
        invoice_id: existing.invoice_id,
        reused: true,
      },
      { supabase },
    );
    return { created: false, reason: "reused_existing", invoice_id: existing.invoice_id, cost: updated };
  }

  const { project, record } = await loadProjectAndRecord(supabase, cost);
  const customerId = project.qb_customer_id || params.qbCustomerId || null;
  let itemId = getDefaultItemId() || params.qbItemId || null;
  if (!itemId && getDefaultItemName()) {
    try {
      itemId = await qbApi.getItemIdByName(supabase, { name: getDefaultItemName() });
    } catch {
      itemId = null;
    }
  }

  const payload = {
    CustomerRef: customerId ? { value: String(customerId) } : undefined,
    PrivateNote: memoForCost(project, record, cost),
    CustomerMemo: { value: memoForCost(project, record, cost) },
    Line: [
      {
        DetailType: "SalesItemLineDetail",
        Amount: Number(cost.actual_amount),
        Description: `Utility ${cost.cost_type} passthrough (zero markup)`,
        SalesItemLineDetail: itemId
          ? { ItemRef: { value: String(itemId) }, Qty: 1, UnitPrice: Number(cost.actual_amount) }
          : { Qty: 1, UnitPrice: Number(cost.actual_amount) },
      },
    ],
  };

  try {
    const creator =
      typeof createInvoiceFn === "function"
        ? createInvoiceFn
        : async () =>
            qbApi.createDraftInvoice(supabase, {
              customerId,
              lines: payload.Line,
              privateNote: payload.PrivateNote,
              customerMemo: payload.CustomerMemo,
            });
    const created = await creator(payload);
    const invoiceId = created?.id || created?.invoice_id || extractInvoiceId(created);
    if (!invoiceId) {
      throw Object.assign(new Error("QuickBooks did not return an invoice id"), {
        code: "QB_UNCERTAIN",
      });
    }
    const billedAt = new Date().toISOString();
    const { data: updated } = await supabase
      .from("coordination_costs")
      .update({
        quickbooks_invoice_id: String(invoiceId),
        client_billed_at: billedAt,
        qb_sync_status: "succeeded",
        qb_last_error: null,
      })
      .eq("id", cost.id)
      .select("*")
      .single();

    emitUciEvent(
      UCI_LIFECYCLE_EVENTS.COST_BILLED,
      {
        coordination_record_id: cost.coordination_record_id,
        project_id: cost.project_id,
        cost_id: cost.id,
        invoice_id: invoiceId,
        request_id: requestId,
        user_id: userId,
      },
      { supabase },
    );
    return { created: true, invoice_id: String(invoiceId), cost: updated, request_id: requestId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const uncertain = err && typeof err === "object" && (err.code === "QB_UNCERTAIN" || err.uncertain === true);
    const requery = await queryInvoiceByRequestId(supabase, { requestId, queryFn });
    if (requery.found && requery.invoice_id) {
      const { data: updated } = await supabase
        .from("coordination_costs")
        .update({
          quickbooks_invoice_id: requery.invoice_id,
          client_billed_at: new Date().toISOString(),
          qb_sync_status: "succeeded",
          qb_last_error: null,
        })
        .eq("id", cost.id)
        .select("*")
        .single();
      return { created: false, reason: "recovered_after_uncertain", invoice_id: requery.invoice_id, cost: updated };
    }
    await supabase
      .from("coordination_costs")
      .update({
        qb_sync_status: uncertain ? "uncertain" : "retry",
        qb_last_error: message.slice(0, 500),
      })
      .eq("id", cost.id);
    return {
      created: false,
      reason: uncertain ? "uncertain" : "failed",
      error: message,
      request_id: requestId,
    };
  }
}

/**
 * Retry ready/pending/retry/uncertain invoices. Never duplicates — always query RequestId first.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} [opts]
 */
async function retryPendingUciInvoices(supabase, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 100);
  const { data, error } = await supabase
    .from("coordination_costs")
    .select("*")
    .in("qb_sync_status", ["ready", "pending", "retry", "uncertain"])
    .not("paid_at", "is", null)
    .limit(limit);

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to list QB retries"), {
      statusCode: 500,
      code: "QB_RETRY_LIST_FAILED",
    });
  }

  const rows = Array.isArray(data) ? data : [];
  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  for (const cost of rows) {
    results.push(
      await createUciPassthroughInvoice(supabase, {
        cost,
        createInvoiceFn: opts.createInvoiceFn,
        queryFn: opts.queryFn,
      }),
    );
  }
  return { evaluated: results.length, results };
}

/**
 * Webhook / poll confirmation — set client_billed_at when QB invoice is known.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function confirmUciInvoiceBilled(supabase, params) {
  const { costId, invoiceId } = params;
  const { data: cost } = await supabase.from("coordination_costs").select("*").eq("id", costId).maybeSingle();
  if (!cost) {
    const err = new Error("Cost not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const { data: updated } = await supabase
    .from("coordination_costs")
    .update({
      quickbooks_invoice_id: invoiceId || cost.quickbooks_invoice_id,
      client_billed_at: cost.client_billed_at || new Date().toISOString(),
      qb_sync_status: "succeeded",
      qb_last_error: null,
    })
    .eq("id", costId)
    .select("*")
    .single();
  return { cost: updated };
}

module.exports = {
  requestIdForCost,
  memoForCost,
  queryInvoiceByRequestId,
  createUciPassthroughInvoice,
  retryPendingUciInvoices,
  confirmUciInvoiceBilled,
};
