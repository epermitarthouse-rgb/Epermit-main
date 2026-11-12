/**
 * Permit Queue (D-064): the single central permit interface at /permit-queue, organised like the
 * DC ProjectDox portal. Pure helpers only (filtering, paging, file tree, view gating, review grouping),
 * so the pages and the tests share one definition. Data access stays in centralPermits.ts.
 */
import type { PermitListRow } from '@/lib/centralPermits';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const PERMIT_QUEUE_PATH = '/permit-queue';

export function permitQueuePath(permitId?: string | null): string {
  return permitId ? `${PERMIT_QUEUE_PATH}/${encodeURIComponent(permitId)}` : PERMIT_QUEUE_PATH;
}

/** Detail tabs in the order the DC portal shows them. */
export const PERMIT_QUEUE_TABS = ['tasks', 'files', 'status', 'info', 'reports', 'reviews'] as const;
export type PermitQueueTab = (typeof PERMIT_QUEUE_TABS)[number];

export const PERMIT_QUEUE_TAB_LABELS: Record<PermitQueueTab, string> = {
  tasks: 'Tasks',
  files: 'Files',
  status: 'Status',
  info: 'Info',
  reports: 'Reports',
  reviews: 'Reviews',
};

// ---- List: filters and paging ----------------------------------------------

export type LinkedFilter = 'all' | 'linked' | 'unlinked';

export interface QueueFilters {
  /** `all`, or a value from queueSourceOptions(). */
  source: string;
  linked: LinkedFilter;
}

export const DEFAULT_QUEUE_FILTERS: QueueFilters = { source: 'all', linked: 'all' };

/** One filter value per jurisdiction + adapter pair, so two adapters for one city stay apart. */
export function queueSourceKey(row: Pick<PermitListRow, 'adapter_key' | 'jurisdiction'>): string {
  return `${row.adapter_key}::${row.jurisdiction ?? ''}`;
}

export function queueSourceOptions(rows: PermitListRow[]): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const key = queueSourceKey(r);
    if (!seen.has(key)) seen.set(key, r.jurisdiction ? `${r.jurisdiction} (${r.adapter_key})` : r.adapter_key);
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function filterQueueRows(rows: PermitListRow[], linkCounts: ReadonlyMap<string, number>, filters: QueueFilters): PermitListRow[] {
  return rows.filter((r) => {
    if (filters.source !== 'all' && queueSourceKey(r) !== filters.source) return false;
    const linked = (linkCounts.get(r.id) ?? 0) > 0;
    if (filters.linked === 'linked' && !linked) return false;
    if (filters.linked === 'unlinked' && linked) return false;
    return true;
  });
}

export function paginate<T>(rows: T[], page: number, pageSize: number): { rows: T[]; page: number; pages: number; total: number } {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { rows: rows.slice((current - 1) * pageSize, current * pageSize), page: current, pages, total };
}

// ---- Files: view gating, versions and the folder tree ------------------------

export type DocumentViewState = 'viewable' | 'not_downloadable' | 'not_captured';

/**
 * A file opens only when its binary is in the private bucket (D-058): `download_status = 'stored'`
 * with a storage path. A folder the portal marks non-downloadable is said so; everything else is
 * not captured. There is never a portal link or a placeholder viewer.
 */
export function documentViewState(doc: Row): DocumentViewState {
  if (doc.download_status === 'stored' && str(doc.storage_path)) return 'viewable';
  if (doc.download_permitted === false || doc.download_status === 'not_permitted') return 'not_downloadable';
  return 'not_captured';
}

export const DOCUMENT_VIEW_LABEL: Record<DocumentViewState, string> = {
  viewable: 'Stored',
  not_downloadable: 'Not downloadable on portal',
  not_captured: 'Not captured',
};

// ---- Content capture pills (D-086) --------------------------------------------

export interface ContentPill {
  label: string;
  tone: 'good' | 'warn';
}

/** "9 of 72 files stored · 61 pending · 2 too large": what is stored, not whether the metadata read worked. */
export function filesContentPill(documents: Row[]): ContentPill | null {
  const docs = documents.filter((d) => !d.removed_at);
  if (!docs.length) return null;
  const stored = docs.filter((d) => documentViewState(d) === 'viewable').length;
  const deferred = docs.filter((d) => d.download_status === 'deferred_oversize').length;
  const pending = docs.length - stored - deferred;
  const parts = [`${stored} of ${docs.length} files stored`];
  if (pending) parts.push(`${pending} pending`);
  if (deferred) parts.push(`${deferred} too large`);
  return { label: parts.join(' · '), tone: stored === docs.length ? 'good' : 'warn' };
}

/** "4 of 5 reports": report contents captured out of the reports the portal lists. */
export function reportsContentPill(reports: Row[]): ContentPill | null {
  const list = reports.filter((r) => !r.removed_at);
  if (!list.length) return null;
  const captured = list.filter((r) => r.content_status === 'captured').length;
  return { label: `${captured} of ${list.length} reports`, tone: captured === list.length ? 'good' : 'warn' };
}

export interface FileGroup {
  key: string;
  /** Highest version first. */
  versions: Row[];
  latest: Row;
}

/** ProjectDox issues a new file id per version; versions of one drawing share folder and file name. */
export function groupFileVersions(documents: Row[]): FileGroup[] {
  const groups = new Map<string, Row[]>();
  for (const d of documents) {
    const name = str(d.original_file_name) || str(d.file_name) || str(d.portal_file_id);
    const key = `${str(d.portal_folder_id)}::${name.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const versions = [...list].sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0));
      return { key, versions, latest: versions[0] };
    })
    .sort((a, b) => str(a.latest.file_name).localeCompare(str(b.latest.file_name)));
}

export interface FolderNode {
  folder: Row;
  children: FolderNode[];
  files: FileGroup[];
  /** Files in this folder and every sub-folder (latest versions). */
  totalFiles: number;
}

/**
 * Folder tree from `parent_portal_folder_id`. Folders whose parent is unknown become roots, and a
 * parent cycle is cut, so every folder is shown exactly once. Files without a known folder are
 * returned separately.
 */
export function buildFolderTree(folders: Row[], documents: Row[]): { roots: FolderNode[]; unfiled: FileGroup[] } {
  const byId = new Map(folders.map((f) => [str(f.portal_folder_id), f]));
  const docsByFolder = new Map<string, Row[]>();
  const unfiledDocs: Row[] = [];
  for (const d of documents) {
    const fid = str(d.portal_folder_id);
    if (fid && byId.has(fid)) docsByFolder.set(fid, [...(docsByFolder.get(fid) ?? []), d]);
    else unfiledDocs.push(d);
  }
  const childIds = new Map<string, string[]>();
  const roots: string[] = [];
  for (const f of folders) {
    const id = str(f.portal_folder_id);
    const parent = str(f.parent_portal_folder_id);
    if (parent && parent !== id && byId.has(parent)) childIds.set(parent, [...(childIds.get(parent) ?? []), id]);
    else roots.push(id);
  }
  const placed = new Set<string>();
  const build = (id: string): FolderNode | null => {
    if (placed.has(id)) return null;
    placed.add(id);
    const children = (childIds.get(id) ?? [])
      .map(build)
      .filter((n): n is FolderNode => n !== null)
      .sort((a, b) => str(a.folder.name).localeCompare(str(b.folder.name)));
    const files = groupFileVersions(docsByFolder.get(id) ?? []);
    return { folder: byId.get(id) as Row, children, files, totalFiles: files.length + children.reduce((n, c) => n + c.totalFiles, 0) };
  };
  const nodes = roots.map(build).filter((n): n is FolderNode => n !== null);
  // Folders only reachable through a parent cycle.
  for (const f of folders) {
    const node = build(str(f.portal_folder_id));
    if (node) nodes.push(node);
  }
  nodes.sort((a, b) => str(a.folder.name).localeCompare(str(b.folder.name)));
  return { roots: nodes, unfiled: groupFileVersions(unfiledDocs) };
}

// ---- Reports: content gating -------------------------------------------------

export type ReportContentState = 'captured' | 'failed' | 'not_captured';

/**
 * Report content exists only after the deep-capture migration (D-067). Before it is applied the
 * columns are missing, which reads as not captured.
 */
export function reportContentState(report: Row): ReportContentState {
  if (report.content_status === 'captured' && str(report.latest_content_id)) return 'captured';
  if (report.content_status === 'failed') return 'failed';
  return 'not_captured';
}

export const REPORT_CONTENT_LABEL: Record<ReportContentState, string> = {
  captured: 'Captured',
  failed: 'Capture failed',
  not_captured: 'Not captured',
};

/** Structured rows from an Excel export: an array of objects or of arrays. Anything else yields none. */
export function reportTable(rows: unknown): { columns: string[]; body: string[][] } {
  if (!Array.isArray(rows) || !rows.length) return { columns: [], body: [] };
  if (rows.every((r) => Array.isArray(r))) {
    const [head, ...rest] = rows as unknown[][];
    return { columns: head.map(str), body: rest.map((r) => r.map(str)) };
  }
  const objects = rows.filter((r): r is Row => !!r && typeof r === 'object' && !Array.isArray(r));
  const columns = [...new Set(objects.flatMap((o) => Object.keys(o)))];
  return {
    columns,
    body: objects.map((o) => columns.map((c) => {
      const v = o[c];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : str(v);
    })),
  };
}

// ---- Reviews: cycle → department → comment cards ------------------------------

export interface ReviewCard {
  comment: Row;
  /** Responses in portal order. */
  thread: Row[];
}

export interface ReviewDepartmentGroup {
  department: string;
  cards: ReviewCard[];
  unresolved: number;
}

export interface ReviewCycleGroup {
  cycle: string;
  departments: ReviewDepartmentGroup[];
  total: number;
  unresolved: number;
}

export const isUnresolved = (status: unknown): boolean => /unresolved/i.test(str(status));

/** Newest cycle first, departments alphabetically, comments by reference number. */
export function groupReviews(comments: Row[], responses: Row[]): ReviewCycleGroup[] {
  const threads = new Map<string, Row[]>();
  for (const r of responses) {
    const k = str(r.comment_key);
    threads.set(k, [...(threads.get(k) ?? []), r]);
  }
  for (const list of threads.values()) list.sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));

  const cycles = new Map<string, Map<string, Row[]>>();
  for (const c of comments) {
    const cycle = str(c.cycle) || '?';
    const dept = str(c.department) || 'General';
    const depts = cycles.get(cycle) ?? new Map<string, Row[]>();
    depts.set(dept, [...(depts.get(dept) ?? []), c]);
    cycles.set(cycle, depts);
  }
  const cycleOrder = (c: string) => (c === '?' ? -Infinity : Number(c));
  return [...cycles.entries()]
    .sort(([a], [b]) => cycleOrder(b) - cycleOrder(a))
    .map(([cycle, depts]) => {
      const departments = [...depts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([department, list]) => {
          const cards = [...list]
            .sort((a, b) => Number(a.ref_number ?? Infinity) - Number(b.ref_number ?? Infinity))
            .map((comment) => ({ comment, thread: threads.get(str(comment.portal_comment_key)) ?? [] }));
          return { department, cards, unresolved: list.filter((c) => isUnresolved(c.status)).length };
        });
      return {
        cycle,
        departments,
        total: departments.reduce((n, d) => n + d.cards.length, 0),
        unresolved: departments.reduce((n, d) => n + d.unresolved, 0),
      };
    });
}
