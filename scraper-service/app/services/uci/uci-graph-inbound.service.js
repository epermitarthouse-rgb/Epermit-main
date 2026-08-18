"use strict";

/**
 * Graph inbound email ingestion into the shared communications model (Phases §7.1).
 * Reuses per-user Microsoft mailbox OAuth (same as PEPCO MFA / Stage 4 transmit).
 * Idempotent on Graph message id / internetMessageId.
 */

const crypto = require("crypto");
const {
  getValidAccessTokenForUser,
  touchMailboxLastCheckedAt,
} = require("../microsoft/microsoft-graph-auth.service.js");
const { matchInboundToCoordination } = require("./uci-communication-matcher.service.js");
const { classifySingleCommunication } = require("./uci-communication-classifier.service.js");
const { emitUciEvent } = require("./uci-events.service.js");

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/**
 * @param {string} accessToken
 * @param {string} url
 */
async function graphGet(accessToken, url, fetchFn = fetch) {
  const r = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      Prefer: 'outlook.body-content-type="text"',
    },
  });
  const text = await r.text();
  /** @type {unknown} */
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text.slice(0, 200) };
  }
  return { ok: r.ok, status: r.status, json };
}

/**
 * @param {unknown} fromField
 */
function senderFromGraph(fromField) {
  const addr =
    fromField &&
    typeof fromField === "object" &&
    fromField !== null &&
    "emailAddress" in fromField
      ? /** @type {{ emailAddress?: { address?: string, name?: string } }} */ (fromField)
          .emailAddress
      : null;
  return addr?.address ? String(addr.address).trim().toLowerCase() : null;
}

/**
 * @param {Record<string, unknown>} message
 */
function normalizeGraphMessage(message) {
  const id = message.id != null ? String(message.id) : "";
  const internetMessageId =
    message.internetMessageId != null ? String(message.internetMessageId) : null;
  const conversationId =
    message.conversationId != null ? String(message.conversationId) : null;
  const bodyObj =
    message.body && typeof message.body === "object"
      ? /** @type {{ content?: string }} */ (message.body)
      : {};
  const bodyText =
    typeof bodyObj.content === "string"
      ? bodyObj.content
      : typeof message.bodyPreview === "string"
        ? String(message.bodyPreview)
        : "";

  const attachments = Array.isArray(message.hasAttachments)
    ? []
    : message.hasAttachments === true
      ? [{ present: true }]
      : [];

  return {
    external_message_id: id,
    internet_message_id: internetMessageId,
    conversation_id: conversationId,
    thread_id: conversationId,
    raw_subject: message.subject != null ? String(message.subject) : null,
    raw_body: bodyText,
    sender: senderFromGraph(message.from),
    recipient: null,
    message_timestamp: message.receivedDateTime
      ? String(message.receivedDateTime)
      : new Date().toISOString(),
    raw_attachments: attachments,
    idempotency_key: `graph:${internetMessageId || id}`,
  };
}

/**
 * Persist unmatched inbound (idempotent).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} row
 */
async function upsertUnmatchedInbound(supabase, row) {
  const { data: existing } = await supabase
    .from("uci_unmatched_inbound_messages")
    .select("*")
    .eq("idempotency_key", row.idempotency_key)
    .maybeSingle();

  if (existing) {
    return { row: existing, inserted: false };
  }

  const { data, error } = await supabase
    .from("uci_unmatched_inbound_messages")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    if (String(error.code) === "23505" || /duplicate/i.test(String(error.message))) {
      const { data: again } = await supabase
        .from("uci_unmatched_inbound_messages")
        .select("*")
        .eq("idempotency_key", row.idempotency_key)
        .maybeSingle();
      return { row: again, inserted: false };
    }
    throw Object.assign(new Error(error.message || "Unmatched inbound insert failed"), {
      cause: error,
      statusCode: 500,
      code: "UNMATCHED_INSERT_FAILED",
    });
  }

  return { row: data, inserted: true };
}

/**
 * Persist matched communication (idempotent on coordination + idempotency_key).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function upsertMatchedCommunication(supabase, params) {
  const { coordinationRecordId, projectId, tenantId, providerSlug, normalized, match } = params;

  const { data: existing } = await supabase
    .from("coordination_communications")
    .select("*")
    .eq("coordination_record_id", coordinationRecordId)
    .eq("idempotency_key", normalized.idempotency_key)
    .maybeSingle();

  if (existing) {
    return { communication: existing, inserted: false };
  }

  const row = {
    coordination_record_id: coordinationRecordId,
    project_id: projectId,
    tenant_id: tenantId ?? null,
    provider_slug: providerSlug ?? null,
    direction: "inbound",
    channel: "email",
    classification: null,
    classification_confidence: null,
    raw_subject: normalized.raw_subject,
    raw_body: normalized.raw_body,
    raw_attachments: normalized.raw_attachments || [],
    sender: normalized.sender,
    recipient: normalized.recipient,
    external_message_id: normalized.external_message_id,
    thread_id: normalized.thread_id,
    idempotency_key: normalized.idempotency_key,
    message_timestamp: normalized.message_timestamp,
    needs_human_attention: false,
    agent_processed_metadata: {
      source: "graph_inbound",
      internet_message_id: normalized.internet_message_id,
      conversation_id: normalized.conversation_id,
      match: {
        matched: true,
        confidence: match.confidence,
        reasons: match.reasons,
        candidates: match.candidates,
      },
    },
  };

  const { data, error } = await supabase
    .from("coordination_communications")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    if (String(error.code) === "23505" || /duplicate/i.test(String(error.message))) {
      const { data: again } = await supabase
        .from("coordination_communications")
        .select("*")
        .eq("coordination_record_id", coordinationRecordId)
        .eq("idempotency_key", normalized.idempotency_key)
        .maybeSingle();
      return { communication: again, inserted: false };
    }
    throw Object.assign(new Error(error.message || "Communication insert failed"), {
      cause: error,
      statusCode: 500,
      code: "COMMUNICATION_INSERT_FAILED",
    });
  }

  return { communication: data, inserted: true };
}

/**
 * Ingest one normalized inbound message (Graph or webhook payload).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function ingestInboundEmailMessage(supabase, params) {
  const {
    normalized,
    mailboxUserId = null,
    projectId = null,
    tenantId = null,
    providerSlug = null,
    deps = {},
  } = params;

  if (!normalized?.idempotency_key) {
    const err = new Error("Inbound message missing idempotency_key");
    err.statusCode = 400;
    err.code = "IDEMPOTENCY_REQUIRED";
    throw err;
  }

  const match = await matchInboundToCoordination(
    supabase,
    {
      raw_subject: normalized.raw_subject,
      raw_body: normalized.raw_body,
      sender: normalized.sender,
      thread_id: normalized.thread_id || normalized.conversation_id,
      provider_slug: providerSlug,
    },
    { projectId: projectId || undefined, tenantId: tenantId || undefined },
  );

  if (!match.matched || !match.coordination_record_id) {
    const unmatched = await upsertUnmatchedInbound(supabase, {
      project_id: projectId || match.project_id || null,
      tenant_id: tenantId,
      provider_slug: providerSlug,
      mailbox_user_id: mailboxUserId,
      external_message_id: normalized.external_message_id,
      internet_message_id: normalized.internet_message_id,
      conversation_id: normalized.conversation_id,
      idempotency_key: normalized.idempotency_key,
      direction: "inbound",
      channel: "email",
      sender: normalized.sender,
      recipient: normalized.recipient,
      raw_subject: normalized.raw_subject,
      raw_body: normalized.raw_body,
      raw_attachments: normalized.raw_attachments || [],
      message_timestamp: normalized.message_timestamp,
      match_status: "unmatched",
      match_candidates: match.candidates || [],
      needs_human_attention: true,
      agent_processed_metadata: {
        source: "graph_inbound",
        match,
      },
    });

    emitUciEvent(
      "uci.communication.unmatched",
      {
        idempotency_key: normalized.idempotency_key,
        unmatched_id: unmatched.row?.id,
        project_id: projectId,
      },
      { supabase },
    );

    return {
      status: "unmatched",
      unmatched: unmatched.row,
      inserted: unmatched.inserted,
      match,
      communication: null,
      classification: null,
    };
  }

  const upserted = await upsertMatchedCommunication(supabase, {
    coordinationRecordId: match.coordination_record_id,
    projectId: match.project_id || projectId,
    tenantId,
    providerSlug,
    normalized,
    match,
  });

  let classification = null;
  if (upserted.inserted || !upserted.communication?.classification) {
    classification = await classifySingleCommunication(supabase, {
      communicationId: String(upserted.communication.id),
      deps,
    });
  }

  emitUciEvent(
    "uci.communication.ingested",
    {
      communication_id: upserted.communication?.id,
      coordination_record_id: match.coordination_record_id,
      project_id: match.project_id,
      source: "graph_inbound",
      inserted: upserted.inserted,
    },
    { supabase },
  );

  return {
    status: "matched",
    unmatched: null,
    inserted: upserted.inserted,
    match,
    communication: classification?.communication || upserted.communication,
    classification,
  };
}

/**
 * Poll connected user mailbox for recent inbound messages and ingest.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function pollGraphInboundForUser(supabase, params) {
  const {
    userId,
    projectId = null,
    tenantId = null,
    providerSlug = null,
    top = 25,
    receivedAfterIso = null,
    deps = {},
  } = params;

  const fetchFn = typeof deps.fetchFn === "function" ? deps.fetchFn : fetch;
  const tokenFn =
    typeof deps.getAccessTokenFn === "function"
      ? deps.getAccessTokenFn
      : getValidAccessTokenForUser;

  const accessToken = await tokenFn(supabase, userId);
  if (!accessToken) {
    const err = new Error("Microsoft mailbox not connected for user");
    err.statusCode = 409;
    err.code = "MAILBOX_NOT_CONNECTED";
    throw err;
  }

  const select =
    "id,receivedDateTime,subject,bodyPreview,body,from,internetMessageId,conversationId,hasAttachments";
  let url =
    `${GRAPH_BASE}/me/messages?$top=${encodeURIComponent(String(Math.min(top, 50)))}` +
    `&$orderby=${encodeURIComponent("receivedDateTime desc")}` +
    `&$select=${encodeURIComponent(select)}`;

  if (receivedAfterIso) {
    url += `&$filter=${encodeURIComponent(`receivedDateTime ge ${receivedAfterIso}`)}`;
  }

  const listed = await graphGet(accessToken, url, fetchFn);
  if (!listed.ok) {
    const err = new Error("Graph mailbox list failed");
    err.statusCode = 502;
    err.code = "GRAPH_INBOUND_LIST_FAILED";
    err.details = { status: listed.status };
    throw err;
  }

  const values = Array.isArray(/** @type {{ value?: unknown }} */ (listed.json).value)
    ? /** @type {{ value: Array<Record<string, unknown>> }} */ (listed.json).value
    : [];

  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  for (const message of values) {
    // Skip drafts / sent-looking when from is self — still allow utility replies
    const normalized = normalizeGraphMessage(message);
    if (!normalized.external_message_id) continue;

    // Optionally fetch attachments metadata
    if (message.hasAttachments === true && normalized.external_message_id) {
      try {
        const attUrl = `${GRAPH_BASE}/me/messages/${encodeURIComponent(normalized.external_message_id)}/attachments?$select=id,name,contentType,size`;
        const att = await graphGet(accessToken, attUrl, fetchFn);
        if (att.ok && att.json && typeof att.json === "object") {
          const attValues = /** @type {{ value?: unknown }} */ (att.json).value;
          if (Array.isArray(attValues)) {
            normalized.raw_attachments = attValues.map((a) => ({
              id: a.id,
              name: a.name,
              contentType: a.contentType,
              size: a.size,
            }));
          }
        }
      } catch {
        // Non-fatal — message body still ingested
      }
    }

    const result = await ingestInboundEmailMessage(supabase, {
      normalized,
      mailboxUserId: userId,
      projectId,
      tenantId,
      providerSlug,
      deps,
    });
    results.push(result);
  }

  try {
    await touchMailboxLastCheckedAt(supabase, userId);
  } catch {
    // non-fatal
  }

  return {
    polled: values.length,
    ingested: results.length,
    matched: results.filter((r) => r.status === "matched").length,
    unmatched: results.filter((r) => r.status === "unmatched").length,
    results,
  };
}

/**
 * Webhook-style ingest: tenant_slug + raw email fields (Phases §7.1 address pattern).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} payload
 */
async function ingestEmailInboundWebhook(supabase, payload) {
  const tenantSlug = String(payload.tenant_slug || "").trim().toLowerCase();
  const subject = payload.subject != null ? String(payload.subject) : null;
  const body = payload.body != null ? String(payload.body) : payload.text != null ? String(payload.text) : null;
  const sender = payload.from != null ? String(payload.from) : payload.sender != null ? String(payload.sender) : null;
  const messageId =
    payload.message_id != null
      ? String(payload.message_id)
      : payload.internet_message_id != null
        ? String(payload.internet_message_id)
        : `webhook-${crypto.createHash("sha256").update(`${sender}|${subject}|${body}`).digest("hex").slice(0, 32)}`;

  /** @type {string | null} */
  let tenantId = null;
  /** @type {string | null} */
  let projectId = payload.project_id ? String(payload.project_id) : null;

  if (tenantSlug) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id")
      .eq("slug", tenantSlug)
      .maybeSingle();
    tenantId = tenant?.id ? String(tenant.id) : null;
  }

  const normalized = {
    external_message_id: messageId,
    internet_message_id: payload.internet_message_id ? String(payload.internet_message_id) : messageId,
    conversation_id: payload.conversation_id ? String(payload.conversation_id) : null,
    thread_id: payload.thread_id || payload.conversation_id || null,
    raw_subject: subject,
    raw_body: body,
    sender,
    recipient: payload.to != null ? String(payload.to) : null,
    message_timestamp: payload.received_at || new Date().toISOString(),
    raw_attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    idempotency_key: `webhook:${messageId}`,
  };

  return ingestInboundEmailMessage(supabase, {
    normalized,
    projectId,
    tenantId,
    providerSlug: payload.provider_slug ? String(payload.provider_slug) : null,
    deps: payload.deps || {},
  });
}

module.exports = {
  normalizeGraphMessage,
  ingestInboundEmailMessage,
  pollGraphInboundForUser,
  ingestEmailInboundWebhook,
  upsertUnmatchedInbound,
  upsertMatchedCommunication,
};
