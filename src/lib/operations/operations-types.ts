/**
 * Operations Board shared types and data-source classification.
 * Mock and real data share presentation shapes but never mix in totals/exports.
 */

export type OperationsTab = "reimbursables" | "scope" | "workflow";

/** Visible classification for every section / KPI / control. */
export type DataSourceKind = "live" | "partial" | "mock" | "upcoming";

export const DATA_SOURCE_LABELS: Record<DataSourceKind, string> = {
  live: "Live Data",
  partial: "Partial Data",
  mock: "Mock Data",
  upcoming: "Upcoming",
};

export const MOCK_WORKFLOW_NOTICE =
  "Illustrative client-designed workflow. Backend integration is pending.";

export type MockReimbursable = {
  item: string;
  logged: string;
  project: string;
  permitNo: string;
  description: string;
  amount: number;
  team: string;
  invoiced: "Invoiced" | "Pending" | "Paid by GC";
  invoice: string;
  payment: "Done" | "Open" | "Paid by GC";
  progress: number;
};

export type MockScopeLine = {
  item: string;
  client: string;
  email: string;
  dateNeeded: string;
  hours: number;
  price: number;
};

export type MockSubitem = {
  name: string;
  approved: "Done" | "N/A" | "Open";
  completion: string;
  dependsOn?: string;
};

export type MockTask = {
  name: string;
  cp: "CP" | "NCP";
  owner: string;
  status: "Done" | "Working" | "Stuck" | "Not Started";
  completion: string;
  progress: number;
  subitems?: MockSubitem[];
};

export type MockWorkflowGroup = {
  name: string;
  accent: string;
  tasks: MockTask[];
};

/** Honest real/partial reimbursable summary row (no fabricated Monday fields). */
export type RealReimbursableSummaryRow = {
  id: string;
  kind: "project_reimbursement" | "permit_fee" | "expeditor_cost" | "utility_coordination";
  label: string;
  description: string | null;
  amount: number | null;
  permitNumber: string | null;
  /** Only when genuinely present on UCI / project QB fields */
  invoiceRef: string | null;
  paidAt: string | null;
  billedAt: string | null;
  sourceTable: "projects" | "coordination_costs";
};

export type RealQbMilestone = {
  key: "m1" | "m2" | "m3";
  label: string;
  triggered: boolean;
  triggeredAt: string | null;
  invoiceId: string | null;
};

export type OperationsProjectHeader = {
  id: string;
  name: string;
  permitNumber: string | null;
  addressLine: string | null;
  jurisdiction: string | null;
  clientName: string | null;
  clientEmail: string | null;
  serviceType: string | null;
  contractValue: number | null;
  reimbursementAmount: number | null;
  reimbursementDescription: string | null;
  permitFee: number | null;
  expeditorCost: number | null;
  totalCost: number | null;
  qbMilestones: RealQbMilestone[];
};

export type OperationsRealBundle = {
  header: OperationsProjectHeader;
  summaryRows: RealReimbursableSummaryRow[];
  utilityCostRows: RealReimbursableSummaryRow[];
  /** Sum of amounts that are non-null on summary + utility rows only */
  realTrackedAmount: number;
  realTrackedCount: number;
  /** Count of genuine QB milestone invoice IDs + UCI costs with quickbooks_invoice_id */
  realInvoiceRefCount: number;
  dataSource: DataSourceKind;
};
