/**
 * Read-only check of the admin permit export against the production permit repository (D-053).
 *
 *   node --import tsx scripts/permit-repo/verify-export.tsx
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from scraper-service/.env (never printed).
 * The client's fetch refuses every method except GET and HEAD, so nothing can be written.
 * The service role stands in for a platform admin: both read every permit row (verified with
 * role-scoped SQL). The export is built by the same functions the admin buttons call, minus the
 * browser-only admin RPC check. Output goes to exports.local/ (git-ignored) and prints counts,
 * permit numbers and ids only: no portal names, emails or phone numbers.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { strFromU8, unzipSync } from 'fflate';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  __centralPermitsTestHooks,
  listExportPermits,
  loadPermitDetail,
  loadPermitExportBundles,
  type CentralPermitsClient,
  type PermitExportBundle,
} from '../../src/lib/centralPermits';
import {
  buildCompletenessCsv,
  buildDcExportZip,
  buildPermitExport,
  bundleCounts,
  dcZipName,
  exportStamp,
  permitDownloadName,
} from '../../src/lib/permitExport';
import { PERMIT_SECTIONS, sectionStateMap } from '../../src/lib/permitSections';
import {
  ExtractionOverview,
  FilesSectionView,
  InfoSectionView,
  ReportsSectionView,
  ReviewsSectionView,
  StatusSectionView,
  TasksSectionView,
  WorkflowsSectionView,
} from '../../src/components/permits/PermitSectionViews';

(globalThis as { React?: typeof React }).React = React;

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const REPRESENTATIVE = ['B2508295', 'TL2600008', 'D2500488', 'B2608367'];
const RENDER = ['B2508295', 'TL2600008', 'B2608367'];
const TABLE_FOR_COUNT: Record<string, string> = {
  section_states: 'permit_section_state',
  snapshots: 'permit_snapshots',
  changes: 'permit_changes',
  workflows: 'permit_workflows',
  tasks: 'permit_tasks',
  review_comments: 'permit_review_comments',
  review_responses: 'permit_review_responses',
  document_folders: 'permit_document_folders',
  documents: 'permit_documents',
  reports: 'permit_reports',
  source_links: 'permit_source_links',
};

function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const readOnlyFetch: typeof fetch = (input, init) => {
  const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') throw new Error(`refused ${method}: this script is read-only`);
  return fetch(input, init);
};

async function main() {
  const env = readEnv(join(ROOT, 'scraper-service/.env'));
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('scraper-service/.env lacks SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  const host = new URL(env.SUPABASE_URL).host;
  if (!host.startsWith('eeqxyjrcldivtpikcpvk.')) throw new Error(`unexpected Supabase host ${host}`);
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: readOnlyFetch },
  });
  __centralPermitsTestHooks.setClient(sb as unknown as CentralPermitsClient);

  const headCount = async (table: string, permitId?: string) => {
    let q = sb.from(table).select('*', { count: 'exact', head: true });
    if (permitId) q = q.eq('permit_id', permitId);
    const { count, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return count ?? 0;
  };

  const now = new Date();
  const outDir = join(ROOT, 'exports.local', `dc-export-${exportStamp(now)}`);
  mkdirSync(outDir, { recursive: true });

  const permits = await listExportPermits('dc-projectdox');
  const bundles = await loadPermitExportBundles(permits.map((p) => String(p.id)));
  const problems: string[] = [];

  // Totals: export vs independent HEAD counts on each table.
  const exportTotals: Record<string, number> = {};
  for (const b of bundles) for (const [k, n] of Object.entries(bundleCounts(b))) exportTotals[k] = (exportTotals[k] ?? 0) + n;
  const dbTotals: Record<string, number> = { permits: await headCount('permits') };
  for (const [k, table] of Object.entries(TABLE_FOR_COUNT)) dbTotals[k] = await headCount(table);
  const totalsRows = [['permits', bundles.length, dbTotals.permits], ...Object.keys(TABLE_FOR_COUNT).map((k) => [k, exportTotals[k] ?? 0, dbTotals[k]])];
  for (const [k, e, d] of totalsRows) if (e !== d) problems.push(`total ${k}: export ${e} vs db ${d}`);

  // Per permit: export vs HEAD counts filtered by permit_id.
  const perPermit: Array<Record<string, unknown>> = [];
  for (const b of bundles) {
    const pid = String(b.permit.id);
    const counts = bundleCounts(b);
    const row: Record<string, unknown> = { permit_number: b.permit.permit_number, portal_project_id: b.permit.portal_record_id };
    let mismatches = 0;
    for (const [k, table] of Object.entries(TABLE_FOR_COUNT)) {
      const db = await headCount(table, pid);
      if (db !== counts[k]) {
        mismatches += 1;
        problems.push(`${String(b.permit.permit_number)} ${k}: export ${counts[k]} vs db ${db}`);
      }
    }
    row.mismatches = mismatches;
    perPermit.push(row);
  }

  // Representative per-permit JSON files.
  const byNumber = new Map(bundles.map((b) => [String(b.permit.permit_number), b]));
  const representative: Array<Record<string, unknown>> = [];
  for (const num of REPRESENTATIVE) {
    const b = byNumber.get(num);
    if (!b) {
      problems.push(`representative permit ${num} not found`);
      continue;
    }
    const json = buildPermitExport(b, now) as Record<string, any>;
    const name = permitDownloadName(b.permit, now);
    writeFileSync(join(outDir, name), JSON.stringify(json, null, 2));
    representative.push({
      permit_number: num,
      portal_project_id: b.permit.portal_record_id,
      file: name,
      sections: Object.fromEntries(PERMIT_SECTIONS.map((s) => [s, json.sections[s].export_status])),
      counts: json.counts,
      binaries_captured: json.data.files.binaries_captured,
      report_content_captured: json.data.reports.content_captured,
    });
  }

  // Full ZIP, then read it back and recount from the files inside.
  const zipBytes = buildDcExportZip(bundles, now);
  const zipName = dcZipName(now);
  writeFileSync(join(outDir, zipName), zipBytes);
  writeFileSync(join(outDir, 'completeness.csv'), buildCompletenessCsv(bundles));
  const files = unzipSync(zipBytes);
  const zipRoot = zipName.replace(/\.zip$/, '');
  const permitFiles = Object.keys(files).filter((f) => f.startsWith(`${zipRoot}/permits/`));
  const zipTotals: Record<string, number> = {};
  for (const f of permitFiles) {
    const j = JSON.parse(strFromU8(files[f]));
    for (const [k, n] of Object.entries(j.counts as Record<string, number>)) zipTotals[k] = (zipTotals[k] ?? 0) + n;
    for (const [k, list] of [['snapshots', j.snapshots], ['changes', j.changes], ['documents', j.data.files.documents], ['reports', j.data.reports.rows]] as const) {
      if ((list as unknown[]).length !== j.counts[k]) problems.push(`${f}: ${k} array ${(list as unknown[]).length} vs counts ${j.counts[k]}`);
    }
  }
  for (const k of Object.keys(TABLE_FOR_COUNT)) if (zipTotals[k] !== dbTotals[k]) problems.push(`zip total ${k}: ${zipTotals[k]} vs db ${dbTotals[k]}`);
  const csv = strFromU8(files[`${zipRoot}/completeness.csv`]).trim().split('\r\n');
  const manifest = JSON.parse(strFromU8(files[`${zipRoot}/manifest.json`]));
  if (permitFiles.length !== dbTotals.permits) problems.push(`zip has ${permitFiles.length} permit files`);
  if (csv.length - 1 !== dbTotals.permits) problems.push(`csv has ${csv.length - 1} rows`);

  // Render the section views with real rows (the same data the page loads) and count what appears.
  const rendered: Array<Record<string, unknown>> = [];
  for (const num of RENDER) {
    const b = byNumber.get(num) as PermitExportBundle | undefined;
    if (!b) continue;
    const d = await loadPermitDetail(String(b.permit.id));
    if (!d) {
      problems.push(`detail ${num} not readable`);
      continue;
    }
    const st = sectionStateMap(d.sections);
    const s = (k: string) => st.get(k) ?? null;
    const r = (el: React.ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el));
    const html = {
      overview: r(createElement(ExtractionOverview, { states: d.sections, snapshots: d.snapshots })),
      status: r(createElement(StatusSectionView, { permit: d.permit, state: s('status'), snapshots: d.snapshots })),
      info: r(createElement(InfoSectionView, { permit: d.permit, state: s('info'), snapshots: d.snapshots })),
      tasks: r(createElement(TasksSectionView, { tasks: d.tasks, state: s('tasks'), snapshots: d.snapshots })),
      workflows: r(createElement(WorkflowsSectionView, { workflows: d.workflows, state: s('workflows'), snapshots: d.snapshots })),
      reviews: r(createElement(ReviewsSectionView, { comments: d.comments, responses: d.responses, state: s('reviews'), snapshots: d.snapshots })),
      files: r(createElement(FilesSectionView, { folders: d.folders, documents: d.documents, state: s('files'), snapshots: d.snapshots })),
      reports: r(createElement(ReportsSectionView, { reports: d.reports, state: s('reports'), snapshots: d.snapshots })),
    };
    const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
    const bodyRows = (h: string) => count(h, /<tr[ >]/g) - count(h, /<thead/g);
    const entry = {
      permit_number: num,
      overview_sections: count(html.overview, /<tr[ >]/g) - 1,
      provenance_blocks: PERMIT_SECTIONS.filter((k) => html[k].includes(`data-section-provenance="${k}"`)).length,
      status_label: /Absent on portal/.test(html.status) ? 'absent' : /Captured/.test(html.status) ? 'captured' : 'other',
      info_has_fields: /Job class/.test(html.info),
      task_rows: bodyRows(html.tasks),
      workflow_and_step_rows: bodyRows(html.workflows),
      review_comments_rendered: count(html.reviews, /data-review-comment/g),
      review_responses_rendered: count(html.reviews, /data-review-response/g),
      review_comments_stored: d.comments.length,
      review_responses_stored: d.responses.length,
      file_table_rows: bodyRows(html.files),
      folders_plus_documents_stored: d.folders.length + d.documents.length,
      files_has_links: /<a\s|href=/.test(html.files),
      report_rows: bodyRows(html.reports),
      snapshot_ids_shown: PERMIT_SECTIONS.filter((k) => /snap|[0-9a-f]{8}-[0-9a-f]{4}/.test(html[k])).length,
    };
    if (entry.review_comments_rendered !== entry.review_comments_stored) problems.push(`${num} rendered ${entry.review_comments_rendered} comments of ${entry.review_comments_stored}`);
    if (entry.review_responses_rendered !== entry.review_responses_stored) problems.push(`${num} rendered ${entry.review_responses_rendered} responses of ${entry.review_responses_stored}`);
    if (entry.file_table_rows !== entry.folders_plus_documents_stored && entry.folders_plus_documents_stored > 0) problems.push(`${num} file rows ${entry.file_table_rows} vs ${entry.folders_plus_documents_stored}`);
    if (entry.files_has_links) problems.push(`${num} files view has a link`);
    if (entry.provenance_blocks !== 7) problems.push(`${num} provenance blocks ${entry.provenance_blocks}`);
    rendered.push(entry);
  }

  const report = {
    generated_at: now.toISOString(),
    supabase_host: host,
    mode: 'read-only (GET/HEAD only), service role standing in for a platform admin',
    output_dir: outDir.replace(`${ROOT}/`, ''),
    totals: totalsRows.map(([table, exported, db]) => ({ table, exported, db })),
    zip: { file: zipName, bytes: zipBytes.length, permit_files: permitFiles.length, csv_rows: csv.length - 1, csv_header: csv[0], section_status: manifest.section_status },
    representative,
    per_permit_mismatches: perPermit.filter((p) => Number(p.mismatches) > 0),
    per_permit_checked: perPermit.length,
    rendered,
    problems,
  };
  writeFileSync(join(outDir, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
