"use strict";

/**
 * Regression: shared workspace / project-team access for client logins.
 * UCI reads coordination rows by project_id after has_project_access — never by record.user_id.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("http");
const { createUciRouter } = require("../app/routes/uci.routes.js");
const {
  assertProjectAccess,
  requireProjectAccess,
} = require("../app/services/uci/uci-access.service.js");
const { listAccessibleProjects } = require("../app/services/uci/uci-operational-snapshot.service.js");

const PROJECT_ID = "project-highland";
const OWNER_ID = "user-operator";
const CLIENT_ID = "user-client";
const TENANT_ID = "tenant-ambitious";

/** @param {object} [opts] */
function makeSupabase(opts = {}) {
  const projects = opts.projects || [
    {
      id: PROJECT_ID,
      name: "McDonald's Highland Springs, VA - LC 451497",
      user_id: OWNER_ID,
      tenant_id: TENANT_ID,
    },
  ];
  const team = opts.team || [
    { project_id: PROJECT_ID, user_id: CLIENT_ID, role: "editor" },
  ];
  const coordination = opts.coordination || [
    {
      id: "coord-electric",
      project_id: PROJECT_ID,
      user_id: OWNER_ID,
      tenant_id: TENANT_ID,
      utility_type: "electric",
      current_stage: 8,
      current_stage_state: "COMPLETED",
      utility_providers: { name: "Dominion" },
    },
  ];

  return {
    from(table) {
      const rows =
        table === "projects"
          ? projects
          : table === "project_team_members"
            ? team
            : table === "coordination_records"
              ? coordination
              : [];
      const chain = {
        _filters: {},
        select() {
          return chain;
        },
        eq(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        in(col, vals) {
          chain._filters[col] = vals;
          return chain;
        },
        order() {
          return chain;
        },
        maybeSingle: async () => {
          const match = rows.find((row) =>
            Object.entries(chain._filters).every(([k, v]) => {
              if (Array.isArray(v)) return v.includes(row[k]);
              return row[k] === v;
            }),
          );
          return { data: match ?? null, error: null };
        },
        then(resolve, reject) {
          let filtered = rows.filter((row) =>
            Object.entries(chain._filters).every(([k, v]) => {
              if (Array.isArray(v)) return v.includes(row[k]);
              return row[k] === v;
            }),
          );
          if (table === "coordination_records") {
            filtered = [...filtered];
          }
          return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
    async rpc(name, args) {
      const uid = args._user_id;
      const pid = args._project_id;
      const tenantId = args._tenant_id;

      if (name === "list_accessible_uci_projects") {
        const accessible = projects.filter((project) => {
          const isOwner = project.user_id === uid;
          const onTeam = team.some(
            (row) => row.project_id === project.id && row.user_id === uid,
          );
          return isOwner || onTeam;
        });
        return {
          data: accessible.map((project) => ({ id: project.id, name: project.name })),
          error: null,
        };
      }

      if (name === "can_access_tenant") {
        return { data: tenantId === TENANT_ID, error: null };
      }

      if (name === "has_project_access") {
        if (pid !== PROJECT_ID) return { data: false, error: null };
        if (uid === OWNER_ID || uid === CLIENT_ID) return { data: true, error: null };
        return { data: false, error: null };
      }

      if (name === "has_project_editor_access") {
        if (pid !== PROJECT_ID) return { data: false, error: null };
        if (uid === OWNER_ID) return { data: true, error: null };
        const membership = team.find(
          (row) => row.project_id === pid && row.user_id === uid,
        );
        if (
          membership &&
          ["owner", "admin", "editor"].includes(String(membership.role))
        ) {
          return { data: true, error: null };
        }
        return { data: false, error: null };
      }

      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
    auth: {
      getUser: async () => ({
        data: { user: { id: CLIENT_ID, email: "admin@dmtechsservice.com" } },
        error: null,
      }),
    },
  };
}

describe("UCI client shared workspace access", () => {
  it("allows team editor read access without owning coordination record user_id", async () => {
    const supabase = makeSupabase();
    const ok = await assertProjectAccess({
      supabase,
      userId: CLIENT_ID,
      projectId: PROJECT_ID,
    });
    assert.equal(ok, true);
  });

  it("denies unrelated users even when coordination rows exist on the project", async () => {
    const supabase = makeSupabase();
    const ok = await assertProjectAccess({
      supabase,
      userId: "user-stranger",
      projectId: PROJECT_ID,
    });
    assert.equal(ok, false);
  });

  it("lists shared tenant projects for team members via list_accessible_uci_projects", async () => {
    const supabase = makeSupabase();
    const queryDurations = {};
    const access = await listAccessibleProjects(supabase, CLIENT_ID, queryDurations);
    assert.equal(access.accessMode, "rpc");
    assert.deepEqual(
      access.projects.map((project) => project.id),
      [PROJECT_ID],
    );
  });

  it("GET /projects/:projectId/coordination returns owner-created records for team client", async () => {
    const supabase = makeSupabase();
    const app = express();
    app.use(express.json());
    app.use("/api/uci", createUciRouter({ supabase }));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/uci/projects/${PROJECT_ID}/coordination`,
        { headers: { Authorization: "Bearer test-token" } },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.records.length, 1);
      assert.equal(body.records[0].id, "coord-electric");
      assert.equal(body.records[0].user_id, OWNER_ID);
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("blocks team viewer from write-gated coordination mutations", async () => {
    const supabase = makeSupabase({
      team: [{ project_id: PROJECT_ID, user_id: CLIENT_ID, role: "viewer" }],
    });
    await assert.rejects(
      () =>
        requireProjectAccess({
          supabase,
          userId: CLIENT_ID,
          projectId: PROJECT_ID,
          write: true,
        }),
      (err) => {
        assert.equal(err.code, "PROJECT_EDITOR_ACCESS_DENIED");
        return true;
      },
    );
  });
});
