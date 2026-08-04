export type ProjectStatus = 'draft' | 'submitted' | 'in_review' | 'corrections' | 'approved';

/**
 * Live Postgres `public.project_type` enum values.
 * Source of truth: supabase/migrations/20260113050946_… + generated
 * `Database["public"]["Enums"]["project_type"]`.
 *
 * Migration `20260308000001_expand_project_types.sql` adds more labels in-repo
 * but is not applied on the shared production DB — do not offer those values
 * in create/edit forms until that migration is deliberately applied.
 */
export const PROJECT_TYPE_VALUES = [
  'new_construction',
  'renovation',
  'addition',
  'tenant_improvement',
  'demolition',
  'other',
] as const;

export type ProjectType = (typeof PROJECT_TYPE_VALUES)[number];

/**
 * Map expanded UI / pre-migration labels → live DB enum.
 * Keeps create/update from failing if a stale client still sends expanded values.
 */
export const PROJECT_TYPE_ALIASES: Record<string, ProjectType> = {
  interior_renovation: 'renovation',
  exterior_renovation: 'renovation',
  change_of_use: 'other',
  foundation: 'new_construction',
  structural_modification: 'renovation',
  mep_upgrade: 'renovation',
  fire_protection: 'renovation',
  roofing: 'renovation',
  facade: 'renovation',
  site_work: 'other',
  excavation: 'other',
  sheeting_shoring: 'other',
  crane_derrick: 'other',
  solar_installation: 'other',
  sign_awning: 'other',
  elevator_conveyance: 'other',
  pool_spa: 'addition',
  retaining_wall: 'other',
  deck_porch: 'addition',
  fence_gate: 'other',
  accessory_structure: 'addition',
  historic_preservation: 'renovation',
  accessibility_ada: 'renovation',
  environmental_remediation: 'other',
  right_of_way: 'other',
  grading_sediment: 'other',
  temporary_structure: 'other',
};

export function isProjectType(value: unknown): value is ProjectType {
  return (
    typeof value === 'string' &&
    (PROJECT_TYPE_VALUES as readonly string[]).includes(value)
  );
}

/** Coerce any form/API string to a live DB project_type, or undefined if empty. */
export function coerceProjectTypeForDb(
  value: string | null | undefined,
): ProjectType | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  if (isProjectType(trimmed)) return trimmed;
  const aliased = PROJECT_TYPE_ALIASES[trimmed];
  if (aliased) return aliased;
  return undefined;
}

export function getProjectTypeLabel(value: string | null | undefined): string {
  if (!value) return '';
  if (isProjectType(value)) return PROJECT_TYPE_LABELS[value];
  const aliased = PROJECT_TYPE_ALIASES[value];
  if (aliased) return PROJECT_TYPE_LABELS[aliased];
  return value;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  address: string | null;
  project_url: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  jurisdiction: string | null;
  project_type: ProjectType | null;
  status: ProjectStatus;
  description: string | null;
  estimated_value: number | null;
  square_footage: number | null;
  permit_fee: number | null;
  expeditor_cost: number | null;
  total_cost: number | null;
  permit_number: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  deadline: string | null;
  notes: string | null;
  portal_status: string | null;
  last_checked_at: string | null;
  portal_data: unknown | null;
  credential_id: string | null;
  /** Billing / QuickBooks (Phase 4B+) */
  client_name: string | null;
  client_email: string | null;
  service_type: string | null;
  contract_value: number | null;
  reimbursement_amount: number | null;
  reimbursement_description: string | null;
  qb_customer_id: string | null;
  qb_invoice_id_m1: string | null;
  qb_invoice_id_m2: string | null;
  qb_invoice_id_m3: string | null;
  m1_triggered: boolean;
  m2_triggered: boolean;
  m3_triggered: boolean;
  m1_triggered_at: string | null;
  m2_triggered_at: string | null;
  m3_triggered_at: string | null;
  m1_trigger_source: string | null;
  m2_trigger_source: string | null;
  m3_trigger_source: string | null;
  created_at: string;
  updated_at: string;
}

export const PROJECT_STATUS_CONFIG: Record<ProjectStatus, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  dotColor: string;
}> = {
  draft: {
    label: 'Draft',
    color: 'text-ink-tertiary-light',
    bgColor: 'bg-cream-raised',
    borderColor: 'border-cream-sunken',
    dotColor: 'bg-ink-tertiary-light',
  },
  submitted: {
    label: 'Submitted',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
    borderColor: 'border-blue-300',
    dotColor: 'bg-blue-500',
  },
  in_review: {
    label: 'In Review',
    color: 'text-amber-700',
    bgColor: 'bg-amber-100',
    borderColor: 'border-amber-300',
    dotColor: 'bg-amber-500',
  },
  corrections: {
    label: 'Corrections',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-300',
    dotColor: 'bg-red-500',
  },
  approved: {
    label: 'Approved',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-100',
    borderColor: 'border-emerald-300',
    dotColor: 'bg-emerald-500',
  },
};

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  new_construction: 'New Construction',
  renovation: 'Renovation',
  addition: 'Addition',
  tenant_improvement: 'Tenant Improvement',
  demolition: 'Demolition',
  other: 'Other',
};

export const STATUS_ORDER: ProjectStatus[] = ['draft', 'submitted', 'in_review', 'corrections', 'approved'];
