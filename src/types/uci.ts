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
  tenant_id?: string | null;
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
  provider_slug?: string | null;
  external_application_id?: string | null;
  external_job_id?: string | null;
  portal_status?: string | null;
  portal_milestone?: string | null;
  portal_last_updated_at?: string | null;
  portal_submitted_at?: string | null;
  action_required?: boolean;
  last_synced_at?: string | null;
  record_source?: "portal_sync" | "agent_draft" | string;
  metadata?: Record<string, unknown>;
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
  tenant_id?: string | null;
  milestone_type: string | null;
  parent_stage: number | null;
  target_date: string | null;
  actual_date: string | null;
  status: "pending" | "scheduled" | "completed" | "missed" | string;
  notes: string | null;
  provider_slug?: string | null;
  external_application_id?: string | null;
  portal_status?: string | null;
  portal_milestone?: string | null;
  occurred_at?: string | null;
  source?: string | null;
  idempotency_key?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CoordinationCommunication {
  id: string;
  coordination_record_id: string;
  project_id: string;
  tenant_id?: string | null;
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
  provider_slug?: string | null;
  external_application_id?: string | null;
  external_message_id?: string | null;
  idempotency_key?: string | null;
  sender?: string | null;
  recipient?: string | null;
  message_timestamp?: string | null;
  updated_at?: string | null;
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

export interface UciEntityCountBucket {
  discovered: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface UciPortalSyncResponse {
  providerSlug: string;
  applications: UciEntityCountBucket;
  communications: UciEntityCountBucket;
  milestones: UciEntityCountBucket;
  warnings: string[];
  errors: string[];
  syncedAt?: string;
}

export interface UciCommunicationsListResponse {
  communications: CoordinationCommunication[];
  total: number;
  limit: number;
  offset: number;
}

export interface UciMilestonesListResponse {
  milestones: CoordinationMilestone[];
  total: number;
  limit: number;
  offset: number;
}

/** POST /api/uci/coordination/:id/discovery/pepco (+ MFA resume) — login only */
export type UciDiscoveryResponse =
  | {
      status: "human_required";
      /** e.g. mfa_email_code, mfa_email_code_input_required, mfa_contact_method_selection_required */
      reason: string;
      message: string;
      currentUrl?: string;
      session_id?: string;
      /** Phase 4.5 — in-app code entry continues dashboard discovery */
      continue_action?: "discover_dashboard" | "discover_application_details";
      capture_application_ids?: boolean;
    }
  | {
      status: "completed";
      checkpoint?: string;
      currentUrl?: string;
      session_id?: string;
    }
  | {
      status: "failed";
      error_code?: string;
      message: string;
      currentUrl?: string;
    };

/** Serialized PEPCO dashboard card (persisted compact form omits rawText) */
export interface UciPepcoDashboardCardMeta {
  index?: number;
  title?: string | null;
  address?: string | null;
  status?: string | null;
  lastUpdated?: string | null;
  dateSubmitted?: string | null;
  lastUpdatedDateTime?: string | null;
  submittedDateTime?: string | null;
  actionRequired?: boolean;
  draft?: boolean;
  source?: "api" | "dom" | string;
  jobId?: string | null;
  applicationId?: string;
  overviewUrl?: string;
  applicationIdError?: string;
}

export interface UciPepcoApplicationDetailErrors {
  overview?: string | null;
  statusChanges?: string | null;
  messages?: string | null;
  documents?: string | null;
  downloads?: Array<{ documentName?: string; error?: string }>;
}

/** PEPCO portal overview block from .euapi includeOverview=true */
export interface PepcoProjectOverview {
  projectName?: string | null;
  propertyAddress?: string | null;
  jobId?: string | null;
  statusName?: string | null;
  actionRequired?: boolean | null;
}

export interface PepcoProjectSummary {
  projectOwnerName?: string | null;
  submitterName?: string | null;
  opco?: string | null;
  opcoContactName?: string | null;
  opcoContactEmail?: string | null;
  expectedInServiceByDate?: string | null;
}

export interface PepcoProjectContact {
  contactType?: string | null;
  customContactType?: string | null;
  primaryContact?: boolean | null;
  contactFullName?: string | null;
  contactPreferredMethod?: string | null;
  email?: string | null;
  primaryPhone?: string | null;
  addressType?: string | null;
}

export interface PepcoProjectDetails {
  applicationDetails?: {
    projectContacts?: PepcoProjectContact[];
    billing?: {
      constructionBillingAddress?: unknown;
      monthlyBillingAddress?: unknown;
    };
    projectInformation?: {
      siteDetails?: Record<string, unknown>;
      estimatedDates?: Record<string, unknown>;
      siteOperationalDetails?: Record<string, unknown>;
    };
    electricServiceLoads?: Record<string, unknown>;
  };
}

export interface PepcoStatusChange {
  milestoneName?: string | null;
  statusName?: string | null;
  statusChangeDateTime?: string | null;
}

export interface PepcoMessage {
  statusChangeDisplayName?: string | null;
  senderMessage?: string | null;
  isSPOC?: boolean;
  isInternalUser?: boolean;
  receiverName?: string | null;
  receiverMessage?: string | null;
  messageDateTime?: string | null;
}

export interface PepcoDocument {
  documentName?: string | null;
  documentType?: string | null;
  documentStatus?: string | null;
  documentUploadDateTime?: string | null;
}

export interface PepcoDownloadedFile {
  documentName?: string | null;
  fileName?: string | null;
  status?: string | null;
  sizeBytes?: number | null;
  localPath?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  storageStatus?: string | null;
  storageUploadedAt?: string | null;
  storageError?: string | null;
  contentType?: string | null;
  contentDisposition?: string | null;
  detectedPdf?: boolean | null;
  error?: string | null;
}

export interface PepcoApplicationDetail {
  applicationUuid: string;
  overview?: PepcoProjectOverview | null;
  projectSummary?: PepcoProjectSummary | null;
  projectDetails?: PepcoProjectDetails | null;
  statusTracking?: Record<string, unknown> | null;
  statusChanges?: PepcoStatusChange[];
  currentMilestone?: string | null;
  currentStatus?: string | null;
  statusLastUpdatedAt?: string | null;
  messageCount?: number;
  latestMessageAt?: string | null;
  messages?: PepcoMessage[];
  documentCount?: number;
  documents?: PepcoDocument[];
  downloadedFiles?: PepcoDownloadedFile[];
  scrapedAt?: string;
  scrapeStatus?: "completed" | "partial" | "failed";
  errors?: UciPepcoApplicationDetailErrors;
}

export interface PepcoApplicationDetailDiscovery {
  lastStatus?: "completed" | "partial" | "failed" | string | null;
  lastScrapedAt?: string | null;
  applications?: PepcoApplicationDetail[];
}

export interface UciPepcoApplicationDetailSnapshot extends PepcoApplicationDetail {}

/** POST /api/uci/coordination/:id/discovery/pepco/application-details */
export type UciPepcoApplicationDetailDiscoveryResponse =
  | UciDiscoveryResponse
  | {
      status: "completed" | "partial" | "failed";
      checkpoint?: string;
      applications_scraped?: number;
      applications?: UciPepcoApplicationDetailSnapshot[];
      progress?: string[];
      error_code?: string;
      message?: string;
      session_id?: string;
      continue_action?: "discover_application_details";
    };

/** POST /api/uci/coordination/:id/discovery/pepco/dashboard — same MFA shapes + optional dashboard payload */
export type UciPepcoDashboardDiscoveryResponse =
  | UciDiscoveryResponse
  | {
      status: "completed";
      checkpoint?: string;
      currentUrl?: string;
      cards_found?: number;
      application_ids_found?: number;
      cards?: UciPepcoDashboardCardMeta[];
      /** Present on live API reads of cards during discovery; stripped before DB persist */
      rawText?: unknown;
    }
  | {
      status: "failed";
      error_code?: string;
      message?: string;
      currentUrl?: string;
      cards_found?: number;
      cards?: unknown[];
    };
