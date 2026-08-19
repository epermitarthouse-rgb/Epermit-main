/**
 * Operator-facing Stage 5 / communications presentation helpers.
 * Keep internal IDs and shorthand (nopm, PM-less, s5uat-…) out of normal UI.
 */

import {
  LOW_CONFIDENCE_THRESHOLD,
  classificationNeedsAttention,
  formatCommunicationClassification,
} from "@/lib/uciCommunicationClassifier";
import type { CoordinationCommunication, CoordinationRecord } from "@/types/uci";

const UAT_INTERNAL_ID_RE = /\b(?:s5uat|s5neg)-[a-z0-9-]+\b/gi;
const NOPM_TOKEN_RE = /\bnopm\b/gi;
const PM_LESS_SHORTHAND_RE =
  /\b(?:PM-less|Ack\s+WITHOUT\s+PM|WITHOUT\s+PM|missing\s+PM(?:\/coordinator)?)\b/gi;
const OWN_PACKAGE_SUBJECT_RE = /utility\s+coordination\s+application\s+package/i;

function emailsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = String(a || "")
    .trim()
    .toLowerCase();
  const right = String(b || "")
    .trim()
    .toLowerCase();
  return Boolean(left && right && left === right);
}

/** Own Stage 4 package echo — should not surface as operator Needs Attention. */
export function isOwnOutboundPackageEcho(comm: CoordinationCommunication): boolean {
  const meta = asMeta(comm);
  if (meta.inbound_echo != null) return true;
  if (meta.source === "stage4_live_transmit" || meta.stage5_handoff === true) {
    return String(comm.direction || "").toLowerCase() === "outbound";
  }
  const subject = String(comm.raw_subject || "");
  if (!OWN_PACKAGE_SUBJECT_RE.test(subject)) return false;
  if (String(comm.direction || "").toLowerCase() === "outbound") return true;
  if (emailsEqual(comm.sender, comm.recipient)) return true;
  return false;
}

const SYNTHETIC_SUBJECT_RE = /\[UCI SYNTHETIC TEST\]/i;
const SYNTHETIC_BODY_RE =
  /SYNTHETIC\s*\/\s*TEST\s+ONLY|SYNTHETIC\s+TEST\s+ONLY|NOT\s+a\s+real\s+Dominion/i;
const UAT_RUN_ID_RE = /\b(?:s5uat|s5neg)-[a-z0-9-]+\b/i;

/**
 * Controlled Stage 5 / synthetic UAT communications (Graph self-send tests).
 * Detection is presentation-only — never deletes or mutates backend rows.
 */
export function isSyntheticUatCommunication(comm: CoordinationCommunication): boolean {
  const meta = asMeta(comm);
  if (meta.uat === true) return true;
  const runId = str(meta.run_id) || str(asRecord(meta.uat).run_id);
  if (runId && UAT_RUN_ID_RE.test(runId)) return true;
  const subject = String(comm.raw_subject || "");
  const body = String(comm.raw_body || "");
  if (SYNTHETIC_SUBJECT_RE.test(subject)) return true;
  if (UAT_RUN_ID_RE.test(subject) || UAT_RUN_ID_RE.test(body)) return true;
  if (SYNTHETIC_BODY_RE.test(body)) return true;
  return false;
}

/**
 * Operator still needs to act (Needs Attention / unresolved reasons).
 * Resolved, confirmed, rejected, or auto-completed items are not actionable.
 */
export function isCommunicationActionableForInbox(
  comm: CoordinationCommunication,
  record?: CoordinationRecord | null,
): boolean {
  const plan = getCommunicationActionPlan(comm, record);
  return plan.needsAttention === true && plan.resolved !== true && plan.rejected !== true;
}

/** Non-actionable synthetic UAT — keep in Test / Audit history, not the primary Inbox feed. */
export function shouldDemoteSyntheticToInboxHistory(
  comm: CoordinationCommunication,
  record?: CoordinationRecord | null,
): boolean {
  return isSyntheticUatCommunication(comm) && !isCommunicationActionableForInbox(comm, record);
}

export type InboxFeedItem<TRecord = CoordinationRecord> = {
  record: TRecord;
  message: CoordinationCommunication;
};

export type InboxThreadGroup<TRecord = CoordinationRecord> = {
  key: string;
  record: TRecord;
  threadId: string | null;
  messages: CoordinationCommunication[];
  latest: CoordinationCommunication;
};

export type InboxAuditHistoryModel = {
  receivedLabel: string;
  ticketOrReference: string | null;
  classificationLabel: string;
  testStatus: string;
  detailLine: string;
};

function messageSortTime(comm: CoordinationCommunication): number {
  const raw = comm.message_timestamp || comm.created_at;
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

/** Split Inbox rows: primary operator feed vs Test / Audit history (no merges, no deletes). */
export function partitionOperatorInboxFeed<TRecord extends { id?: string }>(
  items: Array<InboxFeedItem<TRecord>>,
): {
  primary: Array<InboxFeedItem<TRecord>>;
  auditHistory: Array<InboxFeedItem<TRecord>>;
} {
  const primary: Array<InboxFeedItem<TRecord>> = [];
  const auditHistory: Array<InboxFeedItem<TRecord>> = [];
  for (const item of items) {
    const record = item.record as unknown as CoordinationRecord;
    if (shouldDemoteSyntheticToInboxHistory(item.message, record)) {
      auditHistory.push(item);
    } else {
      primary.push(item);
    }
  }
  return { primary, auditHistory };
}

/**
 * Group production (and actionable) Inbox items by Graph/conversation thread_id.
 * Messages without thread_id stay as single-message groups. Never merges distinct threads.
 */
export function groupInboxItemsByThread<TRecord>(
  items: Array<InboxFeedItem<TRecord>>,
): Array<InboxThreadGroup<TRecord>> {
  const groups = new Map<string, InboxThreadGroup<TRecord>>();
  const order: string[] = [];

  for (const item of items) {
    const threadId = str(item.message.thread_id);
    const key = threadId
      ? `thread:${String((item.record as { id?: string }).id || "")}:${threadId}`
      : `msg:${item.message.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        record: item.record,
        threadId,
        messages: [item.message],
        latest: item.message,
      });
      order.push(key);
      continue;
    }
    existing.messages.push(item.message);
    if (messageSortTime(item.message) > messageSortTime(existing.latest)) {
      existing.latest = item.message;
    }
  }

  return order.map((key) => {
    const group = groups.get(key)!;
    group.messages.sort((a, b) => messageSortTime(b) - messageSortTime(a));
    group.latest = group.messages[0]!;
    return group;
  });
}

function syntheticTestStatusLabel(
  comm: CoordinationCommunication,
  record?: CoordinationRecord | null,
): string {
  const plan = getCommunicationActionPlan(comm, record);
  if (plan.rejected) return "Rejected · audit only";
  if (plan.resolved || isAutoCompletedAck(comm, record) || isManuallyResolved(comm)) {
    if (asMeta(comm).human_confirmed === true) return "Confirmed · synthetic UAT complete";
    if (isAutoCompletedAck(comm, record)) return "Auto-completed · synthetic UAT";
    return "Resolved · synthetic UAT";
  }
  if (plan.needsAttention) return "Needs attention · synthetic UAT";
  return "Synthetic UAT · not actionable";
}

/** Differentiator lines for Test / Audit history cards (tickets, time, result — not merged). */
export function buildInboxAuditHistoryModel(
  comm: CoordinationCommunication,
  record?: CoordinationRecord | null,
): InboxAuditHistoryModel {
  const fields = extractedFields(comm);
  const ticket =
    str(fields.utility_ticket_number) ||
    str(fields.utility_account_number) ||
    null;
  const received =
    formatOperatorTimelineWhen(comm.message_timestamp || comm.created_at) || "—";
  const classification = formatCommunicationClassification(comm.classification);
  const testStatus = syntheticTestStatusLabel(comm, record);
  const confidence = formatConfidencePct(comm.classification_confidence);
  const detailParts = [
    `Received ${received}`,
    ticket ? `Ref ${sanitizeOperatorCommunicationText(ticket)}` : null,
    classification,
    confidence,
    testStatus,
  ].filter(Boolean);

  return {
    receivedLabel: received,
    ticketOrReference: ticket ? sanitizeOperatorCommunicationText(ticket) : null,
    classificationLabel: classification,
    testStatus,
    detailLine: detailParts.join(" · "),
  };
}

export type CommunicationActionPlan = {
  showReclassify: boolean;
  showConfirm: boolean;
  showFlag: boolean;
  showReject: boolean;
  showViewHistory: boolean;
  showViewMessage: boolean;
  resolved: boolean;
  rejected: boolean;
  needsAttention: boolean;
};

export type CommunicationCardModel = {
  title: string;
  subtitle: string | null;
  detailLine: string | null;
  nextLine: string | null;
  attentionReasons: string[];
  directionLabel: string | null;
  overrideLine: string | null;
  displaySubject: string;
  actions: CommunicationActionPlan;
  isAcknowledgment: boolean;
};

export type CommunicationTimelineEvent = {
  at: string | null;
  label: string;
  detail?: string | null;
};

export type Stage5CommunicationsBannerModel = {
  tone: "info" | "warn" | "success";
  title: string;
  detail: string | null;
};

function asMeta(comm: CoordinationCommunication): Record<string, unknown> {
  const meta = comm.agent_processed_metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) return meta;
  return {};
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

/** Strip UAT/internal tokens and PM shorthand from operator-visible text. */
export function sanitizeOperatorCommunicationText(raw: string | null | undefined): string {
  if (raw == null) return "";
  let text = String(raw);
  text = text.replace(UAT_INTERNAL_ID_RE, "").replace(NOPM_TOKEN_RE, "");
  text = text.replace(PM_LESS_SHORTHAND_RE, "Utility contact not assigned");
  text = text
    .replace(/\s*[·|]\s*[·|]/g, " · ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[\s·|,-]+|[\s·|,-]+$/g, "")
    .trim();
  return text;
}

export function formatCommunicationSubjectForDisplay(
  subject: string | null | undefined,
): string {
  const cleaned = sanitizeOperatorCommunicationText(subject);
  return cleaned || "(no subject)";
}

export function formatDirectionLabel(direction: string | null | undefined): string | null {
  const d = String(direction || "")
    .trim()
    .toLowerCase();
  if (d === "inbound") return "Inbound";
  if (d === "outbound") return "Outbound";
  return null;
}

function extractedFields(comm: CoordinationCommunication): Record<string, unknown> {
  const meta = asMeta(comm);
  const review = asRecord(meta.review_decision);
  const reviewer = asRecord(review.reviewer_extracted_fields);
  const original = asRecord(meta.extracted_fields);
  return { ...original, ...reviewer };
}

function incompleteReason(comm: CoordinationCommunication): string | null {
  const incomplete = asRecord(asMeta(comm).stage_5_incomplete);
  return str(incomplete.reason);
}

function isRejected(comm: CoordinationCommunication): boolean {
  const meta = asMeta(comm);
  if (meta.rejected_irrelevant === true) return true;
  const decision = asRecord(meta.review_decision);
  return str(decision.action) === "reject_irrelevant";
}

function isAutoCompletedAck(comm: CoordinationCommunication, record?: CoordinationRecord | null): boolean {
  const meta = asMeta(comm);
  if (meta.stage_5_auto_completed === true || meta.stage_5_completed === true) return true;
  if (asRecord(meta.stage_5_completion).completed === true) return true;
  if (
    String(comm.classification || "") === "acknowledgment" &&
    !comm.needs_human_attention &&
    record &&
    Number(record.current_stage) === 5 &&
    String(record.current_stage_state) === "COMPLETED" &&
    record.acknowledgment_received_at
  ) {
    return true;
  }
  return false;
}

function isManuallyResolved(comm: CoordinationCommunication): boolean {
  if (isRejected(comm)) return true;
  if (!comm.reviewed_at) return false;
  if (comm.needs_human_attention) return false;
  const meta = asMeta(comm);
  return (
    meta.human_confirmed === true ||
    meta.human_reclassified === true ||
    Boolean(asRecord(meta.review_decision).action)
  );
}

function formatConfidencePct(confidence: string | number | null | undefined): string | null {
  const n = Number(confidence);
  if (!Number.isFinite(n)) return null;
  const pct = n <= 1 ? Math.round(n * 100) : Math.round(n);
  return `${pct}% confidence`;
}

export function formatOperatorShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(iso: string | null | undefined): string | null {
  return formatOperatorShortDate(iso);
}

export function formatOperatorTimelineWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Drawer tab / workspace title when Stage 5 is active on the record. */
export function getCommunicationsTabLabel(record?: CoordinationRecord | null): string {
  if (record && Number(record.current_stage) === 5) {
    return "Stage 5 · Utility acknowledgment";
  }
  return "Communications";
}

export function communicationNeedsOperatorAttention(
  comm: CoordinationCommunication,
  record?: CoordinationRecord | null,
): boolean {
  return buildCommunicationCardModel(comm, { record }).actions.needsAttention;
}

export function countCommunicationsNeedingAttention(
  communications: CoordinationCommunication[],
  record?: CoordinationRecord | null,
): number {
  return communications.filter((comm) => communicationNeedsOperatorAttention(comm, record)).length;
}

/** Stage 5 context banner for the record Communications workspace. */
export function buildStage5CommunicationsBanner(
  record: CoordinationRecord,
  communications: CoordinationCommunication[] = [],
): Stage5CommunicationsBannerModel | null {
  if (Number(record.current_stage) !== 5) return null;

  const state = String(record.current_stage_state || "").toUpperCase();
  const ackDate = formatOperatorShortDate(record.acknowledgment_received_at);
  const hasPmAttention = communications.some((comm) =>
    getNeedsAttentionReasons(comm).includes("Utility project manager/coordinator not assigned"),
  );

  if (state === "COMPLETED" && record.acknowledgment_received_at && ackDate) {
    return {
      tone: "success",
      title: `Stage 5 · Completed — acknowledged ${ackDate}`,
      detail: "Utility acknowledgment is recorded. Monitor Class of Service when the utility issues next steps.",
    };
  }

  if (hasPmAttention) {
    return {
      tone: "warn",
      title: "Stage 5 · Needs attention — Utility project manager/coordinator not assigned",
      detail:
        "Confirm acknowledgment details in the message below, or flag for review if the utility contact is unclear.",
    };
  }

  if (state === "AWAITING_UTILITY" || state === "IN_PROGRESS" || state === "NOT_STARTED") {
    return {
      tone: "info",
      title: "Stage 5 · Awaiting utility acknowledgment",
      detail: "Review inbound utility messages and confirm when acknowledgment criteria are met.",
    };
  }

  if (state === "ESCALATED") {
    return {
      tone: "warn",
      title: "Stage 5 · Escalated — acknowledgment overdue",
      detail: "Review flagged communications and confirm or flag items that need human follow-up.",
    };
  }

  if (state === "BLOCKED") {
    return {
      tone: "warn",
      title: "Stage 5 · Blocked",
      detail: record.last_error
        ? sanitizeOperatorCommunicationText(record.last_error)
        : "Resolve the recorded blocker before expecting utility acknowledgment.",
    };
  }

  return {
    tone: "info",
    title: `Stage 5 · ${state.toLowerCase().replace(/_/g, " ")}`,
    detail: null,
  };
}

/** Operator-readable review timeline (no raw JSON in normal UI). */
export function buildCommunicationReviewTimeline(
  comm: CoordinationCommunication,
  record?: CoordinationRecord | null,
): CommunicationTimelineEvent[] {
  const events: CommunicationTimelineEvent[] = [];
  const meta = asMeta(comm);
  const fields = extractedFields(comm);
  const match = asRecord(meta.match);
  const receivedAt = comm.message_timestamp || comm.created_at;

  if (receivedAt) {
    events.push({
      at: receivedAt,
      label: "Message received",
      detail: formatDirectionLabel(comm.direction),
    });
  }

  if (match.matched === true) {
    events.push({
      at: str(match.matched_at) || receivedAt,
      label: "Matched to coordination record",
    });
  } else if (match.matched === false || incompleteReason(comm) === "unmatched") {
    events.push({
      at: str(match.matched_at) || receivedAt,
      label: "Unable to match coordination record",
    });
  }

  const classification = String(comm.classification || "").trim();
  if (classification && classification !== "unclassified") {
    const confidence = formatConfidencePct(comm.classification_confidence);
    events.push({
      at: str(asRecord(meta.classification).classified_at) || receivedAt,
      label: `Classified as ${formatCommunicationClassification(classification)}`,
      detail: confidence,
    });
  } else if (!classification || classification === "unclassified") {
    events.push({
      at: receivedAt,
      label: "Awaiting classification",
    });
  }

  if (meta.flagged_for_review === true) {
    events.push({
      at: str(asRecord(meta.flag).flagged_at) || comm.reviewed_at || receivedAt,
      label: "Flagged for human review",
      detail: "Auto-lifecycle blocked pending reviewer action",
    });
  }

  const review = asRecord(meta.review_decision);
  const reviewer =
    str(comm.reviewed_by) ||
    str(review.reviewed_by) ||
    str(asRecord(meta.reclassification).reclassified_by) ||
    str(asRecord(meta.confirmation).confirmed_by);

  if (comm.reviewed_at) {
    const action = str(review.action);
    if (action === "reject_irrelevant" || meta.rejected_irrelevant === true) {
      events.push({
        at: comm.reviewed_at,
        label: "Marked not relevant",
        detail: reviewer ? `By ${reviewer}` : null,
      });
    } else if (action === "reclassify" || meta.human_reclassified === true) {
      events.push({
        at: comm.reviewed_at,
        label: "Classification updated by reviewer",
        detail: reviewer ? `By ${reviewer}` : null,
      });
    } else if (action === "confirm" || meta.human_confirmed === true) {
      events.push({
        at: comm.reviewed_at,
        label: "Acknowledgment confirmed by reviewer",
        detail: reviewer ? `By ${reviewer}` : null,
      });
    } else {
      events.push({
        at: comm.reviewed_at,
        label: "Review recorded",
        detail: reviewer ? `By ${reviewer}` : null,
      });
    }
  }

  const pm = str(fields.utility_project_manager);
  if (hasRealPm(pm)) {
    events.push({
      at:
        str(asRecord(meta.stage_5_acknowledgment_evidence).captured_at) ||
        comm.reviewed_at ||
        receivedAt,
      label: "Utility project manager identified",
      detail: pm,
    });
  }

  const evidence = asRecord(meta.stage_5_acknowledgment_evidence);
  if (evidence.captured_at && !isAutoCompletedAck(comm, record)) {
    events.push({
      at: str(evidence.captured_at),
      label: "Acknowledgment evidence captured",
      detail:
        evidence.sla_stopped === false
          ? "Stage 5 still awaiting completion criteria"
          : null,
    });
  }

  const completion = asRecord(meta.stage_5_completion);
  const recordMeta = asRecord(record?.metadata);
  const recordAck = asRecord(recordMeta.stage_5_acknowledgment);

  if (isAutoCompletedAck(comm, record) || meta.stage_5_completed === true || meta.stage_5_auto_completed === true) {
    events.push({
      at:
        str(completion.completed_at) ||
        str(recordAck.completed_at) ||
        str(record?.acknowledgment_received_at) ||
        comm.reviewed_at,
      label: "Stage 5 completed",
      detail: formatOperatorShortDate(
        str(record?.acknowledgment_received_at) ||
          str(fields.acknowledgment_date) ||
          str(completion.completed_at),
      ),
    });
  } else if (
    record &&
    Number(record.current_stage) === 5 &&
    String(record.current_stage_state) === "COMPLETED" &&
    record.acknowledgment_received_at
  ) {
    events.push({
      at: record.acknowledgment_received_at,
      label: "Stage 5 completed",
      detail: formatOperatorShortDate(record.acknowledgment_received_at),
    });
  }

  if (evidence.sla_stopped === true || completion.sla_stopped === true) {
    events.push({
      at: str(completion.completed_at) || str(recordAck.completed_at) || comm.reviewed_at,
      label: "Acknowledgment SLA stopped",
      detail: "Timer paused after valid acknowledgment completion",
    });
  }

  return events.sort((left, right) => {
    const leftTime = left.at ? new Date(left.at).getTime() : 0;
    const rightTime = right.at ? new Date(right.at).getTime() : 0;
    if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return 0;
    if (!Number.isFinite(leftTime)) return 1;
    if (!Number.isFinite(rightTime)) return -1;
    return leftTime - rightTime;
  });
}

function hasRealPm(value: unknown): boolean {
  const s = str(value);
  if (!s) return false;
  if (/^(pending(\s+utility)?(\s+contact)?|tbd|n\/?a|unknown|none|null|-+|not\s+(yet\s+)?assigned|awaiting(\s+assignment)?)$/i.test(s)) {
    return false;
  }
  return true;
}

function isOutboundDirection(comm: CoordinationCommunication): boolean {
  return String(comm.direction || "").toLowerCase() === "outbound";
}

/** Synthetic/test history that is no longer an actionable triage item. */
function isSyntheticHistoryNotActionable(comm: CoordinationCommunication): boolean {
  const meta = asMeta(comm);
  if (meta.no_longer_actionable === true || meta.synthetic_history === true) return true;
  if (meta.synthetic_test === true && meta.actionable !== true) {
    if (isOutboundDirection(comm) || isOwnOutboundPackageEcho(comm)) return true;
  }
  const subject = String(comm.raw_subject || "");
  if (/^\[TEST\]/i.test(subject) && (isOutboundDirection(comm) || isOwnOutboundPackageEcho(comm))) {
    return true;
  }
  // Resolved/confirmed/rejected synthetic UAT is audit history only (still preserve the row).
  // Also demote quiet synthetic items that no longer carry needs_human_attention.
  if (isSyntheticUatCommunication(comm) && !comm.needs_human_attention) {
    if (
      isManuallyResolved(comm) ||
      isAutoCompletedAck(comm) ||
      isRejected(comm) ||
      // Quiet classified synthetic with no open attention flag
      Boolean(String(comm.classification || "").trim())
    ) {
      return true;
    }
  }
  return false;
}

/** Explicit Needs Attention reasons for operator UI (never PM-less / nopm). */
export function getNeedsAttentionReasons(
  comm: CoordinationCommunication,
): string[] {
  // Outbound transmissions and own package echoes are never operator triage reasons.
  if (isOwnOutboundPackageEcho(comm) || isOutboundDirection(comm)) return [];
  if (isRejected(comm) || isSyntheticHistoryNotActionable(comm)) return [];

  const reasons: string[] = [];
  const meta = asMeta(comm);
  const fields = extractedFields(comm);
  const incomplete = incompleteReason(comm);
  const confidence = Number(comm.classification_confidence);
  const classification = String(comm.classification || "").trim() || null;

  if (meta.flagged_for_review === true) {
    reasons.push("Flagged for human review");
  }

  if (incomplete === "missing_utility_pm" || (classification === "acknowledgment" && !hasRealPm(fields.utility_project_manager))) {
    if (classification === "acknowledgment" || incomplete === "missing_utility_pm") {
      reasons.push("Utility project manager/coordinator not assigned");
    }
  }

  if (incomplete === "missing_ticket_or_account") {
    reasons.push("Missing utility ticket or account number");
  }
  if (incomplete === "missing_acknowledgment_date") {
    reasons.push("Missing acknowledgment date");
  }

  const match = asRecord(meta.match);
  if (match.matched === false || incomplete === "unmatched") {
    reasons.push("Unable to match coordination record");
  }

  if (!classification || classification === "unclassified") {
    reasons.push("Unclassified inbound utility communication");
  } else if (Number.isFinite(confidence) && confidence < LOW_CONFIDENCE_THRESHOLD) {
    reasons.push("Low classification confidence");
  }

  if (
    classificationNeedsAttention(
      classification,
      Number.isFinite(confidence) ? confidence : null,
      comm.needs_human_attention,
    ) &&
    reasons.length === 0
  ) {
    reasons.push(
      meta.classifier_error || meta.parser_failure
        ? "Unresolved classifier/parser failure"
        : "Needs human review",
    );
  }

  // Deduplicate while preserving order
  return [...new Set(reasons)];
}

export function formatOverrideLine(comm: CoordinationCommunication): string | null {
  const meta = asMeta(comm);
  const review = asRecord(meta.review_decision);
  const reviewedBy =
    str(comm.reviewed_by) ||
    str(review.reviewed_by) ||
    str(asRecord(meta.reclassification).reclassified_by) ||
    str(asRecord(meta.confirmation).confirmed_by);

  if (!reviewedBy && !meta.human_reclassified && !meta.human_confirmed && !review.action) {
    return null;
  }

  const who = reviewedBy ? `Reviewed by ${reviewedBy}` : "Reviewed";
  const parts: string[] = [who];

  if (meta.human_reclassified === true || str(review.action) === "reclassify") {
    parts.push("classification changed");
  } else if (meta.human_confirmed === true || str(review.action) === "confirm") {
    parts.push("classification confirmed");
  } else if (str(review.action) === "reject_irrelevant") {
    parts.push("marked not relevant");
  } else if (meta.flagged_for_review === true) {
    return "Flagged for human review · auto-lifecycle blocked";
  } else {
    return null;
  }

  return parts.join(" · ");
}

export function getCommunicationActionPlan(
  comm: CoordinationCommunication,
  record?: CoordinationRecord | null,
): CommunicationActionPlan {
  // Outbound transmissions / package echoes are history, not operator attention.
  if (isOwnOutboundPackageEcho(comm) || isOutboundDirection(comm)) {
    return {
      showReclassify: false,
      showConfirm: false,
      showFlag: false,
      showReject: false,
      showViewHistory: true,
      showViewMessage: true,
      resolved: true,
      rejected: false,
      needsAttention: false,
    };
  }

  const rejected = isRejected(comm);
  if (rejected) {
    return {
      showReclassify: true,
      showConfirm: false,
      showFlag: false,
      showReject: false,
      showViewHistory: true,
      showViewMessage: true,
      resolved: true,
      rejected: true,
      needsAttention: false,
    };
  }

  // Resolved synthetic UAT → audit history posture (preserve rejected handling above).
  if (isSyntheticHistoryNotActionable(comm)) {
    return {
      showReclassify: false,
      showConfirm: false,
      showFlag: false,
      showReject: false,
      showViewHistory: true,
      showViewMessage: true,
      resolved: true,
      rejected: false,
      needsAttention: false,
    };
  }

  const flagged = asMeta(comm).flagged_for_review === true;
  const autoCompleted = isAutoCompletedAck(comm, record);
  const classificationAttention = classificationNeedsAttention(
    comm.classification,
    comm.classification_confidence != null ? Number(comm.classification_confidence) : null,
    comm.needs_human_attention,
  );
  const incomplete = Boolean(incompleteReason(comm));
  const unmatched = asRecord(asMeta(comm).match).matched === false;
  const needsAttention =
    flagged || classificationAttention || incomplete || unmatched;
  const manuallyResolved = isManuallyResolved(comm);
  const resolved = autoCompleted || (manuallyResolved && !needsAttention && !flagged);

  if (autoCompleted || (resolved && !needsAttention)) {
    return {
      showReclassify: false,
      showConfirm: false,
      showFlag: true,
      showReject: false,
      showViewHistory: true,
      showViewMessage: true,
      resolved: true,
      rejected: false,
      needsAttention: false,
    };
  }

  if (needsAttention || flagged) {
    return {
      showReclassify: true,
      showConfirm: true,
      showFlag: !flagged,
      showReject: true,
      showViewHistory: Boolean(comm.reviewed_at || asMeta(comm).review_decision),
      showViewMessage: true,
      resolved: false,
      rejected: false,
      needsAttention: true,
    };
  }

  if (manuallyResolved) {
    return {
      showReclassify: true,
      showConfirm: false,
      showFlag: true,
      showReject: false,
      showViewHistory: true,
      showViewMessage: true,
      resolved: true,
      rejected: false,
      needsAttention: false,
    };
  }

  // Default quiet state (classified outbound / routine inbound)
  return {
    showReclassify: true,
    showConfirm: false,
    showFlag: true,
    showReject: false,
    showViewHistory: false,
    showViewMessage: true,
    resolved: false,
    rejected: false,
    needsAttention: false,
  };
}

function stage5StatusLabel(
  comm: CoordinationCommunication,
  record?: CoordinationRecord | null,
): string | null {
  if (isAutoCompletedAck(comm, record)) return "Stage 5 completed";
  if (record && Number(record.current_stage) === 5) {
    const state = String(record.current_stage_state || "").toUpperCase();
    if (state === "COMPLETED") return "Stage 5 completed";
    if (state === "AWAITING_UTILITY") return "Stage 5 awaiting utility";
    if (state) return `Stage 5 ${state.toLowerCase().replace(/_/g, " ")}`;
  }
  return null;
}

export function buildCommunicationCardModel(
  comm: CoordinationCommunication,
  opts: {
    providerName?: string | null;
    record?: CoordinationRecord | null;
  } = {},
): CommunicationCardModel {
  const provider = str(opts.providerName) || "Utility";
  const ownEcho = isOwnOutboundPackageEcho(comm);
  const classification = String(comm.classification || "").trim() || null;
  const isAcknowledgment = !ownEcho && classification === "acknowledgment";
  const fields = extractedFields(comm);
  const attentionReasons = getNeedsAttentionReasons(comm);
  const actionPlan = getCommunicationActionPlan(comm, opts.record);
  const needsAttention = actionPlan.needsAttention;
  const missingPm =
    attentionReasons.includes("Utility project manager/coordinator not assigned") ||
    incompleteReason(comm) === "missing_utility_pm";

  const classLabel = ownEcho
    ? "Outbound transmission"
    : isOutboundDirection(comm)
      ? "Outbound transmission"
      : isAcknowledgment
        ? missingPm
          ? "Acknowledgment — Utility contact not assigned"
          : "Acknowledgment"
        : formatCommunicationClassification(classification);

  const title = `${provider} — ${classLabel}`;

  const confidence =
    ownEcho || isOutboundDirection(comm) ? null : formatConfidencePct(comm.classification_confidence);
  const stageLabel =
    ownEcho || isOutboundDirection(comm) ? null : stage5StatusLabel(comm, opts.record);
  let subtitle: string | null = null;
  if (ownEcho || isOutboundDirection(comm)) {
    // History label only — these must never appear in the Needs Attention queue.
    subtitle = ownEcho
      ? "Linked to sent application package · not operator attention"
      : "Outbound transmission · not operator attention";
  } else if (needsAttention && attentionReasons.length) {
    subtitle = `Why this needs attention · ${attentionReasons[0]}`;
  } else if (confidence || stageLabel) {
    subtitle = [confidence, stageLabel].filter(Boolean).join(" · ");
  } else if (isRejected(comm)) {
    subtitle = "Rejected · not relevant";
  }

  const recordMeta = asRecord(opts.record?.metadata);
  const ticket = str(fields.utility_ticket_number);
  const account =
    str(fields.utility_account_number) || str(opts.record?.utility_account_number);
  const pm = hasRealPm(fields.utility_project_manager)
    ? str(fields.utility_project_manager)
    : hasRealPm(opts.record?.utility_contact_name)
      ? str(opts.record?.utility_contact_name)
      : null;
  const ackDate =
    formatShortDate(str(fields.acknowledgment_date)) ||
    formatShortDate(opts.record?.acknowledgment_received_at) ||
    formatShortDate(comm.message_timestamp || comm.created_at);

  const detailParts: string[] = [];
  if (ticket) detailParts.push(`Ticket ${sanitizeOperatorCommunicationText(ticket)}`);
  else if (account) detailParts.push(`Account ${sanitizeOperatorCommunicationText(account)}`);
  if (pm) detailParts.push(`PM ${pm}`);
  if (ackDate) {
    detailParts.push(needsAttention && !pm ? `Received ${ackDate}` : ackDate);
  }
  const detailLine = detailParts.length ? detailParts.join(" · ") : null;

  const nextAction =
    str(fields.next_required_action) ||
    str(recordMeta.next_required_action) ||
    (isAcknowledgment && !needsAttention
      ? "Monitor for class of service / design review"
      : null);
  const nextLine = nextAction ? `Next: ${sanitizeOperatorCommunicationText(nextAction)}` : null;

  return {
    title,
    subtitle,
    detailLine,
    nextLine,
    attentionReasons,
    directionLabel: ownEcho || isOutboundDirection(comm) ? "Outbound" : formatDirectionLabel(comm.direction),
    overrideLine: ownEcho || isOutboundDirection(comm) ? null : formatOverrideLine(comm),
    displaySubject: formatCommunicationSubjectForDisplay(comm.raw_subject),
    actions: actionPlan,
    isAcknowledgment,
  };
}
