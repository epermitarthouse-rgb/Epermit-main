"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getCoordinationDetailBundle,
} = require("../app/services/uci/uci-records.service.js");

function query(result) {
  const chain = {
    eq() {
      return chain;
    },
    like() {
      return chain;
    },
    order() {
      return chain;
    },
    limit() {
      return chain;
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return chain;
}

function detailSupabase() {
  return {
    from(table) {
      return {
        select(columns) {
          if (table === "coordination_applications") {
            if (columns === "id, load_summary") {
              return query({
                data: [{ id: "load-app", load_summary: { version: "d2.1-v1" } }],
                error: null,
              });
            }
            return query({
              data: [
                {
                  id: "load-app",
                  idempotency_key: "agent_2_load_profile:d2.1-v1",
                  record_source: "agent_draft",
                },
                {
                  id: "package-app",
                  idempotency_key: "agent_3_application_package:d3-v1",
                  record_source: "agent_draft",
                },
              ],
              error: null,
            });
          }
          if (table === "coordination_communications") {
            return query({
              data: null,
              error: { message: "simulated communications failure" },
            });
          }
          return query({
            data: table === "coordination_stage_transitions" ? [{ id: "transition-1" }] : [],
            error: null,
          });
        },
      };
    },
  };
}

describe("coordination record detail hydration", () => {
  it("returns the record and healthy children when one child query fails", async () => {
    const record = { id: "coord-1", project_id: "project-1" };
    const detail = await getCoordinationDetailBundle(
      detailSupabase(),
      record.id,
      record.project_id,
      { record, requestId: "request-1" },
    );

    assert.equal(detail.record, record);
    assert.deepEqual(detail.transitions, [{ id: "transition-1" }]);
    assert.deepEqual(detail.communications_recent, []);
    assert.equal(
      detail.hydration.errors.communications.message,
      "simulated communications failure",
    );
    assert.equal(
      detail.hydration.steps.find((step) => step.step === "communications").blocking,
      false,
    );
  });

  it("hydrates the large load summary only onto the Agent 2 draft", async () => {
    const record = { id: "coord-1", project_id: "project-1" };
    const detail = await getCoordinationDetailBundle(
      detailSupabase(),
      record.id,
      record.project_id,
      { record, requestId: "request-2" },
    );

    const loadApp = detail.applications.find((application) => application.id === "load-app");
    const packageApp = detail.applications.find(
      (application) => application.id === "package-app",
    );
    assert.deepEqual(loadApp.load_summary, { version: "d2.1-v1" });
    assert.deepEqual(packageApp.load_summary, {});
  });
});
