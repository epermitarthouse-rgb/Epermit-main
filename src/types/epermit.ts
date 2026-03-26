export type EPermitSystem = 'accela' | 'cityview';
export type EPermitEnvironment = 'sandbox' | 'production';

export interface EPermitCredentials {
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  agencyId?: string;
  baseUrl?: string;
}

export interface EPermitApplicationData {
  permitType: string;
  projectName: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  description: string;
  estimatedValue?: number;
  squareFootage?: number;
  applicantName: string;
  applicantEmail: string;
  applicantPhone?: string;
  contractorLicense?: string;
}

export interface EPermitSubmission {
  projectId: string;
  system: EPermitSystem;
  environment: EPermitEnvironment;
  credentials: EPermitCredentials;
  applicationData: EPermitApplicationData;
  documents?: {
    name: string;
    type: string;
    url: string;
  }[];
}

export interface EPermitSubmissionResult {
  success: boolean;
  system: EPermitSystem;
  recordId?: string;
  trackingNumber?: string;
  status: string;
  submittedAt: string;
  message?: string;
  estimatedReviewTime?: string;
  error?: string;
}

export interface EPermitConfig {
  system: EPermitSystem;
  environment: EPermitEnvironment;
  credentials: EPermitCredentials;
  isConfigured: boolean;
  lastValidated?: string;
}

// Common permit types for different jurisdictions
export const PERMIT_TYPES = {
  accela: [
    { value: 'Building/Residential/New', label: 'Residential - New Construction' },
    { value: 'Building/Residential/Addition', label: 'Residential - Addition' },
    { value: 'Building/Residential/Alteration', label: 'Residential - Alteration' },
    { value: 'Building/Commercial/New', label: 'Commercial - New Construction' },
    { value: 'Building/Commercial/TenantImprovement', label: 'Commercial - Tenant Improvement' },
    { value: 'Building/Commercial/Demolition', label: 'Demolition' },
  ],
  cityview: [
    { value: 'RES-NEW', label: 'Residential - New Construction' },
    { value: 'RES-ADD', label: 'Residential - Addition' },
    { value: 'RES-ALT', label: 'Residential - Alteration' },
    { value: 'COM-NEW', label: 'Commercial - New Construction' },
    { value: 'COM-TI', label: 'Commercial - Tenant Improvement' },
    { value: 'DEM', label: 'Demolition' },
  ],
} as const;

// Sample agency configurations for reference
export const SAMPLE_AGENCIES = {
  accela: [
    { name: 'City of San Francisco', agencyId: 'SFGOV', baseUrl: 'https://apis.accela.com/v4' },
    { name: 'City of Los Angeles', agencyId: 'LADBS', baseUrl: 'https://apis.accela.com/v4' },
    { name: 'City of San Diego', agencyId: 'SANDIEGO', baseUrl: 'https://apis.accela.com/v4' },
  ],
  cityview: [
    { name: 'City of Seattle', baseUrl: 'https://web6.seattle.gov/dpd/edms' },
    { name: 'City of Phoenix', baseUrl: 'https://phoenix.gov/pdd/cityview' },
  ],
} as const;
