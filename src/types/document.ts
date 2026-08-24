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
  | 'code_modification_application'
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
  | 'structural'
  | 'demolition';

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
  ai_ingestion_status?: AiIngestionStatus | null;
  ai_ingested_at?: string | null;
  ai_ingestion_error?: string | null;
  ai_chunk_count?: number | null;
}

export type AiIngestionStatus =
  | 'not_started'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'low_text'
  | 'unsupported'
  | 'partial';

export type ProjectDocumentUploadStep = 'auth' | 'validation' | 'storage' | 'database';

export type ProjectDocumentUploadSubstep =
  | 'file_read'
  | 'storage_upload'
  | 'database_insert'
  | 'activity_log';

export interface ProjectDocumentUploadResult {
  document: ProjectDocument | null;
  error?: string;
  step?: ProjectDocumentUploadStep;
  substep?: ProjectDocumentUploadSubstep;
  /** Last sub-step active when the upload aborted or timed out. */
  hungSubstep?: ProjectDocumentUploadSubstep;
}

export const AI_INGESTION_STATUS_LABELS: Record<AiIngestionStatus, string> = {
  not_started: 'Not prepared',
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Ready for AI',
  failed: 'Failed',
  low_text: 'OCR needed',
  unsupported: 'Unsupported',
  partial: 'Partial',
};

export type DocumentIngestionJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'cancelled';

export interface DocumentIngestionJob {
  id: string;
  project_id: string;
  document_id: string;
  user_id: string;
  status: DocumentIngestionJobStatus;
  progress: Record<string, unknown>;
  total_pages: number | null;
  processed_pages: number;
  failed_pages: number;
  total_chunks: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface IngestionProgressInfo {
  jobId: string;
  status: DocumentIngestionJobStatus | 'queued';
  phase?: string;
  currentPage?: number;
  processedPages?: number;
  totalPages?: number;
  totalChunks?: number;
  error?: string;
  updatedAt?: string;
  isStuck?: boolean;
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
  code_modification_application: 'Code Modification Application',
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
  { value: 'code_modification_application', label: 'Code Modification Application' },
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
  demolition: 'Demolition',
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
  { value: 'demolition', label: 'Demolition' },
];

const DOCUMENT_DISCIPLINE_VALUES = new Set<string>(
  DISCIPLINE_OPTIONS.map((option) => option.value),
);

/** Preserve stored analyzer disciplines; only unknown values fall back to General. */
export function coerceDocumentDiscipline(value: unknown): DocumentDiscipline {
  if (typeof value === 'string' && DOCUMENT_DISCIPLINE_VALUES.has(value)) {
    return value as DocumentDiscipline;
  }
  return 'general';
}

// Max file size for project document uploads (plan sets, submittals, etc.)
export const MAX_FILE_SIZE_MB = 250;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/** MIME types allowed by the project-documents storage bucket. */
export const PROJECT_DOCUMENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/dwg',
  'application/dxf',
  'application/zip',
  'application/x-zip-compressed',
] as const;

const PROJECT_DOCUMENT_EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  dwg: 'application/dwg',
  dxf: 'application/dxf',
  zip: 'application/zip',
};

const PROJECT_DOCUMENT_ALLOWED_SET = new Set<string>(PROJECT_DOCUMENT_ALLOWED_MIME_TYPES);

/**
 * Resolve a storage-safe content type for project document uploads.
 * Extension is preferred for DOCX because browsers often report application/zip.
 */
export function resolveProjectDocumentContentType(file: File): string | null {
  const lower = file.name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot + 1) : '';

  if (ext === 'docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }

  if (ext === 'doc') {
    return 'application/msword';
  }

  const declared = (file.type || '').trim().toLowerCase();
  if (declared && PROJECT_DOCUMENT_ALLOWED_SET.has(declared)) {
    return declared;
  }

  const fromExt = ext ? PROJECT_DOCUMENT_EXT_TO_MIME[ext] : undefined;
  if (fromExt) return fromExt;

  return null;
}

/**
 * Sanitize a user filename for Supabase Storage object keys.
 * Preserves extension; store the original name in project_documents.file_name.
 */
export function sanitizeStorageFileName(fileName: string): string {
  const normalized = fileName.replace(/[/\\]+/g, '_').trim();
  const lastDot = normalized.lastIndexOf('.');
  const hasExt = lastDot > 0 && lastDot < normalized.length - 1;
  const ext = hasExt
    ? normalized.slice(lastDot + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
  let stem = hasExt ? normalized.slice(0, lastDot) : normalized;

  stem = stem
    .replace(/[[\](){}]/g, '_')
    .replace(/&/g, '_and_')
    .replace(/'/g, '_')
    .replace(/,/g, '_')
    .replace(/[^a-zA-Z0-9.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!stem) {
    stem = 'document';
  }

  const maxStem = 200;
  if (stem.length > maxStem) {
    stem = stem.slice(0, maxStem).replace(/_+$/, '');
  }

  return ext ? `${stem}.${ext}` : stem;
}

/** Build a storage-safe project-documents object path; keeps original name for DB display. */
export function buildProjectDocumentStoragePath(
  userId: string,
  projectId: string,
  originalFileName: string,
  objectId: string = crypto.randomUUID(),
): { filePath: string; storageFileName: string; objectId: string } {
  const storageFileName = sanitizeStorageFileName(originalFileName);
  const filePath = `${userId}/${projectId}/${objectId}_${storageFileName}`;
  return { filePath, storageFileName, objectId };
}

export function formatCommentLetterSaveError(
  result: ProjectDocumentUploadResult,
): string {
  if (!result.error) {
    return 'Failed to save comment letter to project documents';
  }
  if (result.step === 'storage') {
    return result.error.startsWith('Failed during storage upload')
      ? result.error
      : `Failed during storage upload: ${result.error}`;
  }
  if (result.step === 'database') {
    return result.error.startsWith('Failed creating document record')
      ? result.error
      : `Failed creating document record: ${result.error}`;
  }
  if (result.step === 'validation') {
    return `Failed to save comment letter: ${result.error}`;
  }
  if (result.step === 'auth') {
    return `Failed to save comment letter: ${result.error}`;
  }
  return `Failed to save comment letter: ${result.error}`;
}

/** Map Supabase/storage errors to a user-friendly upload message. */
export function formatProjectDocumentUploadError(err: unknown): string {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: string }).message ?? "")
      : err instanceof Error
        ? err.message
        : String(err ?? "");

  if (/mime type.*not supported|invalid mime/i.test(msg)) {
    return 'Upload failed: this file type is not allowed for project documents. Use PDF, DOCX, PNG, JPG, or other supported plan/document formats.';
  }

  if (/invalid key|storage path was rejected|unsafe.*path/i.test(msg)) {
    return 'Upload failed: storage path was rejected. Filename has unsupported characters.';
  }

  if (/maximum|too large|413|payload|size limit|file_size_limit|entity too large/i.test(msg)) {
    return `Upload failed: the file may exceed the ${MAX_FILE_SIZE_MB}MB storage limit configured for this project. If the file is smaller, your Supabase storage bucket limit may need to be updated.`;
  }
  return msg.trim() || "Failed to upload document";
}
