import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  __centralPermitsTestHooks,
  assertPermitExportAllowed,
  currentRows,
  loadPermitExportBundles,
  grantPermitAccess,
  linkProjectToPermit,
  listPermitProjectLinks,
  loadPermitDetail,
  loadProjectPermitLink,
  permitFreshness,
  unlinkProjectFromPermit,
  requestPermitSync,
  searchPermits,
  sectionTone,
  type CentralPermitsClient,
} from './centralPermits';

type Call = { kind: 'rpc' | 'from'; name: string; args?: unknown; ops: Array<[string, unknown[]]> };

function fakeClient(tables: Record<string, Record<string, unknown>[]>, rpcResult: (fn: string) => unknown = () => []) {
  const calls: Call[] = [];
  const client = {
    rpc(fn: string, args?: Record<string, unknown>) {
      calls.push({ kind: 'rpc', name: fn, args, ops: [] });
      const r = rpcResult(fn);
      return Promise.resolve(r instanceof Error ? { data: null, error: { message: r.message } } : { data: r, error: null });
    },
    from(table: string) {
      const call: Call = { kind: 'from', name: table, ops: [] };
      calls.push(call);
      let rows = [...(tables[table] ?? [])];
      const builder = {
        eq(col: string, v: unknown) { call.ops.push(['eq', [col, v]]); rows = rows.filter((r) => r[col] === v); return builder; },
        in(col: string, vs: unknown[]) { call.ops.push(['in', [col, vs]]); rows = rows.filter((r) => vs.includes(r[col])); return builder; },
        range(from: number, to: number) { call.ops.push(['range', [from, to]]); rows = rows.slice(from, to + 1); return builder; },
        is(col: string, v: null) { call.ops.push(['is', [col, v]]); rows = rows.filter((r) => (r[col] ?? null) === v); return builder; },
        order(col: string, o?: unknown) { call.ops.push(['order', [col, o]]); return builder; },
        limit(n: number) { call.ops.push(['limit', [n]]); rows = rows.slice(0, n); return builder; },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return { select: (cols: string) => { call.ops.push(['select', [cols]]); return builder; } };
    },
  } as unknown as CentralPermitsClient;
  return { client, calls };
}

afterEach(() => __centralPermitsTestHooks.setClient(null));

describe('project ↔ permit links (R-1)', () => {
  const permits = [
    { id: 'p1', permit_number: 'D2500488', jurisdiction: 'DC', status_raw: 'Resubmit', last_synced_at: '2026-11-01T00:00:00Z' },
  ];

  it('loadProjectPermitLink returns null without a project id and never queries', async () => {
    const { client, calls } = fakeClient({});
    __centralPermitsTestHooks.setClient(client);
    assert.equal(await loadProjectPermitLink(''), null);
    assert.equal(calls.length, 0);
  });

  it('loadProjectPermitLink returns null when no link exists', async () => {
    const { client } = fakeClient({ project_permits: [], permits });
    __centralPermitsTestHooks.setClient(client);
    assert.equal(await loadProjectPermitLink('proj-1'), null);
  });

  it('loadProjectPermitLink joins the linked permit by id and maps the summary fields', async () => {
    const { client, calls } = fakeClient({
      project_permits: [{ project_id: 'proj-1', permit_id: 'p1' }],
      permits,
    });
    __centralPermitsTestHooks.setClient(client);
    const link = await loadProjectPermitLink('proj-1');
    assert.deepEqual(link, {
      permit_id: 'p1',
      permit_number: 'D2500488',
      jurisdiction: 'DC',
      status_raw: 'Resubmit',
      last_synced_at: '2026-11-01T00:00:00Z',
    });
    assert.deepEqual(calls[0].ops.find((o) => o[0] === 'eq'), ['eq', ['project_id', 'proj-1']]);
    assert.deepEqual(calls[1].ops.find((o) => o[0] === 'eq'), ['eq', ['id', 'p1']]);
  });

  it('listPermitProjectLinks embeds the project name and keeps hidden projects as null', async () => {
    const { client, calls } = fakeClient({
      project_permits: [
        { project_id: 'proj-1', permit_id: 'p1', created_at: '2026-11-02T00:00:00Z', projects: { id: 'proj-1', name: 'Hilltop Annex' } },
        { project_id: 'proj-2', permit_id: 'p1', created_at: '2026-11-03T00:00:00Z', projects: null },
      ],
    });
    __centralPermitsTestHooks.setClient(client);
    const rows = await listPermitProjectLinks('p1');
    assert.deepEqual(rows.map((r) => [r.project_id, r.project_name]), [['proj-1', 'Hilltop Annex'], ['proj-2', null]]);
    assert.equal(calls[0].ops.find((o) => o[0] === 'select')?.[1]?.[0], 'project_id, created_at, projects(id, name)');
    assert.deepEqual(calls[0].ops.find((o) => o[0] === 'eq'), ['eq', ['permit_id', 'p1']]);
  });

  it('linkProjectToPermit and unlinkProjectFromPermit call the audited admin RPCs with the same argument names', async () => {
    const { client, calls } = fakeClient({});
    __centralPermitsTestHooks.setClient(client);
    await linkProjectToPermit('proj-1', 'p1');
    await unlinkProjectFromPermit('proj-1', 'p1');
    assert.deepEqual(calls.map((c) => [c.kind, c.name, c.args]), [
      ['rpc', 'admin_link_project_permit', { p_project_id: 'proj-1', p_permit_id: 'p1' }],
      ['rpc', 'admin_unlink_project_permit', { p_project_id: 'proj-1', p_permit_id: 'p1' }],
    ]);
  });

  it('link and unlink refuse empty ids before any request', async () => {
    const { client, calls } = fakeClient({});
    __centralPermitsTestHooks.setClient(client);
    await assert.rejects(linkProjectToPermit('', 'p1'), /required/);
    await assert.rejects(unlinkProjectFromPermit('proj-1', ''), /required/);
    assert.equal(calls.length, 0);
  });

  it('link surfaces the RPC error (for example, a non-admin caller)', async () => {
    const { client } = fakeClient({}, () => new Error('platform admin required'));
    __centralPermitsTestHooks.setClient(client);
    await assert.rejects(linkProjectToPermit('proj-1', 'p1'), /admin_link_project_permit: platform admin required/);
  });
});

describe('central permits data layer', () => {
  it('searchPermits maps filters to the RLS-scoped RPC and reads the window total', async () => {
    const { client, calls } = fakeClient({}, () => [{ id: 'a', permit_number: 'D1', total_count: '42' }]);
    __centralPermitsTestHooks.setClient(client);
    const r = await searchPermits({ query: '  asbestos ', status: 'resubmit', offset: 25 });
    assert.equal(r.total, 42);
    assert.equal(r.rows.length, 1);
    assert.deepEqual(calls[0], {
      kind: 'rpc', name: 'search_permits', ops: [],
      args: { p_query: 'asbestos', p_status: 'resubmit', p_jurisdiction: null, p_include_removed: false, p_limit: 25, p_offset: 25 },
    });
    const empty = fakeClient({}, () => []);
    __centralPermitsTestHooks.setClient(empty.client);
    assert.deepEqual(await searchPermits({ query: '' }), { rows: [], total: 0 });
    assert.equal((empty.calls[0].args as Record<string, unknown>).p_query, null);
  });

  it('surfaces RPC errors instead of showing an empty list', async () => {
    __centralPermitsTestHooks.setClient(fakeClient({}, () => new Error('permission denied')).client);
    await assert.rejects(searchPermits({}), /search_permits: permission denied/);
  });

  it('loadPermitDetail returns null for unreadable permits and scopes every child query to the permit', async () => {
    const pid = 'p1';
    const { client, calls } = fakeClient({
      permits: [{ id: pid, permit_number: 'D2500488' }],
      permit_review_comments: [{ id: 'c1', permit_id: pid }, { id: 'c2', permit_id: 'other' }],
      permit_changes: [{ id: 'x', permit_id: pid }],
    });
    __centralPermitsTestHooks.setClient(client);
    const d = await loadPermitDetail(pid);
    assert.ok(d);
    assert.equal(d.permit.permit_number, 'D2500488');
    assert.deepEqual(d.comments.map((c) => c.id), ['c1']);
    assert.equal(d.changes.length, 1);
    const childCalls = calls.filter((c) => c.kind === 'from' && c.name !== 'permits');
    assert.equal(childCalls.length, 11);
    assert.ok(childCalls.some((c) => c.name === 'permit_snapshots'), 'detail loads raw snapshots for provenance');
    for (const c of childCalls) assert.deepEqual(c.ops.find(([op]) => op === 'eq'), ['eq', ['permit_id', pid]], c.name);

    __centralPermitsTestHooks.setClient(fakeClient({ permits: [] }).client);
    assert.equal(await loadPermitDetail('hidden'), null);
  });

  it('grantPermitAccess requires exactly one grantee and passes trimmed values', async () => {
    const { client, calls } = fakeClient({}, () => 'g1');
    __centralPermitsTestHooks.setClient(client);
    await assert.rejects(grantPermitAccess({ scope: 'permit', scopeRef: 'p', granteeUserId: 'u', granteeTenantId: 't' }), /exactly one grantee/);
    await assert.rejects(grantPermitAccess({ scope: 'permit', scopeRef: 'p' }), /exactly one grantee/);
    assert.equal(calls.length, 0);
    assert.equal(await grantPermitAccess({ scope: 'adapter', scopeRef: ' dc-projectdox ', granteeUserId: 'u1', note: ' ' }), 'g1');
    assert.deepEqual(calls[0].args, {
      p_scope_type: 'adapter', p_scope_ref: 'dc-projectdox', p_grantee_user_id: 'u1', p_grantee_tenant_id: null, p_note: null,
    });
  });

  it('admin actions call the audited RPCs', async () => {
    const { client, calls } = fakeClient({}, () => 'job-1');
    __centralPermitsTestHooks.setClient(client);
    assert.equal(await requestPermitSync('cred-1'), 'job-1');
    assert.deepEqual(calls[0], { kind: 'rpc', name: 'admin_request_permit_sync', args: { p_credential_id: 'cred-1' }, ops: [] });
  });

  it('child reads page past the 1000-row response cap instead of truncating', async () => {
    const pid = 'p1';
    const documents = Array.from({ length: 2345 }, (_, i) => ({ id: `d${String(i).padStart(5, '0')}`, permit_id: pid }));
    const { client, calls } = fakeClient({ permits: [{ id: pid }], permit_documents: documents });
    __centralPermitsTestHooks.setClient(client);
    const d = await loadPermitDetail(pid);
    assert.equal(d?.documents.length, 2345);
    const ranges = calls.filter((c) => c.name === 'permit_documents').map((c) => c.ops.find(([op]) => op === 'range')?.[1]);
    assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('loadPermitExportBundles groups every table per permit, drops unreadable ids and attaches the writing jobs', async () => {
    const { client, calls } = fakeClient({
      permits: [{ id: 'p1', permit_number: 'A1' }, { id: 'p2', permit_number: 'A2' }],
      permit_section_state: [{ permit_id: 'p1', section: 'status' }, { permit_id: 'p2', section: 'status' }],
      permit_snapshots: [{ id: 's1', permit_id: 'p1', run_id: 'job-1' }, { id: 's2', permit_id: 'p2', run_id: 'job-2' }],
      permit_documents: [{ id: 'd1', permit_id: 'p1' }, { id: 'd2', permit_id: 'p1' }],
      permit_sync_jobs: [{ id: 'job-1' }, { id: 'job-2' }],
    });
    __centralPermitsTestHooks.setClient(client);
    const bundles = await loadPermitExportBundles(['p2', 'p1', 'hidden', 'p1']);
    assert.deepEqual(bundles.map((b) => b.permit.id), ['p2', 'p1']);
    const p1 = bundles[1];
    assert.equal(p1.documents.length, 2);
    assert.deepEqual(p1.jobs.map((j) => j.id), ['job-1']);
    assert.deepEqual(bundles[0].jobs.map((j) => j.id), ['job-2']);
    assert.equal(calls.filter((c) => c.kind === 'rpc').length, 0, 'bundles are plain RLS reads, no RPC');
    for (const c of calls.filter((x) => x.name.startsWith('permit_') && x.name !== 'permit_sync_jobs')) {
      assert.equal(c.ops.find(([op]) => op === 'in')?.[1]?.[0], 'permit_id', c.name);
    }
  });

  it('assertPermitExportAllowed uses the existing admin guard RPC and refuses non-admins', async () => {
    const admin = fakeClient({}, () => null);
    __centralPermitsTestHooks.setClient(admin.client);
    await assertPermitExportAllowed();
    assert.deepEqual(admin.calls.map((c) => c.name), ['_admin_require_platform_admin']);
    __centralPermitsTestHooks.setClient(fakeClient({}, () => new Error('Not authorized')).client);
    await assert.rejects(assertPermitExportAllowed(), /limited to platform admins/);
  });

  it('freshness, section tone and current-row helpers', () => {
    const now = new Date('2026-11-06T12:00:00Z');
    assert.equal(permitFreshness(null, now), 'never');
    assert.equal(permitFreshness('garbage', now), 'never');
    assert.equal(permitFreshness('2026-11-06T00:00:00Z', now), 'fresh');
    assert.equal(permitFreshness('2026-11-04T23:00:00Z', now), 'stale');
    assert.equal(sectionTone('ok'), 'good');
    assert.equal(sectionTone('suspect_empty'), 'warn');
    assert.equal(sectionTone('failed'), 'bad');
    assert.equal(sectionTone('absent'), 'default');
    assert.deepEqual(currentRows([{ id: 1 }, { id: 2, removed_at: '2026-01-01' }]).map((r) => r.id), [1]);
  });
});
