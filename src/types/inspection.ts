export type InspectionStatus = 'scheduled' | 'in_progress' | 'passed' | 'failed' | 'conditional' | 'cancelled';
export type InspectionType = 
  | 'foundation'
  | 'framing'
  | 'electrical_rough'
  | 'electrical_final'
  | 'plumbing_rough'
  | 'plumbing_final'
  | 'mechanical_rough'
  | 'mechanical_final'
  | 'insulation'
  | 'drywall'
  | 'fire_safety'
  | 'final'
  | 'other';

export type PunchListStatus = 'open' | 'in_progress' | 'resolved' | 'verified';
export type PunchListPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Inspection {
  id: string;
  project_id: string;
  user_id: string;
  inspection_type: InspectionType;
  status: InspectionStatus;
  scheduled_date: string;
  completed_date: string | null;
  inspector_name: string | null;
  inspector_notes: string | null;
  result_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PunchListItem {
  id: string;
  project_id: string;
  inspection_id: string | null;
  user_id: string;
  title: string;
  description: string | null;
  location: string | null;
  priority: PunchListPriority;
  status: PunchListStatus;
  assigned_to: string | null;
  due_date: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
}

export const INSPECTION_STATUS_CONFIG: Record<InspectionStatus, {
  label: string;
  color: string;
  bgColor: string;
}> = {
  scheduled: { label: 'Scheduled', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  in_progress: { label: 'In Progress', color: 'text-amber-700', bgColor: 'bg-amber-100' },
  passed: { label: 'Passed', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
  failed: { label: 'Failed', color: 'text-red-700', bgColor: 'bg-red-100' },
  conditional: { label: 'Conditional', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  cancelled: { label: 'Cancelled', color: 'text-slate-700', bgColor: 'bg-slate-100' },
};

export const INSPECTION_TYPE_LABELS: Record<InspectionType, string> = {
  foundation: 'Foundation',
  framing: 'Framing',
  electrical_rough: 'Electrical Rough-In',
  electrical_final: 'Electrical Final',
  plumbing_rough: 'Plumbing Rough-In',
  plumbing_final: 'Plumbing Final',
  mechanical_rough: 'Mechanical Rough-In',
  mechanical_final: 'Mechanical Final',
  insulation: 'Insulation',
  drywall: 'Drywall',
  fire_safety: 'Fire Safety',
  final: 'Final Inspection',
  other: 'Other',
};

export const INSPECTION_TYPE_OPTIONS: { value: InspectionType; label: string }[] = Object.entries(
  INSPECTION_TYPE_LABELS
).map(([value, label]) => ({ value: value as InspectionType, label }));

export const PUNCH_LIST_STATUS_CONFIG: Record<PunchListStatus, {
  label: string;
  color: string;
  bgColor: string;
}> = {
  open: { label: 'Open', color: 'text-red-700', bgColor: 'bg-red-100' },
  in_progress: { label: 'In Progress', color: 'text-amber-700', bgColor: 'bg-amber-100' },
  resolved: { label: 'Resolved', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  verified: { label: 'Verified', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
};

export const PUNCH_LIST_PRIORITY_CONFIG: Record<PunchListPriority, {
  label: string;
  color: string;
  bgColor: string;
}> = {
  low: { label: 'Low', color: 'text-slate-700', bgColor: 'bg-slate-100' },
  medium: { label: 'Medium', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  high: { label: 'High', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  critical: { label: 'Critical', color: 'text-red-700', bgColor: 'bg-red-100' },
};
