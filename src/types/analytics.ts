export interface ProjectAnalytics {
  id: string;
  name: string;
  user_id: string;
  status: string;
  jurisdiction: string | null;
  project_type: string | null;
  permit_fee: number;
  expeditor_cost: number;
  total_cost: number;
  rejection_count: number;
  rejection_reasons: string[];
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  draft_to_submit_days: number | null;
  submit_to_approval_days: number | null;
  total_cycle_days: number | null;
  inspection_count: number;
  failed_inspection_count: number;
  punch_list_count: number;
  open_punch_items: number;
  document_count: number;
}

export interface AnalyticsSummary {
  totalProjects: number;
  activeProjects: number;
  approvedProjects: number;
  avgCycleTime: number | null;
  avgSubmitToApproval: number | null;
  totalPermitFees: number;
  totalExpeditorCosts: number;
  totalCosts: number;
  totalRejections: number;
  avgCostPerPermit: number | null;
}

export interface JurisdictionMetrics {
  jurisdiction: string;
  projectCount: number;
  avgCycleTime: number | null;
  avgSubmitToApproval: number | null;
  rejectionCount: number;
  approvalRate: number;
}

export interface RejectionTrend {
  reason: string;
  count: number;
  percentage: number;
}

export interface MonthlyMetrics {
  month: string;
  submitted: number;
  approved: number;
  rejected: number;
  avgCycleTime: number | null;
}

export interface ProjectTypeMetrics {
  projectType: string;
  count: number;
  avgCycleTime: number | null;
  approvalRate: number;
  totalCost: number;
}

export interface JurisdictionTrend {
  jurisdiction: string;
  submitted: number;
  approved: number;
  inReview: number;
  avgCycleTime: number | null;
}
