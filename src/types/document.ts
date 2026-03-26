export type DocumentType = 
  | 'permit_drawing'
  | 'submittal_package'
  | 'structural_calcs'
  | 'site_plan'
  | 'floor_plan'
  | 'elevation'
  | 'specification'
  | 'inspection_report'
  | 'correspondence'
  | 'other';

export type DocumentDiscipline = 
  | 'general'
  | 'architectural'
  | 'fire'
  | 'electrical'
  | 'mechanical'
  | 'plumbing'
  | 'zoning'
  | 'green'
  | 'civil'
  | 'stormwater'
  | 'utilities'
  | 'structural';

export interface ProjectDocument {
  id: string;
  project_id: string;
  user_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  document_type: DocumentType;
  discipline?: DocumentDiscipline;
  version: number;
  parent_document_id: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  permit_drawing: 'Permit Drawing',
  submittal_package: 'Submittal Package',
  structural_calcs: 'Structural Calculations',
  site_plan: 'Site Plan',
  floor_plan: 'Floor Plan',
  elevation: 'Elevation',
  specification: 'Specification',
  inspection_report: 'Inspection Report',
  correspondence: 'Correspondence',
  other: 'Other',
};

export const DOCUMENT_TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: 'permit_drawing', label: 'Permit Drawing' },
  { value: 'submittal_package', label: 'Submittal Package' },
  { value: 'structural_calcs', label: 'Structural Calculations' },
  { value: 'site_plan', label: 'Site Plan' },
  { value: 'floor_plan', label: 'Floor Plan' },
  { value: 'elevation', label: 'Elevation' },
  { value: 'specification', label: 'Specification' },
  { value: 'inspection_report', label: 'Inspection Report' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'other', label: 'Other' },
];

export const DISCIPLINE_LABELS: Record<DocumentDiscipline, string> = {
  general: 'General',
  architectural: 'Architectural',
  fire: 'Fire Protection',
  electrical: 'Electrical',
  mechanical: 'Mechanical',
  plumbing: 'Plumbing',
  zoning: 'Zoning',
  green: 'Green / Sustainability',
  civil: 'Civil',
  stormwater: 'DOEE Stormwater Management',
  utilities: 'Utilities',
  structural: 'Structural',
};

export const DISCIPLINE_OPTIONS: { value: DocumentDiscipline; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'architectural', label: 'Architectural' },
  { value: 'fire', label: 'Fire Protection' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'mechanical', label: 'Mechanical' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'zoning', label: 'Zoning' },
  { value: 'green', label: 'Green / Sustainability' },
  { value: 'civil', label: 'Civil' },
  { value: 'stormwater', label: 'DOEE Stormwater Management' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'structural', label: 'Structural' },
];

// Max file size: 50MB
export const MAX_FILE_SIZE_MB = 50;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
