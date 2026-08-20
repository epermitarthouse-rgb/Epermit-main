"use strict";

const crypto = require("crypto");

/**
 * In-memory Supabase stand-in for Track B unit/integration tests.
 *
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createTrackBMockSupabase(tables) {
  return {
    storage: {
      listBuckets: async () => ({
        data: [{ id: "project-documents", name: "project-documents" }],
        error: null,
      }),
      from() {
        return {
          upload: async (_path, _buffer, _opts) => ({ data: { path: _path }, error: null }),
          download: async (_path) => ({
            data: { arrayBuffer: async () => Buffer.from("%PDF-1.4\n").buffer },
            error: null,
          }),
        };
      },
    },
    from(table) {
      const store = tables[table] || (tables[table] = []);
      const filters = [];
      const state = { mode: "select", updatePatch: null, insertRow: null, inFilter: null };

      const matches = (row) =>
        filters.every((f) => {
          if (f.op === "in") return Array.isArray(f.value) && f.value.map(String).includes(String(row[f.column]));
          if (f.op === "is") return f.value === null ? row[f.column] == null : row[f.column] === f.value;
          if (f.op === "not") return f.value === null ? row[f.column] != null : String(row[f.column]) !== String(f.value);
          if (f.op === "lte") return String(row[f.column] ?? "") <= String(f.value);
          if (f.op === "gte") return String(row[f.column] ?? "") >= String(f.value);
          return String(row[f.column]) === String(f.value);
        });

      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters.push({ column, value });
          return api;
        },
        in(column, values) {
          filters.push({ column, value: values, op: "in" });
          return api;
        },
        is(column, value) {
          filters.push({ column, value, op: "is" });
          return api;
        },
        not(column, _op, value) {
          filters.push({ column, value, op: "not" });
          return api;
        },
        lte(column, value) {
          filters.push({ column, value, op: "lte" });
          return api;
        },
        gte(column, value) {
          filters.push({ column, value, op: "gte" });
          return api;
        },
        or() {
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        range() {
          return api;
        },
        maybeSingle() {
          return Promise.resolve({ data: store.find(matches) ?? null, error: null });
        },
        single() {
          if (state.mode === "insert" && state.insertRow) {
            const copy = {
              id: state.insertRow.id || crypto.randomUUID(),
              ...state.insertRow,
            };
            store.push(copy);
            return Promise.resolve({ data: copy, error: null });
          }
          const row = store.find(matches);
          if (row && state.mode === "update" && state.updatePatch) {
            Object.assign(row, state.updatePatch);
          }
          return Promise.resolve({ data: row ?? null, error: null });
        },
        insert(row) {
          state.mode = "insert";
          state.insertRow = row;
          return api;
        },
        update(patch) {
          state.mode = "update";
          state.updatePatch = patch;
          return api;
        },
        then(resolve, reject) {
          if (state.mode === "update" && state.updatePatch) {
            for (const row of store.filter(matches)) Object.assign(row, state.updatePatch);
          }
          const rows = store.filter((r) => (filters.length ? matches(r) : true));
          return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

function stage6CompletedRecord(overrides = {}) {
  return {
    id: "coord-1",
    project_id: "proj-1",
    user_id: "user-1",
    utility_provider_id: "prov-1",
    utility_type: "electric",
    scope_description: "electric service",
    current_stage: 6,
    current_stage_state: "COMPLETED",
    class_of_service_issued_at: "2026-08-01T00:00:00.000Z",
    metadata: {},
    predicted_p50_date: null,
    predicted_p90_date: null,
    ...overrides,
  };
}

module.exports = {
  createTrackBMockSupabase,
  stage6CompletedRecord,
};
