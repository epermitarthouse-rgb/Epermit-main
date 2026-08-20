/**
 * Project-centric portfolio presentation. Coordination records stay nested
 * under the project; nothing is deleted — test/archive is a filter only.
 */

import {
  communicationNeedsOperatorAttention,
} from "@/lib/uciCommunicationPresentation";
import {
  isUnassignedRequiredProvider,
  providerNeedsConfirmationReason,
} from "@/lib/uciLifecycleMatrix";
import {
  buildNextStepNotice,
  formatConservativeP90Chip,
  formatTypicalP50Chip,
  formatUciLifecycleStateLabel,
  getLifecycleStageTitle,
} from "@/lib/uciWorkspaceGuidance";
import type { CoordinationCommunication, CoordinationRecord, LifecycleState } from "@/types/uci";

export type PortfolioFilter = "active" | "needs_attention" | "completed" | "archived_test";

export type PortfolioRecordLike = CoordinationRecord & {
  projectName?: string | null;
  project_name?: string | null;
  providerDisplayName?: string | null;
  provider_display_name?: string | null;
  attentionCount?: number;
  communications?: CoordinationCommunication[];
};

export type PortfolioProjectGroup = {
  projectId: string;
  projectName: string;
  records: PortfolioRecordLike[];
  utilityCount: number;
  attentionCount: number;
  furthestStage: number;
  furthestState: string;
  overallProgress: number;
  p50Label: string | null;
  p90Label: string | null;
  nextAction: string;
  isTestOrArchive: boolean;
  isCompleted: boolean;
  needsAttention: boolean;
};

const HIGHLAND_OPERATOR_RE = /highland\s+springs|mcdonald/i;
const TEST_ARCHIVE_NAME_RE =
  /\b(?:s5uat|s5neg|synthetic\s+test|uci\s+uat|fixture|archived?\s+test)\b/i;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function formatOperatorDateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function isTestOrArchiveProject(
  projectName: string | null | undefined,
  records: PortfolioRecordLike[],
): boolean {
  const name = String(projectName || "");
  if (HIGHLAND_OPERATOR_RE.test(name)) return false;
  if (TEST_ARCHIVE_NAME_RE.test(name)) return true;
  if (records.length === 0) return false;
  return records.every((record) => {
    const meta = asRecord(record.metadata);
    return meta.synthetic_test === true || meta.uat === true || meta.archived === true;
  });
}

export function countRecordAttention(record: PortfolioRecordLike): number {
  const fromCount = Number(record.attentionCount || 0);
  const comms = record.communications ?? [];
  const fromComms = comms.filter((message) => communicationNeedsOperatorAttention(message, record)).length;
  return Math.max(fromCount, fromComms);
}

function recordProgress(record: PortfolioRecordLike): number {
  const stage = Math.max(0, Math.min(10, Number(record.current_stage) || 0));
  const completedBoost = String(record.current_stage_state || "") === "COMPLETED" ? 1 : 0;
  return Math.round(((stage + completedBoost) / 11) * 100);
}

function furthestRecord(records: PortfolioRecordLike[]): PortfolioRecordLike {
  return [...records].sort((a, b) => {
    const stageDelta = Number(b.current_stage) - Number(a.current_stage);
    if (stageDelta !== 0) return stageDelta;
    const aDone = String(a.current_stage_state) === "COMPLETED" ? 1 : 0;
    const bDone = String(b.current_stage_state) === "COMPLETED" ? 1 : 0;
    return bDone - aDone;
  })[0]!;
}

function nextActionForProject(records: PortfolioRecordLike[]): string {
  const open = records
    .filter((record) => !(Number(record.current_stage) === 10 && String(record.current_stage_state) === "COMPLETED"))
    .sort((a, b) => Number(b.current_stage) - Number(a.current_stage));
  const focus = open[0] ?? furthestRecord(records);
  const notice = buildNextStepNotice({
    stage: Number(focus.current_stage),
    state: focus.current_stage_state as LifecycleState,
    lastError: focus.last_error,
  });
  const provider =
    focus.providerDisplayName ||
    focus.provider_display_name ||
    focus.utility_type ||
    "utility";
  return `${provider}: ${notice.body}`;
}

export function groupPortfolioByProject(
  records: PortfolioRecordLike[],
): PortfolioProjectGroup[] {
  const byProject = new Map<string, PortfolioRecordLike[]>();
  const order: string[] = [];
  for (const record of records) {
    const projectId = String(record.project_id || "");
    if (!projectId) continue;
    if (!byProject.has(projectId)) {
      byProject.set(projectId, []);
      order.push(projectId);
    }
    byProject.get(projectId)!.push(record);
  }

  return order.map((projectId) => {
    const grouped = byProject.get(projectId)!;
    const projectName =
      grouped[0]?.projectName || grouped[0]?.project_name || "Unnamed project";
    const attentionCount = grouped.reduce((sum, record) => sum + countRecordAttention(record), 0);
    const furthest = furthestRecord(grouped);
    const isCompleted = grouped.every(
      (record) => Number(record.current_stage) === 10 && String(record.current_stage_state) === "COMPLETED",
    );
    const isTestOrArchive = isTestOrArchiveProject(projectName, grouped);
    const progressValues = grouped.map(recordProgress);
    const overallProgress = Math.round(
      progressValues.reduce((sum, value) => sum + value, 0) / Math.max(progressValues.length, 1),
    );
    const p50Record =
      grouped.find((record) => record.predicted_p50_date) || furthest;
    return {
      projectId,
      projectName,
      records: grouped,
      utilityCount: grouped.length,
      attentionCount,
      furthestStage: Number(furthest.current_stage) || 0,
      furthestState: formatUciLifecycleStateLabel(furthest.current_stage_state),
      overallProgress,
      p50Label: formatTypicalP50Chip(p50Record, formatOperatorDateOnly),
      p90Label: formatConservativeP90Chip(p50Record, formatOperatorDateOnly),
      nextAction: nextActionForProject(grouped),
      isTestOrArchive,
      isCompleted,
      needsAttention: attentionCount > 0,
    };
  });
}

export function matchesPortfolioFilter(
  group: PortfolioProjectGroup,
  filter: PortfolioFilter,
): boolean {
  if (filter === "archived_test") return group.isTestOrArchive;
  if (filter === "completed") return group.isCompleted && !group.isTestOrArchive;
  if (filter === "needs_attention") return group.needsAttention && !group.isTestOrArchive;
  return !group.isTestOrArchive && !group.isCompleted;
}

export function portfolioFilterLabel(filter: PortfolioFilter): string {
  switch (filter) {
    case "needs_attention":
      return "Needs Attention";
    case "completed":
      return "Completed";
    case "archived_test":
      return "Archived / Test";
    default:
      return "Active";
  }
}

export function furthestStageLabel(stage: number): string {
  return `Stage ${stage} · ${getLifecycleStageTitle(stage)}`;
}

export type RecordAttentionItem = {
  kind: "communication" | "record";
  id: string;
  record: PortfolioRecordLike;
  message?: CoordinationCommunication;
  reason: string;
  tab: "communications" | "cos" | "costs" | "energization-closeout" | "overview";
};

const RECORD_ALERT_LABELS: Record<string, string> = {
  COST_VARIANCE_BLOCK_BILL: "CIAC variance exceeds 20% — billing hold",
  COST_UNPAID_INVOICE: "Utility invoice is unpaid",
  COST_QB_FAILED: "QuickBooks invoice failed — retry or review",
  COST_CIAC_SLA: "CIAC payment SLA is overdue",
  EQUIPMENT_NO_RESPONSE: "No equipment ETA response in 14 days",
  EQUIPMENT_SLIP_INCREASE: "Equipment ETA slipped versus last recorded date",
  METER_SET_NO_SHOW: "Meter-set crew no-show needs reschedule",
  METER_SET_MULTI_RESCHEDULE: "Meter set has been rescheduled more than once",
  PREDICTION_P50_SLIP: "Typical (P50) date slipped more than 7 days",
  "uci.prediction.p50_slip": "Typical (P50) date slipped more than 7 days",
  LOAD_OVERSIZED: "Calculated service size exceeds 800A — review required",
  EMAIL_BOUNCE: "Utility submission email bounced",
};

function tabForReason(reason: string, code: string): RecordAttentionItem["tab"] {
  if (/ciac|invoice|billing|quickbooks|cost/i.test(`${reason} ${code}`)) return "costs";
  if (/eta|equipment/i.test(`${reason} ${code}`)) return "costs";
  if (/meter|inspection|energiz|closeout/i.test(`${reason} ${code}`)) return "energization-closeout";
  if (/capacity|class of service|cos/i.test(`${reason} ${code}`)) return "cos";
  if (/provider|geocod/i.test(`${reason} ${code}`)) return "overview";
  return "communications";
}

export function listRecordOperatorAttentionItems(
  record: PortfolioRecordLike,
): RecordAttentionItem[] {
  const items: RecordAttentionItem[] = [];
  const meta = asRecord(record.metadata);
  const alerts = Array.isArray(meta.uci_alerts) ? meta.uci_alerts : [];
  for (const alert of alerts) {
    if (!alert || typeof alert !== "object") continue;
    const row = alert as Record<string, unknown>;
    if (row.resolved_at) continue;
    const code = String(row.code || row.event || "");
    if (!code) continue;
    const reason =
      RECORD_ALERT_LABELS[code] ||
      String(row.label || code).replace(/_/g, " ").replace(/^uci\./, "");
    items.push({
      kind: "record",
      id: `${record.id}:${code}`,
      record,
      reason,
      tab: tabForReason(reason, code),
    });
  }

  const state = String(record.current_stage_state || "");
  if (isUnassignedRequiredProvider(record)) {
    items.push({
      kind: "record",
      id: `${record.id}:unassigned-provider`,
      record,
      reason: providerNeedsConfirmationReason(record.utility_type),
      tab: "overview",
    });
  }
  if (state === "BLOCKED" && record.last_error) {
    items.push({
      kind: "record",
      id: `${record.id}:blocked`,
      record,
      reason: record.last_error,
      tab: "overview",
    });
  }

  const cos = asRecord(meta.uci_cos_analysis);
  if (
    (cos.needs_human_attention === true || String(cos.review_status || "") === "needs_attention") &&
    String(cos.review_status || "") !== "approved" &&
    cos.auto_completed !== true
  ) {
    items.push({
      kind: "record",
      id: `${record.id}:cos`,
      record,
      reason: "Service capacity differs from submitted load",
      tab: "cos",
    });
  }

  return items;
}
