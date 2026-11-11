import { supabase } from '@/lib/supabase';
import { assertPermitWritesAllowed } from '@/lib/localPermitInspection';

/**
 * Data access for the central permit repository (/permit-queue, /admin/permit-sync).
 * Every read goes through RLS (permits are visible only via user_can_read_permit); admin actions are
 * audited SECURITY DEFINER RPCs that re-check platform admin server-side.
 * The generated Supabase types predate these tables, so queries use a narrow structural client.
 */

type QueryError = { message?: string; code?: string };
type QueryResult<T> = { data: T | null; error: QueryError | null; count?: number | null };

interface FilterBuilder<T> extends PromiseLike<QueryResult<T[]>> {
  eq(column: string, value: unknown): FilterBuilder<T>;
  in(column: string, values: readonly unknown[]): FilterBuilder<T>;
  is(column: string, value: null): FilterBuilder<T>;
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): FilterBuilder<T>;
  limit(n: number): FilterBuilder<T>;
  range(from: number, to: number): FilterBuilder<T>;
  maybeSingle(): PromiseLike<QueryResult<T>>;
}

export interface CentralPermitsClient {
  from(table: string): { select(columns: string): FilterBuilder<Record<string, unknown>> };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<QueryResult<unknown>>;
  storage?: {
    from(bucket: string): {
      createSignedUrl(path: string, expiresIn: number): PromiseLike<{ data: { signedUrl: string } | null; error: QueryError | null }>;
    };
  };
}

let clientOverride: CentralPermitsClient | null = null;

export const __centralPermitsTestHooks = {
  setClient(client: CentralPermitsClient | null) {
    clientOverride = client;
  },
};

function client(): CentralPermitsClient {
  return clientOverride ?? (supabase as unknown as CentralPermitsClient);
}

function unwrap<T>(res: QueryResult<T>, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? 'request failed'}`);
  return res.data as T;
}

type Row = Record<string, unknown>;
type OrderSpec = Array<[string, boolean]>;

/** PostgREST caps a response (1000 rows on Supabase), so reads that must be complete page explicitly. */
export const READ_PAGE_SIZE = 1000;

async function fetchAllRows(
  table: string,
  opts: { columns?: string; filter: (q: FilterBuilder<Row>) => FilterBuilder<Row>; order: OrderSpec; pageSize?: number },
): Promise<Row[]> {
  const pageSize = opts.pageSize ?? READ_PAGE_SIZE;
  const out: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    let q = opts.filter(client().from(table).select(opts.columns ?? '*'));
    for (const [col, ascending] of opts.order) q = q.order(col, { ascending, nullsFirst: false });
    const page = (unwrap(await q.range(from, from + pageSize - 1), table) as Row[] | null) ?? [];
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}

export type SectionStatus = 'ok' | 'partial' | 'absent' | 'failed' | 'suspect_empty';

export interface PermitListRow {
  id: string;
  adapter_key: string;
  jurisdiction: string | null;
  permit_number: string;
  title: string | null;
  description: string | null;
  address: string | null;
  status: string | null;
  status_raw: string | null;
  review_type: string | null;
  unresolved_comments: number | null;
  uncompleted_tasks: number | null;
  last_synced_at: string | null;
  last_changed_at: string | null;
  removed_from_portal_at: string | null;
  matched_in: 'permit_number' | 'permit' | 'comments' | null;
  total_count: number;
}

export interface PermitSearchParams {
  query?: string;
  status?: string | null;
  jurisdiction?: string | null;
  includeRemoved?: boolean;
  limit?: number;
  offset?: number;
}

export const PERMIT_PAGE_SIZE = 25;

export async function searchPermits(params: PermitSearchParams): Promise<{ rows: PermitListRow[]; total: number }> {
  const res = await client().rpc('search_permits', {
    p_query: params.query?.trim() || null,
    p_status: params.status || null,
    p_jurisdiction: params.jurisdiction || null,
    p_include_removed: Boolean(params.includeRemoved),
    p_limit: params.limit ?? PERMIT_PAGE_SIZE,
    p_offset: params.offset ?? 0,
  });
  const rows = (unwrap(res, 'search_permits') as PermitListRow[] | null) ?? [];
  return { rows, total: rows.length ? Number(rows[0].total_count) : 0 };
}

// ---- Permit Queue (D-064) ---------------------------------------------------

/** search_permits caps one call at 200 rows. */
export const SEARCH_PAGE_LIMIT = 200;
const QUEUE_MAX_ROWS = 5000;

export interface PermitQueueData {
  rows: PermitListRow[];
  /** permit id → number of linked projects the caller can see links for. */
  linkCounts: Map<string, number>;
  /** Set when project links could not be read; the list still loads. */
  linkError: string | null;
}

/**
 * Every permit matching the search (paged through search_permits), plus the project link counts.
 * Source and linked filters are applied in the browser because search_permits has no such parameters
 * and the schema is not changed for the UI.
 */
export async function loadPermitQueue(params: Pick<PermitSearchParams, 'query' | 'status' | 'includeRemoved'>): Promise<PermitQueueData> {
  const rows: PermitListRow[] = [];
  for (let offset = 0; offset < QUEUE_MAX_ROWS; offset += SEARCH_PAGE_LIMIT) {
    const page = await searchPermits({ ...params, limit: SEARCH_PAGE_LIMIT, offset });
    rows.push(...page.rows);
    if (page.rows.length < SEARCH_PAGE_LIMIT || rows.length >= page.total) break;
  }
  const linkCounts = new Map<string, number>();
  let linkError: string | null = null;
  try {
    const links = await fetchAllRows('project_permits', {
      columns: 'permit_id, project_id',
      filter: (q) => q,
      order: [['permit_id', true], ['project_id', true]],
    });
    for (const l of links) linkCounts.set(String(l.permit_id), (linkCounts.get(String(l.permit_id)) ?? 0) + 1);
  } catch (e) {
    linkError = e instanceof Error ? e.message : String(e);
  }
  return { rows, linkCounts, linkError };
}

/** Private bucket for deep-capture binaries (D-058); objects are readable only through storage RLS. */
export const PERMIT_DOCUMENTS_BUCKET = 'permit-documents';
export const PERMIT_OBJECT_URL_TTL_SECONDS = 300;

/** Short-lived signed URL for a stored file or report export. Storage RLS decides whether it is issued. */
export async function createPermitObjectSignedUrl(path: string): Promise<string> {
  if (!path) throw new Error('No stored copy');
  const storage = client().storage;
  if (!storage) throw new Error('Storage is not available');
  const res = await storage.from(PERMIT_DOCUMENTS_BUCKET).createSignedUrl(path, PERMIT_OBJECT_URL_TTL_SECONDS);
  if (res.error || !res.data?.signedUrl) throw new Error(`Could not open the stored copy: ${res.error?.message ?? 'not available'}`);
  return res.data.signedUrl;
}

/**
 * True when PostgREST says a table or column does not exist (deep-capture migration not applied).
 * PGRST205 / 42P01: unknown table; PGRST204 / 42703: unknown column.
 */
export function isMissingSchemaError(error: QueryError | null | undefined): boolean {
  if (!error) return false;
  if (error.code && ['PGRST205', 'PGRST204', '42P01', '42703'].includes(error.code)) return true;
  return /does not exist|schema cache/i.test(error.message ?? '');
}

const REPORT_VERSION_COLUMNS = 'id, permit_id, report_key, version, source, pdf_storage_path, excel_storage_path, captured_at';

/** One stored report version (text, structured rows, export paths). null when absent or the table is missing. */
export async function loadReportContent(contentId: string): Promise<Row | null> {
  if (!contentId) return null;
  const res = await client().from('permit_report_contents').select('*').eq('id', contentId).maybeSingle();
  if (isMissingSchemaError(res.error)) return null;
  return (unwrap(res, 'permit_report_contents') as Row | null) ?? null;
}

/** Stored versions of one report, newest first. Empty when the table is missing. */
export async function listReportContentVersions(permitId: string, reportKey: string): Promise<Row[]> {
  if (!permitId || !reportKey) return [];
  const res = await client()
    .from('permit_report_contents')
    .select(REPORT_VERSION_COLUMNS)
    .eq('permit_id', permitId)
    .eq('report_key', reportKey)
    .order('version', { ascending: false })
    .limit(50);
  if (isMissingSchemaError(res.error)) return [];
  return (unwrap(res, 'permit_report_contents') as Row[] | null) ?? [];
}

export interface PermitDetail {
  permit: Record<string, unknown>;
  sections: Record<string, unknown>[];
  comments: Record<string, unknown>[];
  responses: Record<string, unknown>[];
  workflows: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  folders: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  reports: Record<string, unknown>[];
  changes: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  snapshots: Record<string, unknown>[];
}

const DETAIL_CHILDREN: Array<[keyof Omit<PermitDetail, 'permit' | 'changes'>, string, OrderSpec]> = [
  ['sections', 'permit_section_state', [['section', true]]],
  ['comments', 'permit_review_comments', [['cycle', true], ['ref_number', true], ['id', true]]],
  ['responses', 'permit_review_responses', [['seq', true], ['id', true]]],
  ['workflows', 'permit_workflows', [['started_at', false], ['id', true]]],
  ['tasks', 'permit_tasks', [['started_at', false], ['id', true]]],
  ['folders', 'permit_document_folders', [['name', true], ['id', true]]],
  ['documents', 'permit_documents', [['folder_name', true], ['file_name', true], ['id', true]]],
  ['reports', 'permit_reports', [['name', true], ['id', true]]],
  ['sources', 'permit_source_links', [['last_seen_at', false], ['credential_id', true]]],
  ['snapshots', 'permit_snapshots', [['captured_at', false], ['id', true]]],
];

/** Returns null when the permit does not exist or the caller cannot read it (RLS hides both alike). */
export async function loadPermitDetail(permitId: string): Promise<PermitDetail | null> {
  const c = client();
  const permitRes = await c.from('permits').select('*').eq('id', permitId).maybeSingle();
  const permit = unwrap(permitRes, 'permits');
  if (!permit) return null;

  const children = await Promise.all(
    DETAIL_CHILDREN.map(([, table, order]) =>
      fetchAllRows(table, { filter: (q) => q.eq('permit_id', permitId), order, pageSize: table === 'permit_snapshots' ? 50 : undefined }),
    ),
  );
  const changesRes = await c
    .from('permit_changes')
    .select('id, section, entity_table, entity_key, change_type, field_changes, detected_at')
    .eq('permit_id', permitId)
    .order('detected_at', { ascending: false })
    .limit(200);

  const detail = { permit, changes: (unwrap(changesRes, 'permit_changes') as Record<string, unknown>[] | null) ?? [] } as PermitDetail;
  DETAIL_CHILDREN.forEach(([key], i) => {
    detail[key] = children[i];
  });
  return detail;
}

export type Freshness = 'fresh' | 'stale' | 'never';

/** Daily sync target: older than 36 h is stale. */
export function permitFreshness(lastSyncedAt: string | null | undefined, now: Date = new Date()): Freshness {
  if (!lastSyncedAt) return 'never';
  const t = Date.parse(lastSyncedAt);
  if (!Number.isFinite(t)) return 'never';
  return now.getTime() - t > 36 * 3600 * 1000 ? 'stale' : 'fresh';
}

export function sectionTone(status: string | null | undefined): 'good' | 'warn' | 'bad' | 'default' {
  if (status === 'ok') return 'good';
  if (status === 'partial' || status === 'suspect_empty') return 'warn';
  if (status === 'failed') return 'bad';
  return 'default';
}

export const SECTION_LABELS: Record<string, string> = {
  status: 'Status',
  workflows: 'Workflows',
  tasks: 'Tasks',
  files: 'Files',
  reviews: 'Reviews',
  info: 'Info',
  reports: 'Reports',
};

export function sectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? section;
}

/** Visible rows only: soft-removed portal rows are history, not current state. */
export function currentRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.filter((r) => !r.removed_at);
}

// ---- Management Admin -------------------------------------------------------

export async function listSyncSources(): Promise<Record<string, unknown>[]> {
  const res = await client().from('permit_sync_sources').select('*').order('updated_at', { ascending: false });
  return (unwrap(res, 'permit_sync_sources') as Record<string, unknown>[] | null) ?? [];
}

export async function listSyncJobs(limit = 50): Promise<Record<string, unknown>[]> {
  const res = await client().from('permit_sync_jobs').select('*').order('created_at', { ascending: false }).limit(limit);
  return (unwrap(res, 'permit_sync_jobs') as Record<string, unknown>[] | null) ?? [];
}

export async function listSyncEvents(jobId: string): Promise<Record<string, unknown>[]> {
  const res = await client().from('permit_sync_events').select('*').eq('job_id', jobId).order('id', { ascending: true }).limit(500);
  return (unwrap(res, 'permit_sync_events') as Record<string, unknown>[] | null) ?? [];
}

export async function listAccessGrants(): Promise<Record<string, unknown>[]> {
  const res = await client().from('permit_access_grants').select('*').is('revoked_at', null).order('created_at', { ascending: false });
  return (unwrap(res, 'permit_access_grants') as Record<string, unknown>[] | null) ?? [];
}

export async function requestPermitSync(credentialId: string): Promise<string> {
  assertPermitWritesAllowed('admin_request_permit_sync');
  return unwrap(await client().rpc('admin_request_permit_sync', { p_credential_id: credentialId }), 'admin_request_permit_sync') as string;
}

export async function cancelPermitSyncJob(jobId: string): Promise<void> {
  assertPermitWritesAllowed('admin_cancel_permit_sync_job');
  unwrap(await client().rpc('admin_cancel_permit_sync_job', { p_job_id: jobId }), 'admin_cancel_permit_sync_job');
}

export async function resumePermitSyncSource(credentialId: string): Promise<void> {
  assertPermitWritesAllowed('admin_resume_permit_sync_source');
  unwrap(await client().rpc('admin_resume_permit_sync_source', { p_credential_id: credentialId }), 'admin_resume_permit_sync_source');
}

export type GrantScope = 'permit' | 'adapter' | 'source_credential';

export async function grantPermitAccess(input: {
  scope: GrantScope;
  scopeRef: string;
  granteeUserId?: string | null;
  granteeTenantId?: string | null;
  note?: string | null;
}): Promise<string> {
  assertPermitWritesAllowed('admin_grant_permit_access');
  if (!input.granteeUserId === !input.granteeTenantId) {
    throw new Error('Choose exactly one grantee: a user or a tenant');
  }
  const res = await client().rpc('admin_grant_permit_access', {
    p_scope_type: input.scope,
    p_scope_ref: input.scopeRef.trim(),
    p_grantee_user_id: input.granteeUserId || null,
    p_grantee_tenant_id: input.granteeTenantId || null,
    p_note: input.note?.trim() || null,
  });
  return unwrap(res, 'admin_grant_permit_access') as string;
}

export async function revokePermitAccess(grantId: string): Promise<void> {
  assertPermitWritesAllowed('admin_revoke_permit_access');
  unwrap(await client().rpc('admin_revoke_permit_access', { p_grant_id: grantId }), 'admin_revoke_permit_access');
}

/**
 * Project ↔ permit links (P3.5 / R-1). A link grants no data access (D-006): it only lets a project
 * point at its permit record and a permit list the projects it is linked to. Reads go through RLS:
 * a link is visible only when the caller can read the permit, and a project's name only when the
 * caller can read that project.
 */
export interface ProjectPermitLink {
  permit_id: string;
  permit_number: string;
  jurisdiction: string | null;
  status_raw: string | null;
  last_synced_at: string | null;
}

export async function loadProjectPermitLink(projectId: string): Promise<ProjectPermitLink | null> {
  if (!projectId) return null;
  const c = client();
  const link = unwrap(
    await c.from('project_permits').select('permit_id').eq('project_id', projectId).maybeSingle(),
    'project_permits',
  ) as { permit_id: string } | null;
  if (!link) return null;
  const permit = unwrap(
    await c.from('permits').select('id, permit_number, jurisdiction, status_raw, last_synced_at').eq('id', link.permit_id).maybeSingle(),
    'permits',
  ) as Record<string, unknown> | null;
  if (!permit) return null;
  return {
    permit_id: String(permit.id),
    permit_number: String(permit.permit_number ?? ''),
    jurisdiction: (permit.jurisdiction as string | null) ?? null,
    status_raw: (permit.status_raw as string | null) ?? null,
    last_synced_at: (permit.last_synced_at as string | null) ?? null,
  };
}

export interface PermitProjectLink {
  project_id: string;
  created_at: string | null;
  /** null when the caller cannot read the project (RLS hides the embedded row). */
  project_name: string | null;
}

export async function listPermitProjectLinks(permitId: string): Promise<PermitProjectLink[]> {
  if (!permitId) return [];
  const res = await client()
    .from('project_permits')
    .select('project_id, created_at, projects(id, name)')
    .eq('permit_id', permitId)
    .order('created_at', { ascending: true });
  const rows = (unwrap(res, 'project_permits') as Record<string, unknown>[] | null) ?? [];
  return rows.map((r) => {
    const project = (r.projects as { name?: string | null } | null) ?? null;
    return {
      project_id: String(r.project_id),
      created_at: (r.created_at as string | null) ?? null,
      project_name: project?.name ?? null,
    };
  });
}

/** Management Admin only; the RPC re-checks platform admin and writes an audit event. */
export async function linkProjectToPermit(projectId: string, permitId: string): Promise<void> {
  if (!projectId || !permitId) throw new Error('linkProjectToPermit: project and permit are required');
  assertPermitWritesAllowed('admin_link_project_permit');
  unwrap(await client().rpc('admin_link_project_permit', { p_project_id: projectId, p_permit_id: permitId }), 'admin_link_project_permit');
}

export async function unlinkProjectFromPermit(projectId: string, permitId: string): Promise<void> {
  if (!projectId || !permitId) throw new Error('unlinkProjectFromPermit: project and permit are required');
  assertPermitWritesAllowed('admin_unlink_project_permit');
  unwrap(await client().rpc('admin_unlink_project_permit', { p_project_id: projectId, p_permit_id: permitId }), 'admin_unlink_project_permit');
}

export const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'retry_wait']);

// ---- Admin export (D-053) ---------------------------------------------------
// Built in the browser from the same RLS-scoped reads as the pages: no new function, policy or grant.

export interface PermitExportBundle {
  permit: Row;
  section_states: Row[];
  snapshots: Row[];
  changes: Row[];
  workflows: Row[];
  tasks: Row[];
  review_comments: Row[];
  review_responses: Row[];
  document_folders: Row[];
  documents: Row[];
  reports: Row[];
  source_links: Row[];
  jobs: Row[];
}

type BundleChildKey = Exclude<keyof PermitExportBundle, 'permit' | 'jobs'>;

const EXPORT_CHILDREN: Array<[BundleChildKey, string, OrderSpec, number?]> = [
  ['section_states', 'permit_section_state', [['permit_id', true], ['section', true]]],
  ['snapshots', 'permit_snapshots', [['id', true]], 25],
  ['changes', 'permit_changes', [['id', true]]],
  ['workflows', 'permit_workflows', [['id', true]]],
  ['tasks', 'permit_tasks', [['id', true]]],
  ['review_comments', 'permit_review_comments', [['id', true]]],
  ['review_responses', 'permit_review_responses', [['id', true]]],
  ['document_folders', 'permit_document_folders', [['id', true]]],
  ['documents', 'permit_documents', [['id', true]]],
  ['reports', 'permit_reports', [['id', true]]],
  ['source_links', 'permit_source_links', [['permit_id', true], ['credential_id', true]]],
];

const ID_CHUNK = 25;

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Server-side admin check before an export starts. `_admin_require_platform_admin()` is the existing
 * guard the admin RPCs use; it raises for anyone who is not a platform admin and writes nothing.
 * RLS stays the real boundary: a caller who skips this still reads only permits they may read.
 */
export async function assertPermitExportAllowed(): Promise<void> {
  const res = await client().rpc('_admin_require_platform_admin');
  if (res.error) throw new Error('Export is limited to platform admins');
}

export async function listExportPermits(adapterKey = 'dc-projectdox'): Promise<Row[]> {
  return fetchAllRows('permits', {
    columns: 'id, permit_number, portal_record_id',
    filter: (q) => q.eq('adapter_key', adapterKey),
    order: [['permit_number', true], ['id', true]],
  });
}

/** Every stored row for the given permits, complete (paged), grouped per permit. Unreadable permits are dropped. */
export async function loadPermitExportBundles(permitIds: string[]): Promise<PermitExportBundle[]> {
  const ids = [...new Set(permitIds.filter(Boolean))];
  if (!ids.length) return [];
  const permits: Row[] = [];
  for (const part of chunks(ids, ID_CHUNK)) {
    permits.push(...(await fetchAllRows('permits', { filter: (q) => q.in('id', part), order: [['id', true]] })));
  }
  const readable = permits.map((p) => String(p.id));
  const children = {} as Record<BundleChildKey, Row[]>;
  for (const [key, table, order, pageSize] of EXPORT_CHILDREN) {
    children[key] = [];
    for (const part of chunks(readable, ID_CHUNK)) {
      children[key].push(...(await fetchAllRows(table, { filter: (q) => q.in('permit_id', part), order, pageSize })));
    }
  }
  const runIds = [...new Set(children.snapshots.map((s) => s.run_id).filter(Boolean).map(String))];
  const jobs: Row[] = [];
  for (const part of chunks(runIds, ID_CHUNK)) {
    jobs.push(...(await fetchAllRows('permit_sync_jobs', {
      columns: 'id, credential_id, adapter_key, trigger, status, attempt_count, error_code, last_error, metrics, started_at, completed_at, created_at',
      filter: (q) => q.in('id', part),
      order: [['id', true]],
    })));
  }

  const order = new Map(ids.map((id, i) => [id, i]));
  return permits
    .sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0))
    .map((permit) => {
      const pid = String(permit.id);
      const bundle = { permit } as PermitExportBundle;
      for (const [key] of EXPORT_CHILDREN) bundle[key] = children[key].filter((r) => String(r.permit_id) === pid);
      const permitRuns = new Set(bundle.snapshots.map((s) => String(s.run_id ?? '')));
      bundle.jobs = jobs.filter((j) => permitRuns.has(String(j.id)));
      return bundle;
    });
}
