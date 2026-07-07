"use strict";

const { sha256Fingerprint } = require("../uci-sync-utils.js");

/** @type {readonly string[]} */
const ATTENTION_KEYWORDS = [
  "action required",
  "information required",
  "rejected",
  "contract sent",
  "payment due",
  "inspection failed",
  "deadline",
  "expiration",
  "missing document",
  "missing documents",
];

/**
 * @param {string | null | undefined} subject
 * @param {string | null | undefined} body
 * @returns {boolean}
 */
function needsHumanAttentionFromText(subject, body) {
  const haystack = `${subject ?? ""} ${body ?? ""}`.toLowerCase();
  return ATTENTION_KEYWORDS.some((kw) => haystack.includes(kw));
}

/**
 * @param {unknown} overview
 * @returns {string | null}
 */
function pickJobId(overview) {
  if (!overview || typeof overview !== "object") return null;
  const jobId = /** @type {{ jobId?: unknown }} */ (overview).jobId;
  return typeof jobId === "string" && jobId.trim() ? jobId.trim() : null;
}

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
function getExternalApplicationId(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = /** @type {{ applicationUuid?: unknown }} */ (raw).applicationUuid;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
function getExternalJobId(raw) {
  if (!raw || typeof raw !== "object") return null;
  return pickJobId(/** @type {{ overview?: unknown }} */ (raw).overview);
}

/**
 * @param {Array<{ statusName?: string | null, statusChangeDateTime?: string | null }>} statusChanges
 * @returns {string | null}
 */
function findPortalSubmittedAt(statusChanges) {
  if (!Array.isArray(statusChanges)) return null;
  let earliest = null;
  for (const row of statusChanges) {
    const name = String(row?.statusName ?? "").trim();
    if (name.toLowerCase() !== "submitted") continue;
    const ts = row?.statusChangeDateTime;
    if (!ts) continue;
    if (!earliest || Date.parse(String(ts)) < Date.parse(earliest)) {
      earliest = String(ts);
    }
  }
  return earliest;
}

/**
 * @param {unknown} raw
 * @param {import("./utility-adapter.types.js").AdapterContext} context
 * @returns {import("./utility-adapter.types.js").NormalizedApplication | null}
 */
function normalizeApplication(raw, context) {
  const externalId = getExternalApplicationId(raw);
  if (!externalId) return null;

  const app = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const overview = app.overview;
  const statusChanges = Array.isArray(app.statusChanges) ? app.statusChanges : [];

  const portalSubmittedAt =
    findPortalSubmittedAt(
      /** @type {Array<{ statusName?: string | null, statusChangeDateTime?: string | null }>} */ (
        statusChanges
      ),
    ) ?? null;

  let actionRequired = false;
  if (overview && typeof overview === "object" && "actionRequired" in overview) {
    actionRequired = /** @type {{ actionRequired?: unknown }} */ (overview).actionRequired === true;
  }

  const syncedAt = context.syncedAt || new Date().toISOString();

  return {
    external_application_id: externalId,
    external_job_id: getExternalJobId(raw),
    portal_status:
      typeof app.currentStatus === "string" ? app.currentStatus : null,
    portal_milestone:
      typeof app.currentMilestone === "string" ? app.currentMilestone : null,
    portal_last_updated_at:
      typeof app.statusLastUpdatedAt === "string" ? app.statusLastUpdatedAt : null,
    portal_submitted_at: portalSubmittedAt,
    action_required: actionRequired,
    record_source: "portal_sync",
    metadata: {
      portal_snapshot: JSON.parse(JSON.stringify(app)),
      synced_at: syncedAt,
      provider_slug: context.providerSlug,
    },
  };
}

/**
 * @param {Record<string, unknown>} message
 * @param {string} externalApplicationId
 * @param {import("./utility-adapter.types.js").AdapterContext} context
 * @returns {import("./utility-adapter.types.js").NormalizedCommunication | null}
 */
function normalizeOneMessage(message, externalApplicationId, context) {
  const statusChangeDisplayName =
    typeof message.statusChangeDisplayName === "string"
      ? message.statusChangeDisplayName
      : null;
  const senderMessage =
    typeof message.senderMessage === "string" ? message.senderMessage : null;
  const receiverMessage =
    typeof message.receiverMessage === "string" ? message.receiverMessage : null;
  const receiverName =
    typeof message.receiverName === "string" ? message.receiverName : null;
  const messageDateTime =
    typeof message.messageDateTime === "string" ? message.messageDateTime : null;
  const isInternalUser = message.isInternalUser === true;

  const bodyParts = [senderMessage, receiverMessage].filter(Boolean);
  const rawBody = bodyParts.length ? bodyParts.join("\n") : null;

  const direction = isInternalUser ? "outbound" : "inbound";
  const sender = isInternalUser
    ? receiverName || "Portal user"
    : message.isSPOC === true
      ? "PEPCO SPOC"
      : "PEPCO";
  const recipient = isInternalUser ? "PEPCO" : receiverName || "Project team";

  const externalMessageId =
    typeof message.messageId === "string" && String(message.messageId).trim()
      ? String(message.messageId).trim()
      : typeof message.id === "string" && String(message.id).trim()
        ? String(message.id).trim()
        : null;

  const idempotencyKey =
    externalMessageId ||
    sha256Fingerprint([
      context.providerSlug,
      externalApplicationId,
      messageDateTime || "",
      sender || "",
      rawBody || "",
    ]);

  return {
    external_application_id: externalApplicationId,
    external_message_id: externalMessageId,
    idempotency_key: idempotencyKey,
    direction,
    channel: "portal_message",
    raw_subject: statusChangeDisplayName,
    raw_body: rawBody,
    sender,
    recipient,
    message_timestamp: messageDateTime,
    thread_id: externalApplicationId,
    needs_human_attention: needsHumanAttentionFromText(statusChangeDisplayName, rawBody),
    classification: null,
    agent_processed_metadata: {
      source: "portal_sync",
      provider_slug: context.providerSlug,
      raw: JSON.parse(JSON.stringify(message)),
    },
  };
}

/**
 * @param {unknown} raw
 * @param {import("./utility-adapter.types.js").AdapterContext} context
 * @returns {import("./utility-adapter.types.js").NormalizedCommunication[]}
 */
function normalizeMessages(raw, context) {
  const externalId = getExternalApplicationId(raw);
  if (!externalId) return [];

  const messages = raw && typeof raw === "object" && Array.isArray(
    /** @type {{ messages?: unknown }} */ (raw).messages,
  )
    ? /** @type {Array<Record<string, unknown>>} */ (
        /** @type {{ messages: unknown[] }} */ (raw).messages
      )
    : [];

  /** @type {import("./utility-adapter.types.js").NormalizedCommunication[]} */
  const out = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const normalized = normalizeOneMessage(msg, externalId, context);
    if (normalized) out.push(normalized);
  }
  return out;
}

/**
 * @param {unknown} raw
 * @param {import("./utility-adapter.types.js").AdapterContext} context
 * @returns {import("./utility-adapter.types.js").NormalizedStatusEvent[]}
 */
function normalizeStatusEvents(raw, context) {
  const externalId = getExternalApplicationId(raw);
  if (!externalId) return [];

  const events =
    raw && typeof raw === "object" && Array.isArray(
      /** @type {{ statusChanges?: unknown }} */ (raw).statusChanges,
    )
      ? /** @type {Array<Record<string, unknown>>} */ (
          /** @type {{ statusChanges: unknown[] }} */ (raw).statusChanges
        )
      : [];

  /** @type {import("./utility-adapter.types.js").NormalizedStatusEvent[]} */
  const out = [];

  for (const event of events) {
    const portalStatus =
      typeof event.statusName === "string" ? event.statusName : null;
    const portalMilestone =
      typeof event.milestoneName === "string" ? event.milestoneName : null;
    const occurredAt =
      typeof event.statusChangeDateTime === "string"
        ? event.statusChangeDateTime
        : null;

    const idempotencyKey = sha256Fingerprint([
      context.providerSlug,
      externalId,
      occurredAt || "",
      portalStatus || "",
      portalMilestone || "",
    ]);

    const { isoToDateOnly } = require("../uci-sync-utils.js");

    out.push({
      external_application_id: externalId,
      idempotency_key: idempotencyKey,
      milestone_type: "portal_status_event",
      status: "completed",
      source: "portal_sync",
      portal_status: portalStatus,
      portal_milestone: portalMilestone,
      occurred_at: occurredAt,
      actual_date: isoToDateOnly(occurredAt),
      metadata: {
        raw: JSON.parse(JSON.stringify(event)),
        provider_slug: context.providerSlug,
      },
    });
  }

  return out;
}

/** @type {import("./utility-adapter.types.js").UtilityAdapter} */
const pepcoAdapter = {
  providerSlug: "pepco",
  normalizeApplication,
  normalizeMessages,
  normalizeStatusEvents,
  getExternalApplicationId,
  getExternalJobId,
};

module.exports = {
  pepcoAdapter,
  needsHumanAttentionFromText,
  ATTENTION_KEYWORDS,
};
