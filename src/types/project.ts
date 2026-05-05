export type ProjectStatus = 'draft' | 'submitted' | 'in_review' | 'corrections' | 'approved';

export type ProjectType =
  | 'new_construction'
  | 'renovation'
  | 'addition'
  | 'tenant_improvement'
  | 'demolition'
  | 'interior_renovation'
  | 'exterior_renovation'
  | 'change_of_use'
  | 'foundation'
  | 'structural_modification'
  | 'mep_upgrade'
  | 'fire_protection'
  | 'roofing'
  | 'facade'
  | 'site_work'
  | 'excavation'
  | 'sheeting_shoring'
  | 'crane_derrick'
  | 'solar_installation'
  | 'sign_awning'
  | 'elevator_conveyance'
  | 'pool_spa'
  | 'retaining_wall'
  | 'deck_porch'
  | 'fence_gate'
  | 'accessory_structure'
  | 'historic_preservation'
  | 'accessibility_ada'
  | 'environmental_remediation'
  | 'right_of_way'
  | 'grading_sediment'
  | 'temporary_structure'
  | 'other';

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
  interior_renovation: 'Interior Renovation',
  exterior_renovation: 'Exterior Renovation',
  change_of_use: 'Change of Use / Occupancy',
  foundation: 'Foundation',
  structural_modification: 'Structural Modification',
  mep_upgrade: 'MEP (Mechanical / Electrical / Plumbing)',
  fire_protection: 'Fire Protection / Suppression',
  roofing: 'Roofing',
  facade: 'Facade / Exterior Cladding',
  site_work: 'Site Work / Grading',
  excavation: 'Excavation',
  sheeting_shoring: 'Sheeting & Shoring',
  crane_derrick: 'Crane / Derrick',
  solar_installation: 'Solar Installation',
  sign_awning: 'Sign / Awning / Canopy',
  elevator_conveyance: 'Elevator / Conveyance',
  pool_spa: 'Pool / Spa',
  retaining_wall: 'Retaining Wall',
  deck_porch: 'Deck / Porch / Patio',
  fence_gate: 'Fence / Gate',
  accessory_structure: 'Accessory Structure / Shed',
  historic_preservation: 'Historic Preservation',
  accessibility_ada: 'Accessibility / ADA Compliance',
  environmental_remediation: 'Environmental Remediation',
  right_of_way: 'Right-of-Way / Public Space',
  grading_sediment: 'Grading / Sediment Control',
  temporary_structure: 'Temporary Structure',
  other: 'Other',
};

export const STATUS_ORDER: ProjectStatus[] = ['draft', 'submitted', 'in_review', 'corrections', 'approved'];
