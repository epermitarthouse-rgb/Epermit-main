export const IMPLEMENTATION_STATUSES = [
  "Not reviewed",
  "Audited",
  "Ready for implementation",
  "In progress",
  "Implemented",
  "Blocked",
  "Do not implement",
] as const;

export const VERIFICATION_STATUSES = [
  "Not tested",
  "Code inspected",
  "Visual checked",
  "Functional checked",
  "E2E checked",
  "Client approved",
] as const;

export const COMMENT_TYPES = [
  "General",
  "UI mismatch",
  "Functional gap",
  "Backend preservation",
  "Bug",
  "Blocker",
  "Test result",
  "Client feedback",
  "Decision",
] as const;

export type ImplementationStatus = (typeof IMPLEMENTATION_STATUSES)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type CommentType = (typeof COMMENT_TYPES)[number];

export type CompletionState =
  | "Not started"
  | "Planning"
  | "Building"
  | "Ready for test"
  | "Testing"
  | "Complete"
  | "Blocked";

export const COMPLETION_CHECK_KEYS = [
  "lovableLayoutReviewed",
  "routeDecisionConfirmed",
  "existingFunctionalityIdentified",
  "backendPreservationConfirmed",
  "uiImplemented",
  "desktopVisualCheck",
  "tabletVisualCheck",
  "mobileVisualCheck",
  "darkThemeChecked",
  "lightThemeChecked",
  "authBehaviorChecked",
  "roleBehaviorChecked",
  "selectedProjectBehaviorChecked",
  "apiBehaviorChecked",
  "regressionTestPassed",
  "e2eTestPassed",
  "previewReviewed",
  "clientApproved",
  "documentationUpdated",
] as const;

export type CompletionCheckKey = (typeof COMPLETION_CHECK_KEYS)[number];

export type CompletionChecks = Partial<Record<CompletionCheckKey, boolean>>;

export type ArchitectureMatrixRow = {
  rowId: string;
  legacyId?: string;
  rowKind: "lovable" | "permitpilot_only";
  priority: string;
  risk: string;
  lovable: Record<string, string>;
  permitPilot: Record<string, string>;
  decisions: Record<string, string>;
  work: Record<string, string>;
  defaults: {
    implementationStatus: ImplementationStatus;
    verificationStatus: VerificationStatus;
  };
  derived: {
    uiStatus: string;
    backendStatus: string;
    hasPreserve: boolean;
    isMissing: boolean;
    isBackendConnected: boolean;
    isUiOnly: boolean;
  };
};

export type ArchitectureMatrixPayload = {
  generatedAt: string;
  branch: string;
  sourceCsv: string;
  sourceMd: string;
  lovableRowCount: number;
  permitPilotOnlyRowCount: number;
  rows: ArchitectureMatrixRow[];
};

export type ReplicationItemOverlay = {
  matrix_row_id: string;
  implementation_status: ImplementationStatus;
  verification_status: VerificationStatus;
  assigned_owner: string | null;
  is_blocked: boolean;
  blocker_description: string | null;
  implementation_commit: string | null;
  preview_url: string | null;
  test_evidence: string | null;
  last_tested_at: string | null;
  client_approved_at: string | null;
  client_feedback: string | null;
  completion_checks: CompletionChecks;
  updated_at: string | null;
  updated_by: string | null;
};

export type ReplicationComment = {
  id: string;
  matrix_row_id: string;
  comment_type: CommentType;
  comment_text: string;
  created_by: string | null;
  created_at: string;
};

export const COMPLETION_CHECK_LABELS: Record<CompletionCheckKey, string> = {
  lovableLayoutReviewed: "Lovable layout reviewed",
  routeDecisionConfirmed: "Route decision confirmed",
  existingFunctionalityIdentified: "Existing PermitPilot functionality identified",
  backendPreservationConfirmed: "Backend preservation confirmed",
  uiImplemented: "UI implemented",
  desktopVisualCheck: "Desktop visual check",
  tabletVisualCheck: "Tablet visual check",
  mobileVisualCheck: "Mobile visual check",
  darkThemeChecked: "Dark theme checked",
  lightThemeChecked: "Light theme checked",
  authBehaviorChecked: "Auth behavior checked",
  roleBehaviorChecked: "Role behavior checked",
  selectedProjectBehaviorChecked: "Selected-project behavior checked",
  apiBehaviorChecked: "API behavior checked",
  regressionTestPassed: "Regression test passed",
  e2eTestPassed: "E2E test passed",
  previewReviewed: "Preview reviewed",
  clientApproved: "Client approved",
  documentationUpdated: "Documentation updated",
};
