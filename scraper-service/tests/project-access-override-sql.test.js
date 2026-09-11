"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RESOLVE_MIGRATION = path.join(
  __dirname,
  "../../supabase/migrations/20260911200000_super_admin_hierarchy.sql",
);
const PROJECTS_RLS_MIGRATION = path.join(
  __dirname,
  "../../supabase/migrations/20260911210000_projects_rls_align_default_access.sql",
);
const UCI_ALIGN_MIGRATION = path.join(
  __dirname,
  "../../supabase/migrations/20260911220000_uci_row_access_align_default_access.sql",
);

function extractFunctionBlock(sql, fnName) {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, `missing function: ${fnName}`);
  const end = sql.indexOf("\n$$;", start);
  assert.ok(end >= 0, `missing function terminator: ${fnName}`);
  return sql.slice(start, end);
}

describe("_resolve_project_access_level SQL (20260911200000)", () => {
  const block = extractFunctionBlock(fs.readFileSync(RESOLVE_MIGRATION, "utf8"), "_resolve_project_access_level");

  it("uses is_platform_admin for admin bypass", () => {
    assert.match(block, /is_platform_admin\(p_user_id\)/);
    assert.doesNotMatch(block, /has_role\(p_user_id,\s*'admin'/);
  });

  it("reads user_project_access_overrides before default", () => {
    assert.match(block, /user_project_access_overrides/);
    assert.match(block, /IF v_override IN \('none', 'read', 'write'\)/);
  });

  it("returns write as default for active users without override", () => {
    assert.match(block, /RETURN 'write';/);
  });

  it("does not downgrade all team members to read", () => {
    assert.doesNotMatch(block, /IF EXISTS \(\s*SELECT 1 FROM public\.project_team_members[\s\S]*RETURN 'read';/);
    assert.match(block, /v_team_role = 'viewer'/);
    assert.match(block, /'editor'::public\.team_role, 'admin'::public\.team_role/);
  });
});

describe("projects SELECT RLS (20260911210000)", () => {
  const sql = fs.readFileSync(PROJECTS_RLS_MIGRATION, "utf8");

  it("gates non-owner visibility on has_project_access", () => {
    assert.match(sql, /has_project_access\(auth\.uid\(\), id\)/);
  });

  it("preserves demo-tenant isolation via can_access_tenant", () => {
    assert.match(sql, /NOT public\.is_demo_tenant\(tenant_id\)/);
    assert.match(sql, /can_access_tenant\(auth\.uid\(\), tenant_id\)/);
  });

  it("documents why relaxing can_access_tenant is safe", () => {
    assert.match(sql, /Why relaxing can_access_tenant/);
  });
});

describe("UCI row access alignment (20260911220000)", () => {
  const sql = fs.readFileSync(UCI_ALIGN_MIGRATION, "utf8");
  const uciBlock = extractFunctionBlock(sql, "has_uci_row_access");

  it("uses has_project_access as primary gate", () => {
    assert.match(uciBlock, /has_project_access\(_user_id, _project_id\)/);
  });

  it("requires can_access_tenant only for demo tenants", () => {
    assert.match(uciBlock, /NOT public\.is_demo_tenant\(_tenant_id\)/);
    assert.match(uciBlock, /OR public\.can_access_tenant\(_user_id, _tenant_id\)/);
  });

  it("aligns list_accessible_uci_projects with projects RLS shape", () => {
    const listBlock = extractFunctionBlock(sql, "list_accessible_uci_projects");
    assert.match(listBlock, /has_project_access\(_user_id, p\.id\)/);
    assert.match(listBlock, /NOT public\.is_demo_tenant\(p\.tenant_id\)/);
  });
});
