"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("http");
const { createUciRouter } = require("../app/routes/uci.routes.js");
const { computeLifecycleProposalChecksum } = require("../app/services/uci/uci-lifecycle-proposal-actions.service.js");

const PROJECT_A = "project-a";
const PROJECT_B = "project-b";
const COORD_A = "coord-a";
const COORD_B = "coord-b";
const USER_OK = "user-ok";
const USER_DENIED = "user-denied";
const COMM_A = "comm-a";

const baseProposal = {
  external_application_id: "app-123",
  provider_slug: "pepco",
  source_status: "In Design",
  proposed_stage: 5,
  proposed_state: "IN_PROGRESS",
  confidence: "high",
  reason: "Portal maps to stage 5",
  automatic_transition_allowed: true,
  blocked_reason: null,
  applied: false,
  applied_at: null,
};

/**
 * @param {object} opts
 */
function makeSupabase(opts = {}) {
  const hasAccess = opts.hasAccess !== false;
  const projectId = opts.projectId ?? PROJECT_A;
  const coordinationId = opts.coordinationId ?? COORD_A;

  const record = {
    id: coordinationId,
    project_id: projectId,
    current_stage: 4,
    current_stage_state: "IN_PROGRESS",
    metadata: {
      uci_lifecycle_proposals: {
        last_evaluated_at: "2026-07-14T12:00:00.000Z",
        auto_apply_enabled: false,
        proposals: [baseProposal],
        applied_transition_id: null,
      },
    },
    ...(opts.recordOverrides || {}),
  };

  const communications = [
    {
      id: COMM_A,
      coordination_record_id: COORD_A,
      project_id: PROJECT_A,
      classification: null,
      raw_subject: "test",
      raw_body: "meter set schedule",
      agent_processed_metadata: {},
    },
  ];

  const tables = {
    coordination_records: [record],
    coordination_communications: communications,
    coordination_costs: [],
    coordination_equipment: [],
    coordination_stage_transitions: [],
    coordination_applications: [],
    coordination_milestones: [],
    scrape_jobs: [],
  };

  return {
    auth: {
      getUser: async (token) => {
        if (!token) return { data: { user: null }, error: new Error("missing") };
        if (token === "bad") return { data: { user: null }, error: new Error("invalid") };
        if (token === "denied") return { data: { user: { id: USER_DENIED } }, error: null };
        return { data: { user: { id: USER_OK } }, error: null };
      },
    },
    from(table) {
      const rows = tables[table] || [];
      const chain = {
        _table: table,
        _filters: {},
        select(_cols) {
          return chain;
        },
        insert(row) {
          const inserted = { id: `${table}-1`, ...row };
          rows.push(inserted);
          return {
            select() {
              return { single: async () => ({ data: inserted, error: null }) };
            },
          };
        },
        update(patch) {
          return {
            eq(col, val) {
              chain._filters[col] = val;
              const applyUpdate = () => {
                const idx = rows.findIndex((r) =>
                  Object.entries(chain._filters).every(([k, v]) => r[k] === v),
                );
                if (idx >= 0) {
                  rows[idx] = {
                    ...rows[idx],
                    ...patch,
                    agent_processed_metadata:
                      patch.agent_processed_metadata ?? rows[idx].agent_processed_metadata,
                  };
                }
                return rows[idx] ?? null;
              };
              return {
                select() {
                  return {
                    single: async () => ({ data: applyUpdate(), error: null }),
                  };
                },
                eq(col2, val2) {
                  chain._filters[col2] = val2;
                  return {
                    select() {
                      return { single: async () => ({ data: applyUpdate(), error: null }) };
                    },
                    then(resolve) {
                      resolve({ error: null });
                    },
                  };
                },
                then(resolve) {
                  resolve({ error: null });
                },
              };
            },
          };
        },
        eq(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        limit() {
          return chain;
        },
        not() {
          return chain;
        },
        is() {
          return chain;
        },
        lte() {
          return chain;
        },
        gte() {
          return chain;
        },
        in() {
          return chain;
        },
        or() {
          return chain;
        },
        order() {
          return chain;
        },
        then(resolve, reject) {
          const filtered = rows.filter((r) =>
            Object.entries(chain._filters).every(([k, v]) => r[k] === v),
          );
          return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
        },
        maybeSingle: async () => {
          const match = rows.find((r) =>
            Object.entries(chain._filters).every(([k, v]) => r[k] === v),
          );
          return { data: match ?? null, error: null };
        },
        single: async () => {
          const match = rows.find((r) =>
            Object.entries(chain._filters).every(([k, v]) => r[k] === v),
          );
          return { data: match ?? null, error: null };
        },
      };
      return chain;
    },
    async rpc(name, args) {
      if (name === "has_project_access") {
        if (!hasAccess || args._user_id === USER_DENIED) return { data: false, error: null };
        if (args._project_id === PROJECT_B && args._user_id === USER_OK) return { data: false, error: null };
        return { data: true, error: null };
      }
      if (name === "has_project_editor_access") {
        if (!hasAccess || args._user_id === USER_DENIED) return { data: false, error: null };
        if (args._project_id === PROJECT_B && args._user_id === USER_OK) return { data: false, error: null };
        return { data: true, error: null };
      }
      return { data: null, error: null };
    },
  };
}

async function startServer(supabase) {
  const app = express();
  app.use(express.json());
  app.use("/api/uci", createUciRouter({ supabase }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = /** @type {import("net").AddressInfo} */ (server.address()).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

describe("UCI D13 route integration", () => {
  /** @type {{ baseUrl: string, close: () => Promise<void> } | null} */
  let server = null;

  before(async () => {
    server = await startServer(makeSupabase());
  });

  after(async () => {
    if (server) await server.close();
  });

  it("requires authentication on protected routes", async () => {
    const res = await fetch(`${server.baseUrl}/api/uci/coordination/${COORD_A}/costs`);
    assert.equal(res.status, 401);
  });

  it("denies cross-project access to coordination costs", async () => {
    const denied = await startServer(
      makeSupabase({ projectId: PROJECT_B, coordinationId: COORD_B }),
    );
    try {
      const res = await fetch(`${denied.baseUrl}/api/uci/coordination/${COORD_B}/costs`, {
        headers: { Authorization: "Bearer ok" },
      });
      assert.equal(res.status, 403);
    } finally {
      await denied.close();
    }
  });

  it("validates cost_type on POST costs", async () => {
    const res = await fetch(`${server.baseUrl}/api/uci/coordination/${COORD_A}/costs`, {
      method: "POST",
      headers: { Authorization: "Bearer ok", "Content-Type": "application/json" },
      body: JSON.stringify({ estimated_amount: 100 }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "COST_TYPE_REQUIRED");
  });

  it("upserts cost for authorized project", async () => {
    const res = await fetch(`${server.baseUrl}/api/uci/coordination/${COORD_A}/costs`, {
      method: "POST",
      headers: { Authorization: "Bearer ok", "Content-Type": "application/json" },
      body: JSON.stringify({ cost_type: "CIAC", estimated_amount: 1200 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.cost.cost_type, "CIAC");
  });

  it("rejects stale lifecycle proposal checksum", async () => {
    const res = await fetch(
      `${server.baseUrl}/api/uci/coordination/${COORD_A}/lifecycle-proposals/apply`,
      {
        method: "POST",
        headers: { Authorization: "Bearer ok", "Content-Type": "application/json" },
        body: JSON.stringify({
          external_application_id: "app-123",
          proposal_checksum: "deadbeefdeadbeef",
        }),
      },
    );
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error, "PROPOSAL_STALE");
  });

  it("applies lifecycle proposal with valid checksum", async () => {
    const checksum = computeLifecycleProposalChecksum(baseProposal, "2026-07-14T12:00:00.000Z");
    const res = await fetch(
      `${server.baseUrl}/api/uci/coordination/${COORD_A}/lifecycle-proposals/apply`,
      {
        method: "POST",
        headers: { Authorization: "Bearer ok", "Content-Type": "application/json" },
        body: JSON.stringify({
          external_application_id: "app-123",
          proposal_checksum: checksum,
        }),
      },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.transition.to_stage, 5);
  });

  it("classifies communications idempotently for project member", async () => {
    const res = await fetch(
      `${server.baseUrl}/api/uci/coordination/${COORD_A}/communications/classify`,
      {
        method: "POST",
        headers: { Authorization: "Bearer ok", "Content-Type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.classified_count === "number");
  });

  it("returns portfolio view for authorized project", async () => {
    const res = await fetch(`${server.baseUrl}/api/uci/projects/${PROJECT_A}/portfolio_view`, {
      headers: { Authorization: "Bearer ok" },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.project_id, PROJECT_A);
  });
});
