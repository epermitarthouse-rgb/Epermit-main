import type {
  AdminCredentialGrantRow,
  AdminEffectivePermissions,
  AdminFeaturePermissionRow,
} from "@/lib/adminApi";
import {
  ACCESS_LEVEL_LABELS,
  CREDENTIAL_GRANT_DISPLAY,
  resolveActiveUserDefaultFeatureAccess,
  type EffectiveProjectRole,
  type FeatureAccessControl,
  type FeatureAccessLevel,
  type ProjectRole,
} from "@/lib/governanceConstants";

export function userIdentityTitle(effective: AdminEffectivePermissions): string {
  return (
    effective.full_name?.trim() ||
    effective.email?.trim() ||
    "Unnamed user"
  );
}

export function userIdentitySubtitle(effective: AdminEffectivePermissions): string | null {
  const title = userIdentityTitle(effective);
  const email = effective.email?.trim();
  if (email && email !== title) {
    return email;
  }
  return null;
}

export function userIdentityMeta(effective: AdminEffectivePermissions): string | null {
  const parts = [effective.job_title?.trim(), effective.company_name?.trim()].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

const RISK_LABELS: Record<string, string> = {
  sole_platform_admin: "This user is the only platform administrator.",
};

export function humanRiskLabel(risk: string): string {
  return RISK_LABELS[risk] ?? risk.replace(/_/g, " ");
}

export type ProjectAccessRow = {
  project_id: string;
  project_name: string;
  access: string;
  source: string;
  isOwner: boolean;
  project_role: EffectiveProjectRole;
};

export function existingProjectAccessIds(effective: AdminEffectivePermissions): Set<string> {
  return new Set((effective.projects ?? []).map((project) => project.project_id));
}

export type GrantableProject = {
  id: string;
  name: string;
};

export function projectsAvailableForGrant(
  adminProjects: Array<{ id: string; name: string }>,
  effective: AdminEffectivePermissions,
): GrantableProject[] {
  const existing = existingProjectAccessIds(effective);
  return adminProjects
    .filter((project) => !existing.has(project.id))
    .map((project) => ({ id: project.id, name: project.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type BulkProjectOption = {
  id: string;
  name: string;
  /** Team role when user already has team membership; null if not yet assigned. */
  currentTeamRole: ProjectRole | null;
  isOwner: boolean;
};

export function projectsForBulkAccess(
  adminProjects: Array<{ id: string; name: string }>,
  effective: AdminEffectivePermissions,
): BulkProjectOption[] {
  const accessById = new Map(
    (effective.projects ?? []).map((project) => [project.project_id, project.project_role]),
  );

  return adminProjects
    .map((project) => {
      const role = accessById.get(project.id);
      const isOwner = role === "owner";
      return {
        id: project.id,
        name: project.name,
        currentTeamRole:
          role && role !== "owner" ? (String(role) as ProjectRole) : null,
        isOwner,
      };
    })
    .filter((project) => !project.isOwner)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const PROJECT_ROLE_RANK: Record<EffectiveProjectRole, number> = {
  none: 0,
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

export function highestProjectRole(
  effective: AdminEffectivePermissions,
): EffectiveProjectRole {
  let best: EffectiveProjectRole = "none";
  for (const project of effective.projects ?? []) {
    const role = String(project.project_role || "none") as EffectiveProjectRole;
    if ((PROJECT_ROLE_RANK[role] ?? 0) > (PROJECT_ROLE_RANK[best] ?? 0)) {
      best = role;
    }
  }
  return best;
}

export function buildProjectAccessRows(
  effective: AdminEffectivePermissions,
): ProjectAccessRow[] {
  return (effective.projects ?? []).map((project) => {
    const role = String(project.project_role || "none") as EffectiveProjectRole;
    const isOwner = role === "owner";
    return {
      project_id: project.project_id,
      project_name: project.project_name ?? project.project_id.slice(0, 8) + "…",
      access: isOwner ? "Owner" : role.charAt(0).toUpperCase() + role.slice(1),
      source: isOwner ? "Project ownership" : "Team membership",
      isOwner,
      project_role: role,
    };
  });
}

export function projectAccessSummary(effective: AdminEffectivePermissions): {
  total: number;
  owned: number;
  team: number;
} {
  const rows = effective.projects ?? [];
  const owned = rows.filter((p) => p.project_role === "owner").length;
  return {
    total: rows.length,
    owned,
    team: rows.length - owned,
  };
}

export function globalFeatureOverrides(
  effective: AdminEffectivePermissions,
): AdminFeaturePermissionRow[] {
  return (effective.feature_permissions ?? []).filter((row) => row.project_id == null);
}

export function explicitOverrideCount(effective: AdminEffectivePermissions): number {
  return globalFeatureOverrides(effective).length;
}

export function featureAccessSummary(effective: AdminEffectivePermissions): string {
  if (effective.platform_admin) {
    return "All features — Write";
  }
  const overrides = explicitOverrideCount(effective);
  if (overrides === 0) {
    return "Standard product defaults";
  }
  return `${overrides} global feature override${overrides === 1 ? "" : "s"}`;
}

export function dataRestrictionsSummary(effective: AdminEffectivePermissions): string {
  const count = effective.scraped_data_scope?.length ?? 0;
  if (count === 0) {
    return "None";
  }
  return `${count} restriction${count === 1 ? "" : "s"} configured`;
}

export function activeCredentialGrants(
  effective: AdminEffectivePermissions,
): AdminCredentialGrantRow[] {
  return (effective.credential_grants ?? []).filter((grant) => grant.grant_level !== "none");
}

export function credentialGrantSummary(effective: AdminEffectivePermissions): {
  /** Explicit non-none grant rows stored in user_portal_credential_grants */
  explicitTotal: number;
  manage: number;
  use: number;
  /** Detail string for explicit grants only */
  explicitDetail: string;
  /** Primary summary text reflecting effective access */
  summaryText: string;
} {
  const grants = activeCredentialGrants(effective);
  const manage = grants.filter((g) => g.grant_level === "manage").length;
  const use = grants.filter((g) => g.grant_level === "use").length;
  const parts: string[] = [];
  if (manage) parts.push(`${manage} Manage`);
  if (use) parts.push(`${use} Use`);

  if (effective.platform_admin) {
    return {
      explicitTotal: grants.length,
      manage,
      use,
      explicitDetail: grants.length === 0 ? "None" : parts.join(" · "),
      summaryText: "All credentials — Manage",
    };
  }

  if (grants.length === 0) {
    return {
      explicitTotal: 0,
      manage: 0,
      use: 0,
      explicitDetail: "None",
      summaryText: "No credential access",
    };
  }

  const countLabel = `${grants.length} credential${grants.length === 1 ? "" : "s"}`;
  return {
    explicitTotal: grants.length,
    manage,
    use,
    explicitDetail: parts.join(" · "),
    summaryText: parts.length ? `${countLabel} · ${parts.join(" · ")}` : countLabel,
  };
}

export function credentialAccessSummaryText(effective: AdminEffectivePermissions): string {
  return credentialGrantSummary(effective).summaryText;
}

export type PortalCredentialOption = {
  id: string;
  jurisdiction: string | null;
  portal_username: string | null;
  login_url?: string | null;
};

export function portalCredentialLabel(credential: PortalCredentialOption): string {
  const jurisdiction = credential.jurisdiction?.trim();
  const username = credential.portal_username?.trim();
  if (jurisdiction && username) {
    return `${jurisdiction} · ${username}`;
  }
  if (jurisdiction) {
    return jurisdiction;
  }
  if (username) {
    return username;
  }
  return credential.id.slice(0, 8) + "…";
}

export function credentialsAvailableForGrant(
  allCredentials: PortalCredentialOption[],
  effective: AdminEffectivePermissions,
): PortalCredentialOption[] {
  const grantedIds = new Set(activeCredentialGrants(effective).map((grant) => grant.credential_id));
  return allCredentials
    .filter((credential) => !grantedIds.has(credential.id))
    .sort((a, b) => portalCredentialLabel(a).localeCompare(portalCredentialLabel(b)));
}

export function findGlobalFeatureOverride(
  permissions: AdminFeaturePermissionRow[] | undefined,
  featureKey: string,
): AdminFeaturePermissionRow | undefined {
  return permissions?.find(
    (row) => row.project_id == null && String(row.feature_key) === featureKey,
  );
}

export type GlobalFeatureAccessRow = {
  featureKey: string;
  effectiveLevel: FeatureAccessLevel;
  source: string;
  controlValue: FeatureAccessControl;
};

export function globalFeatureAccessRow(
  effective: AdminEffectivePermissions,
  featureKey: string,
): GlobalFeatureAccessRow {
  if (effective.platform_admin) {
    return {
      featureKey,
      effectiveLevel: "write",
      source: "Platform admin",
      controlValue: "write",
    };
  }

  const globalOverride = findGlobalFeatureOverride(
    effective.feature_permissions,
    featureKey,
  );
  if (globalOverride) {
    const level = globalOverride.access_level;
    return {
      featureKey,
      effectiveLevel: level,
      source: level === "none" ? "Admin restriction" : "Admin override",
      controlValue: level,
    };
  }

  const fromPayload = effective.global_features?.[featureKey];
  const inherited =
    fromPayload === "none" || fromPayload === "read" || fromPayload === "write"
      ? fromPayload
      : resolveActiveUserDefaultFeatureAccess(featureKey);

  return {
    featureKey,
    effectiveLevel: inherited,
    source: "Default",
    controlValue: "inherit",
  };
}

export function formatAccessLevel(level: FeatureAccessLevel): string {
  return ACCESS_LEVEL_LABELS[level] ?? level;
}

export function credentialDisplayLabel(grant: {
  credential_id: string;
  jurisdiction?: string | null;
  portal_username?: string | null;
}): string {
  const jurisdiction = grant.jurisdiction?.trim();
  const username = grant.portal_username?.trim();
  if (jurisdiction && username) {
    return `${jurisdiction} · ${username}`;
  }
  if (jurisdiction) {
    return jurisdiction;
  }
  if (username) {
    return username;
  }
  return grant.credential_id.slice(0, 8) + "…";
}

export { CREDENTIAL_GRANT_DISPLAY };
