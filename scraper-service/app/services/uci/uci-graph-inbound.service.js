"use strict";

/**
 * Graph inbound email ingestion into the shared communications model (Phases §7.1).
 * Reuses per-user Microsoft mailbox OAuth (same as PEPCO MFA / Stage 4 transmit).
 * Idempotent on Graph message id / internetMessageId.
 * Self-send echoes of known outbound transmissions are linked — not re-ingested as Needs Attention.
 */

const crypto = require("crypto");
const {
  getValidAccessTokenForUser,
  touchMailboxLastCheckedAt,
} = require("../microsoft/microsoft-graph-auth.service.js");
const { matchInboundToCoordination } = require("./uci-communication-matcher.service.js");
const { classifySingleCommunication } = require("./uci-communication-classifier.service.js");
const { emitUciEvent } = require("./uci-events.service.js");
const {
  persistGraphAttachmentsForCommunication,
} = require("./uci-graph-attachment-persist.service.js");
const {
  DEFAULT_LEASE_TTL_SECONDS,
  DEFAULT_LOOKBACK_HOURS,
  claimMailboxLease,
  releaseMailboxLease,
  computeGraphReceivedAfter,
  computeNextWatermark,
  emptyInboundMetrics,
} = require("./uci-graph-inbound-mailbox-state.service.js");

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const OWN_PACKAGE_SUBJECT_RE = /utility\s+coordination\s+application\s+package/i;

const UNMATCHED_REMATCH_BACKOFF_MS = Math.min(
  Math.max(Number(process.env.UCI_UNMATCHED_REMATCH_BACKOFF_MS || 6 * 60 * 60 * 1000), 60_000),
  7 * 24 * 60 * 60 * 1000,
);

const EXISTING_COMM_SELECT = [
  "id",
  "coordination_record_id",
  "project_id",
  "direction",
  "classification",
  "raw_attachments",
  "needs_human_attention",
  "idempotency_key",
  "external_message_id",
  "sender",
  "raw_subject",
  "thread_id",
  "message_timestamp",
  "agent_processed_metadata",
].join(",");

const EXISTING_UNMATCHED_SELECT = [
  "id",
  "idempotency_key",
  "match_status",
  "project_id",
  "tenant_id",
  "provider_slug",
  "mailbox_user_id",
  "external_message_id",
  "internet_message_id",
  "conversation_id",
  "sender",
  "recipient",
  "raw_subject",
  "raw_body",
  "raw_attachments",
  "message_timestamp",
  "last_match_attempted_at",
  "next_rematch_at",
  "updated_at",
  "created_at",
  "agent_processed_metadata",
].join(",");

const OUTBOUND_ECHO_SELECT = EXISTING_COMM_SELECT;

/**
 * @param {Record<string, number> | null | undefined} metrics
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function timedQuery(metrics, fn) {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    if (metrics) {
      metrics.query_duration_ms = (metrics.query_duration_ms || 0) + (Date.now() - started);
    }
  }
}

/**
 * Controlled rematch only: manual retry, relevant data change, or backoff.
 *
 * @param {Record<string, unknown>} unmatched
 * @param {object} [opts]
 */
function shouldRematchUnmatched(unmatched, opts = {}) {
  if (!unmatched) return { rematch: true, reason: "missing" };
  if (String(unmatched.match_status || "") === "matched") {
    return { rematch: false, reason: "already_matched" };
  }
  if (opts.forceRematch) return { rematch: true, reason: "manual_retry" };

  const now = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const lastAttempt =
    unmatched.last_match_attempted_at || unmatched.updated_at || unmatched.created_at;
  const lastMs = lastAttempt ? new Date(String(lastAttempt)).getTime() : NaN;

  if (opts.latestCoordinationUpdatedAt) {
    const changedMs = new Date(String(opts.latestCoordinationUpdatedAt)).getTime();
    if (Number.isFinite(changedMs) && Number.isFinite(lastMs) && changedMs > lastMs) {
      return { rematch: true, reason: "data_change" };
    }
  }

  if (unmatched.next_rematch_at) {
    const nextMs = new Date(String(unmatched.next_rematch_at)).getTime();
    if (Number.isFinite(nextMs) && now >= nextMs) {
      return { rematch: true, reason: "backoff" };
    }
    return { rematch: false, reason: "backoff_pending" };
  }

  return { rematch: false, reason: "awaiting_backoff_schedule" };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} unmatched
 */
async function scheduleUnmatchedBackoff(supabase, unmatched) {
  if (!unmatched?.id) return;
  const now = new Date();
  const next = new Date(now.getTime() + UNMATCHED_REMATCH_BACKOFF_MS).toISOString();
  try {
    await supabase
      .from("uci_unmatched_inbound_messages")
      .update({
        last_match_attempted_at:
          unmatched.last_match_attempted_at || unmatched.updated_at || now.toISOString(),
        next_rematch_at: next,
      })
      .eq("id", String(unmatched.id));
  } catch {
    // best-effort schedule
  }
}

/**
 * Cheap duplicate detection before echo lookup or matching.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} normalized
 * @param {Record<string, number> | null} [metrics]
 */
async function findExistingInboundState(supabase, normalized, metrics) {
  const key = String(normalized?.idempotency_key || "");
  if (!key) return { communication: null, unmatched: null, echo: null };

  const communication = await timedQuery(metrics, async () => {
    const { data } = await supabase
      .from("coordination_communications")
      .select(EXISTING_COMM_SELECT)
      .eq("idempotency_key", key)
      .maybeSingle();
    return data || null;
  });

  const unmatched = await timedQuery(metrics, async () => {
    const first = await supabase
      .from("uci_unmatched_inbound_messages")
      .select(EXISTING_UNMATCHED_SELECT)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (first.error && /last_match_attempted_at|next_rematch_at/i.test(String(first.error.message))) {
      const fallback = await supabase
        .from("uci_unmatched_inbound_messages")
        .select("id, idempotency_key, match_status, project_id, updated_at, created_at")
        .eq("idempotency_key", key)
        .maybeSingle();
      return fallback.data || null;
    }
    return first.data || null;
  });

  /** @type {Record<string, unknown> | null} */
  let echo = null;
  if (!communication) {
    echo = await timedQuery(metrics, async () => {
      try {
        const query = supabase.from("coordination_communications").select(OUTBOUND_ECHO_SELECT);
        if (typeof query.filter !== "function") return null;
        const { data } = await query
          .filter("agent_processed_metadata->inbound_echo->>idempotency_key", "eq", key)
          .limit(1)
          .maybeSingle();
        return data || null;
      } catch {
        return null;
      }
    });
  }

  return { communication, unmatched, echo };
}

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
function emailsEqual(a, b) {
  const left = String(a || "")
    .trim()
    .toLowerCase();
  const right = String(b || "")
    .trim()
    .toLowerCase();
  return Boolean(left && right && left === right);
}

/**
 * Detect Graph inbox echo of our own Stage 4 outbound transmission (self-send / Sent Items).
 * Does not suppress genuine utility replies (different sender).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} normalized
 */
async function findLinkedOutboundEcho(supabase, normalized) {
  const subject = String(normalized.raw_subject || "").trim();
  const sender = String(normalized.sender || "")
    .trim()
    .toLowerCase();
  const conversationId = normalized.conversation_id || normalized.thread_id || null;
  const internetMessageId = normalized.internet_message_id
    ? String(normalized.internet_message_id)
    : null;
  const graphId = normalized.external_message_id ? String(normalized.external_message_id) : null;

  /** @type {Array<Record<string, unknown>>} */
  let candidates = [];

  if (conversationId) {
    const { data } = await supabase
      .from("coordination_communications")
      .select(OUTBOUND_ECHO_SELECT)
      .eq("direction", "outbound")
      .eq("thread_id", String(conversationId))
      .order("message_timestamp", { ascending: false })
      .limit(8);
    if (Array.isArray(data)) candidates.push(...data);
  }

  if (graphId) {
    const { data } = await supabase
      .from("coordination_communications")
      .select(OUTBOUND_ECHO_SELECT)
      .eq("direction", "outbound")
      .eq("external_message_id", graphId)
      .limit(4);
    if (Array.isArray(data)) candidates.push(...data);
  }

  if (subject && candidates.length === 0) {
    const { data } = await supabase
      .from("coordination_communications")
      .select(OUTBOUND_ECHO_SELECT)
      .eq("direction", "outbound")
      .eq("raw_subject", subject)
      .order("message_timestamp", { ascending: false })
      .limit(12);
    if (Array.isArray(data)) candidates.push(...data);
  }

  const seen = new Set();
  for (const outbound of candidates) {
    if (!outbound?.id || seen.has(String(outbound.id))) continue;
    seen.add(String(outbound.id));

    const outMeta =
      outbound.agent_processed_metadata &&
      typeof outbound.agent_processed_metadata === "object" &&
      !Array.isArray(outbound.agent_processed_metadata)
        ? /** @type {Record<string, unknown>} */ (outbound.agent_processed_metadata)
        : {};

    const outSender = String(outbound.sender || "")
      .trim()
      .toLowerCase();
    const outInternet =
      outMeta.internet_message_id != null ? String(outMeta.internet_message_id) : null;
    const sameGraphId =
      graphId && outbound.external_message_id && String(outbound.external_message_id) === graphId;
    const sameInternet =
      internetMessageId && outInternet && internetMessageId === outInternet;
    const sameThread =
      conversationId &&
      outbound.thread_id &&
      String(outbound.thread_id) === String(conversationId);
    const sameSubject =
      subject &&
      outbound.raw_subject &&
      String(outbound.raw_subject).trim() === subject;
    const senderIsSelf = Boolean(sender && outSender && emailsEqual(sender, outSender));

    // Self-send: sender matches the outbound Commun-ET mailbox (or exact Graph/internet id).
    const isSelfEcho =
      sameGraphId ||
      sameInternet ||
      (senderIsSelf && (sameThread || sameSubject)) ||
      (OWN_PACKAGE_SUBJECT_RE.test(subject) &&
        senderIsSelf &&
        (sameSubject || sameThread) &&
        (outMeta.source === "stage4_live_transmit" || outMeta.stage5_handoff === true));

    if (!isSelfEcho) continue;

    // Extra safety: never treat a different sender as echo when only thread matches.
    if (!sameGraphId && !sameInternet && sender && outSender && !senderIsSelf) {
      continue;
    }

    return outbound;
  }

  return null;
}

/**
 * Annotate existing outbound with inbox echo metadata; do not create a new inbound row.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} outbound
 * @param {object} normalized
 */
async function linkOutboundEcho(supabase, outbound, normalized) {
  const existingMeta =
    outbound.agent_processed_metadata &&
    typeof outbound.agent_processed_metadata === "object" &&
    !Array.isArray(outbound.agent_processed_metadata)
      ? /** @type {Record<string, unknown>} */ (outbound.agent_processed_metadata)
      : {};

  const patchMeta = {
    ...existingMeta,
    internet_message_id:
      existingMeta.internet_message_id || normalized.internet_message_id || null,
    inbound_echo: {
      linked_at: new Date().toISOString(),
      graph_message_id: normalized.external_message_id || null,
      internet_message_id: normalized.internet_message_id || null,
      conversation_id: normalized.conversation_id || null,
      idempotency_key: normalized.idempotency_key || null,
      reason: "self_send_or_sent_items_echo",
    },
  };

  const { data } = await supabase
    .from("coordination_communications")
    .update({
      needs_human_attention: false,
      agent_processed_metadata: patchMeta,
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(outbound.id))
    .select(OUTBOUND_ECHO_SELECT)
    .maybeSingle();

  return data || { ...outbound, agent_processed_metadata: patchMeta, needs_human_attention: false };
}

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
  const now = new Date();
  const attemptAt = now.toISOString();
  const nextRematch = new Date(now.getTime() + UNMATCHED_REMATCH_BACKOFF_MS).toISOString();

  const { data: existing } = await supabase
    .from("uci_unmatched_inbound_messages")
    .select(EXISTING_UNMATCHED_SELECT)
    .eq("idempotency_key", row.idempotency_key)
    .maybeSingle();

  if (existing) {
    const { data: updated } = await supabase
      .from("uci_unmatched_inbound_messages")
      .update({
        match_candidates: row.match_candidates ?? existing.match_candidates,
        agent_processed_metadata: row.agent_processed_metadata ?? existing.agent_processed_metadata,
        last_match_attempted_at: attemptAt,
        next_rematch_at: nextRematch,
        updated_at: attemptAt,
      })
      .eq("id", String(existing.id))
      .select(EXISTING_UNMATCHED_SELECT)
      .maybeSingle();
    return { row: updated || existing, inserted: false, rematched: true };
  }

  const insertRow = {
    ...row,
    last_match_attempted_at: attemptAt,
    next_rematch_at: nextRematch,
  };

  const { data, error } = await supabase
    .from("uci_unmatched_inbound_messages")
    .insert(insertRow)
    .select(EXISTING_UNMATCHED_SELECT)
    .single();

  if (error) {
    if (String(error.code) === "23505" || /duplicate/i.test(String(error.message))) {
      const { data: again } = await supabase
        .from("uci_unmatched_inbound_messages")
        .select(EXISTING_UNMATCHED_SELECT)
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
    .select(EXISTING_COMM_SELECT)
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
    .select(EXISTING_COMM_SELECT)
    .single();

  if (error) {
    if (String(error.code) === "23505" || /duplicate/i.test(String(error.message))) {
      const { data: again } = await supabase
        .from("coordination_communications")
        .select(EXISTING_COMM_SELECT)
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
    accessToken = null,
    deps = {},
    metrics: metricsArg = null,
    forceRematch: forceRematchArg = false,
    latestCoordinationUpdatedAt = null,
  } = params;

  if (!normalized?.idempotency_key) {
    const err = new Error("Inbound message missing idempotency_key");
    err.statusCode = 400;
    err.code = "IDEMPOTENCY_REQUIRED";
    throw err;
  }

  const metrics = metricsArg || deps.metrics || null;
  const forceRematch = forceRematchArg === true || deps.forceRematch === true;
  const latestUpdatedAt =
    latestCoordinationUpdatedAt || deps.latestCoordinationUpdatedAt || null;
  const matchFn =
    typeof deps.matchInboundToCoordination === "function"
      ? deps.matchInboundToCoordination
      : matchInboundToCoordination;

  const existing = await findExistingInboundState(supabase, normalized, metrics);

  if (existing.communication && existing.communication.direction !== "outbound" && !forceRematch) {
    if (metrics) {
      metrics.messages_skipped_duplicate = (metrics.messages_skipped_duplicate || 0) + 1;
    }
    return {
      status: "skipped_duplicate",
      skipped_reason: "already_matched",
      unmatched: null,
      inserted: false,
      match: {
        matched: true,
        coordination_record_id: existing.communication.coordination_record_id,
        reason: "already_matched",
      },
      communication: existing.communication,
      classification: null,
    };
  }

  if (existing.echo && !forceRematch) {
    if (metrics) {
      metrics.messages_skipped_duplicate = (metrics.messages_skipped_duplicate || 0) + 1;
    }
    return {
      status: "skipped_duplicate",
      skipped_reason: "already_linked_echo",
      unmatched: null,
      inserted: false,
      match: {
        matched: true,
        coordination_record_id: existing.echo.coordination_record_id,
        reason: "already_linked_echo",
      },
      communication: existing.echo,
      classification: null,
    };
  }

  if (existing.unmatched && String(existing.unmatched.match_status || "") !== "matched") {
    const decision = shouldRematchUnmatched(existing.unmatched, {
      forceRematch,
      latestCoordinationUpdatedAt: latestUpdatedAt,
      nowMs: deps.nowMs,
    });
    if (!decision.rematch) {
      if (!existing.unmatched.next_rematch_at) {
        await scheduleUnmatchedBackoff(supabase, existing.unmatched);
      }
      if (metrics) {
        metrics.messages_skipped_duplicate = (metrics.messages_skipped_duplicate || 0) + 1;
      }
      return {
        status: "skipped_unmatched",
        skipped_reason: decision.reason,
        unmatched: existing.unmatched,
        inserted: false,
        match: { matched: false, unmatched: true, reason: decision.reason },
        communication: null,
        classification: null,
      };
    }
    if (metrics) {
      metrics.messages_rematched = (metrics.messages_rematched || 0) + 1;
    }
  } else if (metrics) {
    metrics.messages_new = (metrics.messages_new || 0) + 1;
  }

  // Link self-send / Sent Items echoes to existing outbound transmission — do not create
  // a second inbound Needs Attention row for our own application package.
  const outboundEcho = await findLinkedOutboundEcho(supabase, normalized);
  if (outboundEcho) {
    const linked = await linkOutboundEcho(supabase, outboundEcho, normalized);
    emitUciEvent(
      "uci.communication.outbound_echo_linked",
      {
        outbound_communication_id: linked?.id || outboundEcho.id,
        idempotency_key: normalized.idempotency_key,
        graph_message_id: normalized.external_message_id,
      },
      { supabase },
    );
    return {
      status: "linked_outbound_echo",
      unmatched: null,
      inserted: false,
      match: {
        matched: true,
        coordination_record_id: linked?.coordination_record_id || outboundEcho.coordination_record_id,
        reason: "outbound_echo",
      },
      communication: linked,
      classification: null,
    };
  }

  const match = await timedQuery(metrics, () =>
    matchFn(
      supabase,
      {
        raw_subject: normalized.raw_subject,
        raw_body: normalized.raw_body,
        sender: normalized.sender,
        thread_id: normalized.thread_id || normalized.conversation_id,
        provider_slug: providerSlug,
        message_timestamp: normalized.message_timestamp,
      },
      { projectId: projectId || undefined, tenantId: tenantId || undefined },
    ),
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

  /** @type {Record<string, unknown> | null} */
  let attachmentResult = null;
  let communication = upserted.communication;

  const existingAtts = Array.isArray(communication?.raw_attachments)
    ? communication.raw_attachments
    : [];
  const alreadyPersisted =
    existingAtts.length > 0 &&
    existingAtts.every(
      (a) =>
        a &&
        typeof a === "object" &&
        (a.project_document_id || a.unsupported === true || a.persisted === true),
    );

  if (
    accessToken &&
    communication &&
    (upserted.inserted || !alreadyPersisted) &&
    deps.skipAttachmentPersist !== true
  ) {
    attachmentResult = await persistGraphAttachmentsForCommunication(supabase, {
      accessToken,
      communication,
      coordinationRecordId: String(match.coordination_record_id),
      projectId: String(match.project_id || projectId),
      mailboxUserId,
      normalized,
      fetchFn: deps.fetchFn || fetch,
      deps,
    });
    if (attachmentResult?.communication) {
      communication = attachmentResult.communication;
    }
  }

  let classification = null;
  try {
    const { isBounceMessage, applyEmailBounce } = require("./uci-email-bounce.service.js");
    if (isBounceMessage(normalized) || isBounceMessage(communication)) {
      const bounce = await applyEmailBounce(supabase, {
        projectId: String(match.project_id || projectId),
        internetMessageId: normalized.internet_message_id,
        graphMessageId: normalized.id,
        communication,
      });
      if (bounce.bounced) {
        await supabase
          .from("coordination_communications")
          .update({
            needs_human_attention: true,
            classification: "escalation_or_problem",
            parsed_summary: "Outbound utility submission email bounced",
          })
          .eq("id", communication.id);
        const { raiseUciAlert } = require("./uci-alerts.service.js");
        const { data: rec } = await supabase
          .from("coordination_records")
          .select("*")
          .eq("id", bounce.coordination_record_id)
          .maybeSingle();
        if (rec) {
          await raiseUciAlert(supabase, {
            record: rec,
            severity: "P1",
            code: "EMAIL_BOUNCE",
            message: "Utility submission email bounced",
          }).catch(() => null);
        }
      }
    }
  } catch {
    /* bounce handling is best-effort */
  }

  if (upserted.inserted || !communication?.classification) {
    classification = await classifySingleCommunication(supabase, {
      communicationId: String(communication.id),
      deps: {
        ...deps,
        stage6Attachments: attachmentResult?.parser_buffers || [],
      },
    });
  } else if (
    attachmentResult?.parser_buffers?.length &&
    deps.skipStage6Retry !== true
  ) {
    // Attachments recovered on a later poll after classification already ran —
    // still forward into Stage 6 when eligible.
    const { maybeEnterStage6FromCommunication } = require("./uci-stage6-entry.service.js");
    classification = {
      communication,
      skipped: true,
      stage_6: await maybeEnterStage6FromCommunication(supabase, {
        communication,
        deps: {
          ...deps,
          stage6Attachments: attachmentResult.parser_buffers,
        },
      }),
    };
  }

  emitUciEvent(
    "uci.communication.ingested",
    {
      communication_id: communication?.id,
      coordination_record_id: match.coordination_record_id,
      project_id: match.project_id,
      source: "graph_inbound",
      inserted: upserted.inserted,
      attachment_count: attachmentResult?.attachments?.length ?? existingAtts.length,
    },
    { supabase },
  );

  return {
    status: "matched",
    unmatched: null,
    inserted: upserted.inserted,
    match,
    communication: classification?.communication || communication,
    classification,
    attachments: attachmentResult,
  };
}

/**
 * Promote a row from uci_unmatched_inbound_messages into the matched pipeline.
 * Idempotent when the communication already exists.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function reprocessUnmatchedInboundMessage(supabase, params) {
  const {
    unmatchedId,
    projectId = null,
    tenantId = null,
    providerSlug = null,
    mailboxUserId = null,
    accessToken = null,
    deps = {},
  } = params;

  const { data: row, error } = await supabase
    .from("uci_unmatched_inbound_messages")
    .select("*")
    .eq("id", unmatchedId)
    .maybeSingle();
  if (error || !row) {
    const err = new Error("Unmatched inbound message not found");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const normalized = {
    external_message_id: row.external_message_id ? String(row.external_message_id) : null,
    internet_message_id: row.internet_message_id ? String(row.internet_message_id) : null,
    conversation_id: row.conversation_id ? String(row.conversation_id) : null,
    thread_id: row.conversation_id ? String(row.conversation_id) : null,
    raw_subject: row.raw_subject ?? null,
    raw_body: row.raw_body ?? null,
    sender: row.sender ?? null,
    recipient: row.recipient ?? null,
    message_timestamp: row.message_timestamp ?? row.created_at ?? new Date().toISOString(),
    raw_attachments: Array.isArray(row.raw_attachments) ? row.raw_attachments : [],
    idempotency_key: row.idempotency_key
      ? String(row.idempotency_key)
      : `graph:${row.external_message_id || row.internet_message_id || row.id}`,
  };

  const result = await ingestInboundEmailMessage(supabase, {
    normalized,
    mailboxUserId: mailboxUserId || row.mailbox_user_id || null,
    projectId: projectId || row.project_id || null,
    tenantId,
    providerSlug: providerSlug || row.provider_slug || null,
    accessToken,
    forceRematch: true,
    deps: { ...deps, forceRematch: true },
  });

  if (result.status === "matched" || result.status === "linked_outbound_echo") {
    await supabase
      .from("uci_unmatched_inbound_messages")
      .update({
        match_status: "matched",
        needs_human_attention: false,
        updated_at: new Date().toISOString(),
        agent_processed_metadata: {
          ...(row.agent_processed_metadata &&
          typeof row.agent_processed_metadata === "object" &&
          !Array.isArray(row.agent_processed_metadata)
            ? row.agent_processed_metadata
            : {}),
          reprocessed_at: new Date().toISOString(),
          reprocess_result: {
            status: result.status,
            communication_id: result.communication?.id ?? null,
          },
        },
      })
      .eq("id", unmatchedId);
  }

  return {
    unmatched_id: unmatchedId,
    ...result,
  };
}

/**
 * Poll connected user mailbox for recent inbound messages and ingest.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
/**
 * @param {string} accessToken
 * @param {object} params
 */
async function listInboundGraphMessages(accessToken, params) {
  const { top, receivedAfterIso, fetchFn } = params;
  const select =
    "id,receivedDateTime,subject,bodyPreview,body,from,internetMessageId,conversationId,hasAttachments";
  const buildUrl = (order) => {
    let url =
      `${GRAPH_BASE}/me/messages?$top=${encodeURIComponent(String(Math.min(top, 50)))}` +
      `&$orderby=${encodeURIComponent(`receivedDateTime ${order}`)}` +
      `&$select=${encodeURIComponent(select)}`;
    if (receivedAfterIso) {
      url += `&$filter=${encodeURIComponent(`receivedDateTime ge ${receivedAfterIso}`)}`;
    }
    return url;
  };

  let listed = await graphGet(accessToken, buildUrl("asc"), fetchFn);
  if (!listed.ok) {
    listed = await graphGet(accessToken, buildUrl("desc"), fetchFn);
  }
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

  values.sort((a, b) => {
    const ta = new Date(String(a.receivedDateTime || 0)).getTime();
    const tb = new Date(String(b.receivedDateTime || 0)).getTime();
    return ta - tb;
  });
  return values;
}

/**
 * Bounded rematch of unmatched rows that are due (backoff or data change).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function rematchDueUnmatchedForMailbox(supabase, params) {
  const {
    userId,
    limit = 5,
    latestCoordinationUpdatedAt = null,
    deps = {},
    metrics = null,
  } = params;
  if (!userId) return { rematched: 0, ids: [] };

  const nowIso = new Date(Number.isFinite(deps.nowMs) ? deps.nowMs : Date.now()).toISOString();
  const ids = new Set();

  const dueBackoff = await timedQuery(metrics, async () => {
    const { data } = await supabase
      .from("uci_unmatched_inbound_messages")
      .select("id")
      .eq("mailbox_user_id", userId)
      .eq("match_status", "unmatched")
      .lte("next_rematch_at", nowIso)
      .order("next_rematch_at", { ascending: true })
      .limit(limit);
    return Array.isArray(data) ? data : [];
  });
  for (const row of dueBackoff) {
    if (row?.id) ids.add(String(row.id));
  }

  if (latestCoordinationUpdatedAt && ids.size < limit) {
    const dueChange = await timedQuery(metrics, async () => {
      const { data } = await supabase
        .from("uci_unmatched_inbound_messages")
        .select("id")
        .eq("mailbox_user_id", userId)
        .eq("match_status", "unmatched")
        .lt("last_match_attempted_at", latestCoordinationUpdatedAt)
        .limit(limit - ids.size);
      return Array.isArray(data) ? data : [];
    });
    for (const row of dueChange) {
      if (row?.id) ids.add(String(row.id));
    }
  }

  let rematched = 0;
  for (const unmatchedId of ids) {
    await reprocessUnmatchedInboundMessage(supabase, {
      unmatchedId,
      mailboxUserId: userId,
      accessToken: params.accessToken || null,
      deps: { ...deps, forceRematch: true, metrics },
    });
    rematched += 1;
  }
  return { rematched, ids: [...ids] };
}

/**
 * Poll connected user mailbox for recent inbound messages and ingest.
 *
 * Automatic polls use a failure-safe Graph cursor and a mailbox lease.
 * Manual polls may pass receivedAfterIso to rescan a window without moving
 * the cursor. Already-processed messages skip matching.
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
    leaseOwner = null,
    skipLease = false,
    lookbackHours = DEFAULT_LOOKBACK_HOURS,
  } = params;

  const useCursor = params.useCursor != null ? params.useCursor === true : receivedAfterIso == null;
  const fetchFn = typeof deps.fetchFn === "function" ? deps.fetchFn : fetch;
  const tokenFn =
    typeof deps.getAccessTokenFn === "function"
      ? deps.getAccessTokenFn
      : getValidAccessTokenForUser;
  const claimFn =
    typeof deps.claimMailboxLeaseFn === "function" ? deps.claimMailboxLeaseFn : claimMailboxLease;
  const releaseFn =
    typeof deps.releaseMailboxLeaseFn === "function" ? deps.releaseMailboxLeaseFn : releaseMailboxLease;
  const metrics = deps.metrics || emptyInboundMetrics();
  const cycleStarted = Date.now();
  const owner = String(leaseOwner || deps.leaseOwner || `graph-inbound-${process.pid}`).trim();

  let claimed = { claimed: true, fallback: true, row: null };
  if (!skipLease) {
    claimed = await claimFn(supabase, {
      userId,
      owner,
      ttlSeconds: deps.leaseTtlSeconds || DEFAULT_LEASE_TTL_SECONDS,
    });
    if (!claimed?.claimed) {
      metrics.lease_skipped = 1;
      metrics.cycle_duration_ms = Date.now() - cycleStarted;
      return {
        skipped: true,
        reason: "mailbox_lease_held",
        polled: 0,
        ingested: 0,
        matched: 0,
        unmatched: 0,
        results: [],
        metrics,
      };
    }
  }

  const previousWatermark = useCursor ? claimed.row?.watermark_received_at || null : null;
  let nextWatermark = previousWatermark;
  const successfulReceivedAts = [];
  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  let values = [];
  let hadFailure = false;
  let graphError = null;

  try {
    const accessToken = await tokenFn(supabase, userId);
    if (!accessToken) {
      const err = new Error("Microsoft mailbox not connected for user");
      err.statusCode = 409;
      err.code = "MAILBOX_NOT_CONNECTED";
      throw err;
    }

    const filterAfter =
      receivedAfterIso ||
      (useCursor
        ? computeGraphReceivedAfter({
            watermarkReceivedAt: previousWatermark,
            lookbackHours,
            nowMs: deps.nowMs,
            skewMs: deps.cursorSkewMs,
          })
        : null);

    const graphStarted = Date.now();
    values = await listInboundGraphMessages(accessToken, {
      top,
      receivedAfterIso: filterAfter,
      fetchFn,
    });
    metrics.graph_duration_ms = (metrics.graph_duration_ms || 0) + (Date.now() - graphStarted);
    metrics.messages_fetched = (metrics.messages_fetched || 0) + values.length;

    for (const message of values) {
      const normalized = normalizeGraphMessage(message);
      if (!normalized.external_message_id) continue;

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

      try {
        const ingestFn =
          typeof deps.ingestInboundEmailMessage === "function"
            ? deps.ingestInboundEmailMessage
            : ingestInboundEmailMessage;
        const result = await ingestFn(supabase, {
          normalized,
          mailboxUserId: userId,
          projectId,
          tenantId,
          providerSlug,
          accessToken,
          latestCoordinationUpdatedAt: deps.latestCoordinationUpdatedAt || null,
          deps,
          metrics,
        });
        results.push(result);
        successfulReceivedAts.push(normalized.message_timestamp);
      } catch (err) {
        hadFailure = true;
        graphError = err;
        break;
      }
    }

    if (useCursor) {
      nextWatermark = computeNextWatermark({
        previousWatermark,
        successfulReceivedAts,
      });
    }

    if (!hadFailure) {
      try {
        await rematchDueUnmatchedForMailbox(supabase, {
          userId,
          accessToken,
          latestCoordinationUpdatedAt: deps.latestCoordinationUpdatedAt || null,
          deps,
          metrics,
        });
      } catch {
        // rematch sweep is best-effort
      }

      try {
        await touchMailboxLastCheckedAt(supabase, userId);
      } catch {
        // non-fatal
      }
    }
  } finally {
    metrics.cycle_duration_ms = Date.now() - cycleStarted;
    if (!skipLease && !claimed.fallback) {
      try {
        await releaseFn(supabase, {
          userId,
          owner,
          watermarkReceivedAt: useCursor ? nextWatermark : null,
          metrics: { ...metrics },
        });
      } catch {
        // non-fatal
      }
    }
  }

  if (graphError && results.length === 0 && values.length === 0) {
    throw graphError;
  }

  return {
    skipped: false,
    reason: hadFailure ? "partial_failure" : null,
    polled: values.length,
    ingested: results.length,
    matched: results.filter((r) => r.status === "matched").length,
    unmatched: results.filter((r) => r.status === "unmatched").length,
    inserted: results.filter((r) => r && r.inserted === true).length,
    watermark_received_at: useCursor ? nextWatermark : null,
    had_failure: hadFailure,
    results,
    metrics,
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
  reprocessUnmatchedInboundMessage,
  rematchDueUnmatchedForMailbox,
  pollGraphInboundForUser,
  ingestEmailInboundWebhook,
  upsertUnmatchedInbound,
  upsertMatchedCommunication,
  findLinkedOutboundEcho,
  linkOutboundEcho,
  findExistingInboundState,
  shouldRematchUnmatched,
  scheduleUnmatchedBackoff,
  UNMATCHED_REMATCH_BACKOFF_MS,
  EXISTING_COMM_SELECT,
  EXISTING_UNMATCHED_SELECT,
  OUTBOUND_ECHO_SELECT,
};
