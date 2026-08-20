"use strict";

/**
 * UCI passthrough invoice — create client invoice AFTER utility paid_at.
 * RequestId = coordination_costs.id. Uncertain QB: query by RequestId; never duplicate.
 */

const qbApi = require("../quickbooks/qb-api.service.js");
const { getDefaultItemId, getDefaultItemName } = require("../quickbooks/qb-config.js");
const { emitUciEvent } = require("./uci-events.service.js");
const { UCI_LIFECYCLE_EVENTS, BLOCKED_REASON_CODES } = require("./uci-lifecycle-constants.js");
const { resolveUciAlert } = require("./uci-alerts.service.js");

const QB_RETRY_MS = Number(process.env.UCI_QB_RETRY_MS || 5 * 60 * 1000);

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

function formatQbLastError(code, message) {
  const msg = String(message || "QuickBooks invoice failed").slice(0, 460);
  const c = code ? String(code).slice(0, 40) : "QB_INVOICE_FAILED";
  return `[${c}] ${msg}`;
}

function parseQbLastError(raw) {
  const text = String(raw || "");
  const match = text.match(/^\[([^\]]+)\]\s*(.*)$/s);
  if (!match) return { code: null, message: text || null };
  return { code: match[1] || null, message: match[2] || text };
}

/**
 * @param {unknown} err
 * @returns {{ status: string, code: string, retryable: boolean, message: string }}
 */
function classifyQbInvoiceError(err) {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && err.code != null
      ? String(err.code)
      : err instanceof qbApi.QuickBooksApiError
        ? "QB_API_ERROR"
        : "QB_INVOICE_FAILED";

  if (code === "QB_UNCERTAIN" || (err && typeof err === "object" && err.uncertain === true)) {
    return { status: "uncertain", code, retryable: true, message };
  }

  const nonRetryableCodes = new Set([
    "QB_NOT_CONNECTED",
    "QB_CONFIG_MISSING",
    "QB_TOKEN_REFRESH_FAILED",
    "quickbooks_not_connected",
    "quickbooks_item_missing",
  ]);
  const nonRetryablePattern =
    /customerId is required|not connected|authentication failed|OAuth is not configured|Could not resolve a QuickBooks item/i;

  if (nonRetryableCodes.has(code) || nonRetryablePattern.test(message)) {
    return { status: "failed", code, retryable: false, message };
  }

  return { status: "retry", code, retryable: true, message };
}

function computeNextRetryAt(updatedAtIso, status) {
  if (!updatedAtIso) return null;
  if (!["retry", "uncertain", "pending"].includes(String(status || ""))) return null;
  const base = new Date(String(updatedAtIso));
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + Math.max(60_000, QB_RETRY_MS)).toISOString();
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

async function resolveQbCustomerId(supabase, project, params = {}) {
  const projectId = String(project.id || params.projectId || "");
  let customerId =
    project.qb_customer_id != null && String(project.qb_customer_id).trim()
      ? String(project.qb_customer_id).trim()
      : params.qbCustomerId != null && String(params.qbCustomerId).trim()
        ? String(params.qbCustomerId).trim()
        : "";

  if (customerId) return customerId;

  const displayName =
    (project.client_name != null && String(project.client_name).trim()) ||
    (project.client_email != null ? String(project.client_email).split("@")[0].trim() : "") ||
    "Customer";
  const email =
    project.client_email != null && String(project.client_email).trim()
      ? String(project.client_email).trim()
      : undefined;

  const createCustomerFn =
    typeof params.getOrCreateCustomerFn === "function"
      ? params.getOrCreateCustomerFn
      : (opts) => qbApi.getOrCreateCustomer(supabase, opts);
  const cust = await createCustomerFn({ name: displayName, email });
  customerId = String(cust.id);

  if (projectId) {
    const { error } = await supabase.from("projects").update({ qb_customer_id: customerId }).eq("id", projectId);
    if (error) {
      throw Object.assign(new Error(`Failed to save qb_customer_id: ${error.message}`), {
        code: "QB_CUSTOMER_SAVE_FAILED",
      });
    }
  }

  return customerId;
}

async function resolveQbItemId(supabase, project, params = {}) {
  let itemId = params.qbItemId != null && String(params.qbItemId).trim() ? String(params.qbItemId).trim() : null;
  if (!itemId) itemId = getDefaultItemId();

  if (!itemId && project.service_type?.trim?.()) {
    try {
      itemId = await qbApi.getItemIdByName(supabase, { name: String(project.service_type).trim() });
    } catch {
      itemId = null;
    }
  }

  if (!itemId && getDefaultItemName()) {
    try {
      itemId = await qbApi.getItemIdByName(supabase, { name: getDefaultItemName() });
    } catch {
      itemId = null;
    }
  }

  if (!itemId) {
    throw Object.assign(
      new Error(
        "Could not resolve a QuickBooks item ID (service_type match, QB_DEFAULT_ITEM_ID, or QB_DEFAULT_ITEM_NAME).",
      ),
      { code: "quickbooks_item_missing" },
    );
  }

  return itemId;
}

async function markInvoiceSucceeded(supabase, params) {
  const { cost, invoiceId, userId = null, requestId = null } = params;
  const billedAt = new Date().toISOString();
  const { data: updated } = await supabase
    .from("coordination_costs")
    .update({
      quickbooks_invoice_id: String(invoiceId),
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
      invoice_id: invoiceId,
      request_id: requestId || requestIdForCost(cost),
      user_id: userId,
    },
    { supabase },
  );

  const { record } = await loadProjectAndRecord(supabase, cost);
  if (record?.id) {
    await resolveUciAlert(supabase, {
      record,
      code: BLOCKED_REASON_CODES.COST_QB_FAILED,
    }).catch(() => null);
  }

  return updated;
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
  const attemptAt = new Date().toISOString();
  await supabase
    .from("coordination_costs")
    .update({
      qb_sync_status: "pending",
      qb_attempt_count: Number(cost.qb_attempt_count || 0) + 1,
      updated_at: attemptAt,
    })
    .eq("id", cost.id);

  const existing = await queryInvoiceByRequestId(supabase, { requestId, queryFn });
  if (existing.found && existing.invoice_id) {
    const updated = await markInvoiceSucceeded(supabase, {
      cost,
      invoiceId: existing.invoice_id,
      userId,
      requestId,
    });
    return {
      created: false,
      reason: "reused_existing",
      invoice_id: existing.invoice_id,
      cost: updated,
      billing: billingSnapshot(updated),
    };
  }

  const { project, record } = await loadProjectAndRecord(supabase, cost);

  try {
    if (typeof params.getValidConnectionFn === "function") {
      await params.getValidConnectionFn();
    } else {
      await qbApi.getValidConnection(supabase, {});
    }
  } catch (err) {
    const classified = classifyQbInvoiceError(err);
    const lastError = formatQbLastError(classified.code, classified.message);
    await supabase
      .from("coordination_costs")
      .update({
        qb_sync_status: classified.status,
        qb_last_error: lastError,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cost.id);
    return {
      created: false,
      reason: classified.status === "failed" ? "failed" : "uncertain",
      error: classified.message,
      error_code: classified.code,
      retryable: classified.retryable,
      request_id: requestId,
      billing: {
        qb_sync_status: classified.status,
        qb_last_error: lastError,
        qb_attempt_count: Number(cost.qb_attempt_count || 0) + 1,
        last_attempted_at: new Date().toISOString(),
        next_retry_at: classified.retryable ? computeNextRetryAt(new Date().toISOString(), classified.status) : null,
      },
    };
  }

  let customerId;
  let itemId;
  try {
    customerId = await resolveQbCustomerId(supabase, project, {
      projectId: cost.project_id,
      qbCustomerId: params.qbCustomerId,
      getOrCreateCustomerFn: params.getOrCreateCustomerFn,
    });
    itemId = await resolveQbItemId(supabase, project, { qbItemId: params.qbItemId });
  } catch (err) {
    const classified = classifyQbInvoiceError(err);
    const lastError = formatQbLastError(classified.code, classified.message);
    await supabase
      .from("coordination_costs")
      .update({
        qb_sync_status: classified.status,
        qb_last_error: lastError,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cost.id);
    return {
      created: false,
      reason: classified.status === "failed" ? "failed" : "uncertain",
      error: classified.message,
      error_code: classified.code,
      retryable: classified.retryable,
      request_id: requestId,
      billing: {
        qb_sync_status: classified.status,
        qb_last_error: lastError,
        qb_attempt_count: Number(cost.qb_attempt_count || 0) + 1,
        last_attempted_at: new Date().toISOString(),
        next_retry_at: classified.retryable ? computeNextRetryAt(new Date().toISOString(), classified.status) : null,
      },
    };
  }

  const payload = {
    CustomerRef: { value: String(customerId) },
    PrivateNote: memoForCost(project, record, cost),
    CustomerMemo: { value: memoForCost(project, record, cost) },
    Line: [
      {
        DetailType: "SalesItemLineDetail",
        Amount: Number(cost.actual_amount),
        Description: `Utility ${cost.cost_type} passthrough (zero markup)`,
        SalesItemLineDetail: {
          ItemRef: { value: String(itemId) },
          Qty: 1,
          UnitPrice: Number(cost.actual_amount),
        },
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
    const updated = await markInvoiceSucceeded(supabase, {
      cost,
      invoiceId,
      userId,
      requestId,
    });
    return {
      created: true,
      invoice_id: String(invoiceId),
      cost: updated,
      request_id: requestId,
      billing: billingSnapshot(updated),
    };
  } catch (err) {
    const classified = classifyQbInvoiceError(err);
    const requery = await queryInvoiceByRequestId(supabase, { requestId, queryFn });
    if (requery.found && requery.invoice_id) {
      const updated = await markInvoiceSucceeded(supabase, {
        cost,
        invoiceId: requery.invoice_id,
        userId,
        requestId,
      });
      return {
        created: false,
        reason: "recovered_after_uncertain",
        invoice_id: requery.invoice_id,
        cost: updated,
        billing: billingSnapshot(updated),
      };
    }

    const lastError = formatQbLastError(classified.code, classified.message);
    const failedAt = new Date().toISOString();
    await supabase
      .from("coordination_costs")
      .update({
        qb_sync_status: classified.status,
        qb_last_error: lastError,
        updated_at: failedAt,
      })
      .eq("id", cost.id);

    return {
      created: false,
      reason: classified.status === "uncertain" ? "uncertain" : "failed",
      error: classified.message,
      error_code: classified.code,
      retryable: classified.retryable,
      request_id: requestId,
      billing: {
        qb_sync_status: classified.status,
        qb_last_error: lastError,
        qb_attempt_count: Number(cost.qb_attempt_count || 0) + 1,
        last_attempted_at: failedAt,
        next_retry_at: classified.retryable ? computeNextRetryAt(failedAt, classified.status) : null,
      },
    };
  }
}

function billingSnapshot(cost) {
  if (!cost) return null;
  const status = String(cost.qb_sync_status || "");
  return {
    qb_sync_status: status,
    qb_last_error: cost.qb_last_error ?? null,
    qb_attempt_count: Number(cost.qb_attempt_count || 0),
    quickbooks_invoice_id: cost.quickbooks_invoice_id ?? null,
    client_billed_at: cost.client_billed_at ?? null,
    last_attempted_at: cost.updated_at ?? null,
    next_retry_at: computeNextRetryAt(cost.updated_at, status),
    ...parseQbLastError(cost.qb_last_error),
  };
}

/**
 * Retry ready/pending/retry/uncertain invoices. Never duplicates — always query RequestId first.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} [opts]
 */
async function retryPendingUciInvoices(supabase, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 100);
  const now = opts.now instanceof Date ? opts.now : new Date();
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
    const nextRetryAt = computeNextRetryAt(cost.updated_at, cost.qb_sync_status);
    if (nextRetryAt && now.getTime() < new Date(nextRetryAt).getTime()) {
      results.push({
        created: false,
        reason: "retry_scheduled",
        cost_id: cost.id,
        next_retry_at: nextRetryAt,
      });
      continue;
    }
    results.push(
      await createUciPassthroughInvoice(supabase, {
        cost,
        createInvoiceFn: opts.createInvoiceFn,
        queryFn: opts.queryFn,
        getValidConnectionFn: opts.getValidConnectionFn,
        getOrCreateCustomerFn: opts.getOrCreateCustomerFn,
      }),
    );
  }
  return { evaluated: results.length, results };
}

/**
 * Manual retry for a single paid cost. Idempotent via RequestId query.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function retryUciPassthroughInvoice(supabase, params) {
  const { costId, deps = {} } = params;
  const { data: cost } = await supabase.from("coordination_costs").select("*").eq("id", costId).maybeSingle();
  if (!cost) {
    const err = new Error("Cost not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  if (!cost.paid_at) {
    const err = new Error("Utility payment must be recorded before retrying client invoice");
    err.statusCode = 409;
    err.code = "COST_NOT_PAID";
    throw err;
  }
  if (cost.quickbooks_invoice_id) {
    return { cost, reason: "already_invoiced", billing: billingSnapshot(cost) };
  }
  if (String(cost.qb_sync_status) === "failed") {
    await supabase.from("coordination_costs").update({ qb_sync_status: "ready" }).eq("id", costId);
    cost.qb_sync_status = "ready";
  }
  const result = await createUciPassthroughInvoice(supabase, {
    cost,
    userId: params.userId || null,
    createInvoiceFn: deps.createInvoiceFn,
    queryFn: deps.queryFn,
    getValidConnectionFn: deps.getValidConnectionFn,
    getOrCreateCustomerFn: deps.getOrCreateCustomerFn,
    qbCustomerId: deps.qbCustomerId,
    qbItemId: deps.qbItemId,
  });
  const latest = result.cost || cost;
  return { ...result, cost: latest, billing: result.billing || billingSnapshot(latest) };
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
  const updated = await markInvoiceSucceeded(supabase, {
    cost,
    invoiceId: invoiceId || cost.quickbooks_invoice_id,
  });
  return { cost: updated, billing: billingSnapshot(updated) };
}

module.exports = {
  requestIdForCost,
  memoForCost,
  queryInvoiceByRequestId,
  classifyQbInvoiceError,
  formatQbLastError,
  parseQbLastError,
  computeNextRetryAt,
  billingSnapshot,
  createUciPassthroughInvoice,
  retryPendingUciInvoices,
  retryUciPassthroughInvoice,
  confirmUciInvoiceBilled,
};
