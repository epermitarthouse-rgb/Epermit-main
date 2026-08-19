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
  const isSpoc = message.isSPOC === true;

  const bodyParts = [senderMessage, receiverMessage].filter(Boolean);
  const rawBody = bodyParts.length ? bodyParts.join("\n") : null;

  // Commun-ET / portal user → utility = outbound; utility (incl. SPOC) → Commun-ET = inbound.
  // Prefer explicit SPOC as inbound so utility messages are never mislabeled outbound.
  const direction = isSpoc ? "inbound" : isInternalUser ? "outbound" : "inbound";
  const sender = isInternalUser && !isSpoc
    ? receiverName || "Portal user"
    : isSpoc
      ? "PEPCO SPOC"
      : "PEPCO";
  const recipient = isInternalUser && !isSpoc ? "PEPCO" : receiverName || "Project team";

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

/**
 * Conservative PEPCO portal status → UCI lifecycle mapping (D1C).
 * Provider-specific rules live only in this adapter.
 *
 * @param {string | null | undefined} portalStatus
 * @param {import("./utility-adapter.types.js").LifecycleMappingContext} context
 * @returns {import("./utility-adapter.types.js").LifecycleProposal | null}
 */
function mapPortalStatusToLifecycle(portalStatus, context) {
  const status = String(portalStatus || context.portal_status || "").trim();
  if (!status) return null;

  const normalized = status.toLowerCase();
  const actionRequired = context.action_required === true;
  const hasSubmissionEvidence =
    Boolean(context.portal_submitted_at) ||
    submissionConfirmedInRaw(context.raw);

  /** @type {Record<string, Omit<import("./utility-adapter.types.js").LifecycleProposal, "source_status">> & { requiresSubmission?: boolean }>} */
  const table = {
    submitted: {
      proposed_stage: 4,
      proposed_state: "AWAITING_UTILITY",
      confidence: "high",
      reason: "PEPCO status Submitted maps to utility acknowledgment (stage 4).",
      automatic_transition_allowed: true,
      requiresSubmission: true,
    },
    "in technical review": {
      proposed_stage: 6,
      proposed_state: "AWAITING_UTILITY",
      confidence: "medium",
      reason: "PEPCO In Technical Review maps to COS/design review (stage 6).",
      automatic_transition_allowed: true,
    },
    "more information required": {
      proposed_stage: 6,
      proposed_state: "BLOCKED",
      confidence: "high",
      reason: "PEPCO More Information Required indicates a blocked design review.",
      automatic_transition_allowed: true,
    },
    "in design": {
      proposed_stage: 6,
      proposed_state: "AWAITING_UTILITY",
      confidence: "medium",
      reason: "PEPCO In Design maps to COS/design review (stage 6).",
      automatic_transition_allowed: true,
    },
    "contract sent": {
      proposed_stage: 7,
      proposed_state: actionRequired ? "BLOCKED" : "AWAITING_UTILITY",
      confidence: "high",
      reason: actionRequired
        ? "PEPCO Contract Sent with action required maps to blocked CIAC/cost stage."
        : "PEPCO Contract Sent maps to CIAC/cost coordination (stage 7).",
      automatic_transition_allowed: true,
    },
    "pending payment": {
      proposed_stage: 7,
      proposed_state: actionRequired ? "BLOCKED" : "AWAITING_UTILITY",
      confidence: "medium",
      reason: "PEPCO payment-related status maps to CIAC/cost stage.",
      automatic_transition_allowed: true,
    },
    initiated: {
      proposed_stage: 5,
      proposed_state: "AWAITING_UTILITY",
      confidence: "low",
      reason: "PEPCO Initiated status suggests post-submission utility processing.",
      automatic_transition_allowed: true,
      requiresSubmission: true,
    },
  };

  const rule = table[normalized];
  if (!rule) return null;

  if (rule.requiresSubmission && !hasSubmissionEvidence) {
    return {
      proposed_stage: rule.proposed_stage,
      proposed_state: rule.proposed_state,
      confidence: "low",
      reason: `${rule.reason} Submission confirmation not yet observed — proposal only.`,
      source_status: status,
      automatic_transition_allowed: false,
    };
  }

  return {
    proposed_stage: rule.proposed_stage,
    proposed_state: rule.proposed_state,
    confidence: rule.confidence,
    reason: rule.reason,
    source_status: status,
    automatic_transition_allowed: rule.automatic_transition_allowed,
  };
}

/**
 * @param {unknown} raw
 * @returns {boolean}
 */
function submissionConfirmedInRaw(raw) {
  if (!raw || typeof raw !== "object") return false;
  const changes = Array.isArray(/** @type {{ statusChanges?: unknown }} */ (raw).statusChanges)
    ? /** @type {Array<{ statusName?: unknown }>} */ (
        /** @type {{ statusChanges: unknown[] }} */ (raw).statusChanges
      )
    : [];
  return changes.some((row) => String(row?.statusName ?? "").trim().toLowerCase() === "submitted");
}

/** @type {import("./utility-adapter.types.js").UtilityAdapter} */
const pepcoAdapter = {
  providerSlug: "pepco",
  normalizeApplication,
  normalizeMessages,
  normalizeStatusEvents,
  getExternalApplicationId,
  getExternalJobId,
  mapPortalStatusToLifecycle,
};

module.exports = {
  pepcoAdapter,
  needsHumanAttentionFromText,
  ATTENTION_KEYWORDS,
  mapPortalStatusToLifecycle,
  submissionConfirmedInRaw,
};
