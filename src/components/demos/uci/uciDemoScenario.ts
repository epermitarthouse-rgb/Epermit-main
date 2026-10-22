import type { UciDocumentRegistryEntry } from "@/lib/uciDocumentRegistry";
import type {
  CoordinationApplication,
  CoordinationCommunication,
  CoordinationCosDesignRecord,
  CoordinationCost,
  CoordinationEquipment,
  CoordinationMilestone,
  CoordinationRecord,
  CoordinationTransition,
  LifecycleState,
  UciRecordDetailResponse,
} from "@/types/uci";

/**
 * Simulated Highland Springs electric service coordination.
 * Every value is fictional; nothing here is loaded from or written to a live system.
 */
export const UCI_DEMO_LABEL = "Simulated demo — fictional data, no utility, portal, email, or payment activity";

export const UCI_DEMO_PROJECT = {
  name: "Highland Springs Quick-Service Restaurant",
  address: "301 S Airport Dr, Highland Springs, VA",
  scope: "New 1000 A, 120/208 V three-phase electric service",
  utilityType: "electric" as const,
};

export const UCI_DEMO_PROVIDER = "Springhill Electric Cooperative (fictional)";

const PROJECT_ID = "demo-project-highland-springs";
const RECORD_ID = "demo-record-highland-springs-electric";

const linked = { coordination_record_id: RECORD_ID, project_id: PROJECT_ID };

type TransitionSeed = [
  from: number | null,
  to: number,
  fromState: LifecycleState | null,
  toState: LifecycleState,
  reason: string,
  at: string,
  actor?: "user" | "agent",
];

const TRANSITION_SEEDS: TransitionSeed[] = [
  [null, 1, null, "IN_PROGRESS", "Coordination record opened for the new electric service", "2026-01-05T14:00:00.000Z", "agent"],
  [1, 1, "IN_PROGRESS", "COMPLETED", "Service territory match reviewed and provider confirmed by the coordinator", "2026-01-05T15:00:00.000Z"],
  [1, 2, "COMPLETED", "IN_PROGRESS", "Provider confirmed; begin service load review", "2026-01-05T15:05:00.000Z", "agent"],
  [2, 2, "IN_PROGRESS", "COMPLETED", "410 kVA connected and 315 kVA demand load verified against the load letter and one-line", "2026-01-08T17:00:00.000Z"],
  [2, 3, "COMPLETED", "IN_PROGRESS", "Verified load values released to application preparation", "2026-01-08T17:05:00.000Z", "agent"],
  [3, 3, "IN_PROGRESS", "COMPLETED", "Application fields and required attachments reviewed", "2026-01-10T18:00:00.000Z"],
  [3, 4, "COMPLETED", "IN_PROGRESS", "Package approved for submission", "2026-01-10T18:05:00.000Z"],
  [4, 4, "IN_PROGRESS", "COMPLETED", "Simulated submission recorded with reference SEC-2026-0001", "2026-01-12T15:00:00.000Z"],
  [4, 5, "COMPLETED", "AWAITING_UTILITY", "Awaiting utility acknowledgment", "2026-01-12T15:05:00.000Z", "agent"],
  [5, 5, "AWAITING_UTILITY", "COMPLETED", "Acknowledgment SEC-ACK-0113 matched to the submission", "2026-01-13T14:00:00.000Z", "agent"],
  [5, 6, "COMPLETED", "IN_PROGRESS", "Acknowledgment reviewed; begin Class of Service review", "2026-01-13T14:05:00.000Z", "agent"],
  [6, 6, "IN_PROGRESS", "COMPLETED", "800 A vs 1000 A discrepancy resolved; revised Class of Service accepted", "2026-01-24T16:00:00.000Z"],
  [6, 7, "COMPLETED", "IN_PROGRESS", "Design accepted; begin CIAC cost coordination", "2026-01-24T16:05:00.000Z", "agent"],
  [7, 7, "IN_PROGRESS", "COMPLETED", "CIAC reconciled at $12,000 with client approval, payment, and billing recorded", "2026-01-27T17:00:00.000Z"],
  [7, 8, "COMPLETED", "IN_PROGRESS", "Costs resolved; begin long-lead equipment tracking", "2026-01-27T17:05:00.000Z", "agent"],
  [8, 8, "IN_PROGRESS", "COMPLETED", "500 kVA pad-mounted transformer delivered after one ETA slip", "2026-04-15T18:00:00.000Z"],
  [8, 9, "COMPLETED", "IN_PROGRESS", "Equipment on site; begin pre-energization readiness", "2026-04-15T18:05:00.000Z", "agent"],
  [9, 9, "IN_PROGRESS", "COMPLETED", "Inspection release, site readiness, and meter set confirmed", "2026-04-20T17:00:00.000Z"],
  [9, 10, "COMPLETED", "IN_PROGRESS", "Pre-energization prerequisites complete; begin closeout", "2026-04-20T17:05:00.000Z", "agent"],
  [10, 10, "IN_PROGRESS", "COMPLETED", "Energization, meter reading, commissioning, and closeout package reviewed", "2026-04-22T18:00:00.000Z"],
];

export const UCI_DEMO_TRANSITIONS: CoordinationTransition[] = TRANSITION_SEEDS.map(
  ([from, to, fromState, toState, reason, at, actor], index) => ({
    id: `demo-transition-${index + 1}`,
    ...linked,
    from_stage: from,
    to_stage: to,
    from_state: fromState,
    to_state: toState,
    triggered_by_type: actor ?? "user",
    triggered_by_id: actor === "agent" ? "uci-agent" : "demo-coordinator",
    reason,
    metadata: {
      simulated: true,
      ...(from === to && toState === "COMPLETED" ? { [`stage_${to}_completed`]: true } : {}),
    },
    created_at: at,
  }),
);

export const UCI_DEMO_STEP_COUNT = UCI_DEMO_TRANSITIONS.length;

const DATES = {
  providerConfirmed: "2026-01-05T15:00:00.000Z",
  loadDraft: "2026-01-07T16:00:00.000Z",
  loadVerified: "2026-01-08T17:00:00.000Z",
  packageDraft: "2026-01-09T12:00:00.000Z",
  packageReviewed: "2026-01-10T18:00:00.000Z",
  submitted: "2026-01-12T15:00:00.000Z",
  acknowledged: "2026-01-13T14:00:00.000Z",
  cosV1: "2026-01-20T15:00:00.000Z",
  cosV2: "2026-01-24T16:00:00.000Z",
  ciacEstimated: "2026-01-24T16:30:00.000Z",
  ciacActual: "2026-01-25T12:00:00.000Z",
  clientApproved: "2026-01-26T17:00:00.000Z",
  paid: "2026-01-27T16:00:00.000Z",
  billed: "2026-01-27T16:30:00.000Z",
  equipmentOrdered: "2026-01-28T15:00:00.000Z",
  etaSlip: "2026-03-30T15:00:00.000Z",
  delivered: "2026-04-15T18:00:00.000Z",
  inspection: "2026-04-20T13:00:00.000Z",
  siteReady: "2026-04-20T16:00:00.000Z",
  meterScheduled: "2026-04-20T16:30:00.000Z",
  energized: "2026-04-22T15:00:00.000Z",
  closeout: "2026-04-22T18:00:00.000Z",
};

export type UciDemoSnapshot = {
  step: number;
  cutoff: string;
  detail: UciRecordDetailResponse;
  documents: UciDocumentRegistryEntry[];
  communications: CoordinationCommunication[];
  facts: UciDemoFacts;
};

/** Plain-language state for the representative stage workspaces. */
export type UciDemoFacts = {
  providerConfirmed: boolean;
  loadVerified: boolean;
  packageReviewed: boolean;
  submitted: boolean;
  acknowledged: boolean;
  cosDiscrepancyFound: boolean;
  cosApproved: boolean;
  ciacEstimated: boolean;
  ciacActual: boolean;
  ciacApproved: boolean;
  ciacPaid: boolean;
  ciacBilled: boolean;
  equipmentOrdered: boolean;
  etaSlipped: boolean;
  equipmentDelivered: boolean;
  inspectionReleased: boolean;
  siteReady: boolean;
  meterScheduled: boolean;
  energized: boolean;
  closeoutComplete: boolean;
};

export function clampUciDemoStep(step: number): number {
  if (!Number.isFinite(step)) return UCI_DEMO_STEP_COUNT - 1;
  return Math.max(0, Math.min(UCI_DEMO_STEP_COUNT - 1, Math.trunc(step)));
}

/** Index of the last transition reached when a stage is entered. */
export function uciDemoStepForStage(stage: number): number {
  const completed = UCI_DEMO_TRANSITIONS.findIndex(
    (row) => row.to_stage === stage && row.from_stage === stage && row.to_state === "COMPLETED",
  );
  return completed >= 0 ? completed : UCI_DEMO_STEP_COUNT - 1;
}

export function buildUciDemoSnapshot(rawStep: number): UciDemoSnapshot {
  const step = clampUciDemoStep(rawStep);
  const transitions = UCI_DEMO_TRANSITIONS.slice(0, step + 1);
  const latest = transitions[transitions.length - 1];
  const cutoff = latest.created_at;
  const reached = (value: string) => value <= cutoff;
  const at = (value: string) => (reached(value) ? value : null);

  const facts: UciDemoFacts = {
    providerConfirmed: reached(DATES.providerConfirmed),
    loadVerified: reached(DATES.loadVerified),
    packageReviewed: reached(DATES.packageReviewed),
    submitted: reached(DATES.submitted),
    acknowledged: reached(DATES.acknowledged),
    cosDiscrepancyFound: reached(DATES.cosV1),
    cosApproved: reached(DATES.cosV2),
    ciacEstimated: reached(DATES.ciacEstimated),
    ciacActual: reached(DATES.ciacActual),
    ciacApproved: reached(DATES.clientApproved),
    ciacPaid: reached(DATES.paid),
    ciacBilled: reached(DATES.billed),
    equipmentOrdered: reached(DATES.equipmentOrdered),
    etaSlipped: reached(DATES.etaSlip),
    equipmentDelivered: reached(DATES.delivered),
    inspectionReleased: reached(DATES.inspection),
    siteReady: reached(DATES.siteReady),
    meterScheduled: reached(DATES.meterScheduled),
    energized: reached(DATES.energized),
    closeoutComplete: reached(DATES.closeout),
  };

  const record: CoordinationRecord = {
    id: RECORD_ID,
    project_id: PROJECT_ID,
    user_id: null,
    tenant_id: null,
    utility_provider_id: "demo-provider-springhill-electric",
    utility_type: UCI_DEMO_PROJECT.utilityType,
    scope_description: UCI_DEMO_PROJECT.scope,
    current_stage: latest.to_stage,
    current_stage_state: latest.to_state,
    utility_account_number: null,
    utility_contact_name: facts.acknowledged ? "Dana Whitfield (fictional utility PM)" : null,
    utility_contact_email: null,
    utility_contact_phone: null,
    application_submitted_at: at(DATES.submitted),
    acknowledgment_received_at: at(DATES.acknowledged),
    class_of_service_issued_at: at(DATES.cosV2),
    energization_target_date: facts.siteReady ? "2026-04-22" : null,
    energization_actual_date: facts.energized ? "2026-04-22" : null,
    predicted_p50_date: null,
    predicted_p90_date: null,
    inspection_release_received_at: at(DATES.inspection),
    meter_set_scheduled_at: at(DATES.meterScheduled),
    site_readiness_confirmed_at: at(DATES.siteReady),
    closeout_package_doc_id: facts.closeoutComplete ? "demo-doc-closeout" : null,
    agent_monitored: true,
    last_error: null,
    metadata: {
      demo_fixture: true,
      simulated: true,
      ...(facts.providerConfirmed
        ? {
            uci_provider_mapping: {
              confirmed_at: DATES.providerConfirmed,
              confirmed_by_user_id: "demo-coordinator",
              selected_provider_slugs: ["springhill-electric-demo"],
              address_source: "confirmed",
            },
            uci_provider_resolution: {
              status: "confirmed",
              resolution_method: "point_in_polygon",
              confidence: "high",
              confirmed_at: DATES.providerConfirmed,
              source: { name: "Fictional service territory layer", dataset_vintage: "DEMO-2026" },
            },
          }
        : {}),
      ...(facts.closeoutComplete
        ? {
            closeout_artifacts: {
              utility_confirmation: { reference: "SEC-ENERGIZED-0422", simulated: true },
              final_meter_reading: { reference: "Meter 88-1042 · 00012 kWh", simulated: true },
              commissioning_signoff: { reference: "COMM-0422", simulated: true },
            },
          }
        : {}),
    },
    created_at: UCI_DEMO_TRANSITIONS[0].created_at,
    updated_at: cutoff,
  };

  const applications: CoordinationApplication[] = [];
  if (reached(DATES.loadDraft)) {
    applications.push(
      application("demo-application-load", "agent_2_load_profile:demo", DATES.loadDraft, {
        draft_status: facts.loadVerified ? "reviewed" : "draft",
        load_summary: {
          version: "demo-v1",
          utility_type: "electric",
          analysis_status: facts.loadVerified ? "verified" : "preliminary",
          inputs_used: [],
          missing_inputs: [],
          needs_verification: facts.loadVerified ? [] : ["connected_load_kva", "demand_load_kva"],
          assumptions: { template_id: "demo", template_version: "1", notes: ["Simulated values"] },
          calculated_values: { service_size: "1000 A" },
          verified_values: facts.loadVerified
            ? {
                connected_load_kva: verifiedLoad("connected_load_kva", 410, "Connected load 410 kVA"),
                demand_load_kva: verifiedLoad("demand_load_kva", 315, "Demand load 315 kVA"),
              }
            : {},
          source_documents: [],
          generated_at: DATES.loadDraft,
          generated_by: "uci_demo",
          requires_human_review: !facts.loadVerified,
        },
      }),
    );
  }
  if (reached(DATES.packageDraft)) {
    applications.push(
      application("demo-application-package", "agent_3_application_package:demo", DATES.packageDraft, {
        draft_status: facts.submitted ? "submitted" : facts.packageReviewed ? "approved_for_submission" : "draft",
        reviewed_at: at(DATES.packageReviewed),
        reviewed_by: facts.packageReviewed ? "demo-coordinator" : null,
        submitted_at: at(DATES.submitted),
        submission_method: facts.submitted ? "simulated_demo_record" : null,
        utility_ticket_number: facts.submitted ? "SEC-2026-0001" : null,
        package_documents: [
          { key: "load_letter", label: "Load letter", status: "attached", file_name: "Highland Springs Load Letter.pdf", user_confirmed: true },
          { key: "one_line", label: "One-line diagram", status: "attached", file_name: "Highland Springs Electrical One-Line.pdf", user_confirmed: true },
          { key: "site_plan", label: "Site plan", status: "attached", file_name: "Highland Springs Site Plan.pdf", user_confirmed: true },
        ],
        agent_draft_metadata: {
          simulated: true,
          application_package: {
            package_status: facts.packageReviewed ? "ready_for_submission" : "ready_for_review",
            checklist_mode: "provider_checklist",
            requires_human_review: !facts.packageReviewed,
            field_results: [
              { key: "connected_load_kva", label: "Connected load", status: "present", value: "410 kVA", source: "load profile" },
              { key: "demand_load_kva", label: "Demand load", status: "present", value: "315 kVA", source: "load profile" },
              { key: "service_voltage", label: "Service voltage", status: "present", value: "120/208 V", source: "one-line" },
              { key: "service_amperage", label: "Service amperage", status: "present", value: "1000 A", source: "load profile" },
              { key: "meter_location", label: "Meter location", status: "present", value: "East wall, exterior", source: "site plan" },
            ],
          },
        },
      }),
    );
  }

  const cosRecords: CoordinationCosDesignRecord[] = [];
  if (facts.cosDiscrepancyFound) {
    cosRecords.push({
      id: "demo-cos-v1",
      ...linked,
      version: 1,
      is_current: !facts.cosApproved,
      evidence_status: "DISCREPANCY",
      review_status: facts.cosApproved ? "superseded" : "needs_review",
      needs_human_attention: !facts.cosApproved,
      utility_evidence_issued_at: DATES.cosV1,
      discrepancy_report: { headline: "Utility assigned 800 A; requested service is 1000 A" },
    });
  }
  if (facts.cosApproved) {
    cosRecords.push({
      id: "demo-cos-v2",
      ...linked,
      version: 2,
      is_current: true,
      evidence_status: "UTILITY_ISSUED",
      review_status: "approved",
      needs_human_attention: false,
      utility_evidence_issued_at: DATES.cosV2,
      approved_at: DATES.cosV2,
      approval_notes: "Revised 1000 A service accepted (simulated).",
    });
  }

  const costs: CoordinationCost[] = facts.ciacEstimated
    ? [
        {
          id: "demo-cost-ciac",
          ...linked,
          cost_type: "CIAC",
          estimated_amount: "12500.00",
          estimated_at: DATES.ciacEstimated,
          actual_amount: facts.ciacActual ? "12000.00" : null,
          actual_received_at: at(DATES.ciacActual),
          variance_pct: facts.ciacActual ? "-4.0" : null,
          invoice_received_doc_ref: facts.ciacActual ? "demo-doc-ciac" : null,
          paid_at: at(DATES.paid),
          payment_method: facts.ciacPaid ? "simulated_no_payment" : null,
          client_billed_at: at(DATES.billed),
          quickbooks_invoice_id: null,
          notes: "Simulated CIAC — no payment or accounting transaction occurred.",
          client_approval_status: facts.ciacApproved ? "approved" : "pending",
          client_approved_at: at(DATES.clientApproved),
          qb_sync_status: "not_ready",
          created_at: DATES.ciacEstimated,
          updated_at: cutoff,
        },
      ]
    : [];

  const equipment: CoordinationEquipment[] = facts.equipmentOrdered
    ? [
        {
          id: "demo-equipment-transformer",
          ...linked,
          equipment_type: "Pad-mounted transformer",
          equipment_size: "500 kVA",
          initial_eta: "2026-04-10",
          current_eta: facts.etaSlipped ? "2026-04-15" : "2026-04-10",
          eta_history: [],
          status: facts.equipmentDelivered ? "delivered" : facts.etaSlipped ? "shipped" : "on_order",
          last_check_in_at: facts.equipmentDelivered ? DATES.delivered : facts.etaSlipped ? DATES.etaSlip : DATES.equipmentOrdered,
          next_check_in_at: null,
          weeks_of_slip: facts.etaSlipped ? "0.7" : "0",
          check_in_method: "demo",
          created_at: DATES.equipmentOrdered,
          updated_at: cutoff,
        },
      ]
    : [];

  const milestones: CoordinationMilestone[] = [];
  if (reached(UCI_DEMO_TRANSITIONS[16].created_at)) {
    milestones.push(
      milestone("demo-milestone-inspection", "inspection_release", 9, "2026-04-20", facts.inspectionReleased),
      milestone("demo-milestone-meter", "meter_set", 9, "2026-04-22", facts.energized, facts.meterScheduled),
    );
  }
  if (reached(UCI_DEMO_TRANSITIONS[18].created_at)) {
    milestones.push(milestone("demo-milestone-commissioning", "commissioning", 10, "2026-04-22", facts.closeoutComplete));
  }

  return {
    step,
    cutoff,
    facts,
    detail: {
      record,
      transitions,
      applications,
      costs,
      equipment,
      milestones,
      communications_recent: [],
      cos_design_records: cosRecords,
    },
    documents: DEMO_DOCUMENTS.filter((doc) => reached(doc.project_document?.created_at ?? "")),
    communications: DEMO_COMMUNICATIONS.filter((comm) => reached(comm.message_timestamp ?? "")),
  };
}

function application(
  id: string,
  idempotencyKey: string,
  createdAt: string,
  overrides: Partial<CoordinationApplication>,
): CoordinationApplication {
  return {
    id,
    ...linked,
    application_type: "new_service",
    package_documents: [],
    load_summary: null,
    submission_method: null,
    utility_ticket_number: null,
    submitted_at: null,
    submitted_by: null,
    reviewed_by: null,
    reviewed_at: null,
    draft_status: "draft",
    agent_draft_metadata: { simulated: true },
    idempotency_key: idempotencyKey,
    last_error: null,
    record_source: "agent_draft",
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

function verifiedLoad(fieldKey: string, value: number, evidence: string) {
  return {
    field_key: fieldKey,
    value,
    unit: "kVA",
    method: "user_entered_and_verified",
    approved_by: "demo-engineer",
    approved_at: DATES.loadVerified,
    source_document_name: "Highland Springs Load Letter.pdf",
    page_number: 1,
    evidence_text: evidence,
    extraction_method: "pdf_text",
    edited: false,
  };
}

function milestone(
  id: string,
  type: string,
  parentStage: number,
  date: string,
  completed: boolean,
  scheduled = true,
): CoordinationMilestone {
  return {
    id,
    ...linked,
    milestone_type: type,
    parent_stage: parentStage,
    target_date: date,
    actual_date: completed ? date : null,
    status: completed ? "completed" : scheduled ? "scheduled" : "pending",
    notes: "Simulated milestone",
    source: "demo",
    created_at: date,
    updated_at: date,
  };
}

function registryDocument(
  id: string,
  fileName: string,
  role: string,
  stages: number[],
  createdAt: string,
  provenance: UciDocumentRegistryEntry["provenance"] = "stage_upload",
): UciDocumentRegistryEntry {
  return {
    id: `demo-registry-${id}`,
    project_document_id: `demo-doc-${id}`,
    coordination_record_id: RECORD_ID,
    detected_role: role,
    manual_role: null,
    effective_role: role,
    role_confidence: "high",
    classification_review: "auto_accepted",
    provenance,
    signature_status: null,
    stage_consumers: stages,
    provider_slot_keys: [],
    project_document: {
      id: `demo-doc-${id}`,
      project_id: PROJECT_ID,
      document_type: role,
      file_name: fileName,
      file_path: "",
      file_type: "application/pdf",
      created_at: createdAt,
    },
  };
}

const DEMO_DOCUMENTS: UciDocumentRegistryEntry[] = [
  registryDocument("load-letter", "Highland Springs Load Letter.pdf", "load_letter", [2, 3], "2026-01-06T12:00:00.000Z", "manual_upload"),
  registryDocument("one-line", "Highland Springs Electrical One-Line.pdf", "single_line_diagram", [2, 3, 6], "2026-01-06T12:05:00.000Z", "manual_upload"),
  registryDocument("cos-v1", "Class of Service v1 (800 A).pdf", "class_of_service", [6], DATES.cosV1, "email_inbound"),
  registryDocument("cos-v2", "Revised Class of Service (1000 A).pdf", "class_of_service", [6], DATES.cosV2, "email_inbound"),
  registryDocument("ciac", "CIAC Invoice SEC-CIAC-0125.pdf", "ciac", [7], DATES.ciacActual, "email_inbound"),
  registryDocument("transformer", "Transformer Delivery Ticket.pdf", "equipment_evidence", [8], DATES.delivered),
  registryDocument("inspection", "Electrical Inspection Release.pdf", "inspection_release", [9], DATES.inspection),
  registryDocument("closeout", "Energization Closeout Package.pdf", "uci_closeout_package", [10], DATES.closeout, "uci_generated"),
];

function communication(
  id: string,
  stage: number,
  direction: "inbound" | "outbound",
  classification: string,
  subject: string,
  summary: string,
  timestamp: string,
  contact: string,
  actionItems: string[],
  attachments: string[] = [],
): CoordinationCommunication {
  return {
    id: `demo-comm-${id}`,
    ...linked,
    direction,
    channel: "demo",
    classification,
    classification_confidence: 0.97,
    raw_subject: subject,
    raw_body: null,
    raw_attachments: attachments,
    parsed_summary: summary,
    parsed_action_items: actionItems.map((detail) => ({ detail })),
    thread_id: `demo-thread-${stage}`,
    needs_human_attention: false,
    reviewed_by: "demo-coordinator",
    reviewed_at: timestamp,
    agent_processed_metadata: { simulated: true, stage },
    sender: direction === "inbound" ? contact : "coordinator@demo.permitpilot",
    recipient: direction === "inbound" ? "coordinator@demo.permitpilot" : contact,
    message_timestamp: timestamp,
    created_at: timestamp,
  };
}

const UTILITY_CONTACT = "Dana Whitfield, Springhill Electric (fictional)";

const DEMO_COMMUNICATIONS: CoordinationCommunication[] = [
  communication("submission", 4, "outbound", "application_submission", "New service application — Highland Springs QSR", "Application package and load letter sent for the new 1000 A service.", DATES.submitted, UTILITY_CONTACT, ["Await acknowledgment"], ["Highland Springs Load Letter.pdf", "Highland Springs Electrical One-Line.pdf"]),
  communication("ack", 5, "inbound", "acknowledgment", "Application received — SEC-ACK-0113", "Utility acknowledged the application and assigned a project manager.", DATES.acknowledged, UTILITY_CONTACT, ["Design review begins within 5 business days"]),
  communication("cos-v1", 6, "inbound", "class_of_service", "Class of Service issued — 800 A", "Initial Class of Service assigns 800 A, below the requested 1000 A.", DATES.cosV1, UTILITY_CONTACT, ["Confirm requested service size"], ["Class of Service v1 (800 A).pdf"]),
  communication("cos-reply", 6, "outbound", "class_of_service", "RE: Class of Service — 1000 A required", "Coordinator sent the verified 410 kVA load calculation supporting 1000 A.", "2026-01-21T14:00:00.000Z", UTILITY_CONTACT, ["Await revised Class of Service"]),
  communication("cos-v2", 6, "inbound", "class_of_service", "Revised Class of Service — 1000 A approved", "Revised design confirms the 1000 A, 120/208 V service.", DATES.cosV2, UTILITY_CONTACT, ["CIAC estimate to follow"], ["Revised Class of Service (1000 A).pdf"]),
  communication("ciac", 7, "inbound", "ciac_invoice", "CIAC invoice SEC-CIAC-0125", "Final CIAC invoice of $12,000, $500 below the estimate.", DATES.ciacActual, UTILITY_CONTACT, ["Obtain client approval before payment"], ["CIAC Invoice SEC-CIAC-0125.pdf"]),
  communication("eta", 8, "inbound", "equipment_eta_update", "Transformer ETA update — now April 15", "Manufacturer delay moves transformer delivery from April 10 to April 15.", DATES.etaSlip, UTILITY_CONTACT, ["Re-check meter set target"]),
  communication("delivered", 8, "inbound", "equipment_eta_update", "Transformer delivered to site", "500 kVA transformer delivered and set on the pad.", DATES.delivered, UTILITY_CONTACT, ["Request inspection release"]),
  communication("meter", 9, "outbound", "meter_set_request", "Meter set request — April 22", "Inspection release and site readiness sent; meter set requested for April 22.", DATES.meterScheduled, UTILITY_CONTACT, ["Confirm crew schedule"]),
  communication("energized", 10, "inbound", "energization_confirmation", "Service energized — SEC-ENERGIZED-0422", "Utility confirmed energization and the final meter reading.", DATES.energized, UTILITY_CONTACT, ["Assemble closeout package"]),
];
