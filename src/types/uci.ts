/** Frontend-safe types for `/api/uci` JSON (no credentials). */

export type LifecycleState =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "AWAITING_UTILITY"
  | "BLOCKED"
  | "ESCALATED"
  | "COMPLETED";

export type DraftStatus = "draft" | "reviewed" | "needs_changes" | "submitted" | "failed";

export interface UtilityProvider {
  id: string;
  slug: string;
  name: string;
  utility_type: string;
  primary_portal_type: string | null;
  portal_url: string | null;
  automation_status: string;
  is_active: boolean;
}

/** Row from `coordination_records` with optional embedded `utility_providers` join */
export interface CoordinationRecord {
  id: string;
  project_id: string;
  user_id: string | null;
  tenant_id: string | null;
  utility_provider_id: string;
  utility_type: string | null;
  scope_description: string;
  current_stage: number;
  current_stage_state: LifecycleState;
  utility_account_number: string | null;
  utility_contact_name: string | null;
  utility_contact_email: string | null;
  utility_contact_phone: string | null;
  application_submitted_at: string | null;
  acknowledgment_received_at: string | null;
  class_of_service_issued_at: string | null;
  energization_target_date: string | null;
  energization_actual_date: string | null;
  predicted_p50_date: string | null;
  predicted_p90_date: string | null;
  agent_monitored: boolean;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  utility_providers?: UtilityProvider | UtilityProvider[] | null;
}

export interface CoordinationTransition {
  id: string;
  coordination_record_id: string;
  project_id: string;
  from_stage: number | null;
  to_stage: number;
  from_state: LifecycleState | null;
  to_state: LifecycleState;
  triggered_by_type: string | null;
  triggered_by_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CoordinationApplication {
  id: string;
  coordination_record_id: string;
  project_id: string;
  application_type: string | null;
  package_documents: unknown;
  load_summary: unknown;
  submission_method: string | null;
  utility_ticket_number: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  draft_status: DraftStatus;
  agent_draft_metadata: Record<string, unknown>;
  idempotency_key: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoordinationCost {
  id: string;
  coordination_record_id: string;
  project_id: string;
  cost_type: string | null;
  estimated_amount: string | null;
  estimated_at: string | null;
  actual_amount: string | null;
  actual_received_at: string | null;
  variance_pct: string | null;
  invoice_received_doc_ref: string | null;
  paid_at: string | null;
  payment_method: string | null;
  client_billed_at: string | null;
  quickbooks_invoice_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoordinationEquipment {
  id: string;
  coordination_record_id: string;
  project_id: string;
  equipment_type: string | null;
  equipment_size: string | null;
  initial_eta: string | null;
  current_eta: string | null;
  eta_history: unknown;
  status: "pending" | "on_order" | "shipped" | "delivered" | "installed" | string;
  last_check_in_at: string | null;
  next_check_in_at: string | null;
  weeks_of_slip: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoordinationMilestone {
  id: string;
  coordination_record_id: string;
  project_id: string;
  milestone_type: string | null;
  parent_stage: number | null;
  target_date: string | null;
  actual_date: string | null;
  status: "pending" | "scheduled" | "completed" | "missed" | string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoordinationCommunication {
  id: string;
  coordination_record_id: string;
  project_id: string;
  direction: string | null;
  channel: string | null;
  classification: string | null;
  classification_confidence: string | number | null;
  raw_subject: string | null;
  raw_body: string | null;
  raw_attachments: unknown;
  parsed_summary: string | null;
  parsed_action_items: unknown;
  thread_id: string | null;
  needs_human_attention: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  agent_processed_metadata: Record<string, unknown>;
  created_at: string;
}

export interface UciProvidersResponse {
  providers: UtilityProvider[];
}

export interface UciProjectCoordinationResponse {
  records: CoordinationRecord[];
}

export interface UciInitResponse {
  created: CoordinationRecord[];
  already_existed: CoordinationRecord[];
  records: CoordinationRecord[];
}

export interface UciRecordDetailResponse {
  record: CoordinationRecord;
  transitions: CoordinationTransition[];
  applications: CoordinationApplication[];
  costs: CoordinationCost[];
  equipment: CoordinationEquipment[];
  milestones: CoordinationMilestone[];
  communications_recent: CoordinationCommunication[];
}

export interface UciTransitionResponse {
  coordination: CoordinationRecord;
  transition: CoordinationTransition;
}

export interface UciApplicationsListResponse {
  applications: CoordinationApplication[];
}
