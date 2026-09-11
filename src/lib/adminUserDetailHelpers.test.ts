import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AdminEffectivePermissions } from "./adminApi.ts";
import {
  buildCredentialAccessRows,
  buildProjectAccessRows,
  credentialAccessSummaryText,
  credentialGrantSummary,
  featureAccessSummary,
  globalFeatureAccessRow,
  projectAccessSummary,
  projectsForBulkAccess,
  userIdentityTitle,
} from "./adminUserDetailHelpers.ts";

describe("adminUserDetailHelpers", () => {
  it("prefers full_name for identity title", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u1",
      full_name: "Diamond Lakey",
      email: "dlakey@commun-et.com",
      access_status: "active",
      platform_admin: false,
    };
    assert.equal(userIdentityTitle(effective), "Diamond Lakey");
  });

  it("falls back to email when name missing", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u2",
      email: "daniyalzahid12@yahoo.com",
      access_status: "active",
      platform_admin: true,
    };
    assert.equal(userIdentityTitle(effective), "daniyalzahid12@yahoo.com");
  });

  it("summarizes platform admin feature access", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u2",
      access_status: "active",
      platform_admin: true,
    };
    assert.equal(featureAccessSummary(effective), "All standard features — Write");
  });

  it("builds owner vs default project rows from project_access payload", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u2",
      access_status: "active",
      platform_admin: false,
      project_access: [
        {
          project_id: "p1",
          project_name: "A",
          effective_access: "owner",
          source: "Project ownership",
          control: "default",
          is_owner: true,
        },
        {
          project_id: "p2",
          project_name: "B",
          effective_access: "write",
          source: "Default",
          control: "default",
          is_owner: false,
        },
      ],
    };
    const rows = buildProjectAccessRows(effective);
    assert.equal(rows[0].is_owner, true);
    assert.equal(rows[0].source, "Project ownership");
    assert.equal(rows[1].source, "Default");
    const summary = projectAccessSummary(effective);
    assert.equal(summary.total, 2);
    assert.equal(summary.owned, 1);
    assert.equal(summary.team, 1);
  });

  it("summarizes platform admin credential access as effective manage", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u3",
      access_status: "active",
      platform_admin: true,
      credential_grants: [],
    };
    assert.equal(credentialAccessSummaryText(effective), "All credentials — Manage");
    const summary = credentialGrantSummary(effective);
    assert.equal(summary.explicitTotal, 0);
    assert.equal(summary.summaryText, "All credentials — Manage");
  });

  it("summarizes normal user default credential access with exception counts", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u4",
      access_status: "active",
      platform_admin: false,
      access_summaries: {
        projects: "All projects — Write",
        projects_exception_count: 0,
        features: "All standard features — Write",
        features_exception_count: 0,
        credentials: "All credentials — Use",
        credentials_exception_count: 2,
      },
      credential_access: [
        {
          credential_id: "c1",
          jurisdiction: "DC DOB",
          portal_username: "user@example.com",
          effective_access: "manage",
          source: "Admin override",
          control: "manage",
        },
        {
          credential_id: "c2",
          jurisdiction: "Arlington",
          portal_username: "permitbot",
          effective_access: "none",
          source: "Admin restriction",
          control: "none",
        },
      ],
    };
    assert.equal(
      credentialAccessSummaryText(effective),
      "All credentials — Use · Exceptions: 2",
    );
    assert.equal(buildCredentialAccessRows(effective).length, 2);
  });

  it("includes all non-owner projects in bulk access picker", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u2",
      access_status: "active",
      platform_admin: false,
      project_access: [
        {
          project_id: "p1",
          project_name: "Alpha",
          effective_access: "read",
          source: "Admin override",
          control: "read",
          is_owner: false,
        },
        {
          project_id: "p2",
          project_name: "Owned",
          effective_access: "owner",
          source: "Project ownership",
          control: "default",
          is_owner: true,
        },
      ],
    };
    const bulk = projectsForBulkAccess(
      [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Owned" },
        { id: "p3", name: "Gamma" },
      ],
      effective,
    );
    assert.deepEqual(
      bulk.map((project) => project.id),
      ["p1", "p3"],
    );
    assert.equal(bulk[0].currentControl, "read");
    assert.equal(bulk[1].currentControl, "default");
  });

  it("shows global feature override source and control", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u5",
      access_status: "active",
      platform_admin: false,
      projects: [{ project_id: "p1", project_name: "A", project_role: "editor" }],
      feature_permissions: [
        { project_id: null, feature_key: "code.analyzer", access_level: "none" },
      ],
    };
    const row = globalFeatureAccessRow(effective, "code.analyzer");
    assert.equal(row.effectiveLevel, "none");
    assert.equal(row.source, "Admin restriction");
    assert.equal(row.controlValue, "none");
  });

  it("shows inherited default when no global override exists", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u6",
      access_status: "active",
      platform_admin: false,
      projects: [],
      feature_permissions: [],
      global_features: { "billing.quickbooks": "read", "code.analyzer": "write" },
    };
    const row = globalFeatureAccessRow(effective, "billing.quickbooks");
    assert.equal(row.effectiveLevel, "read");
    assert.equal(row.source, "Default");
    assert.equal(row.controlValue, "inherit");
  });

  it("uses standard write defaults for zero-project users without global_features payload", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u8",
      access_status: "active",
      platform_admin: false,
      projects: [],
      feature_permissions: [],
    };
    assert.equal(globalFeatureAccessRow(effective, "code.analyzer").effectiveLevel, "write");
    assert.equal(globalFeatureAccessRow(effective, "billing.quickbooks").effectiveLevel, "write");
    assert.equal(globalFeatureAccessRow(effective, "uci.workspace").source, "Default");
  });

  it("counts only global overrides in feature access summary", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u7",
      access_status: "active",
      platform_admin: false,
      feature_permissions: [
        { project_id: null, feature_key: "code.analyzer", access_level: "none" },
        { project_id: "p1", feature_key: "scraper.run", access_level: "read" },
      ],
    };
    assert.equal(
      featureAccessSummary(effective),
      "All standard features — Write · Exceptions: 1",
    );
  });

});
