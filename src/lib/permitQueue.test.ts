import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  PERMIT_DOCUMENTS_BUCKET,
  PERMIT_OBJECT_URL_TTL_SECONDS,
  __centralPermitsTestHooks,
  createPermitObjectSignedUrl,
  isMissingSchemaError,
  listReportContentVersions,
  loadPermitQueue,
  loadReportContent,
  type CentralPermitsClient,
  type PermitListRow,
} from './centralPermits';
import {
  PERMIT_QUEUE_TABS,
  buildFolderTree,
  documentViewState,
  filterQueueRows,
  groupFileVersions,
  groupReviews,
  paginate,
  permitQueuePath,
  queueSourceOptions,
  reportContentState,
  reportTable,
} from './permitQueue';

const row = (id: string, over: Partial<PermitListRow> = {}): PermitListRow => ({
  id,
  adapter_key: 'dc-projectdox',
  jurisdiction: 'Washington DC',
  permit_number: id.toUpperCase(),
  title: null,
  description: null,
  address: null,
  status: 'in_review',
  status_raw: 'In Review',
  review_type: null,
  unresolved_comments: 0,
  uncompleted_tasks: 0,
  last_synced_at: null,
  last_changed_at: null,
  removed_from_portal_at: null,
  matched_in: null,
  total_count: 0,
  ...over,
});

type Err = { message: string; code?: string };

/** Minimal PostgREST-shaped fake. `errors[table]` makes every read of that table fail. */
function fakeClient(opts: {
  tables?: Record<string, Record<string, unknown>[]>;
  errors?: Record<string, Err>;
  rpc?: (fn: string, args: Record<string, unknown>) => unknown;
  signed?: (bucket: string, path: string, ttl: number) => { data: { signedUrl: string } | null; error: Err | null };
}) {
  const calls: Array<{ table?: string; fn?: string; args?: Record<string, unknown>; ops: Array<[string, unknown[]]> }> = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown> = {}) {
      calls.push({ fn, args, ops: [] });
      return Promise.resolve({ data: opts.rpc ? opts.rpc(fn, args) : [], error: null });
    },
    from(table: string) {
      const call = { table, ops: [] as Array<[string, unknown[]]> };
      calls.push(call);
      let rows = [...(opts.tables?.[table] ?? [])];
      const err = opts.errors?.[table] ?? null;
      const result = () => (err ? { data: null, error: err } : { data: rows, error: null });
      const builder = {
        eq(c: string, v: unknown) { call.ops.push(['eq', [c, v]]); rows = rows.filter((r) => r[c] === v); return builder; },
        in(c: string, vs: unknown[]) { call.ops.push(['in', [c, vs]]); rows = rows.filter((r) => vs.includes(r[c])); return builder; },
        is() { return builder; },
        order(c: string) { call.ops.push(['order', [c]]); return builder; },
        limit(n: number) { rows = rows.slice(0, n); return builder; },
        range(from: number, to: number) { rows = rows.slice(from, to + 1); return builder; },
        maybeSingle() { return Promise.resolve(err ? { data: null, error: err } : { data: rows[0] ?? null, error: null }); },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(result()).then(res, rej); },
      };
      return { select: (cols: string) => { call.ops.push(['select', [cols]]); return builder; } };
    },
    storage: {
      from(bucket: string) {
        return {
          createSignedUrl(path: string, ttl: number) {
            calls.push({ fn: 'createSignedUrl', args: { bucket, path, ttl }, ops: [] });
            return Promise.resolve(opts.signed ? opts.signed(bucket, path, ttl) : { data: { signedUrl: `https://signed/${path}` }, error: null });
          },
        };
      },
    },
  } as unknown as CentralPermitsClient;
  return { client, calls };
}

afterEach(() => __centralPermitsTestHooks.setClient(null));

describe('permit queue list helpers', () => {
  it('paths point at /permit-queue', () => {
    assert.equal(permitQueuePath(), '/permit-queue');
    assert.equal(permitQueuePath('abc'), '/permit-queue/abc');
  });

  it('detail tabs follow the portal order', () => {
    assert.deepEqual([...PERMIT_QUEUE_TABS], ['tasks', 'files', 'status', 'info', 'reports', 'reviews']);
  });

  it('filters by jurisdiction/adapter and by project link', () => {
    const rows = [row('a'), row('b', { adapter_key: 'other', jurisdiction: 'Arlington' }), row('c')];
    const links = new Map([['a', 1]]);
    const opts = queueSourceOptions(rows);
    assert.deepEqual(opts.map((o) => o.label), ['Arlington (other)', 'Washington DC (dc-projectdox)']);
    const dc = opts.find((o) => o.label.startsWith('Washington'))!.value;
    assert.deepEqual(filterQueueRows(rows, links, { source: dc, linked: 'all' }).map((r) => r.id), ['a', 'c']);
    assert.deepEqual(filterQueueRows(rows, links, { source: 'all', linked: 'linked' }).map((r) => r.id), ['a']);
    assert.deepEqual(filterQueueRows(rows, links, { source: dc, linked: 'unlinked' }).map((r) => r.id), ['c']);
  });

  it('paginates and clamps the page number', () => {
    const list = Array.from({ length: 30 }, (_, i) => i);
    assert.deepEqual(paginate(list, 2, 25), { rows: [25, 26, 27, 28, 29], page: 2, pages: 2, total: 30 });
    assert.equal(paginate(list, 9, 25).page, 2);
    assert.equal(paginate([], 1, 25).pages, 1);
  });
});

describe('loadPermitQueue', () => {
  it('pages search_permits at 200 rows and counts project links', async () => {
    const all = Array.from({ length: 205 }, (_, i) => row(`p${i}`, { total_count: 205 }));
    const { client, calls } = fakeClient({
      tables: { project_permits: [{ permit_id: 'p1', project_id: 'x' }, { permit_id: 'p1', project_id: 'y' }, { permit_id: 'p3', project_id: 'z' }] },
      rpc: (_fn, args) => all.slice(Number(args.p_offset), Number(args.p_offset) + Number(args.p_limit)),
    });
    __centralPermitsTestHooks.setClient(client);
    const data = await loadPermitQueue({ query: 'x', status: 'resubmit' });
    assert.equal(data.rows.length, 205);
    const rpcCalls = calls.filter((c) => c.fn === 'search_permits');
    assert.deepEqual(rpcCalls.map((c) => [c.args?.p_offset, c.args?.p_limit, c.args?.p_status]), [[0, 200, 'resubmit'], [200, 200, 'resubmit']]);
    assert.equal(data.linkCounts.get('p1'), 2);
    assert.equal(data.linkCounts.get('p3'), 1);
    assert.equal(data.linkError, null);
  });

  it('still returns the list when project links cannot be read', async () => {
    const { client } = fakeClient({ errors: { project_permits: { message: 'permission denied' } }, rpc: () => [row('a', { total_count: 1 })] });
    __centralPermitsTestHooks.setClient(client);
    const data = await loadPermitQueue({});
    assert.equal(data.rows.length, 1);
    assert.match(String(data.linkError), /permission denied/);
  });
});

describe('files: viewer gating, versions and folder tree', () => {
  it('opens a file only when it is stored with a storage path', () => {
    assert.equal(documentViewState({ download_status: 'stored', storage_path: 'p/files/1_a.pdf' }), 'viewable');
    assert.equal(documentViewState({ download_status: 'stored', storage_path: null }), 'not_captured');
    assert.equal(documentViewState({ download_status: 'stored', storage_path: '' }), 'not_captured');
    assert.equal(documentViewState({ download_status: 'not_requested', storage_path: 'p/x', download_permitted: true }), 'not_captured');
    assert.equal(documentViewState({ download_status: 'not_requested', download_permitted: false }), 'not_downloadable');
    assert.equal(documentViewState({ download_status: 'not_permitted' }), 'not_downloadable');
    assert.equal(documentViewState({ download_status: 'failed', download_permitted: true }), 'not_captured');
  });

  it('groups versions of one file, newest first', () => {
    const groups = groupFileVersions([
      { id: '1', portal_folder_id: 'f', file_name: 'A-101.pdf', version: 1 },
      { id: '2', portal_folder_id: 'f', file_name: 'A-101.pdf', version: 3 },
      { id: '3', portal_folder_id: 'f', file_name: 'B.pdf', version: 1 },
      { id: '4', portal_folder_id: 'g', file_name: 'A-101.pdf', version: 1 },
    ]);
    assert.equal(groups.length, 3);
    const a = groups.find((g) => g.key === 'f::a-101.pdf')!;
    assert.deepEqual(a.versions.map((v) => v.id), ['2', '1']);
    assert.equal(a.latest.id, '2');
  });

  it('builds the folder tree from parent_portal_folder_id, cuts cycles and keeps unfiled files', () => {
    const { roots, unfiled } = buildFolderTree(
      [
        { id: 'r', portal_folder_id: '1', name: 'Drawings', parent_portal_folder_id: null },
        { id: 's', portal_folder_id: '2', name: 'Architectural', parent_portal_folder_id: '1' },
        { id: 'o', portal_folder_id: '3', name: 'Orphan', parent_portal_folder_id: '999' },
        { id: 'c1', portal_folder_id: '4', name: 'Loop A', parent_portal_folder_id: '5' },
        { id: 'c2', portal_folder_id: '5', name: 'Loop B', parent_portal_folder_id: '4' },
      ],
      [
        { id: 'd1', portal_folder_id: '2', file_name: 'A-101.pdf', version: 1 },
        { id: 'd2', portal_folder_id: '1', file_name: 'Cover.pdf', version: 1 },
        { id: 'd3', portal_folder_id: 'zzz', file_name: 'Lost.pdf', version: 1 },
      ],
    );
    const names = (ns: typeof roots): string[] => ns.flatMap((n) => [String(n.folder.name), ...names(n.children)]);
    assert.deepEqual(names(roots).sort(), ['Architectural', 'Drawings', 'Loop A', 'Loop B', 'Orphan']);
    const drawings = roots.find((n) => n.folder.name === 'Drawings')!;
    assert.equal(drawings.children[0].folder.name, 'Architectural');
    assert.equal(drawings.totalFiles, 2);
    assert.deepEqual(unfiled.map((g) => g.latest.id), ['d3']);
  });
});

describe('reports: content gating', () => {
  it('is captured only with status captured and a latest content id', () => {
    assert.equal(reportContentState({ content_status: 'captured', latest_content_id: 'c1' }), 'captured');
    assert.equal(reportContentState({ content_status: 'captured', latest_content_id: null }), 'not_captured');
    assert.equal(reportContentState({ content_status: 'failed' }), 'failed');
    assert.equal(reportContentState({ content_status: 'not_captured' }), 'not_captured');
    // Migration not applied: the columns are missing.
    assert.equal(reportContentState({ report_key: '14', name: 'Plan Review' }), 'not_captured');
  });

  it('turns structured rows (objects or arrays) into a table', () => {
    assert.deepEqual(reportTable([{ a: 1, b: 'x' }, { a: 2, c: { d: 1 } }]), { columns: ['a', 'b', 'c'], body: [['1', 'x', ''], ['2', '', '{"d":1}']] });
    assert.deepEqual(reportTable([['H1', 'H2'], ['v1', 'v2']]), { columns: ['H1', 'H2'], body: [['v1', 'v2']] });
    assert.deepEqual(reportTable(null), { columns: [], body: [] });
  });

  it('missing table or column errors are recognised', () => {
    assert.equal(isMissingSchemaError({ code: 'PGRST205', message: "Could not find the table 'public.permit_report_contents' in the schema cache" }), true);
    assert.equal(isMissingSchemaError({ code: '42P01', message: 'relation does not exist' }), true);
    assert.equal(isMissingSchemaError({ code: '42703', message: 'column x does not exist' }), true);
    assert.equal(isMissingSchemaError({ code: '42501', message: 'permission denied' }), false);
    assert.equal(isMissingSchemaError(null), false);
  });

  it('report content loaders degrade to "none" when the deep-capture table is missing', async () => {
    const missing = { code: 'PGRST205', message: "Could not find the table 'public.permit_report_contents' in the schema cache" };
    const { client } = fakeClient({ errors: { permit_report_contents: missing } });
    __centralPermitsTestHooks.setClient(client);
    assert.equal(await loadReportContent('c1'), null);
    assert.deepEqual(await listReportContentVersions('p1', '14'), []);
  });

  it('report content loaders surface other errors', async () => {
    const { client } = fakeClient({ errors: { permit_report_contents: { code: '500', message: 'boom' } } });
    __centralPermitsTestHooks.setClient(client);
    await assert.rejects(() => loadReportContent('c1'), /boom/);
  });

  it('loads the requested version and lists versions newest first', async () => {
    const { client, calls } = fakeClient({
      tables: {
        permit_report_contents: [
          { id: 'c1', permit_id: 'p1', report_key: '14', version: 1 },
          { id: 'c2', permit_id: 'p1', report_key: '14', version: 2, text_content: 'Comments' },
        ],
      },
    });
    __centralPermitsTestHooks.setClient(client);
    assert.equal((await loadReportContent('c2'))?.text_content, 'Comments');
    await listReportContentVersions('p1', '14');
    const versionCall = calls.filter((c) => c.table === 'permit_report_contents').at(-1)!;
    assert.deepEqual(versionCall.ops.filter((o) => o[0] === 'eq'), [['eq', ['permit_id', 'p1']], ['eq', ['report_key', '14']]]);
    assert.doesNotMatch(String(versionCall.ops.find((o) => o[0] === 'select')?.[1][0]), /text_content/);
    assert.equal(await loadReportContent(''), null);
  });
});

describe('signed URLs for stored objects', () => {
  it('asks the private permit-documents bucket for a 300-second URL', async () => {
    const { client, calls } = fakeClient({});
    __centralPermitsTestHooks.setClient(client);
    assert.equal(await createPermitObjectSignedUrl('p1/files/9_A.pdf'), 'https://signed/p1/files/9_A.pdf');
    assert.equal(PERMIT_DOCUMENTS_BUCKET, 'permit-documents');
    assert.equal(PERMIT_OBJECT_URL_TTL_SECONDS, 300);
    assert.deepEqual(calls.at(-1)?.args, { bucket: 'permit-documents', path: 'p1/files/9_A.pdf', ttl: 300 });
  });

  it('stays outside the local read-only write guard, so files and reports open under VITE_LOCAL_PERMIT_INSPECTION', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./centralPermits.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export async function createPermitObjectSignedUrl'));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    assert.doesNotMatch(fn, /assertPermitWritesAllowed/);
    const queueSrc = readFileSync(new URL('./permitQueue.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(queueSrc, /assertPermitWritesAllowed/, 'the queue only reads');
  });

  it('fails without a path or when storage RLS refuses', async () => {
    const { client } = fakeClient({ signed: () => ({ data: null, error: { message: 'Object not found' } }) });
    __centralPermitsTestHooks.setClient(client);
    await assert.rejects(() => createPermitObjectSignedUrl(''), /No stored copy/);
    await assert.rejects(() => createPermitObjectSignedUrl('p1/files/x'), /Object not found/);
  });
});

describe('reviews grouping', () => {
  it('groups by cycle (newest first), then department, with threads in order', () => {
    const groups = groupReviews(
      [
        { id: '1', portal_comment_key: 'k1', cycle: 1, department: 'Zoning', ref_number: 2, status: 'Resolved' },
        { id: '2', portal_comment_key: 'k2', cycle: 2, department: 'Zoning', ref_number: 5, status: 'Unresolved' },
        { id: '3', portal_comment_key: 'k3', cycle: 2, department: 'Fire', ref_number: 1, status: 'Unresolved' },
        { id: '4', portal_comment_key: 'k4', cycle: 2, department: 'Zoning', ref_number: 3, status: 'Resolved' },
        { id: '5', portal_comment_key: 'k5', cycle: null, department: null, ref_number: 1 },
      ],
      [
        { id: 'r2', comment_key: 'k2', seq: 2, body: 'second' },
        { id: 'r1', comment_key: 'k2', seq: 1, body: 'first' },
      ],
    );
    assert.deepEqual(groups.map((g) => g.cycle), ['2', '1', '?']);
    assert.deepEqual(groups[0].departments.map((d) => d.department), ['Fire', 'Zoning']);
    assert.deepEqual(groups[0].departments[1].cards.map((c) => c.comment.id), ['4', '2']);
    assert.deepEqual(groups[0].departments[1].cards[1].thread.map((r) => r.id), ['r1', 'r2']);
    assert.equal(groups[0].total, 3);
    assert.equal(groups[0].unresolved, 2);
    assert.equal(groups[2].departments[0].department, 'General');
  });
});
