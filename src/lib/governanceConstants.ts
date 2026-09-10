/** Feature keys governed by user_feature_permissions (mirrors governance.constants.js). */
export const FEATURE_KEYS = [
  "project.core",
  "scraper.run",
  "scraper.results",
  "filing.submit",
  "documents.vault",
  "ingestion.rag",
  "billing.quickbooks",
  "code.analyzer",
  "uci.workspace",
  "credentials.self",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureAccessLevel = "none" | "read" | "write";

export type CredentialGrantLevel = "none" | "use" | "manage";

export type ProjectRole = "none" | "viewer" | "editor" | "admin";

/** Includes owner resolved from projects.user_id (not stored on team table). */
export type EffectiveProjectRole = ProjectRole | "owner";

const EDITOR_WRITE_FEATURES: readonly FeatureKey[] = [
  "scraper.run",
  "filing.submit",
  "documents.vault",
  "ingestion.rag",
  "code.analyzer",
  "credentials.self",
];

export const FEATURE_KEY_LABELS: Record<FeatureKey, string> = {
  "project.core": "Project core",
  "scraper.run": "Scraper run",
  "scraper.results": "Scraper results",
  "filing.submit": "Permit filing submit",
  "documents.vault": "Documents vault",
  "ingestion.rag": "Ingestion / RAG",
  "billing.quickbooks": "QuickBooks billing",
  "code.analyzer": "Code analyzer",
  "uci.workspace": "UCI workspace",
  "credentials.self": "Portal credentials (self)",
};

export const ACCESS_LEVEL_LABELS: Record<FeatureAccessLevel, string> = {
  none: "None",
  read: "Read",
  write: "Write",
};

/** Admin feature-access control including reset-to-inherited. */
export type FeatureAccessControl = "inherit" | FeatureAccessLevel;

export const FEATURE_CONTROL_LABELS: Record<FeatureAccessControl, string> = {
  inherit: "Default / Inherited",
  none: "No access",
  read: "Read",
  write: "Write",
};

export const CREDENTIAL_GRANT_LABELS: Record<CredentialGrantLevel, string> = {
  none: "None",
  use: "Use",
  manage: "Manage",
};

/** Admin-facing credential grant labels. */
export const CREDENTIAL_GRANT_DISPLAY: Record<CredentialGrantLevel, string> = {
  none: "No access",
  use: "Can use in automations",
  manage: "Can manage login",
};

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  none: "None",
  viewer: "Viewer",
  editor: "Editor",
  admin: "Admin",
};

export function featureKeyLabel(key: string): string {
  return FEATURE_KEY_LABELS[key as FeatureKey] ?? key;
}

/** Mirrors scraper-service governance.constants.js role-default matrix. */
export function resolveRoleDefaultFeatureAccess(
  projectRole: EffectiveProjectRole,
  featureKey: string,
): FeatureAccessLevel {
  if (projectRole === "none") {
    return "none";
  }
  if (projectRole === "owner" || projectRole === "admin") {
    return "write";
  }
  if (projectRole === "viewer") {
    return "read";
  }
  if (projectRole === "editor") {
    if (EDITOR_WRITE_FEATURES.includes(featureKey as FeatureKey)) {
      return "write";
    }
    return "read";
  }
  return "none";
}

/** Standard product baseline for active users — all standard features usable. */
export function resolveActiveUserDefaultFeatureAccess(featureKey: string): FeatureAccessLevel {
  if (FEATURE_KEYS.includes(featureKey as FeatureKey)) {
    return "write";
  }
  return "write";
}

const FEATURE_LEVEL_RANK: Record<FeatureAccessLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
};

export function combineFeatureAccessLevels(
  a: FeatureAccessLevel,
  b: FeatureAccessLevel,
): FeatureAccessLevel {
  const min = Math.min(FEATURE_LEVEL_RANK[a] ?? 0, FEATURE_LEVEL_RANK[b] ?? 0);
  if (min >= FEATURE_LEVEL_RANK.write) return "write";
  if (min >= FEATURE_LEVEL_RANK.read) return "read";
  return "none";
}
