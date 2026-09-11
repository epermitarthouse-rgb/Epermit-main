import type {
  AdminCredentialAccessRow,
  AdminEffectivePermissions,
  AdminFeaturePermissionRow,
  AdminProjectAccessRow,
} from "@/lib/adminApi";
import {
  ACCESS_LEVEL_LABELS,
  CREDENTIAL_GRANT_CONTROL_LABELS,
  CREDENTIAL_GRANT_DISPLAY,
  PROJECT_ACCESS_CONTROL_LABELS,
  PROJECT_ACCESS_LEVEL_LABELS,
  resolveActiveUserDefaultFeatureAccess,
  type CredentialGrantControl,
  type CredentialGrantLevel,
  type EffectiveProjectRole,
  type FeatureAccessControl,
  type FeatureAccessLevel,
  type ProjectAccessControl,
  type ProjectAccessLevel,
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
  return effective.email?.trim() || null;
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

function summariesFromPayload(effective: AdminEffectivePermissions) {
  if (effective.access_summaries) {
    return effective.access_summaries;
  }

  const featureExceptions = explicitOverrideCount(effective);
  const projectExceptions = (effective.project_access ?? []).filter(
    (row) => row.control !== "default" && !row.is_owner,
  ).length;
  const credentialExceptions = (effective.credential_access ?? []).filter(
    (row) => row.control !== "default",
  ).length;

  const inactive = effective.access_status !== "active";

  return {
    projects: inactive
      ? "No project access"
      : "All projects — Write",
    projects_exception_count: projectExceptions,
    features: inactive
      ? "No feature access"
      : effective.platform_admin
        ? "All standard features — Write"
        : "All standard features — Write",
    features_exception_count: featureExceptions,
    credentials: inactive
      ? "No credential access"
      : effective.platform_admin
        ? "All credentials — Manage"
        : "All credentials — Use",
    credentials_exception_count: credentialExceptions,
  };
}

export function projectAccessSummaryText(effective: AdminEffectivePermissions): string {
  const s = summariesFromPayload(effective);
  if (s.projects_exception_count === 0) {
    return s.projects;
  }
  return `${s.projects} · Exceptions: ${s.projects_exception_count}`;
}

export function featureAccessSummary(effective: AdminEffectivePermissions): string {
  const s = summariesFromPayload(effective);
  if (s.features_exception_count === 0) {
    return s.features;
  }
  return `${s.features} · Exceptions: ${s.features_exception_count}`;
}

export function credentialAccessSummaryText(effective: AdminEffectivePermissions): string {
  const s = summariesFromPayload(effective);
  if (s.credentials_exception_count === 0) {
    return s.credentials;
  }
  return `${s.credentials} · Exceptions: ${s.credentials_exception_count}`;
}

/** @deprecated Use credentialAccessSummaryText */
export function credentialGrantSummary(effective: AdminEffectivePermissions) {
  const text = credentialAccessSummaryText(effective);
  const s = summariesFromPayload(effective);
  return {
    explicitTotal: s.credentials_exception_count,
    manage: 0,
    use: 0,
    explicitDetail: s.credentials_exception_count === 0 ? "None" : String(s.credentials_exception_count),
    summaryText: text,
  };
}

export function explicitOverrideCount(effective: AdminEffectivePermissions): number {
  if (effective.platform_admin || effective.access_status !== "active") {
    return 0;
  }
  return globalFeatureOverrides(effective).length;
}

export function globalFeatureOverrides(
  effective: AdminEffectivePermissions,
): AdminFeaturePermissionRow[] {
  return (effective.feature_permissions ?? []).filter((row) => row.project_id == null);
}

export function dataRestrictionsSummary(effective: AdminEffectivePermissions): string {
  const count = effective.scraped_data_scope?.length ?? 0;
  if (count === 0) {
    return "None";
  }
  return `${count} restriction${count === 1 ? "" : "s"} configured`;
}

export type ProjectAccessRow = AdminProjectAccessRow;

export function buildProjectAccessRows(
  effective: AdminEffectivePermissions,
): ProjectAccessRow[] {
  if (effective.project_access?.length) {
    return [...effective.project_access].sort((a, b) =>
      (a.project_name ?? a.project_id).localeCompare(b.project_name ?? b.project_id),
    );
  }

  return (effective.projects ?? []).map((project) => {
    const role = String(project.project_role || "none") as EffectiveProjectRole;
    const isOwner = role === "owner";
    let effectiveAccess: string = isOwner ? "owner" : role === "viewer" ? "read" : "write";
    if (role === "none") {
      effectiveAccess = effective.access_status === "active" ? "write" : "none";
    }
    return {
      project_id: project.project_id,
      project_name: project.project_name,
      effective_access: effectiveAccess,
      source: isOwner ? "Project ownership" : effectiveAccess === "write" ? "Default" : "Admin override",
      control: effectiveAccess === "write" && !isOwner ? "default" : effectiveAccess,
      is_owner: isOwner,
    };
  });
}

export type CredentialAccessRow = AdminCredentialAccessRow;

export function buildCredentialAccessRows(
  effective: AdminEffectivePermissions,
): CredentialAccessRow[] {
  if (effective.credential_access?.length) {
    return [...effective.credential_access].sort((a, b) =>
      credentialDisplayLabel(a).localeCompare(credentialDisplayLabel(b)),
    );
  }
  return [];
}

export function formatProjectAccessLevel(level: string): string {
  if (level === "owner") {
    return PROJECT_ACCESS_LEVEL_LABELS.owner;
  }
  if (level in PROJECT_ACCESS_LEVEL_LABELS) {
    return PROJECT_ACCESS_LEVEL_LABELS[level as ProjectAccessLevel];
  }
  if (level in ACCESS_LEVEL_LABELS) {
    return ACCESS_LEVEL_LABELS[level as FeatureAccessLevel];
  }
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function formatCredentialGrantLevel(level: string): string {
  if (level in CREDENTIAL_GRANT_DISPLAY) {
    return CREDENTIAL_GRANT_DISPLAY[level as CredentialGrantLevel];
  }
  return level.charAt(0).toUpperCase() + level.slice(1);
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

  if (effective.access_status !== "active") {
    return {
      featureKey,
      effectiveLevel: "none",
      source: "Inactive user",
      controlValue: "none",
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

export type PortalCredentialOption = {
  id: string;
  jurisdiction: string | null;
  portal_username: string | null;
  login_url?: string | null;
};

export function portalCredentialLabel(credential: PortalCredentialOption): string {
  return credentialDisplayLabel(credential);
}

/** Legacy helpers kept for compatibility with directory list views. */
export function projectAccessSummary(effective: AdminEffectivePermissions) {
  const rows = buildProjectAccessRows(effective);
  const owned = rows.filter((p) => p.is_owner).length;
  return {
    total: rows.length,
    owned,
    team: rows.length - owned,
  };
}

export function projectsForBulkAccess(
  adminProjects: Array<{ id: string; name: string }>,
  effective: AdminEffectivePermissions,
): Array<{ id: string; name: string; currentControl: ProjectAccessControl; isOwner: boolean }> {
  const rowById = new Map(
    buildProjectAccessRows(effective).map((row) => [row.project_id, row]),
  );

  return adminProjects
    .map((project) => {
      const row = rowById.get(project.id);
      const isOwner = row?.is_owner ?? false;
      const control = (row?.control ?? "default") as ProjectAccessControl;
      return {
        id: project.id,
        name: project.name,
        currentControl: isOwner ? "default" : control,
        isOwner,
      };
    })
    .filter((project) => !project.isOwner)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { CREDENTIAL_GRANT_DISPLAY, PROJECT_ACCESS_CONTROL_LABELS, CREDENTIAL_GRANT_CONTROL_LABELS };
