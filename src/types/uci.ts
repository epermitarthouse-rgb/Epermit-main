/** Frontend-safe types for `/api/uci` JSON (no credentials). */
import type { UciUtilityType } from "@/lib/uciUtilityTypes";

export type LifecycleState =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "AWAITING_UTILITY"
  | "BLOCKED"
  | "ESCALATED"
  | "COMPLETED";

export type DraftStatus =
  | "draft"
  | "reviewed"
  | "approved_for_submission"
  | "needs_changes"
  | "submitted"
  | "failed";

export interface UtilityProvider {
  id: string;
  slug: string;
  name: string;
  display_name?: string | null;
  canonical_name?: string | null;
  utility_type: UciUtilityType;
  ownership_type?: string | null;
  cet_relationship?: boolean;
  portal_key?: string | null;
  primary_portal_type: string | null;
  portal_url: string | null;
  automation_status: string;
  is_active: boolean;
  label?: string;
}

/** Row from `coordination_records` with optional embedded `utility_providers` join */
export interface CoordinationRecord {
  id: string;
  project_id: string;
  user_id: string | null;
  tenant_id: string | null;
  utility_provider_id: string | null;
  utility_type: UciUtilityType | null;
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
  predicted_p50_previous?: string | null;
  predicted_p50_computed_at?: string | null;
  prediction_baseline_source?:
    | "historical"
    | "seed_fallback"
    | "code_fallback"
    | "operator_override"
    | null;
  prediction_sample_size?: number | null;
  prediction_reason?: Record<string, unknown> | null;
  inspection_release_received_at?: string | null;
  meter_set_scheduled_at?: string | null;
  site_readiness_confirmed_at?: string | null;
  site_contact_name?: string | null;
  site_contact_email?: string | null;
  site_contact_phone?: string | null;
  energization_date_conflict?: boolean | null;
  closeout_package_doc_id?: string | null;
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
  package_review_summary?: unknown;
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

export const UCI_COST_TYPES = [
  "CIAC",
  "application_fee",
  "design_review",
  "meter",
  "recording",
  "courier",
] as const;

export type UciCostType = (typeof UCI_COST_TYPES)[number];

export type ClientApprovalStatus = "pending" | "approved" | "rejected";
export type QbSyncStatus =
  | "not_ready"
  | "ready"
  | "pending"
  | "succeeded"
  | "retry"
  | "failed"
  | "uncertain";

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
  client_approval_status?: ClientApprovalStatus | null;
  client_approved_at?: string | null;
  client_approved_by?: string | null;
  billing_hold?: boolean | null;
  human_override_bill_at?: string | null;
  qb_sync_status?: QbSyncStatus | null;
  qb_last_error?: string | null;
  qb_attempt_count?: number | null;
  actual_source?: string | null;
  estimated_source?: string | null;
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
  check_in_method?: string | null;
  last_response_at?: string | null;
  last_weeks_of_slip?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UciLifecycleStatus {
  guards?: {
    can_enter_stage_7?: boolean;
    can_complete_stage_7?: boolean;
    can_enter_stage_8?: boolean;
    can_complete_stage_8?: boolean;
    can_enter_stage_9?: boolean;
    can_complete_stage_9?: boolean;
    can_enter_stage_10?: boolean;
    can_complete_stage_10?: boolean;
    choreography_may_start?: boolean;
    inspection_release_received?: boolean;
    stage_7_reasons?: string[];
    stage_8_reasons?: string[];
    stage_9_reasons?: string[];
    stage_10_reasons?: string[];
  };
  meter_set?: { status?: string; reason?: string | null; actions?: string[] };
  closeout?: { status?: string; missing?: string[]; actions?: string[] };
  project_rollup?: { completed_count?: number; total?: number; banner?: string; complete?: boolean };
  predicted?: {
    typical_label?: string;
    conservative_label?: string;
    predicted_p50_date?: string | null;
    predicted_p90_date?: string | null;
  };
  record_attention?: Array<{ code: string; label: string }>;
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

export const PERMITPILOT_DEMO_TENANT_ID = '00000000-0000-4000-8000-000000000001';

export interface UciProvidersResponse {
  providers: UtilityProvider[];
  tenant_id?: string | null;
}

export interface UciCreateProviderInput {
  name: string;
  utility_type: UciUtilityType;
}

export interface UciCreateProviderResponse {
  provider: UtilityProvider;
  created: boolean;
  tenant_id: string;
}

export interface UciPortalHarvestSuggestion {
  project_id: string;
  project_name: string;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

export interface UciPortalHarvestApplication {
  provider_slug: string;
  external_application_id: string;
  external_job_id: string | null;
  name: string | null;
  address: string | null;
  portal_status: string | null;
  portal_milestone: string | null;
  last_synced_at: string | null;
  documents_count: number;
  communications_count: number;
  milestones_count: number;
  latest_milestone_status: string | null;
  linked_project: { id: string; name: string } | null;
  coordination_record_id: string | null;
  match_status: "Linked" | "Unmatched" | "Needs review";
  suggestions: UciPortalHarvestSuggestion[];
  source_duplicate_count: number;
}

export interface UciPortalHarvestResponse {
  provider: { slug: string; name: string };
  last_sync: string | null;
  applications: UciPortalHarvestApplication[];
  projects: Array<{ id: string; name: string }>;
}

export interface UciProjectCoordinationResponse {
  records: CoordinationRecord[];
}

export interface UciRecordAttentionItem {
  kind: "record";
  coordination_record_id: string;
  project_id: string;
  code: string;
  label: string;
  stage: number;
  state: string;
}

export interface UciOperationalSnapshotRecord extends CoordinationRecord {
  project_name: string;
  provider_display_name: string | null;
  applications: CoordinationApplication[];
  communications_recent: CoordinationCommunication[];
  attention_communications: CoordinationCommunication[];
  attention_count: number;
  record_attention?: UciRecordAttentionItem[];
}

export interface UciOperationalSnapshotResponse {
  records: UciOperationalSnapshotRecord[];
  generated_at: string;
  diagnostics: {
    project_count: number;
    record_count: number;
    application_count: number;
    communication_count: number;
    db_query_count: number;
    access_mode: "rpc" | "compatibility";
    partial_failures: string[];
    query_durations_ms: Record<string, number>;
    service_duration_ms: number;
  };
}

export interface UciInitResponse {
  created: CoordinationRecord[];
  already_existed: CoordinationRecord[];
  records: CoordinationRecord[];
}

export type UciProviderSetupAddressSource =
  | "structured"
  | "portal_data_location"
  | "utility_portal"
  | "none";

export interface UciProviderSetupAddress {
  source: UciProviderSetupAddressSource;
  parts: Record<string, string | null> | null;
  formatted: string | null;
  complete: boolean;
  fallback_used?: boolean;
  fallback_note?: string;
}

export interface UciProviderSetupScrapedLocation {
  formatted: string;
  source: "portal_data_location";
}

export interface UciProviderSetupResponse {
  project_id: string;
  tenant_id?: string | null;
  mapping_method: "human_assisted";
  territory_matching_available: false;
  territory_matching_message: string;
  address: UciProviderSetupAddress;
  structured: UciProviderSetupAddress;
  scraped_location: UciProviderSetupScrapedLocation | null;
  address_mismatch: boolean;
  mismatch_warning: string | null;
  available_address_sources: UciProviderSetupAddressSource[];
  recommended_address_source: UciProviderSetupAddressSource;
  guidance_steps: string[];
  providers: UciProviderSetupCatalogItem[];
  utility_types_in_catalog: UciUtilityType[];
  auto_selection_enabled: false;
}

export interface UciProviderSetupCatalogItem {
  id: string;
  slug: string;
  name: string;
  display_name?: string;
  canonical_name?: string | null;
  utility_type: UciUtilityType;
  ownership_type?: string | null;
  cet_relationship?: boolean;
  portal_key?: string | null;
  automation_status: string;
  already_initialized: boolean;
  suggested: boolean;
}

export interface UciProviderSetupConfirmation {
  confirmed: true;
  address_source_acknowledged: UciProviderSetupAddressSource;
  unresolved_utility_types?: string[];
}

export interface UciProviderMappingMetadata {
  method: "human_assisted";
  confirmed: true;
  confirmed_by_user_id: string;
  confirmed_at: string;
  address_source: UciProviderSetupAddressSource;
  address_source_acknowledged: UciProviderSetupAddressSource;
  address_mismatch?: boolean;
  address_snapshot: {
    formatted: string | null;
    complete: boolean;
    fallback_used: boolean;
    parts: Record<string, string | null> | null;
  } | null;
  selected_provider_slugs: string[];
  unresolved_utility_types: string[];
  territory_matching_available: false;
  provider_slug?: string;
}

export type UciProviderResolutionStatus =
  | "resolved"
  | "ambiguous"
  | "not_found"
  | "geocoding_failed"
  | "territory_data_unavailable"
  | "manual_confirmation_required"
  | "confirmed"
  | "overridden";

export type UciProviderResolutionMethod =
  | "point_in_polygon"
  | "boundary_buffer"
  | "county_fallback"
  | "zip_cache_suggestion"
  | "manual_selection";

export type UciProviderResolutionConfidence = "high" | "medium" | "low" | "none";

export interface UciProviderResolutionCandidate {
  provider_id: string;
  provider_slug: string;
  display_name: string;
  match_reason: string;
  coverage_or_distance?: number | null;
}

export interface UciProviderResolutionResult {
  service_type: string;
  status: UciProviderResolutionStatus;
  resolution_tier: number | null;
  resolution_method: UciProviderResolutionMethod | null;
  confidence: UciProviderResolutionConfidence;
  address: {
    formatted: string | null;
    source: "project" | "portal" | "manual";
    latitude: number | null;
    longitude: number | null;
    geocode_provider: string | null;
    geocoded_at: string | null;
  };
  source: {
    name: string;
    dataset_vintage: string | null;
    layer_id: string | null;
    source_url: string | null;
    generated_at: string | null;
    available?: boolean;
  };
  candidates: UciProviderResolutionCandidate[];
  suggested_provider_id: string | null;
  boundary_risk: boolean;
  boundary_distance_miles: number | null;
  requires_human_confirmation: boolean;
  confirmed_provider_id: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  confirmed_provider_slug?: string | null;
  override_reason: string | null;
  notes: string | null;
  resolver_version?: string;
  resolved_at?: string | null;
  user_message?: string | null;
  original_suggestion?: {
    suggested_provider_id: string | null;
    candidates: UciProviderResolutionCandidate[];
    resolution_method: UciProviderResolutionMethod | null;
    resolution_tier: number | null;
    source: UciProviderResolutionResult["source"] | null;
  };
}

export interface UciProviderResolutionListResponse {
  project_id: string;
  resolver_version: string;
  territory_data_available: Partial<Record<UciUtilityType, boolean>>;
  address_context: {
    formatted: string | null;
    source: string;
    address_mismatch: boolean;
  };
  resolutions: Record<string, UciProviderResolutionResult>;
  user_messages: {
    territory_unavailable: string;
  };
}

export interface UciProviderResolutionActionResponse {
  project_id: string;
  service_type: string;
  resolution: UciProviderResolutionResult;
}

export interface UciLoadProfileAnalyzeResponse {
  coordination_record_id: string;
  project_id: string;
  analysis_status: "preliminary" | "missing_inputs" | "blocked";
  load_summary: Record<string, unknown>;
  application: CoordinationApplication;
  stage_unchanged: boolean;
  current_stage: number;
  current_stage_state: LifecycleState;
}

export interface UciLoadProfileDocumentScopeRow {
  project_document_id: string;
  file_name: string;
  document_type: string;
  classified_document_type: string;
  source_utility_type: string | null;
  source_provider_slug: string | null;
  source_provider_name: string | null;
  provenance_label: string;
  relevance: "same_utility" | "cross_utility" | "project_level" | "unknown";
  included_in_analysis: boolean;
  link_origin: "automatic" | "manual" | "inbound";
  link_role: string;
  linked_by: string | null;
  linked_at: string | null;
  processing_status: string;
  processing_status_label: string;
  processing_status_reason?: string | null;
  findings_count: number;
  linked: boolean;
  unlinked_at: string | null;
  portal_document?: boolean;
}

export interface UciLoadProfileDocumentScope {
  coordination_record_id: string;
  project_id: string;
  utility_type: string;
  provider_name: string | null;
  provider_slug: string | null;
  selected_for_analysis_count: number;
  selected_for_analysis_label: string;
  used: UciLoadProfileDocumentScopeRow[];
  other_project_documents: UciLoadProfileDocumentScopeRow[];
  linked_document_ids?: string[];
  project_document_deleted?: boolean;
  project_document_present?: boolean;
}

export interface UciApplicationPackageBuildResponse {
  coordination_record_id: string;
  project_id: string;
  package_status: "blocked" | "incomplete" | "ready_for_review";
  missing_documents: string[];
  missing_fields: string[];
  application: CoordinationApplication;
  stage_unchanged: boolean;
  current_stage: number;
  current_stage_state: LifecycleState;
}

export interface UciApplicationReviewResponse {
  application: CoordinationApplication;
  review_status: DraftStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  package_review?: unknown;
}

export interface UciApplicationSubmitResponse {
  status?:
    | "confirmed"
    | "human_required"
    | "failed"
    | "validation_passed"
    | "validation_failed"
    | "validation_blocked";
  reason?: string;
  dry_run?: boolean;
  validation_only?: boolean;
  live_submission_enabled?: boolean;
  lifecycle_advanced?: boolean;
  fields_to_submit?: Array<Record<string, unknown>>;
  attachments_to_submit?: Array<Record<string, unknown>>;
  validation_errors?: Array<Record<string, unknown>>;
  missing_fields?: string[];
  missing_attachments?: string[];
  utility_ticket_number?: string | null;
  message?: string;
  application: CoordinationApplication;
  submission_method: string;
  submission_metadata: Record<string, unknown>;
  coordination_record?: CoordinationRecord;
  transitions?: CoordinationTransition[];
  portal_adapter_used: boolean;
  external_side_effects?: {
    email_sent?: boolean;
    portal_touched?: boolean;
    live_submission_attempted?: boolean;
    lifecycle_advanced?: boolean;
    graph_called?: boolean;
  };
  primary_state?: string;
  secondary_state?: string;
  synthetic_banner?: string | null;
  intended_submission_mode?: string;
  validated_at?: string;
  attachments?: Array<Record<string, unknown>>;
  package_snapshot?: Record<string, unknown>;
  blockers?: Array<Record<string, unknown>>;
  warnings?: Array<Record<string, unknown>>;
  readiness?: Record<string, unknown>;
  attempt?: Record<string, unknown>;
}

export interface UciSubmissionValidationAttemptResponse extends UciApplicationSubmitResponse {
  mode: "validation_only";
  capability?: string;
  result?: "passed" | "failed" | "blocked";
}

export interface UciSubmissionValidationAttemptsListResponse {
  application_id: string;
  attempts: Array<Record<string, unknown>>;
  latest_validation?: Record<string, unknown> | null;
  primary_state: string;
  source: string;
  submitted_at?: string | null;
  application?: CoordinationApplication;
  table_error?: string;
}

export interface UciRecordDetailResponse {
  record: CoordinationRecord;
  transitions: CoordinationTransition[];
  applications: CoordinationApplication[];
  costs: CoordinationCost[];
  equipment: CoordinationEquipment[];
  milestones: CoordinationMilestone[];
  communications_recent: CoordinationCommunication[];
  hydration?: {
    request_id: string | null;
    steps: Array<{
      step: string;
      duration_ms: number;
      success: boolean;
      blocking: boolean;
      request_id: string | null;
      error?: string;
    }>;
    errors: Record<string, { code: string; message: string }>;
  };
}

export interface UciTransitionResponse {
  coordination: CoordinationRecord;
  transition: CoordinationTransition;
}

export interface UciStage2CompletionResponse extends UciTransitionResponse {
  stage_2_completed: true;
  stage_3_completed: boolean;
  ready_for_stage_4: boolean;
  application_id: string | null;
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
  lifecycle?: UciLifecycleMappingResult;
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

export type UciNormalizedSyncStatus = "success" | "partial" | "failed" | "not_run";

export interface UciNormalizedSyncCountBucket {
  discovered: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface UciNormalizedSyncResult {
  status: UciNormalizedSyncStatus;
  reason?: string | null;
  applications: UciNormalizedSyncCountBucket;
  communications: UciNormalizedSyncCountBucket;
  milestones: UciNormalizedSyncCountBucket;
  errors: string[];
  synced_at?: string | null;
}

export interface UciLifecycleProposalRow {
  external_application_id: string;
  provider_slug: string;
  source_status: string;
  proposed_stage: number;
  proposed_state: LifecycleState;
  confidence: string;
  reason: string;
  automatic_transition_allowed: boolean;
  blocked_reason: string | null;
  applied: boolean;
  applied_at: string | null;
  rejected?: boolean;
  rejected_at?: string | null;
  rejection_reason?: string | null;
}

export interface UciLifecycleProposalsPayload {
  last_evaluated_at: string;
  auto_apply_enabled: boolean;
  proposals: UciLifecycleProposalRow[];
  applied_transition_id: string | null;
}

export type UciLifecycleMappingStatus = "not_run" | "proposed" | "applied" | "partial" | "failed";

export interface UciLifecycleMappingResult {
  status: UciLifecycleMappingStatus;
  evaluated_count: number;
  applied_count: number;
  blocked_count: number;
  auto_apply_enabled: boolean;
  proposals: UciLifecycleProposalRow[];
  errors: string[];
}

export type UciPepcoApplicationDetailSnapshot = PepcoApplicationDetail;

/** POST /api/uci/coordination/:id/discovery/pepco/application-details */
export type UciPepcoApplicationDetailDiscoveryResponse =
  | UciDiscoveryResponse
  | {
      status: "completed" | "partial" | "failed";
      checkpoint?: string;
      applications_scraped?: number;
      applications?: UciPepcoApplicationDetailSnapshot[];
      normalized_sync?: UciNormalizedSyncResult;
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

export interface UciPortalSyncRun {
  id: string;
  jobType: string;
  coordinationRecordId: string;
  projectId: string;
  providerSlug: string | null;
  status: string;
  phase: string | null;
  currentStage: string | null;
  currentUserMessage: string | null;
  progressCurrent: number | null;
  progressTotal: number | null;
  errorCode: string | null;
  errorUserMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  lastSyncSummary: Record<string, unknown> | null;
}

export interface UciPortalSyncRunsResponse {
  runs: UciPortalSyncRun[];
  activeRun: UciPortalSyncRun | null;
  durableJobsEnabled: boolean;
}

export interface UciPortfolioViewResponse {
  project_id: string;
  coordination_record_count: number;
  needs_attention_communication_count: number;
  stage_summary: Record<string, number>;
  records: Array<{
    id: string;
    utility_type: string | null;
    utility_provider_id?: string | null;
    current_stage: number;
    current_stage_state: LifecycleState;
    needs_attention_count: number;
    updated_at: string;
  }>;
}

export interface UciCosAnalysisResponse {
  coordination_record_id: string;
  project_id: string;
  analysis: Record<string, unknown>;
  comparison_rows?: UciCosComparisonRow[];
  discrepancies?: Array<Record<string, unknown>>;
  cos_design_record?: CoordinationCosDesignRecord | null;
  can_enter_stage_7?: boolean;
  stage_unchanged: boolean;
}

export interface UciCosComparisonRow {
  field: string;
  label: string;
  submitted: unknown;
  utility_issued: unknown;
  /** Display when documents disagree (immutable candidates kept separately) */
  utility_issued_display?: string | null;
  utility_conflict?: boolean;
  utility_candidates?: Array<Record<string, unknown>>;
  /** Operator accepted value — editable; defaults to utility_issued */
  accepted?: unknown;
  operator_override?: boolean;
  override_reason?: string | null;
  result: string;
  required_action: string;
  material?: boolean;
  utility_provenance?: unknown;
  baseline_provenance?: unknown;
}

export interface UciCosFieldOverrideAudit {
  field: string;
  label?: string;
  submitted_value?: unknown;
  utility_issued_value?: unknown;
  previous_accepted_value?: unknown;
  accepted_value?: unknown;
  source_document?: Record<string, unknown> | null;
  evidence_page?: unknown;
  reason?: string | null;
  changed_by?: string;
  changed_at?: string;
  review_version?: number;
  action?: string;
}

export interface CoordinationCosDesignRecord {
  id: string;
  coordination_record_id: string;
  project_id: string;
  version: number;
  is_current: boolean;
  evidence_status: UciCosEvidenceStatus;
  review_status: string;
  comparison_rows?: UciCosComparisonRow[];
  discrepancy_report?: Record<string, unknown>;
  extracted_fields?: Record<string, unknown>;
  baseline_fields?: Record<string, unknown>;
  accepted_fields?: Record<string, unknown>;
  field_overrides?: UciCosFieldOverrideAudit[];
  approved_snapshot?: Record<string, unknown> | null;
  review_version?: number;
  needs_human_attention?: boolean;
  attention_reasons?: string[];
  utility_evidence_issued_at?: string | null;
  approved_at?: string | null;
  approval_notes?: string | null;
}

export interface UciMeterSetPrepareResponse {
  coordination_record_id: string;
  project_id: string;
  checklist: Record<string, unknown>;
  milestone: CoordinationMilestone;
  stage_unchanged: boolean;
}

export interface UciCloseoutPrepareResponse {
  coordination_record_id: string;
  project_id: string;
  closeout_package: Record<string, unknown>;
  stage_unchanged: boolean;
}

export interface UciLifecycleProposalActionResponse {
  coordination_record_id: string;
  project_id: string;
  external_application_id: string;
  proposal_checksum: string;
  transition?: CoordinationTransition;
  coordination?: CoordinationRecord;
  lifecycle_proposals: UciLifecycleProposalsPayload;
}

export interface UciRecentEvent {
  name: string;
  payload: Record<string, unknown>;
  emitted_at: string;
}

export interface UciRecentEventsResponse {
  events: UciRecentEvent[];
}

/** Foundation-only vocabulary. These values do not imply automated decisions. */
export type UciCosEvidenceStatus = "ADVISORY" | "UTILITY_ISSUED" | "DISCREPANCY";
export type UciRefundAssessmentStatus = "NOT_ASSESSED" | "UNDER_REVIEW" | "DOCUMENTED";
export type UciAccountingMode = "DRAFT_HUMAN_APPROVAL";

export interface UciManual811Ticket {
  ticket_number: string;
  status: string;
  requested_at: string;
  expires_at: string;
  notes: string;
}

export interface UciManualConflict {
  id: string;
  project_id: string;
  coordination_record_id: string | null;
  category: string;
  summary: string;
  status: "OPEN" | "MONITORING" | "RESOLVED";
  created_at: string;
}

export interface UciManualFoundationNotes {
  refund_status: UciRefundAssessmentStatus;
  refund_notes: string;
  accounting_mode: UciAccountingMode;
  miss_utility_811: UciManual811Ticket;
  easement_row_notes: string;
  inspection_release_notes: string;
}
