import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { __centralPermitsTestHooks, type CentralPermitsClient, type PermitExportBundle } from './centralPermits';
import {
  COMPLETENESS_COLUMNS,
  PERMIT_EXPORT_SCHEMA,
  buildCompletenessCsv,
  buildDcExportZip,
  buildPermitExport,
  dcZipName,
  exportDcPermitsZip,
  exportPermitJson,
  permitDownloadName,
} from './permitExport';
import { PERMIT_SECTIONS, classifySectionState } from './permitSections';

type Row = Record<string, unknown>;
const NOW = new Date('2026-11-11T04:30:00.000Z');

function bundle(over: Partial<PermitExportBundle> = {}): PermitExportBundle {
  const pid = 'p-1';
  const ok = (section: string, extra: Row = {}) => ({ permit_id: pid, section, status: 'ok', source_kind: 'json', item_count: 1, ...extra });
  return {
    permit: { id: pid, adapter_key: 'dc-projectdox', portal_record_id: '100', permit_number: 'X1', status_raw: 'Resubmit', search_tsv: "'x1':1" },
    section_states: [ok('status'), ok('info', { source_kind: 'html' }), ok('tasks'), ok('workflows'), ok('reviews'), ok('files'), ok('reports')],
    snapshots: [
      { id: 'snap-status-old', permit_id: pid, section: 'status', run_id: 'job-0', captured_at: '2026-11-11T03:00:00Z', payload: { SubWorkflows: [] } },
      { id: 'snap-status', permit_id: pid, section: 'status', run_id: 'job-1', captured_at: '2026-11-11T03:40:00Z', payload: { ProjectStatus: 'Resubmit', SubWorkflows: [{ SubWorkflow: 'Building', UncompletedTasks: [] }] } },
      { id: 'snap-info', permit_id: pid, section: 'info', run_id: 'job-1', captured_at: '2026-11-11T03:40:01Z', payload: { address: '1 Test St', jobClass: 'Alteration', latitude: null } },
    ],
    changes: [{ id: 'c1', permit_id: pid }, { id: 'c2', permit_id: pid }],
    workflows: [{ id: 'w1', permit_id: pid }],
    tasks: [{ id: 't1', permit_id: pid }],
    review_comments: [{ id: 'rc1', permit_id: pid }, { id: 'rc2', permit_id: pid }],
    review_responses: [{ id: 'rr1', permit_id: pid }],
    document_folders: [{ id: 'f1', permit_id: pid }],
    documents: [{ id: 'd1', permit_id: pid, download_status: 'not_permitted' }, { id: 'd2', permit_id: pid, download_status: 'not_permitted' }],
    reports: [{ id: 'r1', permit_id: pid, name: 'Plan Review - Review Comments', portal_report_id: '14' }],
    source_links: [{ permit_id: pid, credential_id: 'cred-1' }],
    jobs: [{ id: 'job-1', status: 'completed' }],
    ...over,
  };
}

describe('section extraction status', () => {
  it('distinguishes captured, partial, absent, inaccessible and not captured', () => {
    assert.equal(classifySectionState({ status: 'ok' }).status, 'ok');
    assert.equal(classifySectionState({ status: 'suspect_empty' }).status, 'partial');
    assert.equal(classifySectionState({ status: 'partial', last_error: 'unresolved_parity:1/2' }).status, 'partial');
    assert.equal(classifySectionState({ status: 'absent' }).status, 'absent');
    assert.equal(classifySectionState({ status: 'failed', last_error: 'safety_violation: not_allowlisted' }).status, 'inaccessible');
    assert.equal(classifySectionState({ status: 'failed', last_error: 'portal API answered 403' }).status, 'inaccessible');
    assert.equal(classifySectionState({ status: 'failed', last_error: 'parse error: unexpected token' }).status, 'not_captured');
    assert.equal(classifySectionState(null).status, 'not_captured');
    assert.equal(classifySectionState(undefined).status, 'not_captured');
  });
});

describe('per-permit JSON export', () => {
  it('has every section with an explicit status, provenance, raw snapshots, structured rows and changes', () => {
    const out = buildPermitExport(bundle(), NOW) as Record<string, any>;
    assert.equal(out.schema, PERMIT_EXPORT_SCHEMA);
    assert.equal(out.exported_at, NOW.toISOString());
    assert.equal(out.permit.permit_number, 'X1');
    assert.equal('search_tsv' in out.permit, false);
    assert.deepEqual(Object.keys(out.sections), [...PERMIT_SECTIONS]);
    for (const s of PERMIT_SECTIONS) {
      assert.equal(out.sections[s].export_status, 'ok', s);
      assert.ok(out.sections[s].source_routes.length, s);
    }
    assert.equal(out.sections.status.latest_snapshot_id, 'snap-status');
    assert.equal(out.sections.status.snapshot_count, 2);
    assert.equal(out.sections.status.latest_run_id, 'job-1');
    assert.deepEqual(out.provenance.run_ids, ['job-0', 'job-1']);
    assert.match(out.provenance.portal_page_url, /ProjectID=100$/);
    assert.equal(out.data.status.portal_status.ProjectStatus, 'Resubmit');
    assert.equal(out.data.workflows.review_steps_from_status.length, 1);
    assert.equal(out.data.info.portal_fields.jobClass, 'Alteration');
    assert.equal(out.sections.info.rows.info_fields, 2);
    assert.equal(out.data.files.binaries_captured, false);
    assert.match(out.data.files.note, /binaries were not captured/);
    assert.equal(out.data.reports.content_captured, false);
    assert.match(out.data.reports.note, /Metadata only/);
    assert.equal(out.snapshots.length, 3);
    assert.equal(out.changes.length, 2);
    assert.deepEqual(out.counts, {
      section_states: 7, snapshots: 3, changes: 2, workflows: 1, tasks: 1, review_comments: 2, review_responses: 1,
      document_folders: 1, documents: 2, reports: 1, source_links: 1,
    });
  });

  it('marks absent and missing sections explicitly instead of dropping them', () => {
    const b = bundle({
      section_states: bundle().section_states.map((s) => (s.section === 'status' || s.section === 'reviews' ? { ...s, status: 'absent', item_count: null } : s)).filter((s) => s.section !== 'reports'),
      snapshots: [],
      reports: [],
    });
    const out = buildPermitExport(b, NOW) as Record<string, any>;
    assert.equal(out.sections.status.export_status, 'absent');
    assert.equal(out.sections.reviews.export_status, 'absent');
    assert.equal(out.sections.reports.export_status, 'not_captured');
    assert.equal(out.sections.reports.db_status, null);
    assert.equal(out.data.status.portal_status, null);
  });
});

describe('completeness.csv', () => {
  it('has the documented columns and one status per section', () => {
    const absent = bundle({
      permit: { ...bundle().permit, id: 'p-2', permit_number: 'TL9', portal_record_id: '200' },
      section_states: bundle().section_states.map((s) => (s.section === 'status' ? { ...s, status: 'absent' } : s.section === 'files' ? { ...s, status: 'failed', last_error: 'session_ended: 401' } : s)),
    });
    const csv = buildCompletenessCsv([bundle(), absent]);
    const [header, first, second] = csv.trim().split('\r\n');
    assert.deepEqual(header.split(','), [...COMPLETENESS_COLUMNS]);
    for (const s of PERMIT_SECTIONS) assert.ok(header.split(',').includes(`${s}_extraction`), s);
    const col = (line: string, name: string) => line.split(',')[COMPLETENESS_COLUMNS.indexOf(name as never)];
    assert.equal(col(first, 'permit_number'), 'X1');
    assert.equal(col(first, 'status_extraction'), 'ok');
    assert.equal(col(first, 'documents'), '2');
    assert.equal(col(first, 'review_comments'), '2');
    assert.equal(col(first, 'document_binaries_stored'), '0');
    assert.equal(col(first, 'captured_at'), '2026-11-11T03:40:01Z');
    assert.equal(col(second, 'status_extraction'), 'absent');
    assert.equal(col(second, 'files_extraction'), 'inaccessible');
    const values = new Set(PERMIT_SECTIONS.flatMap((s) => [col(first, `${s}_extraction`), col(second, `${s}_extraction`)]));
    for (const v of values) assert.ok(['ok', 'partial', 'absent', 'inaccessible', 'not_captured'].includes(v), v);
  });

  it('quotes commas and neutralises spreadsheet formulas', () => {
    const csv = buildCompletenessCsv([bundle({ permit: { ...bundle().permit, permit_number: '=HYPERLINK("x")', status_raw: 'In Review, hold' } })]);
    assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
    assert.match(csv, /"In Review, hold"/);
  });
});

describe('DC zip', () => {
  it('contains one JSON per permit, completeness.csv and a manifest with totals', () => {
    const b2 = bundle({ permit: { ...bundle().permit, id: 'p-2', permit_number: 'TL9', portal_record_id: '200' } });
    const files = unzipSync(buildDcExportZip([bundle(), b2], NOW));
    const root = dcZipName(NOW).replace(/\.zip$/, '');
    assert.equal(root, 'permitpilot-dc-permits-20261111T043000Z');
    assert.deepEqual(Object.keys(files).sort(), [
      `${root}/completeness.csv`,
      `${root}/manifest.json`,
      `${root}/permits/permit-TL9-200.json`,
      `${root}/permits/permit-X1-100.json`,
    ]);
    const manifest = JSON.parse(strFromU8(files[`${root}/manifest.json`]));
    assert.equal(manifest.permit_count, 2);
    assert.equal(manifest.totals.documents, 4);
    assert.equal(manifest.totals.section_states, 14);
    assert.equal(manifest.section_status.status.ok, 2);
    const one = JSON.parse(strFromU8(files[`${root}/permits/permit-X1-100.json`]));
    assert.equal(one.permit.id, 'p-1');
    assert.equal(permitDownloadName(bundle().permit, NOW), 'permit-X1-100-20261111T043000Z.json');
  });
});

describe('export gating', () => {
  afterEach(() => __centralPermitsTestHooks.setClient(null));

  function client(isAdmin: boolean) {
    const reads: string[] = [];
    const c = {
      rpc: (fn: string) => Promise.resolve(fn === '_admin_require_platform_admin' && !isAdmin ? { data: null, error: { message: 'Not authorized' } } : { data: null, error: null }),
      from(table: string) {
        reads.push(table);
        const b: any = {
          eq: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
        };
        return { select: () => b };
      },
    } as unknown as CentralPermitsClient;
    return { c, reads };
  }

  it('non-admins are refused before any permit table is read', async () => {
    const { c, reads } = client(false);
    __centralPermitsTestHooks.setClient(c);
    await assert.rejects(exportPermitJson('p-1', NOW), /limited to platform admins/);
    await assert.rejects(exportDcPermitsZip(NOW), /limited to platform admins/);
    assert.deepEqual(reads, []);
  });

  it('an admin whose RLS read returns nothing gets "not found", never an empty file', async () => {
    const { c, reads } = client(true);
    __centralPermitsTestHooks.setClient(c);
    await assert.rejects(exportPermitJson('p-1', NOW), /not found/);
    assert.deepEqual(reads, ['permits']);
  });
});
