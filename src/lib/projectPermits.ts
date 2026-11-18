import { supabase } from '@/lib/supabase';
import { searchPermits, isMissingSchemaError, type PermitListRow } from '@/lib/centralPermits';
import { assertPermitWritesAllowed } from '@/lib/localPermitInspection';

/**
 * Project ↔ permit linking and comment processing state (D-110..D-116).
 * Editors link permits they can read (link_project_permits); a link grants no data access (D-006).
 * Processing state comes from get_comment_pipeline_overview, which only returns links the caller can
 * see on both sides. Generated Supabase types predate these objects, so a narrow structural client is used.
 */

type QueryError = { message?: string; code?: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };

interface FilterBuilder extends PromiseLike<QueryResult<Record<string, unknown>[]>> {
  eq(column: string, value: unknown): FilterBuilder;
  in(column: string, values: readonly unknown[]): FilterBuilder;
  not(column: string, operator: string, value: unknown): FilterBuilder;
  order(column: string, opts?: { ascending?: boolean }): FilterBuilder;
  limit(n: number): FilterBuilder;
}

export interface ProjectPermitsClient {
  from(table: string): { select(columns: string): FilterBuilder };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<QueryResult<unknown>>;
  functions?: {
    invoke(name: string, opts: { body: Record<string, unknown> }): Promise<{ data: unknown; error: { message?: string; context?: unknown } | null }>;
  };
}

let clientOverride: ProjectPermitsClient | null = null;

export const __projectPermitsTestHooks = {
  setClient(c: ProjectPermitsClient | null) {
    clientOverride = c;
  },
};

function client(): ProjectPermitsClient {
  return clientOverride ?? (supabase as unknown as ProjectPermitsClient);
}

function unwrap<T>(res: QueryResult<T>, what: string): T {
  if (res.error) throw new Error(friendlyError(res.error, what));
  return res.data as T;
}

/** Server messages are written for people (see the migration); anything else gets a plain fallback. */
function friendlyError(error: QueryError, what: string): string {
  const msg = error.message ?? '';
  if (/permit not available|not allowed|between 1 and 50|no linked permit|authentication required/i.test(msg)) {
    return msg.charAt(0).toUpperCase() + msg.slice(1);
  }
  if (isMissingSchemaError(error)) return 'Permit linking is not available yet.';
  return `${what} failed. Please try again.`;
}

// ---- Linked permits ---------------------------------------------------------

export interface LinkedPermit {
  permit_id: string;
  permit_number: string;
  jurisdiction: string | null;
  address: string | null;
  title: string | null;
  status_raw: string | null;
  last_synced_at: string | null;
  linked_at: string | null;
}

/** Permits linked to a project that the caller can read (RLS hides the rest). */
export async function listProjectPermits(projectId: string): Promise<LinkedPermit[]> {
  if (!projectId) return [];
  const res = await client()
    .from('project_permits')
    .select('permit_id, created_at, permits(id, permit_number, jurisdiction, address, title, status_raw, last_synced_at)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  const rows = unwrap(res, 'Loading linked permits') ?? [];
  return rows
    .map((r) => {
      const p = (r.permits as Record<string, unknown> | null) ?? null;
      if (!p) return null;
      return {
        permit_id: String(r.permit_id),
        permit_number: String(p.permit_number ?? ''),
        jurisdiction: (p.jurisdiction as string | null) ?? null,
        address: (p.address as string | null) ?? null,
        title: (p.title as string | null) ?? null,
        status_raw: (p.status_raw as string | null) ?? null,
        last_synced_at: (p.last_synced_at as string | null) ?? null,
        linked_at: (r.created_at as string | null) ?? null,
      };
    })
    .filter((x): x is LinkedPermit => x !== null);
}

export async function linkPermitsToProject(projectId: string, permitIds: string[]): Promise<number> {
  const ids = [...new Set(permitIds.filter(Boolean))];
  if (!projectId || ids.length === 0) return 0;
  assertPermitWritesAllowed('link_project_permits');
  const n = unwrap(await client().rpc('link_project_permits', { p_project_id: projectId, p_permit_ids: ids }), 'Linking permits');
  return Number(n ?? 0);
}

export async function unlinkPermitFromProject(projectId: string, permitId: string): Promise<void> {
  if (!projectId || !permitId) return;
  assertPermitWritesAllowed('unlink_project_permit');
  unwrap(await client().rpc('unlink_project_permit', { p_project_id: projectId, p_permit_id: permitId }), 'Unlinking the permit');
}

/** Whether the signed-in user may change this project (owner, default Write, or a write override). */
export async function canEditProject(userId: string, projectId: string): Promise<boolean> {
  if (!userId || !projectId) return false;
  const res = await client().rpc('has_project_editor_access', { _user_id: userId, _project_id: projectId });
  return !res.error && res.data === true;
}

/** Other projects of the caller's organization (RLS, D-120) already linked to these permits, so the picker can warn before a duplicate project. */
export async function findExistingPermitLinks(permitIds: string[]): Promise<Map<string, Array<{ project_id: string; project_name: string | null }>>> {
  const out = new Map<string, Array<{ project_id: string; project_name: string | null }>>();
  const ids = [...new Set(permitIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const res = await client().from('project_permits').select('permit_id, project_id, projects(name)').in('permit_id', ids);
  if (res.error) return out;
  for (const r of res.data ?? []) {
    const list = out.get(String(r.permit_id)) ?? [];
    list.push({ project_id: String(r.project_id), project_name: ((r.projects as { name?: string } | null)?.name as string | undefined) ?? null });
    out.set(String(r.permit_id), list);
  }
  return out;
}

/** Jurisdictions of the permits this account can see (for the picker's first step). */
export async function listPermitJurisdictions(): Promise<string[]> {
  const res = await client().from('permits').select('jurisdiction').not('jurisdiction', 'is', null).limit(1000);
  if (res.error) return [];
  return [...new Set((res.data ?? []).map((r) => String(r.jurisdiction ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export async function searchLinkablePermits(params: { query: string; jurisdiction: string | null; limit?: number }): Promise<PermitListRow[]> {
  const { rows } = await searchPermits({ query: params.query, jurisdiction: params.jurisdiction, limit: params.limit ?? 20 });
  return rows;
}

// ---- Prefill ----------------------------------------------------------------

export interface ProjectPrefill {
  permit_number?: string;
  address?: string;
  jurisdiction?: string;
  name?: string;
}

/** Fills only fields the user left blank, from the first chosen permit. */
export function prefillFromPermit(
  current: { name: string; permit_number: string; address: string; jurisdiction: string },
  permit: Pick<PermitListRow, 'permit_number' | 'address' | 'jurisdiction' | 'title'>,
): ProjectPrefill {
  const out: ProjectPrefill = {};
  if (!current.permit_number.trim() && permit.permit_number) out.permit_number = permit.permit_number;
  if (!current.address.trim() && permit.address) out.address = permit.address;
  if (!current.jurisdiction.trim() && permit.jurisdiction) out.jurisdiction = permit.jurisdiction;
  if (!current.name.trim()) {
    const label = (permit.title || permit.address || '').trim();
    if (label) out.name = label.slice(0, 200);
  }
  return out;
}

// ---- Comment processing -----------------------------------------------------

export type ProcessingState = 'processed' | 'waiting' | 'processing' | 'retrying' | 'needs_attention' | 'no_comments';

export interface PipelineOverviewRow {
  project_id: string;
  project_name: string | null;
  permit_id: string;
  permit_number: string | null;
  jurisdiction: string | null;
  linked_at: string | null;
  processing_state: ProcessingState;
  comments_in_matrix: number;
  comments_removed: number;
  comments_changed: number;
  portal_comments: number;
  last_completed_at: string | null;
  next_attempt_at: string | null;
  can_edit: boolean;
  /** Platform admins only. */
  last_error: string | null;
}

export async function loadPipelineOverview(params: { projectIds?: string[]; permitIds?: string[] }): Promise<PipelineOverviewRow[]> {
  const projectIds = params.projectIds?.filter(Boolean) ?? null;
  const permitIds = params.permitIds?.filter(Boolean) ?? null;
  if (!projectIds?.length && !permitIds?.length) return [];
  const res = await client().rpc('get_comment_pipeline_overview', {
    p_project_ids: projectIds?.length ? projectIds.slice(0, 200) : null,
    p_permit_ids: permitIds?.length ? permitIds.slice(0, 200) : null,
  });
  if (res.error && isMissingSchemaError(res.error)) return [];
  return ((unwrap(res, 'Loading comment processing') as PipelineOverviewRow[] | null) ?? []).map((r) => ({
    ...r,
    comments_in_matrix: Number(r.comments_in_matrix ?? 0),
    comments_removed: Number(r.comments_removed ?? 0),
    comments_changed: Number(r.comments_changed ?? 0),
    portal_comments: Number(r.portal_comments ?? 0),
  }));
}

export type ProcessingRequestResult = 'started' | 'queued' | 'already_running';

export function processingToast(result: ProcessingRequestResult): string {
  if (result === 'started') return 'Processing started. Comments will appear in the Response Matrix shortly.';
  if (result === 'already_running') return 'Comments are already being processed.';
  return 'Processing requested. It will start within a few minutes.';
}

/**
 * "Process comments now" / "Try again". Asks the permit-comment-pipeline function to start now; if it is
 * not reachable, the request is still recorded and the next scheduled sweep picks it up.
 */
export async function requestCommentProcessing(projectId: string): Promise<ProcessingRequestResult> {
  if (!projectId) throw new Error('No project selected');
  assertPermitWritesAllowed('request_project_comment_processing');
  const c = client();
  if (c.functions) {
    const { data, error } = await c.functions.invoke('permit-comment-pipeline', { body: { action: 'process', project_id: projectId } });
    if (!error) {
      const claimed = Number((data as { claimed?: number } | null)?.claimed ?? 0);
      return claimed > 0 ? 'started' : 'already_running';
    }
    const context = error.context as { status?: number; json?: () => Promise<unknown> } | undefined;
    const status = context?.status;
    if (status === 403 || status === 404 || status === 400) {
      const body = (await context?.json?.().catch(() => null)) as { error?: string } | null;
      throw new Error(friendlyError({ message: body?.error ?? '' }, 'Requesting comment processing'));
    }
  }
  unwrap(await c.rpc('request_project_comment_processing', { p_project_id: projectId }), 'Requesting comment processing');
  return 'queued';
}

export const PROCESSING_LABELS: Record<ProcessingState, { label: string; tone: 'good' | 'warn' | 'bad' | 'default'; detail: string }> = {
  processed: { label: 'In Response Matrix', tone: 'good', detail: 'Comments are in the Response Matrix.' },
  waiting: { label: 'Queued', tone: 'default', detail: 'New or changed comments will be added shortly.' },
  processing: { label: 'Processing', tone: 'default', detail: 'Comments are being added and classified.' },
  retrying: { label: 'Retrying', tone: 'warn', detail: 'Processing hit a problem and will try again automatically.' },
  needs_attention: { label: 'Needs attention', tone: 'bad', detail: 'Processing stopped after several attempts. Try again, or contact support.' },
  no_comments: { label: 'No review comments', tone: 'default', detail: 'This permit has no review comments yet.' },
};

/** One summary per project from its per-permit rows: the least settled state wins. */
export function summarizeProjectState(rows: Pick<PipelineOverviewRow, 'processing_state'>[]): ProcessingState | null {
  if (rows.length === 0) return null;
  const order: ProcessingState[] = ['needs_attention', 'retrying', 'processing', 'waiting', 'processed', 'no_comments'];
  return order.find((s) => rows.some((r) => r.processing_state === s)) ?? null;
}

// ---- Permit-level (central) processing, D-121 --------------------------------

export type CentralProcessingState = 'not_processed' | 'processing' | 'ready' | 'needs_attention' | 'no_comments';

export interface PermitCommentProcessing {
  permit_id: string;
  processing_state: CentralProcessingState;
  source_comments: number;
  processed: number;
  pending: number;
  failed: number;
  needs_attention: number;
  skipped: number;
  last_completed_at: string | null;
}

/** Plain-language Permit Queue states. Versions, hashes, failures and costs are admin-only (diagnostics). */
export const CENTRAL_PROCESSING_LABELS: Record<CentralProcessingState, { label: string; tone: 'good' | 'warn' | 'bad' | 'default'; detail: string }> = {
  not_processed: { label: 'Not yet processed', tone: 'default', detail: 'Review comments have not been analysed yet.' },
  processing: { label: 'Processing', tone: 'default', detail: 'Review comments are being analysed.' },
  ready: { label: 'Ready for project use', tone: 'good', detail: 'Preliminary AI analysis is ready; linked projects reuse it.' },
  needs_attention: { label: 'Needs attention', tone: 'bad', detail: 'Some comments could not be analysed. An administrator can retry.' },
  no_comments: { label: 'No review comments', tone: 'default', detail: 'This permit has no review comments yet.' },
};

/** Per readable permit. Empty when the migration is not applied yet. */
export async function loadPermitCommentProcessing(permitIds: string[]): Promise<Map<string, PermitCommentProcessing>> {
  const out = new Map<string, PermitCommentProcessing>();
  const ids = [...new Set(permitIds.filter(Boolean))].slice(0, 200);
  if (ids.length === 0) return out;
  const res = await client().rpc('get_permit_comment_processing', { p_permit_ids: ids });
  if (res.error && isMissingSchemaError(res.error)) return out;
  for (const r of (unwrap(res, 'Loading comment analysis') as PermitCommentProcessing[] | null) ?? []) {
    out.set(r.permit_id, {
      ...r,
      source_comments: Number(r.source_comments ?? 0),
      processed: Number(r.processed ?? 0),
      pending: Number(r.pending ?? 0),
      failed: Number(r.failed ?? 0),
      needs_attention: Number(r.needs_attention ?? 0),
      skipped: Number(r.skipped ?? 0),
    });
  }
  return out;
}

export interface CentralDiagnosticsRow {
  permit_id: string;
  permit_number: string | null;
  status: string | null;
  processing_version: string | null;
  completed_fingerprint: string | null;
  current_fingerprint: string | null;
  attempts: number | null;
  next_attempt_at: string | null;
  last_error: string | null;
  last_completed_at: string | null;
  source_comments: number;
  processed: number;
  pending: number;
  failed: number;
  needs_attention: number;
  skipped: number;
  ai_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface AiBudgetStatus {
  scope: string;
  cap_usd: number;
  approved: boolean;
  closed: boolean;
  used_usd: number;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

/** Platform admins: per-permit diagnostics and AI budgets. `available: false` before the migration. */
export async function loadCentralDiagnostics(permitIds?: string[]): Promise<{ available: boolean; rows: CentralDiagnosticsRow[]; budgets: AiBudgetStatus[] }> {
  const [diag, budgets] = await Promise.all([
    client().rpc('admin_get_central_processing_diagnostics', { p_permit_ids: permitIds?.length ? permitIds.slice(0, 200) : null }),
    client().rpc('admin_list_permit_ai_budgets', {}),
  ]);
  if (diag.error && isMissingSchemaError(diag.error)) return { available: false, rows: [], budgets: [] };
  const num = (v: unknown) => Number(v ?? 0);
  const rows = ((unwrap(diag, 'Loading comment analysis diagnostics') as CentralDiagnosticsRow[] | null) ?? []).map((r) => ({
    ...r,
    source_comments: num(r.source_comments),
    processed: num(r.processed),
    pending: num(r.pending),
    failed: num(r.failed),
    needs_attention: num(r.needs_attention),
    skipped: num(r.skipped),
    ai_calls: num(r.ai_calls),
    input_tokens: num(r.input_tokens),
    output_tokens: num(r.output_tokens),
    cost_usd: num(r.cost_usd),
  }));
  const list = budgets.error ? [] : ((budgets.data as AiBudgetStatus[] | null) ?? []);
  return { available: true, rows, budgets: list.map((b) => ({ ...b, cap_usd: num(b.cap_usd), used_usd: num(b.used_usd), calls: num(b.calls), input_tokens: num(b.input_tokens), output_tokens: num(b.output_tokens) })) };
}

/** Platform admins: analyse a permit again (set-aside comments get fresh attempts). */
export async function retryCentralProcessing(permitId: string): Promise<void> {
  assertPermitWritesAllowed('admin_retry_permit_comment_processing');
  unwrap(await client().rpc('admin_retry_permit_comment_processing', { p_permit_id: permitId }), 'Retrying comment analysis');
}

// ---- Response Matrix markers ------------------------------------------------

export interface PortalCommentMarker {
  removed_at: string | null;
  changed_at: string | null;
  latest_text: string | null;
  permit_id: string | null;
  /** Fields on this row filled from the permit-level preliminary AI analysis (D-122). */
  preliminary_fields?: Array<'discipline' | 'code_reference' | 'response_text'>;
  /** A newer preliminary analysis differs from a value a person set; the value was kept. */
  central_update_at?: string | null;
}

const MARKER_COLUMNS = 'id, portal_permit_id, portal_removed_at, portal_changed_at, portal_latest_text';
const CENTRAL_MARKER_COLUMNS = 'discipline_source, code_reference_source, response_text_source, central_update_at';

/**
 * Portal and preliminary-analysis markers per comment id. Without the central columns (migration not applied)
 * the portal markers still load; without the portal columns the map is empty.
 */
export async function loadPortalCommentMarkers(projectId: string): Promise<Map<string, PortalCommentMarker>> {
  const out = new Map<string, PortalCommentMarker>();
  if (!projectId) return out;
  const query = (columns: string) => client().from('parsed_comments').select(columns).eq('project_id', projectId).limit(5000);
  let res = await query(`${MARKER_COLUMNS}, ${CENTRAL_MARKER_COLUMNS}`);
  if (res.error) res = await query(MARKER_COLUMNS);
  if (res.error) return out;
  for (const r of res.data ?? []) {
    const preliminary = (['discipline', 'code_reference', 'response_text'] as const).filter((f) => r[`${f}_source`] === 'central');
    const centralUpdate = (r.central_update_at as string | null | undefined) ?? null;
    if (!r.portal_removed_at && !r.portal_latest_text && preliminary.length === 0 && !centralUpdate) continue;
    out.set(String(r.id), {
      removed_at: (r.portal_removed_at as string | null) ?? null,
      changed_at: (r.portal_changed_at as string | null) ?? null,
      latest_text: (r.portal_latest_text as string | null) ?? null,
      permit_id: (r.portal_permit_id as string | null) ?? null,
      preliminary_fields: preliminary,
      central_update_at: centralUpdate,
    });
  }
  return out;
}

/** The discussion part of a persisted `ref: N` comment, for showing newer portal text. */
export function discussionOf(text: string | null | undefined): string {
  const raw = String(text ?? '');
  const m = raw.match(/full_discussion_text:\s*\r?\n([\s\S]*?)(?=\r?\nstatus:\s*)/i);
  return (m ? m[1] : raw).trim();
}
