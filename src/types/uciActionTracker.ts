export const UCI_TRACKER_STATUSES = [
  "Complete",
  "Partial",
  "Scaffolded",
  "Not Started",
  "Blocked",
  "Production Verification Required",
  "Deferred",
] as const;

export type UciTrackerStatus = (typeof UCI_TRACKER_STATUSES)[number];

export type UciTrackerScope = "pilot" | "deferred";

export type UciTrackerBucket =
  | "foundation"
  | "phase1"
  | "phase2"
  | "phase3"
  | "deferred"
  | "testing"
  | "ops"
  | "production_gate";

export type UciEvidence = {
  paths?: string[];
  services?: string[];
  routes?: string[];
  migrations?: string[];
  tests?: string[];
  uiRoutes?: string[];
  testResult?: string;
};

export type UciActionItem = {
  sequence: number;
  phaseWeek: string;
  actionItem: string;
  clientRequirement: string;
  /** Spreadsheet baseline wording before audit correction */
  spreadsheetStatus: string;
  spreadsheetBlocker: string;
  spreadsheetNextAction: string;
  /** Audit/code-corrected fields */
  status: UciTrackerStatus;
  statusExplanation: string;
  subStatus?: string;
  blockerGap: string;
  nextAction: string;
  scope: UciTrackerScope;
  bucket: UciTrackerBucket;
  agent?: string | null;
  lifecycleStage?: string | null;
  criticalPath: boolean;
  lastVerified: string;
  verificationSource: string;
  notes?: string;
  evidence?: UciEvidence;
};

export type UciCriticalPath = {
  furthestCompletedStage: string;
  majorGate: string;
  additionalFlags: string[];
  extendRatherThanRebuild: string;
};

export type UciCapabilityEstimates = {
  label: string;
  foundationPct: number;
  phase1Pct: number;
  phase2Pct: number;
  phase3Pct: number;
  pilotOverallPct: number;
  lifecyclePct: number;
};

export type UciActionTrackerPayload = {
  version: string;
  lastAuditedAt: string;
  sourceHierarchy: string[];
  criticalPath: UciCriticalPath;
  capabilityEstimates: UciCapabilityEstimates;
  items: UciActionItem[];
};

export type UciActionItemOverlay = {
  sequence: number;
  status?: UciTrackerStatus;
  blockerGap?: string;
  nextAction?: string;
  notes?: string;
  lastVerified?: string;
  updatedAt?: string;
};

export type UciTrackerOverlayStore = {
  version: 1;
  updatedAt: string;
  items: Record<string, UciActionItemOverlay>;
};
