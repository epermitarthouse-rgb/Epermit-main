import { strToU8, zipSync } from 'fflate';
import {
  assertPermitExportAllowed,
  listExportPermits,
  loadPermitExportBundles,
  type PermitExportBundle,
} from '@/lib/centralPermits';
import {
  DC_SECTION_SOURCES,
  DOCUMENTS_NOTE,
  EXTRACTION_STATUS_LABEL,
  REPORTS_NOTE,
  PERMIT_SECTIONS,
  classifySectionState,
  dcProjectPageUrl,
  infoFieldCount,
  latestSnapshot,
  sectionStateMap,
  snapshotsFor,
  statusSubWorkflows,
  type ExtractionStatus,
  type PermitSection,
} from '@/lib/permitSections';

/**
 * Admin-only permit export (D-053). Pure builders plus two orchestrators that check platform admin
 * server-side and then read through RLS. Nothing here writes to the database.
 */

type Row = Record<string, unknown>;

export const PERMIT_EXPORT_SCHEMA = 'permitpilot.permit-export.v1';

const NOISE_COLUMNS = new Set(['search_tsv']);

function clean(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!NOISE_COLUMNS.has(k)) out[k] = v;
  return out;
}

const cleanAll = (rows: Row[]) => rows.map(clean);

function sectionRowCounts(section: PermitSection, b: PermitExportBundle): Record<string, number> {
  switch (section) {
    case 'status':
      return { sub_workflows: statusSubWorkflows(latestSnapshot(b.snapshots, 'status')?.payload).length };
    case 'info':
      return { info_fields: infoFieldCount(latestSnapshot(b.snapshots, 'info')?.payload) };
    case 'tasks':
      return { permit_tasks: b.tasks.length };
    case 'workflows':
      return { permit_workflows: b.workflows.length };
    case 'reviews':
      return { permit_review_comments: b.review_comments.length, permit_review_responses: b.review_responses.length };
    case 'files':
      return { permit_document_folders: b.document_folders.length, permit_documents: b.documents.length };
    case 'reports':
      return { permit_reports: b.reports.length };
  }
}

export interface ExportSection {
  section: PermitSection;
  export_status: ExtractionStatus;
  export_status_label: string;
  reason: string;
  db_status: string | null;
  source_kind: string | null;
  source_routes: string[];
  item_count: number | null;
  last_attempt_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  consecutive_failures: number | null;
  content_hash: string | null;
  snapshot_count: number;
  latest_snapshot_id: string | null;
  latest_captured_at: string | null;
  latest_run_id: string | null;
  rows: Record<string, number>;
}

export function buildExportSections(b: PermitExportBundle): Record<PermitSection, ExportSection> {
  const states = sectionStateMap(b.section_states);
  const out = {} as Record<PermitSection, ExportSection>;
  for (const section of PERMIT_SECTIONS) {
    const st = states.get(section) ?? null;
    const cls = classifySectionState(st);
    const snaps = snapshotsFor(b.snapshots, section);
    const latest = snaps[0] ?? null;
    const val = (k: string) => (st && st[k] !== undefined && st[k] !== null ? st[k] : null);
    out[section] = {
      section,
      export_status: cls.status,
      export_status_label: EXTRACTION_STATUS_LABEL[cls.status],
      reason: cls.reason,
      db_status: (val('status') as string | null) ?? null,
      source_kind: (val('source_kind') as string | null) ?? (latest?.source_kind as string | undefined) ?? null,
      source_routes: DC_SECTION_SOURCES[section],
      item_count: (val('item_count') as number | null) ?? null,
      last_attempt_at: (val('last_attempt_at') as string | null) ?? null,
      last_ok_at: (val('last_ok_at') as string | null) ?? null,
      last_error: (val('last_error') as string | null) ?? null,
      consecutive_failures: (val('consecutive_failures') as number | null) ?? null,
      content_hash: (val('content_hash') as string | null) ?? null,
      snapshot_count: snaps.length,
      latest_snapshot_id: latest ? String(latest.id) : null,
      latest_captured_at: latest ? String(latest.captured_at) : null,
      latest_run_id: latest?.run_id ? String(latest.run_id) : null,
      rows: sectionRowCounts(section, b),
    };
  }
  return out;
}

export function bundleCounts(b: PermitExportBundle): Record<string, number> {
  return {
    section_states: b.section_states.length,
    snapshots: b.snapshots.length,
    changes: b.changes.length,
    workflows: b.workflows.length,
    tasks: b.tasks.length,
    review_comments: b.review_comments.length,
    review_responses: b.review_responses.length,
    document_folders: b.document_folders.length,
    documents: b.documents.length,
    reports: b.reports.length,
    source_links: b.source_links.length,
  };
}

const PERMIT_STATUS_COLUMNS = ['status', 'status_raw', 'review_type', 'review_cycle', 'total_files', 'unresolved_comments', 'uncompleted_tasks', 'summary'];
const PERMIT_INFO_COLUMNS = ['title', 'description', 'address', 'job_class', 'owner_org', 'contact_org', 'project_start_date', 'project_end_date'];

function pick(row: Row, cols: string[]): Row {
  const out: Row = {};
  for (const c of cols) out[c] = row[c] ?? null;
  return out;
}

export function buildPermitExport(b: PermitExportBundle, exportedAt: Date): Row {
  const p = b.permit;
  const sections = buildExportSections(b);
  const storedBinaries = b.documents.filter((d) => d.download_status === 'stored').length;
  const statusSnap = latestSnapshot(b.snapshots, 'status');
  const infoSnap = latestSnapshot(b.snapshots, 'info');
  const runIds = [...new Set(b.snapshots.map((s) => s.run_id).filter(Boolean).map(String))].sort();
  return {
    schema: PERMIT_EXPORT_SCHEMA,
    exported_at: exportedAt.toISOString(),
    permit: clean(p),
    provenance: {
      adapter_key: p.adapter_key ?? null,
      jurisdiction: p.jurisdiction ?? null,
      portal_record_id: p.portal_record_id ?? null,
      portal_page_url: dcProjectPageUrl(p.portal_record_id),
      first_seen_at: p.first_seen_at ?? null,
      last_seen_at: p.last_seen_at ?? null,
      last_synced_at: p.last_synced_at ?? null,
      last_changed_at: p.last_changed_at ?? null,
      run_ids: runIds,
      jobs: cleanAll(b.jobs),
      source_links: cleanAll(b.source_links),
    },
    sections,
    data: {
      status: {
        export_status: sections.status.export_status,
        permit_fields: pick(p, PERMIT_STATUS_COLUMNS),
        latest_snapshot_id: statusSnap ? String(statusSnap.id) : null,
        portal_status: statusSnap?.payload ?? null,
      },
      info: {
        export_status: sections.info.export_status,
        permit_fields: pick(p, PERMIT_INFO_COLUMNS),
        latest_snapshot_id: infoSnap ? String(infoSnap.id) : null,
        portal_fields: infoSnap?.payload ?? null,
      },
      tasks: { export_status: sections.tasks.export_status, rows: cleanAll(b.tasks) },
      workflows: {
        export_status: sections.workflows.export_status,
        rows: cleanAll(b.workflows),
        review_steps_from_status: statusSubWorkflows(statusSnap?.payload),
      },
      reviews: {
        export_status: sections.reviews.export_status,
        comments: cleanAll(b.review_comments),
        responses: cleanAll(b.review_responses),
      },
      files: {
        export_status: sections.files.export_status,
        binaries_captured: storedBinaries > 0,
        stored_binary_count: storedBinaries,
        note: storedBinaries > 0 ? `${storedBinaries} document binaries are stored; the rest are metadata only.` : DOCUMENTS_NOTE,
        folders: cleanAll(b.document_folders),
        documents: cleanAll(b.documents),
      },
      reports: {
        export_status: sections.reports.export_status,
        content_captured: false,
        note: REPORTS_NOTE,
        rows: cleanAll(b.reports),
      },
    },
    section_states: cleanAll(b.section_states),
    snapshots: cleanAll(b.snapshots),
    changes: cleanAll(b.changes),
    counts: bundleCounts(b),
  };
}

// ---- completeness.csv -------------------------------------------------------

export const COMPLETENESS_COLUMNS = [
  'permit_number',
  'portal_project_id',
  'permit_id',
  'portal_status',
  ...PERMIT_SECTIONS.map((s) => `${s}_extraction`),
  'status_sub_workflows',
  'info_fields',
  'tasks_rows',
  'workflows_rows',
  'review_comments',
  'review_responses',
  'folders',
  'documents',
  'document_binaries_stored',
  'reports_rows',
  'section_states',
  'snapshots',
  'changes',
  'captured_at',
  'last_synced_at',
] as const;

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function completenessRow(b: PermitExportBundle): Record<(typeof COMPLETENESS_COLUMNS)[number], unknown> {
  const sections = buildExportSections(b);
  const capturedAt = b.snapshots.map((s) => String(s.captured_at ?? '')).filter(Boolean).sort().pop() ?? '';
  const row = {
    permit_number: b.permit.permit_number,
    portal_project_id: b.permit.portal_record_id,
    permit_id: b.permit.id,
    portal_status: b.permit.status_raw ?? b.permit.status,
    status_sub_workflows: sections.status.rows.sub_workflows,
    info_fields: sections.info.rows.info_fields,
    tasks_rows: b.tasks.length,
    workflows_rows: b.workflows.length,
    review_comments: b.review_comments.length,
    review_responses: b.review_responses.length,
    folders: b.document_folders.length,
    documents: b.documents.length,
    document_binaries_stored: b.documents.filter((d) => d.download_status === 'stored').length,
    reports_rows: b.reports.length,
    section_states: b.section_states.length,
    snapshots: b.snapshots.length,
    changes: b.changes.length,
    captured_at: capturedAt,
    last_synced_at: b.permit.last_synced_at ?? '',
  } as Record<(typeof COMPLETENESS_COLUMNS)[number], unknown>;
  for (const s of PERMIT_SECTIONS) row[`${s}_extraction`] = sections[s].export_status;
  return row;
}

export function buildCompletenessCsv(bundles: PermitExportBundle[]): string {
  const lines = [COMPLETENESS_COLUMNS.join(',')];
  for (const b of bundles) {
    const r = completenessRow(b);
    lines.push(COMPLETENESS_COLUMNS.map((c) => csvCell(r[c])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

// ---- file names and zip -----------------------------------------------------

export function exportStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

const safePart = (v: unknown) => String(v ?? 'unknown').replace(/[^A-Za-z0-9._-]+/g, '_') || 'unknown';

export function permitJsonName(permit: Row): string {
  return `permit-${safePart(permit.permit_number)}-${safePart(permit.portal_record_id)}.json`;
}

export function permitDownloadName(permit: Row, d: Date): string {
  return permitJsonName(permit).replace(/\.json$/, `-${exportStamp(d)}.json`);
}

export function dcZipName(d: Date): string {
  return `permitpilot-dc-permits-${exportStamp(d)}.zip`;
}

export function buildExportManifest(bundles: PermitExportBundle[], exportedAt: Date): Row {
  const totals: Record<string, number> = {};
  const statusTally: Record<string, Record<string, number>> = {};
  for (const b of bundles) {
    for (const [k, n] of Object.entries(bundleCounts(b))) totals[k] = (totals[k] ?? 0) + n;
    const sections = buildExportSections(b);
    for (const s of PERMIT_SECTIONS) {
      statusTally[s] ??= {};
      statusTally[s][sections[s].export_status] = (statusTally[s][sections[s].export_status] ?? 0) + 1;
    }
  }
  return {
    schema: PERMIT_EXPORT_SCHEMA,
    exported_at: exportedAt.toISOString(),
    adapter_key: 'dc-projectdox',
    permit_count: bundles.length,
    totals,
    section_status: statusTally,
    files: bundles.map((b) => `permits/${permitJsonName(b.permit)}`),
    notes: { documents: DOCUMENTS_NOTE, reports: REPORTS_NOTE },
  };
}

export function buildDcExportZip(bundles: PermitExportBundle[], exportedAt: Date): Uint8Array {
  const root = dcZipName(exportedAt).replace(/\.zip$/, '');
  const files: Record<string, Uint8Array> = {
    [`${root}/manifest.json`]: strToU8(JSON.stringify(buildExportManifest(bundles, exportedAt), null, 2)),
    [`${root}/completeness.csv`]: strToU8(buildCompletenessCsv(bundles)),
  };
  for (const b of bundles) {
    files[`${root}/permits/${permitJsonName(b.permit)}`] = strToU8(JSON.stringify(buildPermitExport(b, exportedAt), null, 2));
  }
  return zipSync(files, { level: 6 });
}

// ---- orchestrators (admin check, then RLS reads) ----------------------------

export async function exportPermitJson(permitId: string, now: Date = new Date()): Promise<{ fileName: string; text: string }> {
  await assertPermitExportAllowed();
  const [bundle] = await loadPermitExportBundles([permitId]);
  if (!bundle) throw new Error('Permit not found, or you cannot read it');
  return { fileName: permitDownloadName(bundle.permit, now), text: JSON.stringify(buildPermitExport(bundle, now), null, 2) };
}

export async function exportDcPermitsZip(now: Date = new Date()): Promise<{ fileName: string; bytes: Uint8Array; permitCount: number }> {
  await assertPermitExportAllowed();
  const permits = await listExportPermits('dc-projectdox');
  const bundles = await loadPermitExportBundles(permits.map((p) => String(p.id)));
  return { fileName: dcZipName(now), bytes: buildDcExportZip(bundles, now), permitCount: bundles.length };
}

export function triggerBrowserDownload(fileName: string, data: string | Uint8Array, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
