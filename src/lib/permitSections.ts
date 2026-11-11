/**
 * The seven DC permit sections and how their extraction state is reported (D-052).
 * Shared by PermitDetailPage and the admin export, so the page and the files always agree.
 */

type Row = Record<string, unknown>;

export const PERMIT_SECTIONS = ['status', 'info', 'tasks', 'workflows', 'reviews', 'files', 'reports'] as const;
export type PermitSection = (typeof PERMIT_SECTIONS)[number];

/**
 * ok           captured completely on the last attempt
 * partial      captured, but the adapter or the database flagged it incomplete (partial / suspect_empty)
 * absent       the portal does not offer this section for this permit
 * inaccessible the portal refused or blocked the read (guard, session, auth, rate limit, no permission)
 * not_captured no capture is stored (never attempted, or failed for another reason)
 */
export type ExtractionStatus = 'ok' | 'partial' | 'absent' | 'inaccessible' | 'not_captured';

export const EXTRACTION_STATUS_LABEL: Record<ExtractionStatus, string> = {
  ok: 'Captured',
  partial: 'Captured, incomplete',
  absent: 'Absent on portal',
  inaccessible: 'Inaccessible / blocked',
  not_captured: 'Not captured',
};

const INACCESSIBLE_ERROR = /safety_violation|session_ended|auth_failed|rate_limited|not_permitted|forbidden|denied|blocked|inaccessible|\b40[13]\b|\b429\b/i;

export interface SectionClassification {
  status: ExtractionStatus;
  reason: string;
}

export function classifySectionState(state: Row | null | undefined): SectionClassification {
  if (!state) return { status: 'not_captured', reason: 'No extraction is recorded for this section.' };
  const db = String(state.status ?? '');
  const err = state.last_error ? String(state.last_error) : '';
  switch (db) {
    case 'ok':
      return { status: 'ok', reason: 'Captured on the last attempt.' };
    case 'absent':
      return { status: 'absent', reason: 'The portal does not offer this section for this permit.' };
    case 'partial':
    case 'suspect_empty':
      return { status: 'partial', reason: err || `Stored as ${db}: the capture may be incomplete.` };
    case 'failed':
      return INACCESSIBLE_ERROR.test(err)
        ? { status: 'inaccessible', reason: err }
        : { status: 'not_captured', reason: err || 'The last attempt failed; no complete capture.' };
    default:
      return { status: 'not_captured', reason: `Unknown stored status "${db}".` };
  }
}

/** Where each section is read from on the DC portal (adapters/dc-projectdox/routes.js, adapter.js). */
export const DC_SECTION_SOURCES: Record<PermitSection, string[]> = {
  status: ['GET api /WorkflowInstance/GetWorkflowInstanceStatusData'],
  info: ['GET ui /Project/ProjectInfo (HTML partial)'],
  tasks: ['GET api /WorkflowAggregate/GetActiveWorkflowTaskList', 'status capture: SubWorkflows[].UncompletedTasks'],
  workflows: ['GET api /WorkflowAggregate/GetWorkflowInstancesList'],
  reviews: [
    'GET api /WorkflowAggregate/GetProjectCorrectionsByCycleInstance (json)',
    'fallback: GET ui /WebForms/ReportViewer.aspx?ReportID=14 (report)',
  ],
  files: ['GET api /Folder/GetProjectFolders', 'GET api /File/GetFolderFiles'],
  reports: ['GET api /Report/GetReportList'],
};

export const DOCUMENTS_NOTE = 'Metadata only. Document binaries were not captured (D-014: the DC account has DownloadFile=false).';
export const REPORTS_NOTE =
  'Metadata only. The portal report list (report id, name, category) was captured; no report was opened, rendered or exported, so no report content is stored.';

export const DC_API_ORIGIN = 'https://washington-dc-us-projectdoxwebapi.avolvecloud.com';
export const DC_UI_ORIGIN = 'https://session.planreview.dob.dc.gov';

/** The portal page the record came from. Shown as text: a typed session URL ends a portal session. */
export function dcProjectPageUrl(portalRecordId: unknown): string {
  return `${DC_UI_ORIGIN}/Project/Index?ProjectID=${encodeURIComponent(String(portalRecordId ?? ''))}`;
}

/** Newest first; one section can have several snapshots (a new one only when the payload hash changes). */
export function snapshotsFor(snapshots: Row[], section: string): Row[] {
  return snapshots
    .filter((s) => s.section === section)
    .sort((a, b) => String(b.captured_at ?? '').localeCompare(String(a.captured_at ?? '')));
}

export function latestSnapshot(snapshots: Row[], section: string): Row | null {
  return snapshotsFor(snapshots, section)[0] ?? null;
}

export function sectionStateMap(states: Row[]): Map<string, Row> {
  return new Map(states.map((s) => [String(s.section), s]));
}

export const INFO_FIELD_LABELS: Array<[string, string]> = [
  ['statusRaw', 'Portal status'],
  ['description', 'Description'],
  ['address', 'Address'],
  ['jobClass', 'Job class'],
  ['ownerOrg', 'Owner organisation'],
  ['contactOrg', 'Contact organisation'],
  ['reviewCycle', 'Review cycle'],
  ['startDate', 'Project start'],
  ['endDate', 'Project end'],
  ['latitude', 'Latitude'],
  ['longitude', 'Longitude'],
];

function isPresent(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

export function infoFieldCount(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;
  return Object.values(payload as Row).filter(isPresent).length;
}

export function statusSubWorkflows(payload: unknown): Row[] {
  const list = payload && typeof payload === 'object' ? (payload as Row).SubWorkflows : null;
  return Array.isArray(list) ? (list as Row[]) : [];
}

/** Portal durations are `{Days, Hours, FormattedText}`; anything else is shown as compact JSON. */
export function formatPortalValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'object') {
    const o = v as Row;
    if (typeof o.FormattedText === 'string') return o.FormattedText.replace(/\s+/g, ' ').trim();
    return JSON.stringify(v);
  }
  return String(v);
}
