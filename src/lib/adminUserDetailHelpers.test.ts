import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AdminEffectivePermissions } from "./adminApi.ts";
import {
  buildProjectAccessRows,
  credentialAccessSummaryText,
  credentialGrantSummary,
  credentialsAvailableForGrant,
  featureAccessSummary,
  globalFeatureAccessRow,
  projectAccessSummary,
  projectsAvailableForGrant,
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
    assert.equal(featureAccessSummary(effective), "All features — Write");
  });

  it("builds owner vs team project rows", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u2",
      access_status: "active",
      platform_admin: true,
      projects: [
        { project_id: "p1", project_name: "A", project_role: "owner" },
        { project_id: "p2", project_name: "B", project_role: "editor" },
      ],
    };
    const rows = buildProjectAccessRows(effective);
    assert.equal(rows[0].isOwner, true);
    assert.equal(rows[0].source, "Project ownership");
    assert.equal(rows[1].source, "Team membership");
    const summary = projectAccessSummary(effective);
    assert.equal(summary.total, 2);
    assert.equal(summary.owned, 1);
    assert.equal(summary.team, 1);
  });

  it("excludes projects the user already has access to from grant picker", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u2",
      access_status: "active",
      platform_admin: false,
      projects: [{ project_id: "p1", project_name: "Alpha", project_role: "viewer" }],
    };
    const available = projectsAvailableForGrant(
      [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Beta" },
        { id: "p3", name: "Gamma" },
      ],
      effective,
    );
    assert.deepEqual(
      available.map((project) => project.id),
      ["p2", "p3"],
    );
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

  it("summarizes normal user credential grants with counts", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u4",
      access_status: "active",
      platform_admin: false,
      credential_grants: [
        {
          credential_id: "c1",
          grant_level: "manage",
          jurisdiction: "DC DOB",
          portal_username: "user@example.com",
        },
        {
          credential_id: "c2",
          grant_level: "use",
          jurisdiction: "Arlington",
          portal_username: "permitbot",
        },
      ],
    };
    assert.equal(credentialAccessSummaryText(effective), "2 credentials · 1 Manage · 1 Use");
  });

  it("includes all non-owner projects in bulk access picker", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u2",
      access_status: "active",
      platform_admin: false,
      projects: [
        { project_id: "p1", project_name: "Alpha", project_role: "viewer" },
        { project_id: "p2", project_name: "Owned", project_role: "owner" },
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
    assert.equal(bulk[0].currentTeamRole, "viewer");
    assert.equal(bulk[1].currentTeamRole, null);
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
    assert.equal(featureAccessSummary(effective), "1 global feature override");
  });

  it("excludes already-granted credentials from picker", () => {
    const effective: AdminEffectivePermissions = {
      user_id: "u4",
      access_status: "active",
      platform_admin: false,
      credential_grants: [{ credential_id: "c1", grant_level: "use" }],
    };
    const available = credentialsAvailableForGrant(
      [
        { id: "c1", jurisdiction: "DC", portal_username: "a" },
        { id: "c2", jurisdiction: "Arlington", portal_username: "b" },
      ],
      effective,
    );
    assert.deepEqual(available.map((credential) => credential.id), ["c2"]);
  });
});
