/**
 * Read-only presentation model for the 10 UCI lifecycle stages.
 * Uses records already scoped to one coordination record.
 * Does not infer an external event from the saved stage number alone.
 */

import {
  formatCommunicationSubjectForDisplay,
  formatDirectionLabel,
  isSyntheticUatCommunication,
  listCommunicationAttachmentLabels,
  conciseCommunicationSummary,
} from "@/lib/uciCommunicationPresentation";
import type { UciDocumentRegistryEntry } from "@/lib/uciDocumentRegistry";
import { normalizeLifecycleStage } from "@/lib/uciLifecycleMatrix";
import { getProviderMappingFromMetadata } from "@/lib/uciLifecycleProposals";
import {
  getApplicationPackageDraftApplication,
  parseApplicationPackageMetadata,
  parsePackageDocuments,
} from "@/lib/uciApplicationPrep";
import { getLoadProfileDraftApplication, parseLoadProfileSummary } from "@/lib/uciLoadProfile";
import {
  formatConfidenceLabel,
  formatResolutionMethodLabel,
  formatResolutionStatusLabel,
} from "@/lib/uciProviderResolution";
import { formatUciLifecycleStateLabel } from "@/lib/uciWorkspaceGuidance";
import type {
  CoordinationApplication,
  CoordinationCommunication,
  CoordinationCosDesignRecord,
  CoordinationCost,
  CoordinationEquipment,
  CoordinationMilestone,
  CoordinationRecord,
  CoordinationTransition,
  UciRecordDetailResponse,
} from "@/types/uci";

export const UCI_STAGE_HISTORY_CATALOG = [
  { stage: 1, name: "Provider Mapping" },
  { stage: 2, name: "Load Profile / Service Sizing" },
  { stage: 3, name: "Application Preparation" },
  { stage: 4, name: "Submission" },
  { stage: 5, name: "Acknowledgment" },
  { stage: 6, name: "Class of Service / Design Review" },
  { stage: 7, name: "CIAC / Cost Confirmed" },
  { stage: 8, name: "Equipment & Long-Lead" },
  { stage: 9, name: "Pre-Energization Coordination" },
  { stage: 10, name: "Energization & Closeout" },
] as const;

const COMPLETION_WITHOUT_DETAIL = "Completion recorded. Supporting details are not available.";

const CLASSIFICATION_STAGE: Record<string, number> = {
  acknowledgment: 5,
  class_of_service: 6,
  design_review_response: 6,
  ciac_invoice: 7,
  equipment_eta_update: 8,
  "uci.equipment_eta_checkin.v1": 8,
  inspection_release_request: 9,
  meter_set_scheduling: 9,
  energization_confirmation: 10,
};

export type UciStagePosition = "completed" | "current" | "not_reached";

export type UciStageHistoryDocument = {
  name: string;
  typeLabel: string;
  date: string | null;
  sourceLabel: string;
  reviewLabel: string;
  downloadPath: string | null;
  testRecord: boolean;
};

export type UciStageHistoryCommunication = {
  id: string;
  date: string | null;
  direction: string;
  summary: string;
  contact: string;
  actionItems: string[];
  attachments: string[];
  testRecord: boolean;
};

export type UciStageHistoryMilestone = {
  id: string;
  label: string;
  status: string;
  targetDate: string | null;
  actualDate: string | null;
  note: string | null;
};

export type UciStageHistoryStage = {
  stage: number;
  name: string;
  position: UciStagePosition;
  statusLabel: string;
  startedAt: string | null;
  advancedAt: string | null;
  workSummary: string;
  responsibleParty: string;
  workPerformed: string[];
  documents: UciStageHistoryDocument[];
  hiddenDocumentCount: number;
  communications: UciStageHistoryCommunication[];
  hiddenCommunicationCount: number;
  milestones: UciStageHistoryMilestone[];
  completionEvidence: string[];
  completionMessage: string;
  previousStageName: string | null;
  nextStageName: string | null;
  transitionDate: string | null;
  transitionReason: string;
  transitionTrigger: string;
  transitionTestRecord: boolean;
  relatedTransitions: Array<{
    id: string;
    summary: string;
    testRecord: boolean;
  }>;
  hiddenTransitionCount: number;
};

export type UciStageHistoryModel = {
  savedStage: number | null;
  savedStateLabel: string;
  stages: UciStageHistoryStage[];
};

export type UciStageHistoryInput = {
  detail: UciRecordDetailResponse;
  providerName?: string | null;
  documents?: UciDocumentRegistryEntry[] | null;
  communications?: CoordinationCommunication[] | null;
};

const LIST_LIMIT = 8;

export function parseStageQuery(value: string | null | undefined): number | null {
  return normalizeLifecycleStage(value);
}

export function stageHistoryName(stage: number): string {
  return UCI_STAGE_HISTORY_CATALOG.find((entry) => entry.stage === stage)?.name ?? `Stage ${stage}`;
}

export function buildUciStageHistory(input: UciStageHistoryInput): UciStageHistoryModel {
  const record = input.detail.record;
  const savedStage = normalizeLifecycleStage(record.current_stage);
  const savedState = String(record.current_stage_state || "");
  const transitions = (input.detail.transitions ?? []).filter((row) => sameRecord(row, record.id));
  const applications = (input.detail.applications ?? []).filter((row) => sameRecord(row, record.id));
  const costs = (input.detail.costs ?? []).filter((row) => sameRecord(row, record.id));
  const equipment = (input.detail.equipment ?? []).filter((row) => sameRecord(row, record.id));
  const milestones = (input.detail.milestones ?? []).filter((row) => sameRecord(row, record.id));
  const communications = (input.communications ?? input.detail.communications_recent ?? []).filter((row) =>
    sameRecord(row, record.id),
  );
  const documents = (input.documents ?? []).filter((row) => row.coordination_record_id === record.id);
  const cosRecords = (input.detail.cos_design_records ?? []).filter((row) => sameRecord(row, record.id));

  return {
    savedStage,
    savedStateLabel: formatUciLifecycleStateLabel(savedState),
    stages: UCI_STAGE_HISTORY_CATALOG.map((entry) =>
      buildStage({
        stage: entry.stage,
        name: entry.name,
        record,
        providerName: cleanText(input.providerName),
        savedStage,
        savedState,
        transitions,
        applications,
        costs,
        equipment,
        milestones,
        communications,
        documents,
        cosRecords,
      }),
    ),
  };
}

function buildStage(args: {
  stage: number;
  name: string;
  record: CoordinationRecord;
  providerName: string | null;
  savedStage: number | null;
  savedState: string;
  transitions: CoordinationTransition[];
  applications: CoordinationApplication[];
  costs: CoordinationCost[];
  equipment: CoordinationEquipment[];
  milestones: CoordinationMilestone[];
  communications: CoordinationCommunication[];
  documents: UciDocumentRegistryEntry[];
  cosRecords: CoordinationCosDesignRecord[];
}): UciStageHistoryStage {
  const position = stagePosition(args.stage, args.savedStage, args.savedState);
  const entered = earliest(
    args.transitions.filter((row) => Number(row.to_stage) === args.stage),
  );
  const forward = args.transitions
    .filter((row) => Number(row.from_stage) === args.stage && Number(row.to_stage) > args.stage)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .at(-1) ?? null;
  const completedInPlace = args.transitions
    .filter(
      (row) =>
        Number(row.from_stage) === args.stage &&
        Number(row.to_stage) === args.stage &&
        String(row.to_state).toUpperCase() === "COMPLETED",
    )
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .at(-1) ?? null;
  const advanced = forward ?? completedInPlace;
  const related = args.transitions
    .filter((row) => Number(row.from_stage) === args.stage || Number(row.to_stage) === args.stage)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const work = workForStage(args).map(markTestText);
  const documents = documentsForStage(
    args.stage,
    args.documents,
    args.applications,
    Boolean(args.record.application_submitted_at),
  );
  const communications = communicationsForStage(args.stage, args.communications);
  const milestones = args.milestones
    .filter((row) => Number(row.parent_stage) === args.stage)
    .map(presentMilestone);
  const completionEvidence = work;

  return {
    stage: args.stage,
    name: args.name,
    position,
    statusLabel: statusLabel(position, args.savedState, args.stage, args.savedStage),
    startedAt: entered?.created_at ?? null,
    advancedAt: advanced?.created_at ?? null,
    workSummary: work.length
      ? work.slice(0, 2).join(" ")
      : "No recorded work is available for this stage.",
    responsibleParty: responsibleParty(args.stage, args.record, args.providerName),
    workPerformed: work,
    documents: documents.slice(0, 12),
    hiddenDocumentCount: Math.max(0, documents.length - 12),
    communications: communications.slice(0, LIST_LIMIT),
    hiddenCommunicationCount: Math.max(0, communications.length - LIST_LIMIT),
    milestones,
    completionEvidence,
    completionMessage: completionMessage(position, completionEvidence),
    previousStageName: args.stage > 1 ? stageHistoryName(args.stage - 1) : null,
    nextStageName: args.stage < 10 ? stageHistoryName(args.stage + 1) : null,
    transitionDate: advanced?.created_at ?? null,
    transitionReason: cleanText(advanced?.reason) ?? "Not recorded.",
    transitionTrigger: triggerLabel(advanced?.triggered_by_type ?? null),
    transitionTestRecord: isTestRecordText(advanced?.reason),
    relatedTransitions: related.slice(0, 6).map((row) => ({
      id: row.id,
      summary: `${shortDate(row.created_at)} · Stage ${row.from_stage ?? "—"} to ${row.to_stage} · ${cleanText(row.reason) ?? "Reason not recorded"}`,
      testRecord: isTestRecordText(row.reason),
    })),
    hiddenTransitionCount: Math.max(0, related.length - 6),
  };
}

function stagePosition(
  stage: number,
  savedStage: number | null,
  savedState: string,
): UciStagePosition {
  if (savedStage == null) return "not_reached";
  if (stage < savedStage) return "completed";
  if (stage === savedStage) {
    return String(savedState).toUpperCase() === "COMPLETED" ? "completed" : "current";
  }
  return "not_reached";
}

function statusLabel(
  position: UciStagePosition,
  savedState: string,
  stage: number,
  savedStage: number | null,
): string {
  if (position === "not_reached") return "Not reached";
  if (position === "completed") return "Completed";
  if (stage === savedStage) return formatUciLifecycleStateLabel(savedState);
  return "In progress";
}

function completionMessage(position: UciStagePosition, evidence: string[]): string {
  if (position === "not_reached") return "This stage has not been reached.";
  if (position === "current") {
    return evidence.length
      ? "This stage is still open. The records below are what has been saved so far."
      : "This stage is still open. Supporting details are not available yet.";
  }
  return evidence.length ? evidence.join(" ") : COMPLETION_WITHOUT_DETAIL;
}

function responsibleParty(
  stage: number,
  record: CoordinationRecord,
  providerName: string | null,
): string {
  if (stage === 1 && providerName) return providerName;
  const contact = cleanText(record.utility_contact_name) || cleanText(record.utility_project_manager);
  if (contact) return contact;
  if (providerName) return providerName;
  return "Not recorded";
}

function workForStage(args: Parameters<typeof buildStage>[0]): string[] {
  switch (args.stage) {
    case 1:
      return stage1Work(args.record, args.providerName);
    case 2:
      return stage2Work(args.applications);
    case 3:
      return stage3Work(args.applications);
    case 4:
      return stage4Work(args.record, args.applications);
    case 5:
      return stage5Work(args.record, args.communications);
    case 6:
      return stage6Work(args.record, args.cosRecords);
    case 7:
      return stage7Work(args.costs);
    case 8:
      return stage8Work(args.equipment);
    case 9:
      return stage9Work(args.record, args.milestones);
    case 10:
      return stage10Work(args.record, args.documents);
    default:
      return [];
  }
}

function stage1Work(record: CoordinationRecord, providerName: string | null): string[] {
  const lines: string[] = [];
  if (providerName) lines.push(`${labelUtility(record.utility_type)} provider assigned: ${providerName}.`);
  else if (record.utility_provider_id) lines.push("A provider is assigned to this record.");

  const mapping = getProviderMappingFromMetadata(record.metadata);
  if (mapping?.confirmed_at) {
    lines.push(`Provider mapping was confirmed on ${shortDate(mapping.confirmed_at)}.`);
  }

  const resolution = readResolution(record.metadata, record.utility_type);
  if (resolution) {
    const status = typeof resolution.status === "string" ? formatResolutionStatusLabel(resolution.status) : null;
    const method =
      typeof resolution.resolution_method === "string"
        ? formatResolutionMethodLabel(resolution.resolution_method)
        : null;
    const confidence =
      typeof resolution.confidence === "string" ? formatConfidenceLabel(resolution.confidence) : null;
    const bits = [status, method, confidence ? `${confidence} confidence` : null].filter(Boolean);
    if (bits.length) lines.push(`Territory evidence: ${bits.join(" · ")}.`);
    const source = asRecord(resolution.source);
    const sourceName = cleanText(source?.name);
    const vintage = cleanText(source?.dataset_vintage);
    if (sourceName) {
      lines.push(`Territory source: ${sourceName}${vintage ? ` (${vintage})` : ""}.`);
    }
    if (typeof resolution.boundary_distance_miles === "number") {
      lines.push(`Recorded distance from the territory boundary: ${resolution.boundary_distance_miles} miles.`);
    }
  }
  return lines;
}

function stage2Work(applications: CoordinationApplication[]): string[] {
  const draft = getLoadProfileDraftApplication(applications);
  const summary = parseLoadProfileSummary(draft?.load_summary);
  if (!summary) return draft ? ["A load profile draft is saved."] : [];
  const lines: string[] = [];
  const verified = summary.verified_values ?? {};
  for (const [key, entry] of Object.entries(verified)) {
    const value = formatScalar(entry?.value);
    if (!value) continue;
    const unit = cleanText(entry.unit);
    const source = cleanText(entry.source_document_name);
    lines.push(
      `${humanize(key)}: ${value}${unit ? ` ${unit}` : ""}${source ? `, from ${source}` : ""}.`,
    );
  }
  if (summary.analysis_status) {
    lines.push(`Load profile status recorded as ${humanize(summary.analysis_status)}.`);
  }
  if (!lines.length && draft) lines.push("A load profile draft is saved without verified values.");
  return lines;
}

function stage3Work(applications: CoordinationApplication[]): string[] {
  const draft = getApplicationPackageDraftApplication(applications);
  const metadata = parseApplicationPackageMetadata(draft);
  if (!draft && !metadata) return [];
  const lines: string[] = [];
  if (metadata?.checklist_mode === "synthetic_test") {
    lines.push(
      metadata.checklist_label
        ? `Saved checklist: ${metadata.checklist_label}. This is a synthetic test checklist.`
        : "Saved checklist is a synthetic test checklist.",
    );
  }
  if (metadata?.package_status) lines.push(`Package status: ${humanize(metadata.package_status)}.`);
  const fields = metadata?.field_results ?? [];
  const present = fields.filter((field) => field.status === "present" && formatScalar(field.value));
  if (fields.length) {
    lines.push(`${present.length} of ${fields.length} saved application fields have a value.`);
  }
  for (const field of present.slice(0, 6)) {
    lines.push(`${field.label}: ${formatScalar(field.value)}.`);
  }
  const docs = parsePackageDocuments(draft?.package_documents);
  const attached = docs.filter((doc) => doc.status === "attached" && cleanText(doc.file_name));
  if (docs.length) lines.push(`${attached.length} of ${docs.length} package document slots are attached.`);
  if (metadata?.requires_human_review) lines.push("Human review is still required before the package can be treated as ready.");
  if (draft?.reviewed_at) lines.push(`Package review recorded on ${shortDate(draft.reviewed_at)}.`);
  return lines;
}

function stage4Work(record: CoordinationRecord, applications: CoordinationApplication[]): string[] {
  const lines: string[] = [];
  if (record.application_submitted_at) {
    lines.push(`Submission date recorded: ${shortDate(record.application_submitted_at)}.`);
  }
  for (const application of applications) {
    const when = application.submitted_at || application.portal_submitted_at;
    if (!when) continue;
    const channel = cleanText(application.submission_method) || cleanText(application.record_source);
    const reference = cleanText(application.utility_ticket_number) || cleanText(application.external_application_id);
    const portal = cleanText(application.portal_status);
    const bits = [
      when ? `submitted ${shortDate(when)}` : null,
      channel ? `by ${humanize(channel)}` : null,
      reference ? `reference ${reference}` : null,
      portal ? `portal status ${portal}` : null,
    ].filter(Boolean);
    if (bits.length) lines.push(`Application ${bits.join(", ")}.`);
  }
  return unique(lines);
}

function stage5Work(record: CoordinationRecord, communications: CoordinationCommunication[]): string[] {
  const lines: string[] = [];
  if (record.acknowledgment_received_at) {
    lines.push(`Acknowledgment date recorded: ${shortDate(record.acknowledgment_received_at)}.`);
  }
  const related = communications.filter((row) => communicationStage(row) === 5);
  if (related.length) {
    lines.push(`${related.length} acknowledgment communication${related.length === 1 ? "" : "s"} saved on this record.`);
  }
  return lines;
}

function stage6Work(record: CoordinationRecord, cosRecords: CoordinationCosDesignRecord[]): string[] {
  const lines: string[] = [];
  if (record.class_of_service_issued_at) {
    lines.push(`Class of service date recorded: ${shortDate(record.class_of_service_issued_at)}.`);
  }
  for (const row of cosRecords.slice(0, LIST_LIMIT)) {
    const bits = [
      `Version ${row.version}`,
      row.evidence_status ? humanize(row.evidence_status) : null,
      row.review_status ? humanize(row.review_status) : null,
      row.approved_at ? `approved ${shortDate(row.approved_at)}` : null,
    ].filter(Boolean);
    lines.push(`Design review record: ${bits.join(" · ")}.`);
  }
  if (cosRecords.length > LIST_LIMIT) {
    lines.push(`${cosRecords.length - LIST_LIMIT} more design review versions are saved.`);
  }
  return lines;
}

function stage7Work(costs: CoordinationCost[]): string[] {
  return costs.map((cost) => {
    const type = humanize(cost.cost_type || "cost");
    const actual = formatMoney(cost.actual_amount);
    const estimated = formatMoney(cost.estimated_amount);
    const approval = cleanText(cost.client_approval_status);
    const bits = [
      actual ? `actual ${actual}` : null,
      estimated ? `estimated ${estimated}` : null,
      approval ? `approval ${humanize(approval)}` : null,
      cost.paid_at ? `paid ${shortDate(cost.paid_at)}` : null,
      cost.qb_sync_status ? `accounting sync ${humanize(cost.qb_sync_status)}` : null,
    ].filter(Boolean);
    return `${type}${bits.length ? `: ${bits.join(", ")}` : " recorded"}.`;
  });
}

function stage8Work(equipment: CoordinationEquipment[]): string[] {
  return equipment.map((item) => {
    const name = [cleanText(item.equipment_type), cleanText(item.equipment_size)].filter(Boolean).join(" ");
    const bits = [
      cleanText(item.status) ? humanize(String(item.status)) : null,
      item.current_eta ? `current delivery ${shortDate(item.current_eta)}` : null,
      item.initial_eta ? `initial delivery ${shortDate(item.initial_eta)}` : null,
    ].filter(Boolean);
    return `${name || "Equipment"}${bits.length ? `: ${bits.join(", ")}` : ""}.`;
  });
}

function stage9Work(record: CoordinationRecord, milestones: CoordinationMilestone[]): string[] {
  const lines: string[] = [];
  if (record.inspection_release_received_at) {
    lines.push(`Inspection release recorded: ${shortDate(record.inspection_release_received_at)}.`);
  }
  if (record.meter_set_scheduled_at) {
    lines.push(`Meter set scheduled: ${shortDate(record.meter_set_scheduled_at)}.`);
  }
  if (record.site_readiness_confirmed_at) {
    lines.push(`Site readiness confirmed: ${shortDate(record.site_readiness_confirmed_at)}.`);
  }
  const stageMilestones = milestones.filter((row) => Number(row.parent_stage) === 9);
  if (stageMilestones.length) {
    lines.push(`${stageMilestones.length} pre-energization milestone${stageMilestones.length === 1 ? "" : "s"} recorded.`);
  }
  return lines;
}

function stage10Work(record: CoordinationRecord, documents: UciDocumentRegistryEntry[]): string[] {
  const lines: string[] = [];
  if (record.energization_actual_date) {
    lines.push(`Energization date recorded: ${shortDate(record.energization_actual_date)}.`);
  }
  if (record.energization_target_date) {
    lines.push(`Energization target recorded: ${shortDate(record.energization_target_date)}.`);
  }
  const closeout = documents.some(
    (doc) =>
      (doc.stage_consumers ?? []).includes(10) ||
      doc.effective_role === "closeout" ||
      doc.effective_role === "uci_closeout_package",
  );
  if (record.closeout_package_doc_id || closeout) lines.push("A closeout package document is recorded.");
  return lines;
}

function documentsForStage(
  stage: number,
  documents: UciDocumentRegistryEntry[],
  applications: CoordinationApplication[],
  submissionRecorded: boolean,
): UciStageHistoryDocument[] {
  const fromRegistry = documents
    .filter(
      (doc) =>
        (doc.stage_consumers ?? []).includes(stage) ||
        (stage === 10 && (doc.effective_role === "closeout" || doc.effective_role === "uci_closeout_package")),
    )
    .map(presentRegistryDocument);
  const packageDocs =
    stage === 3 || stage === 4
      ? parsePackageDocuments(getApplicationPackageDraftApplication(applications)?.package_documents)
          .filter((doc) => doc.status === "attached")
          .filter(
            () =>
              stage === 3 ||
              submissionRecorded ||
              applications.some((app) => app.submitted_at || app.portal_submitted_at),
          )
          .map(presentPackageDocument)
      : [];
  const seen = new Set<string>();
  const merged: UciStageHistoryDocument[] = [];
  for (const doc of [...fromRegistry, ...packageDocs]) {
    const key = doc.name.toLowerCase();
    if (!doc.name || seen.has(key)) continue;
    seen.add(key);
    merged.push(doc);
  }
  return merged;
}

function presentRegistryDocument(entry: UciDocumentRegistryEntry): UciStageHistoryDocument {
  const file = entry.project_document;
  const name = cleanText(file?.file_name) || "Untitled document";
  return {
    name,
    typeLabel: humanize(entry.effective_role || file?.document_type || "document"),
    date: file?.created_at ?? entry.classified_at ?? null,
    sourceLabel: provenanceLabel(entry.provenance),
    reviewLabel: reviewLabel(entry.classification_review, entry.signature_status),
    downloadPath: file?.file_path?.trim() || null,
    testRecord: /synthetic|\[test\]/i.test(name),
  };
}

function presentPackageDocument(doc: ReturnType<typeof parsePackageDocuments>[number]): UciStageHistoryDocument {
  const name = cleanText(doc.file_name) || cleanText(doc.label) || "Package document";
  return {
    name,
    typeLabel: humanize(doc.document_type || doc.key || "package document"),
    date: doc.confirmed_at ?? null,
    sourceLabel: "Application package",
    reviewLabel:
      doc.signature_status === "signed_manual_verified"
        ? "Signature manually verified"
        : doc.user_confirmed
          ? "Confirmed"
          : "Attached",
    downloadPath: looksLikeStoragePath(doc.storage_path) ? doc.storage_path ?? null : null,
    testRecord: /synthetic|\[test\]/i.test(name),
  };
}

function communicationsForStage(
  stage: number,
  communications: CoordinationCommunication[],
): UciStageHistoryCommunication[] {
  return communications
    .filter((row) => communicationStage(row) === stage)
    .sort((a, b) => communicationTime(b).localeCompare(communicationTime(a)))
    .map((row) => ({
      id: row.id,
      date: row.message_timestamp || row.created_at || null,
      direction: formatDirectionLabel(row.direction) || "Direction not recorded",
      summary:
        formatCommunicationSubjectForDisplay(row.raw_subject) ||
        conciseCommunicationSummary(row) ||
        "Communication saved without a subject",
      contact: cleanText(row.sender) || cleanText(row.recipient) || "Contact not recorded",
      actionItems: actionItems(row),
      attachments: listCommunicationAttachmentLabels(row).filter((label) => !looksLikeStoragePath(label)),
      testRecord: isSyntheticUatCommunication(row),
    }));
}

function communicationStage(comm: CoordinationCommunication): number | null {
  const explicit = explicitMetadataStage(comm.agent_processed_metadata);
  if (explicit) return explicit;
  const meta = asRecord(comm.agent_processed_metadata) ?? {};
  if (meta.source === "stage4_live_transmit" || meta.stage5_handoff === true) {
    return meta.stage5_handoff === true ? 5 : 4;
  }
  if (asRecord(meta.stage_6_cos)) return 6;
  const classification = String(comm.classification || "").trim();
  return CLASSIFICATION_STAGE[classification] ?? null;
}

function presentMilestone(row: CoordinationMilestone): UciStageHistoryMilestone {
  return {
    id: row.id,
    label: humanize(row.milestone_type || row.portal_milestone || "Milestone"),
    status: humanize(row.status || "recorded"),
    targetDate: row.target_date,
    actualDate: row.actual_date || row.occurred_at || null,
    note: cleanText(row.notes),
  };
}

function explicitMetadataStage(metadata: unknown): number | null {
  const meta = asRecord(metadata);
  if (!meta) return null;
  return normalizeLifecycleStage(meta.stage ?? meta.parent_stage);
}

function readResolution(
  metadata: Record<string, unknown> | null | undefined,
  utilityType: string | null,
): Record<string, unknown> | null {
  const raw = asRecord(metadata)?.uci_provider_resolution;
  const resolution = asRecord(raw);
  if (!resolution) return null;
  if (typeof resolution.status === "string") return resolution;
  const byType = asRecord(resolution.by_service_type);
  const service = utilityType ? asRecord(byType?.[utilityType]) : null;
  return service;
}

function sameRecord(row: { coordination_record_id?: string | null }, recordId: string): boolean {
  return String(row.coordination_record_id || "") === recordId;
}

function earliest(rows: CoordinationTransition[]): CoordinationTransition | null {
  return rows.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0] ?? null;
}

function triggerLabel(value: string | null): string {
  const text = String(value || "").trim().toLowerCase();
  if (!text || /^[0-9a-f-]{36}$/i.test(text)) return "Not recorded";
  if (text === "human" || text === "user" || text === "operator") return "Person";
  if (text === "system" || text === "agent") return "Recorded automatically";
  return humanize(text);
}

function provenanceLabel(value: string | null | undefined): string {
  const map: Record<string, string> = {
    manual_upload: "Uploaded",
    portal_harvest: "Utility portal",
    email_inbound: "Email",
    uci_generated: "Generated in PermitPilot",
    loa_signed: "Authorization",
    stage_upload: "Added during coordination",
    load_profile: "Load profile",
    application_builder: "Application package",
    reclassified: "Reclassified",
    unknown: "Source not recorded",
  };
  return map[String(value || "unknown")] ?? "Source not recorded";
}

function reviewLabel(review: string | null | undefined, signature: string | null | undefined): string {
  if (signature === "signed_manual_verified") return "Signature manually verified";
  if (review === "auto_accepted") return "Classification accepted";
  if (review === "review_recommended") return "Review recommended";
  if (review === "needs_classification") return "Needs classification";
  return "Review state not recorded";
}

function actionItems(comm: CoordinationCommunication): string[] {
  if (!Array.isArray(comm.parsed_action_items)) return [];
  return comm.parsed_action_items
    .map((item) => {
      if (typeof item === "string") return cleanText(item);
      const row = asRecord(item);
      return cleanText(row?.detail) || cleanText(row?.reason) || cleanText(row?.type);
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
}

function communicationTime(comm: CoordinationCommunication): string {
  return String(comm.message_timestamp || comm.created_at || "");
}

function labelUtility(value: string | null | undefined): string {
  const text = cleanText(value);
  if (!text) return "Utility";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function formatMoney(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatScalar(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return cleanText(value);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || /^[0-9a-f-]{36}$/i.test(text) || looksLikeStoragePath(text)) return null;
  return text.length > 240 ? `${text.slice(0, 239).trimEnd()}…` : text;
}

function looksLikeStoragePath(value: string | null | undefined): boolean {
  const text = String(value || "");
  return text.includes("/") || text.startsWith("sb://");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isTestRecordText(value: unknown): boolean {
  return /synthetic|\bUAT\b|\[test\]/i.test(String(value || ""));
}

function markTestText(line: string): string {
  if (!isTestRecordText(line) || line.startsWith("Controlled test record")) return line;
  return `Controlled test record — ${line}`;
}

function shortDate(value: string | null | undefined): string {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : text;
}

function unique(lines: string[]): string[] {
  return [...new Set(lines)];
}
