/**
 * Portal view resolution: detect Baltimore / Fairfax vs generic portal so the app
 * can show jurisdiction-specific UI only when the selected credential matches a known tenant.
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

/**
 * True when the credential is for Fairfax County VA Accela (plus.fairfaxcounty.gov/CitizenAccess).
 *
 * Signals (any one is sufficient):
 * - login_url host is plus.fairfaxcounty.gov and path includes CitizenAccess
 * - jurisdiction contains "fairfax" and login_url contains accela.com (fallback)
 */
export function isFairfaxPortal(
  credential: PortalCredentialLike | null | undefined,
): boolean {
  if (!credential) return false;
  const urlRaw = (credential.login_url ?? "").trim();
  const jurisdiction = (credential.jurisdiction ?? "").trim().toLowerCase();

  if (urlRaw) {
    try {
      const u = new URL(urlRaw);
      const host = u.hostname.toLowerCase();
      const path = `${u.pathname}/`.toLowerCase();
      if (host === "plus.fairfaxcounty.gov" && path.includes("/citizenaccess/"))
        return true;
    } catch {
      const low = urlRaw.toLowerCase();
      if (
        low.includes("plus.fairfaxcounty.gov") &&
        low.includes("citizenaccess")
      )
        return true;
    }
  }

  if (urlRaw && /accela\.com/i.test(urlRaw) && /fairfax/i.test(jurisdiction))
    return true;

  return false;
}

export type PortalViewVariant =
  | "baltimore"
  | "fairfax"
  | "accela"
  | "projectdox"
  | "generic";

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
 * Montgomery County MD — Avolve ProjectDox (montgomeryco-md-us.avolvecloud.com).
 * Distinct from PGC ePlan; used for Montgomery-specific scrape modes in the dashboard.
 */
export function isMontgomeryProjectDoxPortalCredential(
  credential: PortalCredentialLike | null | undefined,
): boolean {
  if (!credential) return false;
  return (credential.login_url ?? "")
    .toLowerCase()
    .includes("montgomeryco-md-us.avolvecloud.com");
}

export function isHowardProjectDoxPortalCredential(
  credential: PortalCredentialLike | null | undefined,
): boolean {
  if (!credential) return false;
  const url = (credential.login_url ?? "").toLowerCase();
  return (
    url.includes("howardco-md-us.avolvecloud.com") ||
    url.includes("howardb2cprod.b2clogin.com")
  );
}

/**
 * Generic Avolve ProjectDox scrape (e.g. Washington DC) — uses `scrapeAll` / TAB_DEFS,
 * not Montgomery / Howard / PGC pipelines.
 */
export function isWashingtonStyleProjectDoxCredential(
  credential: PortalCredentialLike | null | undefined,
): boolean {
  if (!credential) return false;
  if (!isProjectDoxUrl(credential.login_url)) return false;
  if (isPgcEplanPortalCredential(credential)) return false;
  if (isMontgomeryProjectDoxPortalCredential(credential)) return false;
  const url = (credential.login_url ?? "").toLowerCase();
  if (
    url.includes("howardco-md-us.avolvecloud.com") ||
    url.includes("howardb2cprod.b2clogin.com")
  ) return false;
  return true;
}

/**
 * Resolves which portal view variant to use given credential and optional portalData.portalType.
 * Baltimore / Fairfax are returned when the credential matches those tenants; other Accela stays "accela".
 */
export function resolvePortalView(
  credential: PortalCredentialLike | null | undefined,
  portalTypeFromData?: string | null
): PortalViewVariant {
  if (isBaltimorePortal(credential)) return "baltimore";
  if (isFairfaxPortal(credential)) return "fairfax";
  if (portalTypeFromData === "accela") return "accela";
  if (portalTypeFromData === "projectdox") return "projectdox";
  const url = (credential?.login_url ?? "").toLowerCase();
  if (url.includes("accela.com")) return "accela";
  if (isProjectDoxUrl(credential?.login_url)) return "projectdox";
  return "generic";
}
