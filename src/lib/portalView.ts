/**
 * Portal view resolution: detect Baltimore vs generic portal so the app
 * can show jurisdiction-specific UI only when the selected credential is Baltimore Accela.
 */

export interface PortalCredentialLike {
  login_url?: string | null;
  jurisdiction?: string | null;
}

/**
 * True when the credential is for Baltimore Accela (aca-prod.accela.com/BALTIMORE).
 * Used to show Baltimore-specific portal UI only for Baltimore credentials;
 * all other Accela portals keep the generic Accela UI.
 *
 * Signals (any one is sufficient):
 * - login_url contains /BALTIMORE (with optional trailing slash)
 * - jurisdiction contains "Baltimore" and login_url contains accela.com (fallback)
 */
export function isBaltimorePortal(
  credential: PortalCredentialLike | null | undefined
): boolean {
  if (!credential) return false;
  const url = (credential.login_url ?? "").trim().replace(/\/+$/, "");
  const jurisdiction = (credential.jurisdiction ?? "").trim().toLowerCase();

  if (url && /\/BALTIMORE(\/|$)/i.test(url)) return true;
  if (url && /accela\.com/i.test(url) && /baltimore/i.test(jurisdiction)) return true;

  return false;
}

export type PortalViewVariant = "baltimore" | "accela" | "projectdox" | "generic";

/**
 * True when login_url appears to be a ProjectDox-style portal (Avolve-hosted, /ProjectDox paths,
 * or known jurisdiction ePlan hosts such as Prince George's County).
 */
export function isProjectDoxUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes("avolvecloud.com") ||
    lower.includes("projectdox") ||
    lower.includes("eplans.princegeorgescountymd.gov")
  );
}

/**
 * True when the sidebar-selected portal credential is Prince George's County ePlan (PGC).
 * Used to show PGC-specific scrape modes; other portals keep Washington/general options.
 */
export function isPgcEplanPortalCredential(
  credential: PortalCredentialLike | null | undefined,
): boolean {
  if (!credential) return false;
  const url = (credential.login_url ?? "").toLowerCase();
  if (url.includes("eplans.princegeorgescountymd.gov")) return true;
  const j = (credential.jurisdiction ?? "").trim().toLowerCase();
  if (j.includes("prince george") && j.includes("eplan")) return true;
  return false;
}

/**
 * Resolves which portal view variant to use given credential and optional portalData.portalType.
 * Baltimore is only returned when the credential is Baltimore Accela; other Accela stays "accela".
 */
export function resolvePortalView(
  credential: PortalCredentialLike | null | undefined,
  portalTypeFromData?: string | null
): PortalViewVariant {
  if (isBaltimorePortal(credential)) return "baltimore";
  if (portalTypeFromData === "accela") return "accela";
  if (portalTypeFromData === "projectdox") return "projectdox";
  const url = (credential?.login_url ?? "").toLowerCase();
  if (url.includes("accela.com")) return "accela";
  if (isProjectDoxUrl(credential?.login_url)) return "projectdox";
  return "generic";
}
