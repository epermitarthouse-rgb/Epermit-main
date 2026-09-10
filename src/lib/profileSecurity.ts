export type ProfileSecurityState = {
  mustChangePassword: boolean;
  accessStatus: string;
  loading: boolean;
};

export const DEFAULT_PROFILE_SECURITY: ProfileSecurityState = {
  mustChangePassword: false,
  accessStatus: "active",
  loading: false,
};

export function shouldForcePasswordChange(
  security: Pick<ProfileSecurityState, "mustChangePassword" | "accessStatus" | "loading">,
): boolean {
  if (security.loading) return false;
  if (security.accessStatus === "deactivated") return false;
  return security.mustChangePassword;
}

export function isDeactivatedProfile(
  security: Pick<ProfileSecurityState, "accessStatus" | "loading">,
): boolean {
  if (security.loading) return false;
  return security.accessStatus === "deactivated";
}
