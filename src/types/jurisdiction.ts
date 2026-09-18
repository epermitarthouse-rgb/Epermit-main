import type { Database } from '@/integrations/supabase/types';

export interface ReviewerContact {
  name: string;
  title: string;
  email: string;
  phone: string;
}

export type JurisdictionRow = Database['public']['Tables']['jurisdictions']['Row'];
export type JurisdictionInsert = Database['public']['Tables']['jurisdictions']['Insert'];
export type JurisdictionUpdate = Database['public']['Tables']['jurisdictions']['Update'];

/** Domain model aligned with the jurisdictions table. */
export interface Jurisdiction {
  id: string;
  name: string;
  state: string;
  city: string | null;
  county: string | null;
  fips_place: string | null;

  website_url: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;

  reviewer_contacts: ReviewerContact[];

  base_permit_fee: number;
  plan_review_fee: number;
  inspection_fee: number;
  fee_notes: string | null;
  fee_schedule_url: string | null;

  plan_review_sla_days: number | null;
  permit_issuance_sla_days: number | null;
  inspection_sla_days: number | null;
  avg_review_days_actual: number | null;
  avg_issuance_days_actual: number | null;
  expedited_available: boolean;
  expedited_fee_multiplier: number;

  residential_units_2024: number | null;
  sf_1unit_units_2024: number | null;
  duplex_units_2024: number | null;
  mf_3plus_units_2024: number | null;
  commercial_permits_2024: number | null;
  total_permits_2024: number | null;
  is_high_volume: boolean;

  permit_portal_url: string | null;
  data_source: string | null;

  submission_methods: string[] | null;
  accepted_file_formats: string[] | null;
  special_requirements: string | null;
  notes: string | null;

  is_active: boolean;
  last_verified_at: string | null;
  verified_by: string | null;

  created_at: string;
  updated_at: string;
}

export type CreateJurisdictionData = Omit<Jurisdiction, 'id' | 'created_at' | 'updated_at'>;
export type UpdateJurisdictionData = Partial<CreateJurisdictionData>;

export type CoverageRequestRow = Database['public']['Tables']['coverage_requests']['Row'];
export type CoverageRequestStatus = 'pending' | 'reviewed' | 'added' | 'dismissed';

export const COVERAGE_REQUEST_STATUSES: CoverageRequestStatus[] = [
  'pending',
  'reviewed',
  'added',
  'dismissed',
];

export interface CoverageRequestPrefill {
  name: string;
  state: string;
  city: string | null;
  county: string | null;
  notes: string | null;
  coverageRequestId: string;
}

export function parseReviewerContacts(value: JurisdictionRow['reviewer_contacts']): ReviewerContact[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ReviewerContact =>
      typeof item === 'object' &&
      item !== null &&
      'name' in item &&
      typeof (item as ReviewerContact).name === 'string',
  );
}

export function rowToJurisdiction(row: JurisdictionRow): Jurisdiction {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    city: row.city,
    county: row.county,
    fips_place: row.fips_place,
    website_url: row.website_url,
    phone: row.phone,
    email: row.email,
    address: row.address,
    reviewer_contacts: parseReviewerContacts(row.reviewer_contacts),
    base_permit_fee: row.base_permit_fee ?? 0,
    plan_review_fee: row.plan_review_fee ?? 0,
    inspection_fee: row.inspection_fee ?? 0,
    fee_notes: row.fee_notes,
    fee_schedule_url: row.fee_schedule_url,
    plan_review_sla_days: row.plan_review_sla_days,
    permit_issuance_sla_days: row.permit_issuance_sla_days,
    inspection_sla_days: row.inspection_sla_days,
    avg_review_days_actual: row.avg_review_days_actual,
    avg_issuance_days_actual: row.avg_issuance_days_actual,
    expedited_available: row.expedited_available ?? false,
    expedited_fee_multiplier: row.expedited_fee_multiplier ?? 1.5,
    residential_units_2024: row.residential_units_2024,
    sf_1unit_units_2024: row.sf_1unit_units_2024,
    duplex_units_2024: row.duplex_units_2024,
    mf_3plus_units_2024: row.mf_3plus_units_2024,
    commercial_permits_2024: row.commercial_permits_2024,
    total_permits_2024: row.total_permits_2024,
    is_high_volume: row.is_high_volume ?? false,
    permit_portal_url: row.permit_portal_url,
    data_source: row.data_source,
    submission_methods: row.submission_methods,
    accepted_file_formats: row.accepted_file_formats,
    special_requirements: row.special_requirements,
    notes: row.notes,
    is_active: row.is_active ?? true,
    last_verified_at: row.last_verified_at,
    verified_by: row.verified_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function jurisdictionToInsert(data: CreateJurisdictionData): JurisdictionInsert {
  const residential = data.residential_units_2024 ?? 0;
  return {
    name: data.name,
    state: data.state,
    city: data.city,
    county: data.county,
    fips_place: data.fips_place,
    website_url: data.website_url,
    phone: data.phone,
    email: data.email,
    address: data.address,
    reviewer_contacts: data.reviewer_contacts,
    base_permit_fee: data.base_permit_fee,
    plan_review_fee: data.plan_review_fee,
    inspection_fee: data.inspection_fee,
    fee_notes: data.fee_notes,
    fee_schedule_url: data.fee_schedule_url,
    plan_review_sla_days: data.plan_review_sla_days,
    permit_issuance_sla_days: data.permit_issuance_sla_days,
    inspection_sla_days: data.inspection_sla_days,
    avg_review_days_actual: data.avg_review_days_actual,
    avg_issuance_days_actual: data.avg_issuance_days_actual,
    expedited_available: data.expedited_available,
    expedited_fee_multiplier: data.expedited_fee_multiplier,
    residential_units_2024: data.residential_units_2024,
    sf_1unit_units_2024: data.sf_1unit_units_2024,
    duplex_units_2024: data.duplex_units_2024,
    mf_3plus_units_2024: data.mf_3plus_units_2024,
    commercial_permits_2024: data.commercial_permits_2024,
    total_permits_2024: data.total_permits_2024,
    is_high_volume: residential >= 1000,
    permit_portal_url: data.permit_portal_url,
    data_source: data.data_source,
    submission_methods: data.submission_methods,
    accepted_file_formats: data.accepted_file_formats,
    special_requirements: data.special_requirements,
    notes: data.notes,
    is_active: data.is_active,
    last_verified_at: data.last_verified_at,
    verified_by: data.verified_by,
  };
}

export function jurisdictionToUpdate(data: UpdateJurisdictionData): JurisdictionUpdate {
  const payload: JurisdictionUpdate = { ...data, reviewer_contacts: data.reviewer_contacts };
  if (data.residential_units_2024 !== undefined) {
    payload.is_high_volume = (data.residential_units_2024 ?? 0) >= 1000;
  }
  return payload;
}

export function createDefaultJurisdictionFormData(
  overrides: Partial<CreateJurisdictionData> = {},
): CreateJurisdictionData {
  return {
    name: '',
    state: '',
    city: null,
    county: null,
    fips_place: null,
    website_url: null,
    phone: null,
    email: null,
    address: null,
    reviewer_contacts: [],
    base_permit_fee: 0,
    plan_review_fee: 0,
    inspection_fee: 0,
    fee_notes: null,
    fee_schedule_url: null,
    plan_review_sla_days: null,
    permit_issuance_sla_days: null,
    inspection_sla_days: null,
    avg_review_days_actual: null,
    avg_issuance_days_actual: null,
    expedited_available: false,
    expedited_fee_multiplier: 1.5,
    residential_units_2024: null,
    sf_1unit_units_2024: null,
    duplex_units_2024: null,
    mf_3plus_units_2024: null,
    commercial_permits_2024: null,
    total_permits_2024: null,
    is_high_volume: false,
    permit_portal_url: null,
    data_source: null,
    submission_methods: [],
    accepted_file_formats: [],
    special_requirements: null,
    notes: null,
    is_active: true,
    last_verified_at: null,
    verified_by: null,
    ...overrides,
  };
}

export function jurisdictionToFormData(jurisdiction: Jurisdiction): CreateJurisdictionData {
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = jurisdiction;
  return rest;
}

export function isJurisdictionVerified(jurisdiction: Pick<Jurisdiction, 'last_verified_at'>): boolean {
  return Boolean(jurisdiction.last_verified_at);
}

export const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

export const SUBMISSION_METHODS = [
  'online',
  'in-person',
  'mail',
  'email',
  'fax',
];

export const FILE_FORMATS = [
  'pdf',
  'dwg',
  'dxf',
  'rvt',
  'ifc',
  'jpg',
  'png',
  'tiff',
];
