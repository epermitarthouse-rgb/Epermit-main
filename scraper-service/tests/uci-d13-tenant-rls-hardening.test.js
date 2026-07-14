"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("http");
const { createUciRouter } = require("../app/routes/uci.routes.js");
const {
  emitUciEvent,
  clearRecentUciEventsForTests,
} = require("../app/services/uci/uci-events.service.js");
const { buildUciStoragePath } = require("../app/services/uci/uci-document-storage.service.js");

const PROJECT_A = "project-a";
const PROJECT_B = "project-b";
const COORD_A = "coord-a";
const USER_EDITOR = "user-editor";
const USER_VIEWER = "user-viewer";

/**
 * @param {object} opts
 */
function makeSupabase(opts = {}) {
  const record = {
    id: COORD_A,
    project_id: PROJECT_A,
    current_stage: 4,
    current_stage_state: "IN_PROGRESS",
    metadata: {},
  };

  const tables = {
    coordination_records: [record],
    coordination_costs: [],
    coordination_communications: [],
    coordination_equipment: [],
    coordination_stage_transitions: [],
    coordination_applications: [],
    coordination_milestones: [],
    scrape_jobs: [],
  };

  const editorUsers = new Set([USER_EDITOR]);
  const accessUsers = new Set([USER_EDITOR, USER_VIEWER]);

  return {
    auth: {
      getUser: async (token) => {
        if (token === "editor") return { data: { user: { id: USER_EDITOR } }, error: null };
        if (token === "viewer") return { data: { user: { id: USER_VIEWER } }, error: null };
        return { data: { user: null }, error: new Error("invalid") };
      },
    },
    from(table) {
      const rows = tables[table] || [];
      const chain = {
        _filters: {},
        select() {
          return chain;
        },
        insert(row) {
          const inserted = { id: `${table}-new`, ...row };
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
              return {
                select() {
                  return {
                    single: async () => {
                      const idx = rows.findIndex((r) =>
                        Object.entries(chain._filters).every(([k, v]) => r[k] === v),
                      );
                      if (idx >= 0) rows[idx] = { ...rows[idx], ...patch };
                      return { data: rows[idx] ?? null, error: null };
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
        order() {
          const filtered = rows.filter((r) =>
            Object.entries(chain._filters).every(([k, v]) => r[k] === v),
          );
          return Promise.resolve({ data: filtered, error: null });
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
        if (args._project_id === PROJECT_B) return { data: false, error: null };
        return { data: accessUsers.has(args._user_id), error: null };
      }
      if (name === "has_project_editor_access") {
        if (args._project_id === PROJECT_B) return { data: false, error: null };
        return { data: editorUsers.has(args._user_id), error: null };
      }
      return { data: null, error: null };
    },
  };
}

describe("UCI tenant/RLS hardening routes (NB-D1-001)", () => {
  /** @type {import("http").Server | null} */
  let server = null;
  /** @type {string} */
  let base = "";

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/uci", createUciRouter({ supabase: makeSupabase() }));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();
    base = `http://127.0.0.1:${port}/api/uci`;
  });

  after(async () => {
    clearRecentUciEventsForTests();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("denies viewer mutation on cost upsert", async () => {
    const res = await fetch(`${base}/coordination/${COORD_A}/costs`, {
      method: "POST",
      headers: {
        Authorization: "Bearer viewer",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cost_type: "ciac", amount: 100 }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "PROJECT_EDITOR_ACCESS_DENIED");
  });

  it("allows editor mutation on cost upsert", async () => {
    const res = await fetch(`${base}/coordination/${COORD_A}/costs`, {
      method: "POST",
      headers: {
        Authorization: "Bearer editor",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cost_type: "ciac", estimated_amount: 100 }),
    });

    assert.equal(res.status, 200);
  });

  it("denies cross-project coordination list", async () => {
    const res = await fetch(`${base}/projects/${PROJECT_B}/coordination`, {
      headers: { Authorization: "Bearer editor" },
    });

    assert.equal(res.status, 403);
  });

  it("requires project_id for recent events", async () => {
    const res = await fetch(`${base}/events/recent`, {
      headers: { Authorization: "Bearer editor" },
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "PROJECT_ID_REQUIRED");
  });

  it("filters recent events by project_id", async () => {
    clearRecentUciEventsForTests();
    emitUciEvent("uci.communication.classified", {
      project_id: PROJECT_A,
      coordination_record_id: COORD_A,
    });
    emitUciEvent("uci.communication.classified", {
      project_id: PROJECT_B,
      coordination_record_id: "coord-b",
    });

    const res = await fetch(
      `${base}/events/recent?project_id=${encodeURIComponent(PROJECT_A)}`,
      { headers: { Authorization: "Bearer editor" } },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].payload.project_id, PROJECT_A);
  });

  it("keeps unconfigured storage namespace when no org field exists", () => {
    const path = buildUciStoragePath({
      projectId: PROJECT_A,
      coordinationRecordId: COORD_A,
      providerSlug: "pepco",
      externalApplicationId: "ext-1",
      fileName: "plan.pdf",
    });
    assert.ok(path.startsWith(`uci/unconfigured/${PROJECT_A}/`));
  });
});
