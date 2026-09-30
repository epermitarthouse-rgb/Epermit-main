"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");

const {
  createPortalCredentialsRouter,
  listVisiblePortalCredentials,
} = require("../app/routes/portal-credentials.routes.js");

const DAN = "f1f84c83-1111-4111-8111-111111111111";
const DEMO = "3d2b4632-2222-4222-8222-222222222222";
const NORMAL = "3688792b-3333-4333-8333-333333333333";
const TEST_ADMIN = "b25512cb-4444-4444-8444-444444444444";
const DEACTIVATED = "22222222-5555-4555-8555-555555555555";

const DC_OLDER = "de8592f9-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const DC_NEWER = "0610eaa5-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const PGC_OLDER = "3986941e-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const PGC_NEWER = "de064b18-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const FAIRFAX_ACCELA = "03cefbea-cccc-4ccc-8ccc-ccccccccccc1";

const USERNAME = "permitting@example.com";

const credentials = [
  {
    id: DC_OLDER,
    user_id: DAN,
    jurisdiction: "Washington DC - ProjectDox",
    portal_username: USERNAME,
    login_url: "https://example.test/dc",
    permit_number: "D2500488",
    project_id: null,
    created_at: "2026-02-12T16:08:56.484Z",
    portal_password: "stored-secret-older",
  },
  {
    id: PGC_OLDER,
    user_id: DAN,
    jurisdiction: "Prince George's County ePlan",
    portal_username: USERNAME,
    login_url: "https://example.test/pgc",
    permit_number: null,
    project_id: null,
    created_at: "2026-03-31T13:15:12.507Z",
    portal_password: "stored-secret-pgc",
  },
  {
    id: DC_NEWER,
    user_id: DEMO,
    jurisdiction: "Washington DC - ProjectDox",
    portal_username: USERNAME,
    login_url: "https://example.test/dc",
    permit_number: "SETTINGS",
    project_id: null,
    created_at: "2026-07-10T17:43:51.394Z",
    portal_password: "stored-secret-newer",
  },
  {
    id: PGC_NEWER,
    user_id: DEMO,
    jurisdiction: "Prince George's County ePlan",
    portal_username: USERNAME,
    login_url: "https://example.test/pgc",
    permit_number: "SETTINGS",
    project_id: null,
    created_at: "2026-07-10T17:45:16.114Z",
    portal_password: "stored-secret-pgc-newer",
  },
  {
    id: FAIRFAX_ACCELA,
    user_id: DEMO,
    jurisdiction: "Fairfax County VA - Accela",
    portal_username: USERNAME,
    login_url: "https://example.test/fairfax",
    permit_number: "SETTINGS",
    project_id: null,
    created_at: "2026-07-10T17:44:19.313Z",
    portal_password: "stored-secret-fairfax",
  },
];

const grants = [
  {
    user_id: DEMO,
    credential_id: DC_NEWER,
    grant_level: "manage",
  },
  {
    user_id: DEMO,
    credential_id: PGC_NEWER,
    grant_level: "manage",
  },
  {
    user_id: DEMO,
    credential_id: FAIRFAX_ACCELA,
    grant_level: "manage",
  },
  {
    user_id: TEST_ADMIN,
    credential_id: PGC_NEWER,
    grant_level: "none",
  },
  {
    user_id: NORMAL,
    credential_id: FAIRFAX_ACCELA,
    grant_level: "use",
  },
];

const users = {
  [DAN]: {
    id: DAN,
    token: "dan",
    email: "dan@example.com",
    active: true,
    roles: ["admin", "super_admin"],
  },
  [DEMO]: {
    id: DEMO,
    token: "demo",
    email: "demo@example.com",
    active: true,
    roles: ["admin"],
  },
  [NORMAL]: {
    id: NORMAL,
    token: "normal",
    email: "normal@example.com",
    active: true,
    roles: [],
  },
  [TEST_ADMIN]: {
    id: TEST_ADMIN,
    token: "test-admin",
    email: "test-admin@example.com",
    active: true,
    roles: ["admin"],
  },
  [DEACTIVATED]: {
    id: DEACTIVATED,
    token: "deactivated",
    email: "deactivated@example.com",
    active: false,
    roles: ["admin"],
  },
};

function createSupabase() {
  return {
    auth: {
      getUser: async (token) => {
        const user = Object.values(users).find((row) => row.token === token);
        if (!user) {
          return { data: { user: null }, error: new Error("invalid") };
        }
        return {
          data: { user: { id: user.id, email: user.email } },
          error: null,
        };
      },
    },
    rpc: async (name, args) => {
      const userId = args.p_user_id || args._user_id;
      const user = users[userId];
      if (!user) return { data: false, error: null };
      if (name === "is_user_active") {
        return { data: user.active === true, error: null };
      }
      if (name === "has_role") {
        return { data: user.roles.includes(args._role), error: null };
      }
      return { data: null, error: { message: `unknown rpc ${name}` } };
    },
    from(table) {
      const builder = {
        _userId: null,
        select() {
          return builder;
        },
        order() {
          return builder;
        },
        eq(col, val) {
          if (col === "user_id") builder._userId = val;
          return builder;
        },
        then(onFulfilled, onRejected) {
          let data = [];
          if (table === "portal_credentials") data = credentials;
          if (table === "user_portal_credential_grants") {
            data = grants.filter(
              (row) => !builder._userId || row.user_id === builder._userId,
            );
          }
          return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
}

function assertNoPassword(rows) {
  for (const row of rows) {
    assert.equal("portal_password" in row, false);
    assert.equal(row.password_configured, true);
  }
}

describe("listVisiblePortalCredentials", () => {
  const supabase = createSupabase();

  it("Demo Account includes canonical rows and honors a manage grant on the newer duplicate", async () => {
    const rows = await listVisiblePortalCredentials(supabase, DEMO);
    assert.deepEqual(
      rows.map((row) => row.id),
      [FAIRFAX_ACCELA, PGC_OLDER, DC_OLDER],
    );
    assert.deepEqual(
      rows.map((row) => row.grant_level),
      ["manage", "manage", "manage"],
    );
    assertNoPassword(rows);
  });

  it("Dan Z sees the same canonical credentials at default manage with no explicit grants", async () => {
    const rows = await listVisiblePortalCredentials(supabase, DAN);
    assert.deepEqual(
      rows.map((row) => row.id),
      [FAIRFAX_ACCELA, PGC_OLDER, DC_OLDER],
    );
    assert.ok(rows.every((row) => row.grant_level === "manage"));
    assertNoPassword(rows);
  });

  it("active normal user defaults to use and keeps an explicit use grant", async () => {
    const rows = await listVisiblePortalCredentials(supabase, NORMAL);
    const byId = new Map(rows.map((row) => [row.id, row.grant_level]));
    assert.equal(byId.get(DC_OLDER), "use");
    assert.equal(byId.get(PGC_OLDER), "use");
    assert.equal(byId.get(FAIRFAX_ACCELA), "use");
    assert.equal(rows.length, 3);
    assertNoPassword(rows);
  });

  it("Test admin explicit none on the newer duplicate excludes that canonical credential", async () => {
    const rows = await listVisiblePortalCredentials(supabase, TEST_ADMIN);
    const ids = rows.map((row) => row.id);
    assert.equal(ids.includes(PGC_OLDER), false);
    assert.equal(ids.includes(PGC_NEWER), false);
    assert.deepEqual(ids, [FAIRFAX_ACCELA, DC_OLDER]);
    assert.ok(rows.every((row) => row.grant_level === "manage"));
    assertNoPassword(rows);
  });

  it("deactivated user returns an empty list", async () => {
    const rows = await listVisiblePortalCredentials(supabase, DEACTIVATED);
    assert.deepEqual(rows, []);
  });
});

describe("GET /api/portal-credentials", () => {
  /** @type {http.Server} */
  let server;
  let baseUrl;

  it("returns [] for a deactivated caller and still rejects deactivated writes", async () => {
    const app = express();
    app.use(express.json());
    app.use(createPortalCredentialsRouter({ supabase: createSupabase() }));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    const deactivated = await fetch(`${baseUrl}/api/portal-credentials`, {
      headers: { Authorization: "Bearer deactivated" },
    });
    assert.equal(deactivated.status, 200);
    assert.deepEqual(await deactivated.json(), []);

    const missing = await fetch(`${baseUrl}/api/portal-credentials`);
    assert.equal(missing.status, 401);

    const write = await fetch(`${baseUrl}/api/portal-credentials`, {
      method: "POST",
      headers: {
        Authorization: "Bearer deactivated",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jurisdiction: "Washington DC - ProjectDox",
        portal_username: USERNAME,
        portal_password: "new-secret",
      }),
    });
    assert.equal(write.status, 403);
    const body = await write.json();
    assert.equal(body.error, "USER_DEACTIVATED");

    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
