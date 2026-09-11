"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  requireTenantProjectAccess,
} = require("../app/services/uci/uci-access.service.js");
const { DEMO_TENANT_ID } = require("../app/services/uci/uci-tenant-context.service.js");

const USER_NO_MEMBERSHIP = "user-no-membership";
const USER_DEMO = "user-demo";
const PROJECT_PROD = "project-prod";
const PROJECT_DEMO = "project-demo";
const TENANT_PROD = "tenant-prod-0000-4000-8000-000000000201";

function makeDefaultAccessSupabase() {
  const projects = [
    { id: PROJECT_PROD, tenant_id: TENANT_PROD, user_id: "owner-1" },
    { id: PROJECT_DEMO, tenant_id: DEMO_TENANT_ID, user_id: "owner-2" },
  ];

  return {
    from(table) {
      const chain = {
        _filters: {},
        select() {
          return chain;
        },
        eq(col, val) {
          chain._filters[col] = val;
          return chain;
        },
        maybeSingle: async () => {
          const match = projects.find((row) =>
            Object.entries(chain._filters).every(([k, v]) => row[k] === v),
          );
          return { data: match ?? null, error: null };
        },
      };
      return chain;
    },
    async rpc(name, args) {
      if (name === "has_project_access") {
        if (args._user_id === USER_NO_MEMBERSHIP && args._project_id === PROJECT_PROD) {
          return { data: true, error: null };
        }
        return { data: false, error: null };
      }
      if (name === "has_project_editor_access") {
        return { data: false, error: null };
      }
      if (name === "is_demo_tenant") {
        return { data: args._tenant_id === DEMO_TENANT_ID, error: null };
      }
      if (name === "can_access_tenant") {
        if (args._user_id === USER_DEMO && args._tenant_id === DEMO_TENANT_ID) {
          return { data: true, error: null };
        }
        return { data: false, error: null };
      }
      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
  };
}

describe("UCI requireTenantProjectAccess default-access alignment", () => {
  it("allows production project read without tenant_memberships when has_project_access passes", async () => {
    await assert.doesNotReject(() =>
      requireTenantProjectAccess({
        supabase: makeDefaultAccessSupabase(),
        userId: USER_NO_MEMBERSHIP,
        projectId: PROJECT_PROD,
      }),
    );
  });

  it("still requires demo tenant membership for demo projects", async () => {
    await assert.rejects(
      () =>
        requireTenantProjectAccess({
          supabase: makeDefaultAccessSupabase(),
          userId: USER_NO_MEMBERSHIP,
          projectId: PROJECT_DEMO,
        }),
      (err) => err.code === "TENANT_ACCESS_DENIED" || err.code === "PROJECT_ACCESS_DENIED",
    );
  });
});
