// Run: node --import tsx --test supabase/functions/_shared/serviceExecution.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTING_USER_HEADER,
  authorizeServiceExecution,
  buildServiceAuditRow,
  parseServiceHeaders,
  SERVICE_EXECUTION_ACTION,
  SERVICE_EXECUTION_DENIED_ACTION,
  SERVICE_SECRET_HEADER,
  serviceForwardHeaders,
  serviceUserResponse,
  timingSafeEqual,
  writeServiceExecutionAudit,
  type ServiceAdminClient,
} from "./serviceExecution.ts";

const SECRET = "test-pipeline-secret-value";
const ROLE_KEY = "test-service-role-key-value";
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const FN = "intake-pipeline-agent";
const ENV = { serviceSecret: SECRET, serviceRoleKey: ROLE_KEY };

type FakeState = {
  projects: Record<string, { id: string; user_id: string }>;
  access: boolean | { error: string };
  links: string[];
  auditError?: string;
};

function fakeAdmin(state: Partial<FakeState> = {}) {
  const s: FakeState = {
    projects: { [PROJECT]: { id: PROJECT, user_id: OWNER } },
    access: true,
    links: [PROJECT],
    ...state,
  };
  const audit: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const client: ServiceAdminClient = {
    from(table: string) {
      calls.push(table);
      const filters: Record<string, unknown> = {};
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        maybeSingle: async () => {
          if (table !== "projects") throw new Error(`unexpected maybeSingle on ${table}`);
          return { data: s.projects[filters.id as string] ?? null, error: null };
        },
        limit: async () => {
          if (table !== "project_permits") throw new Error(`unexpected limit on ${table}`);
          const rows = s.links.filter((p) => p === filters.project_id).map((p) => ({ project_id: p }));
          return { data: rows, error: null };
        },
        insert: async (row: Record<string, unknown>) => {
          if (table !== "platform_audit_events") throw new Error(`unexpected insert on ${table}`);
          if (s.auditError) return { data: null, error: { message: s.auditError } };
          audit.push(row);
          return { data: null, error: null };
        },
      };
      return builder;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (typeof s.access === "object") return { data: null, error: { message: s.access.error } };
      return { data: s.access, error: null };
    },
  };
  return { client, audit, calls, rpcCalls };
}

function headers(h: Record<string, string>) {
  return new Headers(h);
}

function serviceHeaders(over: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    Authorization: `Bearer ${ROLE_KEY}`,
    [SERVICE_SECRET_HEADER]: SECRET,
    [ACTING_USER_HEADER]: OWNER,
    ...over,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) out[k] = v;
  return headers(out);
}

function assertNoSecrets(row: unknown) {
  const text = JSON.stringify(row);
  assert.ok(!text.includes(SECRET), "audit row must not contain the pipeline secret");
  assert.ok(!text.includes(ROLE_KEY), "audit row must not contain the service role key");
}

test("timingSafeEqual: equal, different, different length, empty", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), false);
  assert.equal(timingSafeEqual(null, "a"), false);
  assert.equal(timingSafeEqual("a", undefined), false);
});

test("parseServiceHeaders: absent vs present", () => {
  assert.equal(parseServiceHeaders(headers({ Authorization: "Bearer user.jwt" })).present, false);
  const p = parseServiceHeaders(serviceHeaders());
  assert.equal(p.present, true);
  assert.equal(p.bearer, ROLE_KEY);
  assert.equal(p.actingUser, OWNER);
  assert.equal(parseServiceHeaders(headers({ [ACTING_USER_HEADER]: OWNER })).present, true);
});

test("user mode: no service headers returns user mode and touches nothing", async () => {
  const f = fakeAdmin();
  let factoryCalls = 0;
  let projectReads = 0;
  const r = await authorizeServiceExecution({
    headers: headers({ Authorization: "Bearer user.jwt.token" }),
    env: ENV,
    admin: () => {
      factoryCalls++;
      return f.client;
    },
    projectId: () => {
      projectReads++;
      return PROJECT;
    },
    functionName: FN,
  });
  assert.deepEqual(r, { mode: "user" });
  assert.equal(factoryCalls, 0);
  assert.equal(projectReads, 0);
  assert.deepEqual(f.calls, []);
});

test("user mode is the same even when service mode is disabled", async () => {
  const r = await authorizeServiceExecution({
    headers: headers({ Authorization: "Bearer user.jwt.token" }),
    env: {},
    admin: fakeAdmin().client,
    projectId: PROJECT,
    functionName: FN,
  });
  assert.deepEqual(r, { mode: "user" });
});

for (const [label, env] of [
  ["secret unset", { serviceRoleKey: ROLE_KEY }],
  ["secret empty", { serviceSecret: "", serviceRoleKey: ROLE_KEY }],
  ["secret whitespace", { serviceSecret: "   ", serviceRoleKey: ROLE_KEY }],
  ["role key unset", { serviceSecret: SECRET }],
] as const) {
  test(`disabled (${label}): service headers rejected 401, no audit, no DB`, async () => {
    const f = fakeAdmin();
    const r = await authorizeServiceExecution({
      headers: serviceHeaders(),
      env,
      admin: f.client,
      projectId: PROJECT,
      functionName: FN,
    });
    assert.deepEqual(r, { error: "Service execution disabled", status: 401 });
    assert.deepEqual(f.calls, []);
  });
}

test("wrong secret: 401, no audit, admin factory never called", async () => {
  let factoryCalls = 0;
  const r = await authorizeServiceExecution({
    headers: serviceHeaders({ [SERVICE_SECRET_HEADER]: "nope" }),
    env: ENV,
    admin: () => {
      factoryCalls++;
      return fakeAdmin().client;
    },
    projectId: PROJECT,
    functionName: FN,
  });
  assert.deepEqual(r, { error: "Invalid service credentials", status: 401 });
  assert.equal(factoryCalls, 0);
});

test("partial: acting user header only (no secret) is 401, never user mode", async () => {
  const f = fakeAdmin();
  const r = await authorizeServiceExecution({
    headers: headers({ Authorization: "Bearer user.jwt.token", [ACTING_USER_HEADER]: OWNER }),
    env: ENV,
    admin: f.client,
    projectId: PROJECT,
    functionName: FN,
  });
  assert.equal("error" in r && r.status, 401);
  assert.deepEqual(f.calls, []);
});

test("partial: empty secret header is 401", async () => {
  const r = await authorizeServiceExecution({
    headers: serviceHeaders({ [SERVICE_SECRET_HEADER]: "" }),
    env: ENV,
    admin: fakeAdmin().client,
    projectId: PROJECT,
    functionName: FN,
  });
  assert.equal("error" in r && r.status, 401);
});

test("wrong bearer (user JWT with valid secret): 401 and denied audit row", async () => {
  const f = fakeAdmin();
  const r = await authorizeServiceExecution({
    headers: serviceHeaders({ Authorization: "Bearer user.jwt.token" }),
    env: ENV,
    admin: f.client,
    projectId: PROJECT,
    functionName: FN,
  });
  assert.deepEqual(r, { error: "Invalid service credentials", status: 401 });
  assert.equal(f.audit.length, 1);
  assert.equal(f.audit[0].action, SERVICE_EXECUTION_DENIED_ACTION);
  assert.equal(f.audit[0].result, "failure");
  assert.equal((f.audit[0].after_json as any).reason, "bearer_mismatch");
  assertNoSecrets(f.audit[0]);
});

test("missing Authorization with valid secret: 401", async () => {
  const f = fakeAdmin();
  const r = await authorizeServiceExecution({
    headers: serviceHeaders({ Authorization: undefined }),
    env: ENV,
    admin: f.client,
    projectId: PROJECT,
    functionName: FN,
  });
  assert.equal("error" in r && r.status, 401);
  assert.equal(f.audit.length, 1);
});

test("D-075: an sb_secret bearer or an apikey-only call is refused while the function compares the legacy key", async () => {
  const newFormatKey = ["sb", "secret", "fake"].join("_");
  for (const over of [
    { Authorization: `Bearer ${newFormatKey}` },
    { Authorization: undefined, apikey: ROLE_KEY },
    { Authorization: undefined, apikey: newFormatKey },
  ]) {
    const f = fakeAdmin();
    const r = await authorizeServiceExecution({ headers: serviceHeaders(over), env: ENV, admin: f.client, projectId: PROJECT, functionName: FN });
    assert.deepEqual(r, { error: "Invalid service credentials", status: 401 }, JSON.stringify(Object.keys(over)));
    assert.equal((f.audit[0].after_json as any).reason, "bearer_mismatch");
    assertNoSecrets(f.audit[0]);
  }
});

test("bad acting-user uuid: 401, raw header not stored in audit", async () => {
  const f = fakeAdmin();
  const r = await authorizeServiceExecution({
    headers: serviceHeaders({ [ACTING_USER_HEADER]: "not-a-uuid" }),
    env: ENV,
    admin: f.client,
    projectId: PROJECT,
    functionName: FN,
  });
  assert.deepEqual(r, { error: "Invalid service credentials", status: 401 });
  assert.equal(f.audit.length, 1);
  assert.equal((f.audit[0].after_json as any).reason, "acting_user_invalid");
  assert.equal((f.audit[0].after_json as any).acting_user_id, null);
  assert.ok(!JSON.stringify(f.audit[0]).includes("not-a-uuid"));
  assert.deepEqual(f.calls, ["platform_audit_events"]);
});

test("project_id missing: 400 and audited", async () => {
  const f = fakeAdmin();
  const r = await authorizeServiceExecution({
    headers: serviceHeaders(),
    env: ENV,
    admin: f.client,
    projectId: async () => undefined,
    functionName: FN,
  });
  assert.deepEqual(r, { error: "project_id is required", status: 400 });
  assert.equal((f.audit[0].after_json as any).reason, "project_id_missing");
});

test("project missing: 403, audit has no project_id FK", async () => {
  const f = fakeAdmin({ projects: {} });
  const r = await authorizeServiceExecution({
    headers: serviceHeaders(),
    env: ENV,
    admin: f.client,
    projectId: PROJECT,
    functionName: FN,
  });
  assert.deepEqual(r, { error: "Project not found or access denied", status: 403 });
  assert.equal(f.audit.length, 1);
  assert.equal(f.audit[0].project_id, null);
  assert.equal(f.audit[0].target_id, PROJECT);
  assert.equal(f.audit[0].actor_id, null);
  assert.equal((f.audit[0].after_json as any).reason, "project_not_found");
});

test("non-uuid project id: 403 without querying projects", async () => {
  const f = fakeAdmin();
  const r = await authorizeServiceExecution({
    headers: serviceHeaders(),
    env: ENV,
    admin: f.client,
    projectId: "abc",
    functionName: FN,
  });
  assert.equal("error" in r && r.status, 403);
  assert.deepEqual(f.calls, ["platform_audit_events"]);
});

test("owner mismatch: 403, no access RPC, audited with project FK", async () => {
  const f = fakeAdmin();
  const r = await authorizeServiceExecution({
    headers: serviceHeaders({ [ACTING_USER_HEADER]: OTHER }),
    env: ENV,
    admin: f.client,
    projectId: PROJECT,
    functionName: FN,
  });
  assert.deepEqual(r, { error: "Project not found or access denied", status: 403 });
  assert.equal(f.rpcCalls.length, 0);
  assert.equal(f.audit[0].project_id, PROJECT);
  assert.equal(f.audit[0].actor_id, null);
  assert.equal((f.audit[0].after_json as any).acting_user_id, OTHER);
  assert.equal((f.audit[0].after_json as any).reason, "owner_mismatch");
});

test("no access (false): 403 and RPC called with acting user", async () => {
  const f = fakeAdmin({ access: false });
  const r = await authorizeServiceExecution({
    headers: serviceHeaders(),
    env: ENV,
    admin: f.client,
    projectId: PROJECT,
    functionName: FN,
  });
  assert.equal("error" in r && r.status, 403);
  assert.deepEqual(f.rpcCalls, [{ fn: "has_project_access", args: { _user_id: OWNER, _project_id: PROJECT } }]);
  assert.equal((f.audit[0].after_json as any).reason, "no_project_access");
});

test("no access (RPC error): 403", async () => {
  const f = fakeAdmin({ access: { error: "boom" } });
  const r = await authorizeServiceExecution({
    headers: serviceHeaders(),
    env: ENV,
    admin: f.client,
    projectId: PROJECT,
    functionName: FN,
  });
  assert.equal("error" in r && r.status, 403);
});

test("unlinked project (no project_permits row): 403", async () => {
  const f = fakeAdmin({ links: [] });
  const r = await authorizeServiceExecution({
    headers: serviceHeaders(),
    env: ENV,
    admin: f.client,
    projectId: PROJECT,
    functionName: FN,
  });
  assert.deepEqual(r, { error: "Project not found or access denied", status: 403 });
  assert.equal((f.audit[0].after_json as any).reason, "project_not_linked");
  assert.equal(f.audit.length, 1);
});

test("success: service mode with acting user, one success audit row", async () => {
  const f = fakeAdmin();
  const r = await authorizeServiceExecution({
    headers: serviceHeaders(),
    env: ENV,
    admin: () => f.client,
    projectId: async () => PROJECT,
    functionName: "comment-parser-agent",
  });
  assert.deepEqual(r, { mode: "service", actingUserId: OWNER, projectId: PROJECT });
  assert.equal(f.audit.length, 1);
  assert.deepEqual(f.audit[0], {
    actor_id: OWNER,
    action: SERVICE_EXECUTION_ACTION,
    target_type: "project",
    target_id: PROJECT,
    project_id: PROJECT,
    after_json: { function: "comment-parser-agent", acting_user_id: OWNER, project_id: PROJECT },
    result: "success",
  });
  assertNoSecrets(f.audit[0]);
  assert.deepEqual(f.calls, ["projects", "project_permits", "platform_audit_events"]);
});

test("success path refuses (500) when the audit row cannot be written", async () => {
  const f = fakeAdmin({ auditError: "insert denied" });
  const r = await authorizeServiceExecution({
    headers: serviceHeaders(),
    env: ENV,
    admin: f.client,
    projectId: PROJECT,
    functionName: FN,
  });
  assert.deepEqual(r, { error: "Service execution audit failed", status: 500 });
});

test("denial still returned when denial audit fails", async () => {
  const f = fakeAdmin({ links: [], auditError: "insert denied" });
  const r = await authorizeServiceExecution({
    headers: serviceHeaders(),
    env: ENV,
    admin: f.client,
    projectId: PROJECT,
    functionName: FN,
  });
  assert.equal("error" in r && r.status, 403);
});

test("writeServiceExecutionAudit reports thrown errors", async () => {
  const client = {
    from() {
      return { insert: async () => { throw new Error("network"); } };
    },
    rpc: async () => ({ data: null, error: null }),
  } as unknown as ServiceAdminClient;
  const res = await writeServiceExecutionAudit(client, {
    accepted: true,
    functionName: FN,
    actingUserId: OWNER,
    projectId: PROJECT,
  });
  assert.deepEqual(res, { ok: false, error: "network" });
});

test("buildServiceAuditRow drops non-uuid ids", () => {
  const row = buildServiceAuditRow({
    accepted: false,
    functionName: FN,
    actingUserId: "x",
    projectId: "y",
    reason: "project_not_found",
  });
  assert.equal(row.target_id, null);
  assert.equal(row.project_id, null);
  assert.equal((row.after_json as any).acting_user_id, null);
});

test("serviceForwardHeaders: same three headers the helper accepts", async () => {
  const fwd = serviceForwardHeaders({ serviceSecret: SECRET, serviceRoleKey: ROLE_KEY, actingUserId: OWNER });
  assert.deepEqual(Object.keys(fwd).sort(), ["Authorization", ACTING_USER_HEADER, SERVICE_SECRET_HEADER].sort());
  assert.equal(fwd.Authorization, `Bearer ${ROLE_KEY}`);

  const f = fakeAdmin();
  const r = await authorizeServiceExecution({
    headers: headers({ "Content-Type": "application/json", apikey: "anon", ...fwd }),
    env: ENV,
    admin: f.client,
    projectId: PROJECT,
    functionName: "auto-router-agent",
  });
  assert.equal("mode" in r && r.mode, "service");
});

test("serviceUserResponse matches getUser() destructuring", () => {
  const { data: { user }, error } = serviceUserResponse(OWNER);
  assert.equal(user.id, OWNER);
  assert.equal(error, null);
});
