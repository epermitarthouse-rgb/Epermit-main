export type PlatformRoleLevel = "user" | "admin" | "super_admin";

export function resolvePrimaryPlatformRole(roles: string[] | undefined): PlatformRoleLevel {
  const set = new Set((roles ?? []).map((role) => String(role)));
  if (set.has("super_admin")) return "super_admin";
  if (set.has("admin")) return "admin";
  return "user";
}

export function platformRoleLabel(role: PlatformRoleLevel | string | undefined): string {
  switch (role) {
    case "super_admin":
      return "Super Admin";
    case "admin":
      return "Platform Admin";
    default:
      return "User";
  }
}

export function platformRoleFromUser(input: {
  platform_role?: string;
  platform_roles?: string[];
  super_admin?: boolean;
  platform_admin?: boolean;
}): PlatformRoleLevel {
  const fromRoles = resolvePrimaryPlatformRole(input.platform_roles);
  if (fromRoles !== "user") {
    return fromRoles;
  }
  if (input.super_admin) {
    return "super_admin";
  }
  if (input.platform_role === "super_admin" || input.platform_role === "admin") {
    return input.platform_role;
  }
  if (input.platform_admin) {
    return "admin";
  }
  return "user";
}

export type AdminRoleAction =
  | "grant-platform-admin"
  | "promote-to-super-admin"
  | "revoke-platform-admin"
  | "demote-super-admin"
  | "deactivate"
  | "activate";

export function visibleRoleActions(input: {
  viewerRole: PlatformRoleLevel;
  targetRole: PlatformRoleLevel;
  isSelf: boolean;
  isLastSuperAdmin?: boolean;
}): AdminRoleAction[] {
  const { viewerRole, targetRole, isSelf, isLastSuperAdmin } = input;

  if (isSelf) {
    return [];
  }

  if (viewerRole === "user") {
    return [];
  }

  if (viewerRole === "admin") {
    if (targetRole !== "user") {
      return [];
    }
    return ["activate", "deactivate"];
  }

  // super_admin viewer
  /** @type {AdminRoleAction[]} */
  const actions = ["activate"];

  if (!(targetRole === "super_admin" && isLastSuperAdmin)) {
    actions.push("deactivate");
  }

  if (targetRole === "user") {
    actions.push("grant-platform-admin", "promote-to-super-admin");
  } else if (targetRole === "admin") {
    actions.push("revoke-platform-admin", "promote-to-super-admin");
  } else if (targetRole === "super_admin" && !isLastSuperAdmin) {
    actions.push("demote-super-admin");
  }

  return actions;

  return [];
}

export function mapRoleActionToApiAction(
  action: AdminRoleAction,
): "promote-to-admin" | "promote-to-super-admin" | "demote-super-admin" | "revoke-admin" {
  switch (action) {
    case "grant-platform-admin":
      return "promote-to-admin";
    case "promote-to-super-admin":
      return "promote-to-super-admin";
    case "revoke-platform-admin":
      return "revoke-admin";
    case "demote-super-admin":
      return "demote-super-admin";
    default:
      return "revoke-admin";
  }
}
