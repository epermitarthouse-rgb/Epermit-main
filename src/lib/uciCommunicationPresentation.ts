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
import { resolveUtilityContact } from "@/lib/uciUtilityContact";

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

const SYNTHETIC_SUBJECT_RE = /\[(?:UCI\s+)?SYNTHETIC\s+TEST\]/i;
const SYNTHETIC_SUBJECT_PLAIN_RE = /^synthetic\s+test\b/i;
const SYNTHETIC_PACKAGE_SUBJECT_RE =
  /^\[TEST\].*utility\s+coordination\s+application\s+package/i;
const SYNTHETIC_BODY_RE =
  /SYNTHETIC\s*\/\s*TEST\s+ONLY|SYNTHETIC\s+TEST\s+ONLY|NOT\s+a\s+real\s+Dominion|NOT\s+A\s+REAL\s+DOMINION/i;
const UAT_RUN_ID_RE = /\b(?:s5uat|s5neg)-[a-z0-9-]+\b/i;

/**
 * Controlled Stage 5 / Stage 6 / synthetic UAT communications (Graph self-send tests).
 * Detection is presentation-only — never deletes or mutates backend rows.
 */
export function isSyntheticUatCommunication(comm: CoordinationCommunication): boolean {
  const meta = asMeta(comm);
  if (meta.uat === true || meta.synthetic_test === true || meta.synthetic_history === true) {
    return true;
  }
  const runId = str(meta.run_id) || str(asRecord(meta.uat).run_id);
  if (runId && UAT_RUN_ID_RE.test(runId)) return true;
  const subject = String(comm.raw_subject || "");
  const body = String(comm.raw_body || "");
  if (SYNTHETIC_SUBJECT_RE.test(subject)) return true;
  if (SYNTHETIC_SUBJECT_PLAIN_RE.test(subject)) return true;
  if (SYNTHETIC_PACKAGE_SUBJECT_RE.test(subject)) return true;
  if (UAT_RUN_ID_RE.test(subject) || UAT_RUN_ID_RE.test(body)) return true;
  if (SYNTHETIC_BODY_RE.test(body)) return true;
  return false;
}

/**
 * Crude / residual synthetic tests that should not inflate operator queues
 * (e.g. "Synthetic test -…" with trivial body, or [TEST] package-send echoes).
 */
function isInertSyntheticTestArtifact(comm: CoordinationCommunication): boolean {
  const meta = asMeta(comm);
  if (meta.no_longer_actionable === true || meta.synthetic_history === true) return true;
  if (meta.synthetic_test === true && meta.actionable === false) return true;
  const subject = String(comm.raw_subject || "");
  const body = String(comm.raw_body || "").trim();
  if (SYNTHETIC_PACKAGE_SUBJECT_RE.test(subject)) return true;
  // Vague Gmail self-tests: subject says Synthetic test, body is essentially empty/"test".
  if (SYNTHETIC_SUBJECT_PLAIN_RE.test(subject) && body.length < 40) return true;
  return false;
}

/**
 * Operator still needs to act (Needs Attention / unresolved reasons).
 * Resolved, confirmed, rejected, or auto-completed items are not actionable.
 */
export function isCommunicationActionableForInbox(
  comm: CoordinationCommunication,
  record?: CoordinationRecord | null,
  allCommunications?: CoordinationCommunication[],
): boolean {
  const plan = getCommunicationActionPlan(comm, record, { allCommunications });
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

export type ConversationActionState = "action_required" | "waiting" | "resolved";

export type InboxThreadGroup<TRecord = CoordinationRecord> = {
  key: string;
  record: TRecord;
  threadId: string | null;
  grouping: "thread" | "subject" | "message";
  messages: CoordinationCommunication[];
  latest: CoordinationCommunication;
};

export type InboxConversationCardModel = {
  projectName: string;
  providerName: string;
  subject: string;
  category: string;
  summary: string | null;
  timestamp: string | null;
  timestampLabel: string;
  classification: string | null;
  actionState: ConversationActionState;
  actionStateLabel: string;
  messageCount: number;
  showMessageCount: boolean;
  attentionReasons: string[];
  latest: CoordinationCommunication;
  chronological: CoordinationCommunication[];
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

/** Graph conversation id, stored thread_id, or metadata conversation id. */
export function resolveInboxThreadId(comm: CoordinationCommunication): string | null {
  const meta = asMeta(comm);
  const graph = asRecord(meta.graph);
  const match = asRecord(meta.match);
  return (
    str(comm.thread_id) ||
    str(meta.conversation_id) ||
    str(meta.graph_conversation_id) ||
    str(graph.conversationId) ||
    str(graph.conversation_id) ||
    str(match.conversation_id) ||
    str(match.thread_id) ||
    null
  );
}

function normalizeSubjectForThread(subject: string | null | undefined): string | null {
  let text = String(subject || "").trim().toLowerCase();
  while (/^(re|fw|fwd)\s*:/.test(text)) {
    text = text.replace(/^(re|fw|fwd)\s*:\s*/, "");
  }
  text = sanitizeOperatorCommunicationText(text).toLowerCase();
  return text || null;
}

export function resolveInboxConversationKey(
  comm: CoordinationCommunication,
  recordId: string,
): { key: string; threadId: string | null; grouping: InboxThreadGroup["grouping"] } {
  const threadId = resolveInboxThreadId(comm);
  if (threadId) {
    return {
      key: `thread:${recordId}:${threadId}`,
      threadId,
      grouping: "thread",
    };
  }
  const subject = normalizeSubjectForThread(comm.raw_subject);
  if (subject) {
    return {
      key: `subj:${recordId}:${subject}`,
      threadId: null,
      grouping: "subject",
    };
  }
  return { key: `msg:${comm.id}`, threadId: null, grouping: "message" };
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
 * Group production (and actionable) Inbox items by Graph/conversation thread_id,
 * then by normalized subject on the same record. Messages without either stay
 * as single-message groups. Never merges distinct records.
 */
export function groupInboxItemsByThread<TRecord>(
  items: Array<InboxFeedItem<TRecord>>,
): Array<InboxThreadGroup<TRecord>> {
  const groups = new Map<string, InboxThreadGroup<TRecord>>();
  const order: string[] = [];

  for (const item of items) {
    const recordId = String((item.record as { id?: string }).id || "");
    const resolved = resolveInboxConversationKey(item.message, recordId);
    const existing = groups.get(resolved.key);
    if (!existing) {
      groups.set(resolved.key, {
        key: resolved.key,
        record: item.record,
        threadId: resolved.threadId,
        grouping: resolved.grouping,
        messages: [item.message],
        latest: item.message,
      });
      order.push(resolved.key);
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
  showConfirmed: boolean;
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

export type CommunicationPresentationContext = {
  record?: CoordinationRecord | null;
  /** Same-record messages used to resolve supplemental thread PM/ticket evidence. */
  allCommunications?: CoordinationCommunication[];
};

/** PM/ticket/account from later inbound messages on the same record or Graph thread. */
export function resolveSupplementalThreadFields(
  comm: CoordinationCommunication,
  allCommunications: CoordinationCommunication[] = [],
): Record<string, unknown> {
  const anchorMs = messageSortTime(comm);
  const threadId = resolveInboxThreadId(comm);
  const supplemental: Record<string, unknown> = {};

  for (const row of allCommunications) {
    if (row.id === comm.id) continue;
    if (isOutboundDirection(row) || isRejected(row)) continue;

    const rowThread = resolveInboxThreadId(row);
    const sameThread = Boolean(threadId && rowThread && threadId === rowThread);
    const rowMs = messageSortTime(row);
    const isLater = !anchorMs || !Number.isFinite(rowMs) || rowMs >= anchorMs - 60_000;
    if (!sameThread && anchorMs && Number.isFinite(rowMs) && rowMs < anchorMs - 60_000) {
      continue;
    }
    if (!sameThread && !isLater) continue;

    const extracted = extractedFields(row);
    if (!supplemental.utility_project_manager && hasRealPm(extracted.utility_project_manager)) {
      supplemental.utility_project_manager = str(extracted.utility_project_manager);
    }
    if (!supplemental.utility_ticket_number && str(extracted.utility_ticket_number)) {
      supplemental.utility_ticket_number = str(extracted.utility_ticket_number);
    }
    if (!supplemental.utility_account_number && str(extracted.utility_account_number)) {
      supplemental.utility_account_number = str(extracted.utility_account_number);
    }
  }

  return supplemental;
}

function resolveEffectiveExtractedFields(
  comm: CoordinationCommunication,
  ctx: CommunicationPresentationContext = {},
): Record<string, unknown> {
  const own = extractedFields(comm);
  const supplemental = resolveSupplementalThreadFields(comm, ctx.allCommunications ?? []);
  return { ...supplemental, ...own };
}

function resolveEffectivePm(
  comm: CoordinationCommunication,
  ctx: CommunicationPresentationContext = {},
): string | null {
  const fields = resolveEffectiveExtractedFields(comm, ctx);
  if (hasRealPm(fields.utility_project_manager)) return str(fields.utility_project_manager);
  if (hasRealPm(ctx.record?.utility_project_manager)) return str(ctx.record!.utility_project_manager!);
  if (hasRealPm(ctx.record?.utility_contact_name)) return str(ctx.record!.utility_contact_name);
  return null;
}

export function resolveRecordUtilityContact(
  record?: CoordinationRecord | null,
  communications?: CoordinationCommunication[],
) {
  return resolveUtilityContact({ record, communications });
}

function designReviewNeedsOperatorAction(comm: CoordinationCommunication): boolean {
  const meta = asMeta(comm);
  const stage6 = asRecord(meta.stage_6_cos);
  const stage6Status = String(stage6.review_status || "");
  if (stage6.auto_completed === true || meta.stage_6_auto_completed === true) return false;
  if (stage6Status === "approved" || stage6Status === "superseded") return false;

  if (isHumanConfirmed(comm)) {
    return stage6Status === "needs_attention" || stage6Status === "revision_required";
  }

  const headline = String(
    asRecord(stage6.discrepancy_report).headline ||
      asRecord(asRecord(meta.uci_cos_analysis).discrepancy_report).headline ||
      "",
  ).toLowerCase();
  return (
    stage6Status === "needs_attention" ||
    stage6Status === "revision_required" ||
    headline.includes("undersized") ||
    headline.includes("capacity") ||
    headline.includes("mismatch")
  );
}

function incompleteReason(comm: CoordinationCommunication): string | null {
  const incomplete = asRecord(asMeta(comm).stage_5_incomplete);
  return str(incomplete.reason);
}

function isHumanConfirmed(comm: CoordinationCommunication): boolean {
  return asMeta(comm).human_confirmed === true;
}

function needsStage5CosAcceptance(
  comm: CoordinationCommunication,
  record?: CoordinationRecord | null,
): boolean {
  if (!record || Number(record.current_stage) !== 5) return false;
  if (String(record.current_stage_state || "").toUpperCase() === "COMPLETED") return false;
  const classification = String(comm.classification || "").trim();
  if (classification !== "design_review_response" && classification !== "class_of_service") {
    return false;
  }
  if (isHumanConfirmed(comm)) return false;
  if (isRejected(comm)) return false;
  const conf = Number(comm.classification_confidence);
  return Number.isFinite(conf) && conf >= LOW_CONFIDENCE_THRESHOLD;
}

function isStage5PresentationResolved(comm: CoordinationCommunication): boolean {
  const resolved = asMeta(comm).stage_5_resolved;
  if (resolved === true) return true;
  return Boolean(resolved && typeof resolved === "object");
}

function isAckPendingThreadPm(
  comm: CoordinationCommunication,
  ctx: CommunicationPresentationContext = {},
): boolean {
  if (String(comm.classification || "") !== "acknowledgment") return false;
  if (!isHumanConfirmed(comm)) return false;
  if (resolveEffectivePm(comm, ctx)) return false;
  if (isStage5PresentationResolved(comm)) return false;
  return incompleteReason(comm) === "missing_utility_pm";
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
  if (meta.stage_6_auto_completed === true) return true;
  if (asRecord(meta.stage_6_completion).auto_completed === true) return true;
  if (asRecord(meta.stage_6_cos).auto_completed === true) return true;
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
  allCommunications?: CoordinationCommunication[],
): boolean {
  return buildCommunicationCardModel(comm, { record, allCommunications }).actions.needsAttention;
}

export function countCommunicationsNeedingAttention(
  communications: CoordinationCommunication[],
  record?: CoordinationRecord | null,
): number {
  return communications.filter((comm) =>
    communicationNeedsOperatorAttention(comm, record, communications),
  ).length;
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
  if (isInertSyntheticTestArtifact(comm)) return true;
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
  record?: CoordinationRecord | null,
  allCommunications?: CoordinationCommunication[],
): string[] {
  const ctx: CommunicationPresentationContext = { record, allCommunications };
  // Outbound transmissions and own package echoes are never operator triage reasons.
  if (isOwnOutboundPackageEcho(comm) || isOutboundDirection(comm)) return [];
  if (isRejected(comm) || isSyntheticHistoryNotActionable(comm)) return [];
  if (isAutoCompletedAck(comm, record)) return [];
  if (isHumanConfirmed(comm) && isStage5PresentationResolved(comm)) return [];

  const reasons: string[] = [];
  const meta = asMeta(comm);
  const fields = resolveEffectiveExtractedFields(comm, ctx);
  const effectivePm = resolveEffectivePm(comm, ctx);
  const incomplete = incompleteReason(comm);
  const confidence = Number(comm.classification_confidence);
  const classification = String(comm.classification || "").trim() || null;
  const stage6 = asRecord(meta.stage_6_cos);
  const stage6Status = String(stage6.review_status || "");

  if (stage6.auto_completed === true || meta.stage_6_auto_completed === true) return [];
  if (stage6Status === "approved" || stage6Status === "superseded") return [];

  if (meta.flagged_for_review === true) {
    reasons.push("Flagged for human review");
  }

  const missingPm =
    !effectivePm &&
    (incomplete === "missing_utility_pm" ||
      (classification === "acknowledgment" && !hasRealPm(fields.utility_project_manager)));
  if (missingPm && !(isHumanConfirmed(comm) && incomplete === "missing_utility_pm")) {
    reasons.push("Utility project manager/coordinator not assigned");
  }

  if (incomplete === "missing_ticket_or_account") {
    reasons.push("Missing utility ticket or account number");
  }
  if (incomplete === "missing_acknowledgment_date") {
    reasons.push("Missing acknowledgment date");
  }
  if (incomplete === "missing_utility_contact_email") {
    reasons.push("Utility contact email required for outbound meter-set request");
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

  if (classification === "class_of_service" || classification === "design_review_response") {
    if (designReviewNeedsOperatorAction(comm)) {
      reasons.push("Service capacity differs from submitted load");
    }
  }

  if (classification === "ciac_invoice") {
    const variance = Number(
      fields.variance_pct ?? asRecord(meta.ciac).variance_pct ?? asRecord(meta.cost).variance_pct,
    );
    if (Number.isFinite(variance) && variance > 20) {
      reasons.push("CIAC variance exceeds 20% — billing hold");
    } else if (comm.needs_human_attention) {
      reasons.push("CIAC invoice needs operator review");
    }
  }

  if (classification === "equipment_eta_update" && comm.needs_human_attention) {
    reasons.push("Equipment ETA slipped versus last recorded date");
  }

  const meter = asRecord(meta.meter_set);
  if (
    classification === "meter_set_scheduling" &&
    (meta.no_show === true || meter.no_show === true || Number(meter.reschedule_count || 0) >= 2)
  ) {
    reasons.push("Meter set needs reschedule");
  }

  if (classification === "inspection_release_request") {
    reasons.push("Inspection release requested — record it in the energization workspace");
  }

  if (classification === "escalation_or_problem") {
    reasons.push("Utility reported a problem or escalation");
  }
  if (classification === "request_for_information") {
    reasons.push("Utility requested additional information");
  }

  const staleAttentionFlag =
    comm.needs_human_attention === true &&
    !isHumanConfirmed(comm) &&
    !isStage5PresentationResolved(comm);
  if (
    !isHumanConfirmed(comm) &&
    classificationNeedsAttention(
      classification,
      Number.isFinite(confidence) ? confidence : null,
      staleAttentionFlag,
    ) &&
    reasons.length === 0
  ) {
    reasons.push(
      meta.classifier_error || meta.parser_failure
        ? "Unresolved classifier/parser failure"
        : "Low classification confidence",
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

export type CommunicationActionSurface = "inbox" | "needs-attention" | "workspace";

export function getCommunicationActionPlan(
  comm: CoordinationCommunication,
  record?: CoordinationRecord | null,
  opts?: CommunicationPresentationContext & { surface?: CommunicationActionSurface },
): CommunicationActionPlan {
  const hideFlag = opts?.surface === "needs-attention";
  const emptyActions = (overrides: Partial<CommunicationActionPlan>): CommunicationActionPlan => ({
    showReclassify: false,
    showConfirm: false,
    showConfirmed: false,
    showFlag: false,
    showReject: false,
    showViewHistory: true,
    showViewMessage: true,
    resolved: false,
    rejected: false,
    needsAttention: false,
    ...overrides,
  });

  // Outbound transmissions / package echoes are history, not operator attention.
  if (isOwnOutboundPackageEcho(comm) || isOutboundDirection(comm)) {
    return emptyActions({ resolved: true });
  }

  const rejected = isRejected(comm);
  if (rejected) {
    return emptyActions({
      showReclassify: true,
      resolved: true,
      rejected: true,
    });
  }

  // Resolved synthetic UAT → audit history posture (preserve rejected handling above).
  if (isSyntheticHistoryNotActionable(comm)) {
    return emptyActions({ resolved: true });
  }

  const ctx: CommunicationPresentationContext = {
    record,
    allCommunications: opts?.allCommunications,
  };
  const humanConfirmed = isHumanConfirmed(comm);
  const cosAcceptance = needsStage5CosAcceptance(comm, record);
  const ackPendingThreadPm = isAckPendingThreadPm(comm, ctx);

  if (cosAcceptance && !humanConfirmed) {
    return emptyActions({
      showReclassify: true,
      showConfirm: true,
      showReject: true,
      showViewHistory: Boolean(comm.reviewed_at || asMeta(comm).review_decision),
      resolved: false,
      needsAttention: true,
    });
  }

  if (ackPendingThreadPm) {
    return emptyActions({
      showReclassify: true,
      showConfirmed: true,
      showFlag: hideFlag ? false : true,
      showViewHistory: Boolean(comm.reviewed_at || asMeta(comm).review_decision),
      resolved: false,
      needsAttention: false,
    });
  }

  const flagged = asMeta(comm).flagged_for_review === true;
  const autoCompleted = isAutoCompletedAck(comm, record);
  const stage6 = asRecord(asMeta(comm).stage_6_cos);
  const stage6Closed =
    stage6.auto_completed === true ||
    asMeta(comm).stage_6_auto_completed === true ||
    String(stage6.review_status || "") === "approved" ||
    String(stage6.review_status || "") === "superseded";
  const attentionReasons = getNeedsAttentionReasons(comm, record, opts?.allCommunications);
  const needsAttention =
    !autoCompleted && !stage6Closed && (flagged || attentionReasons.length > 0);
  const manuallyResolved = isManuallyResolved(comm);
  const resolved =
    autoCompleted ||
    stage6Closed ||
    isStage5PresentationResolved(comm) ||
    (manuallyResolved && !needsAttention && !flagged);

  if (humanConfirmed && !needsAttention && !flagged) {
    return emptyActions({
      showReclassify: true,
      showConfirmed: true,
      showFlag: hideFlag ? false : true,
      showViewHistory: Boolean(comm.reviewed_at || asMeta(comm).review_decision),
      resolved: true,
    });
  }

  if (autoCompleted || stage6Closed || (resolved && !needsAttention)) {
    return emptyActions({
      showFlag: hideFlag ? false : true,
      resolved: true,
      showConfirmed: humanConfirmed,
    });
  }

  if (needsAttention || flagged) {
    return emptyActions({
      showReclassify: true,
      showConfirm: !humanConfirmed,
      showConfirmed: humanConfirmed,
      showFlag: hideFlag ? false : !flagged,
      showReject: !humanConfirmed,
      showViewHistory: Boolean(comm.reviewed_at || asMeta(comm).review_decision),
      resolved: false,
      needsAttention,
    });
  }

  if (manuallyResolved) {
    return emptyActions({
      showReclassify: true,
      showConfirmed: humanConfirmed,
      showFlag: hideFlag ? false : true,
      resolved: true,
    });
  }

  // Default quiet state (classified outbound / routine inbound)
  return emptyActions({
    showReclassify: true,
    showFlag: hideFlag ? false : true,
    showViewHistory: false,
  });
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
    allCommunications?: CoordinationCommunication[];
  } = {},
): CommunicationCardModel {
  const provider = str(opts.providerName) || "Utility";
  const ownEcho = isOwnOutboundPackageEcho(comm);
  const classification = String(comm.classification || "").trim() || null;
  const isAcknowledgment = !ownEcho && classification === "acknowledgment";
  const ctx = { record: opts.record, allCommunications: opts.allCommunications };
  const attentionReasons = getNeedsAttentionReasons(
    comm,
    opts.record,
    opts.allCommunications,
  );
  const actionPlan = getCommunicationActionPlan(comm, opts.record, {
    allCommunications: opts.allCommunications,
  });
  const needsAttention = actionPlan.needsAttention;
  const missingPm =
    attentionReasons.includes("Utility project manager/coordinator not assigned") ||
    (incompleteReason(comm) === "missing_utility_pm" && !resolveEffectivePm(comm, ctx));
  const fields = resolveEffectiveExtractedFields(comm, ctx);

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

function truncateOperatorText(value: string, max = 160): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function conciseCommunicationSummary(
  comm: CoordinationCommunication,
): string | null {
  const parsed = sanitizeOperatorCommunicationText(comm.parsed_summary);
  if (parsed && !/^keyword match:/i.test(parsed)) return truncateOperatorText(parsed);
  const body = sanitizeOperatorCommunicationText(comm.raw_body);
  if (body) return truncateOperatorText(body);
  const items = Array.isArray(comm.parsed_action_items) ? comm.parsed_action_items : [];
  const first = items
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const row = item as Record<string, unknown>;
      return sanitizeOperatorCommunicationText(
        String(row.detail || row.reason || row.type || ""),
      );
    })
    .find(Boolean);
  return first ? truncateOperatorText(first) : null;
}

export function listCommunicationAttachmentLabels(
  comm: CoordinationCommunication,
): string[] {
  const raw = comm.raw_attachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return sanitizeOperatorCommunicationText(item);
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        return sanitizeOperatorCommunicationText(
          String(row.file_name || row.name || row.filename || row.label || ""),
        );
      }
      return "";
    })
    .filter(Boolean);
}

export function formatConversationActionState(state: ConversationActionState): string {
  if (state === "action_required") return "Action required";
  if (state === "waiting") return "Waiting";
  return "Resolved";
}

export function conversationActionState(
  messages: CoordinationCommunication[],
  record?: CoordinationRecord | null,
): ConversationActionState {
  if (messages.some((message) => communicationNeedsOperatorAttention(message, record, messages))) {
    return "action_required";
  }
  if (
    messages.every((message) =>
      getCommunicationActionPlan(message, record, { allCommunications: messages }).resolved,
    )
  ) {
    return "resolved";
  }
  return "waiting";
}

export function buildInboxConversationCardModel<TRecord extends { id?: string }>(
  group: InboxThreadGroup<TRecord>,
  opts: {
    projectName?: string | null;
    providerName?: string | null;
    record?: CoordinationRecord | null;
  } = {},
): InboxConversationCardModel {
  const latest = group.latest;
  const record = opts.record ?? (group.record as unknown as CoordinationRecord);
  const card = buildCommunicationCardModel(latest, {
    providerName: opts.providerName,
    record,
    allCommunications: group.messages,
  });
  const actionState = conversationActionState(group.messages, record);
  const chronological = [...group.messages].sort(
    (left, right) => messageSortTime(left) - messageSortTime(right),
  );
  return {
    projectName: String(opts.projectName || "").trim() || "Project",
    providerName: String(opts.providerName || "").trim() || "Utility",
    subject: card.displaySubject,
    category: formatCommunicationClassification(latest.classification),
    summary: conciseCommunicationSummary(latest),
    timestamp: latest.message_timestamp || latest.created_at || null,
    timestampLabel: formatOperatorTimelineWhen(latest.message_timestamp || latest.created_at),
    classification: latest.classification,
    actionState,
    actionStateLabel: formatConversationActionState(actionState),
    messageCount: group.messages.length,
    showMessageCount: group.messages.length > 1,
    attentionReasons: actionState === "action_required" ? card.attentionReasons : [],
    latest,
    chronological,
  };
}

