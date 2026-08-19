"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATION = path.join(
  __dirname,
  "../../supabase/migrations/20260819120000_uci_destructive_action_safety.sql",
);

describe("UCI destructive-action safety migration", () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");

  it("adds archive path and blocks project delete with UCI dependents", () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS archived_at/);
    assert.match(sql, /prevent_destructive_project_delete_with_uci/);
    assert.match(sql, /PROJECT_HAS_UCI_DEPENDENCIES/);
    assert.match(sql, /coordination_records/);
  });

  it("removes authenticated DELETE policies from append-only tables", () => {
    assert.match(sql, /coordination_stage_transitions/);
    assert.match(sql, /coordination_communications/);
    assert.match(sql, /coordination_applications/);
    assert.match(sql, /DROP POLICY IF EXISTS "Users can delete %1\$s for tenant project editor access"/);
    assert.match(sql, /service_role bypasses RLS/i);
  });
});
