"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { isPlatformAdmin, isSuperAdmin } = require("../app/services/governance/governance.service.js");
const { resolveDefaultCredentialGrantLevel } = require("../app/services/governance/governance.constants.js");

const SUPER_ADMIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PLATFORM_ADMIN = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const NORMAL_USER = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const MIGRATION_PATH = path.join(
  __dirname,
  "../../supabase/migrations/20260911200000_super_admin_hierarchy.sql",
);

/**
 * @param {Array<{ user_id: string, role: string }>} userRoles
 */
function makeRoleSupabase(userRoles) {
  return {
    async rpc(name, args) {
      if (name === "has_role") {
        const match = userRoles.some(
          (row) => row.user_id === args._user_id && row.role === args._role,
        );
        return { data: match, error: null };
      }
      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
  };
}

describe("super admin RLS compatibility migration", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const section8 = sql.split("-- 8. RLS + function compatibility")[1] || "";

  const auditedPolicies = [
    "Platform admins read project access overrides",
    "Platform admins can view all tenants",
    "Platform admins can manage global templates",
    "Platform admins can manage global provider aliases",
    "Platform admins can manage architecture replication items",
    "Platform admins can manage architecture replication comments",
    "Anyone can view active jurisdictions",
    "Admins can insert jurisdictions",
    "Admins can update jurisdictions",
    "Admins can delete jurisdictions",
    "Admins can view branding settings",
    "Admins can insert branding settings",
    "Admins can update branding settings",
    "Admins can view scheduled notifications",
    "Admins can insert scheduled notifications",
    "Admins can update scheduled notifications",
    "Admins can delete scheduled notifications",
    "Admins can view coverage requests",
    "Admins can update coverage requests",
    "Admins can delete coverage requests",
    "Admins can view activity logs",
    "Admins can insert activity logs",
    "Admins can insert notifications",
  ];

  for (const policyName of auditedPolicies) {
    it(`policy "${policyName}" uses is_platform_admin in section 8`, () => {
      const marker = `CREATE POLICY "${policyName}"`;
      const start = section8.indexOf(marker);
      assert.ok(start >= 0, `missing policy block: ${policyName}`);
      const block = section8.slice(start, start + 600);
      assert.match(block, /is_platform_admin\(/);
      assert.doesNotMatch(block, /has_role\([^)]*'admin'/);
    });
  }

  const auditedFunctions = [
    "admin_list_member_directory",
    "can_access_tenant",
    "_default_credential_grant_level",
    "_global_feature_access_level",
    "assert_scraped_data_access",
  ];

  for (const fnName of auditedFunctions) {
    it(`function ${fnName} uses is_platform_admin in section 8`, () => {
      const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
      const start = section8.indexOf(marker);
      assert.ok(start >= 0, `missing function block: ${fnName}`);
      const block = section8.slice(start, start + 1200);
      assert.match(block, /is_platform_admin\(/);
      assert.doesNotMatch(block, /has_role\([^)]*'admin'/);
    });
  }
});

describe("platform admin checks include super_admin", () => {
  it("super_admin-only user passes isPlatformAdmin", async () => {
    const supabase = makeRoleSupabase([{ user_id: SUPER_ADMIN, role: "super_admin" }]);
    assert.equal(await isPlatformAdmin(supabase, SUPER_ADMIN), true);
    assert.equal(await isSuperAdmin(supabase, SUPER_ADMIN), true);
  });

  it("admin-only user passes isPlatformAdmin but not isSuperAdmin", async () => {
    const supabase = makeRoleSupabase([{ user_id: PLATFORM_ADMIN, role: "admin" }]);
    assert.equal(await isPlatformAdmin(supabase, PLATFORM_ADMIN), true);
    assert.equal(await isSuperAdmin(supabase, PLATFORM_ADMIN), false);
  });

  it("normal user fails platform admin checks", async () => {
    const supabase = makeRoleSupabase([]);
    assert.equal(await isPlatformAdmin(supabase, NORMAL_USER), false);
    assert.equal(await isSuperAdmin(supabase, NORMAL_USER), false);
  });

  it("super_admin receives manage-level default credential grant", () => {
    assert.equal(resolveDefaultCredentialGrantLevel(true), "manage");
    assert.equal(resolveDefaultCredentialGrantLevel(false), "use");
  });
});
