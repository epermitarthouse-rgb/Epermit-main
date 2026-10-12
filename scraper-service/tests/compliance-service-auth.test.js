"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isServiceRoleKey,
  authenticateComplianceServiceRequest,
} = require("../app/services/compliance/compliance-service-auth.js");

describe("compliance-service-auth", () => {
  it("accepts matching service role key", () => {
    const key = "test-service-role-key-12345";
    assert.equal(isServiceRoleKey(key, key), true);
    assert.equal(isServiceRoleKey("wrong", key), false);
  });

  it("rejects missing bearer token", async () => {
    const out = await authenticateComplianceServiceRequest({ headers: {} }, null);
    assert.equal(out.ok, false);
    assert.equal(out.status, 401);
  });

  it("accepts service role bearer without calling getUser", async () => {
    const key = "local-service-role-secret";
    const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    try {
      const out = await authenticateComplianceServiceRequest(
        { headers: { authorization: `Bearer ${key}` } },
        {
          auth: {
            getUser: () => {
              throw new Error("getUser should not run for service role");
            },
          },
        },
      );
      assert.equal(out.ok, true);
      assert.equal(out.caller, "service_role");
    } finally {
      if (prev === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
    }
  });
});
