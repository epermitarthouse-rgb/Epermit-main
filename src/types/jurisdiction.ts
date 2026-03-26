export interface ReviewerContact {
  name: string;
  title: string;
  email: string;
  phone: string;
}

export interface Jurisdiction {
  id: string;
  name: string;
  state: string;
  city: string | null;
  county: string | null;
  
  // Contact info
  website_url: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  
  // Reviewer contacts
  reviewer_contacts: ReviewerContact[];
  
  // Fee structure
  base_permit_fee: number;
  plan_review_fee: number;
  inspection_fee: number;
  fee_notes: string | null;
  fee_schedule_url: string | null;
  
  // SLA / Processing times
  plan_review_sla_days: number | null;
  permit_issuance_sla_days: number | null;
  inspection_sla_days: number | null;
  expedited_available: boolean;
  expedited_fee_multiplier: number;
  
  // Additional info
  submission_methods: string[] | null;
  accepted_file_formats: string[] | null;
  special_requirements: string | null;
  notes: string | null;
  
  // Status
  is_active: boolean;
  last_verified_at: string | null;
  verified_by: string | null;
  
  created_at: string;
  updated_at: string;
}

export type CreateJurisdictionData = Omit<Jurisdiction, 'id' | 'created_at' | 'updated_at'>;
export type UpdateJurisdictionData = Partial<CreateJurisdictionData>;

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
