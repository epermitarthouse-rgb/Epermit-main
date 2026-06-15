/**
 * Portal view resolution: detect Baltimore / Fairfax vs generic portal so the app
 * can show jurisdiction-specific UI only when the selected credential matches a known tenant.
 */

export interface PortalCredentialLike {
  login_url?: string | null;
  jurisdiction?: string | null;
  name?: string | null;
  profile_name?: string | null;
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

/**
 * Arlington County VA — Accela Citizen Access (aca-prod.accela.com/ARLINGTONCO).
 */
export function isArlingtonPortal(
  credential: PortalCredentialLike | null | undefined,
): boolean {
  if (!credential) return false;
  const url = (credential.login_url ?? "").trim().replace(/\/+$/, "");
  const jurisdiction = (credential.jurisdiction ?? "").trim().toLowerCase();
  const name = `${credential.name ?? credential.profile_name ?? ""}`.trim();
  if (/\/ARLINGTONCO(\/|$)/i.test(url)) return true;
  if (
    url &&
    /accela\.com/i.test(url) &&
    /\barlington\b/i.test(jurisdiction)
  )
    return true;
  if (/\barlington county\b/i.test(name)) return true;
  return false;
}

export type ArlingtonPortalContextSource =
  | "credential"
  | "portalUrl"
  | "portalData"
  | "project"
  | "agencyCode"
  | null;

export interface ArlingtonPortalContextInput {
  selectedCredential?: PortalCredentialLike | null;
  portalUrl?: string | null;
  portalType?: string | null;
  portalData?: unknown;
  project?: {
    portal_url?: string | null;
    agency_code?: string | null;
    agencyCode?: string | null;
    municipality_key?: string | null;
    jurisdiction?: string | null;
    credential?: PortalCredentialLike | null;
    [key: string]: unknown;
  } | null;
}

export interface ArlingtonPortalContextResult {
  isArlington: boolean;
  source: ArlingtonPortalContextSource;
}

function urlIndicatesArlingtonCo(url: string | null | undefined): boolean {
  const raw = `${url ?? ""}`.trim();
  if (!raw) return false;
  return /\/ARLINGTONCO(\/|$)/i.test(raw);
}

function portalDataIndicatesArlington(portalData: unknown): boolean {
  if (!portalData || typeof portalData !== "object") return false;
  const pd = portalData as Record<string, unknown>;
  const tabs = pd.tabs;
  if (tabs && typeof tabs === "object" && !Array.isArray(tabs)) {
    const t = tabs as Record<string, unknown>;
    for (const key of ["info", "attachments", "planReview"]) {
      const slice = t[key];
      if (!slice || typeof slice !== "object") continue;
      const jurisdiction = `${(slice as Record<string, unknown>).jurisdiction ?? ""}`.trim();
      if (jurisdiction === "arlington_county_va") return true;
      if (/\barlington\b/i.test(jurisdiction)) return true;
    }
  }
  for (const field of ["jurisdiction", "agencyCode", "agency_code", "tenant"]) {
    const val = `${pd[field] ?? ""}`.trim();
    if (val === "arlington_county_va" || /^ARLINGTONCO$/i.test(val)) return true;
    if (/\barlington\b/i.test(val)) return true;
  }
  if (urlIndicatesArlingtonCo(`${pd.portalUrl ?? pd.portalBaseUrl ?? ""}`)) {
    return true;
  }
  return false;
}

/**
 * True when any reliable signal indicates Arlington County Accela — used for portal
 * renderer selection independent of scrape completeness (planReview, attachments, etc.).
 */
export function isArlingtonPortalContext(
  input: ArlingtonPortalContextInput,
): ArlingtonPortalContextResult {
  const cred =
    input.selectedCredential ??
    input.project?.credential ??
    null;

  if (isArlingtonPortal(cred)) {
    return { isArlington: true, source: "credential" };
  }

  const portalUrl = `${input.portalUrl ?? input.project?.portal_url ?? cred?.login_url ?? ""}`.trim();
  if (portalUrl && urlIndicatesArlingtonCo(portalUrl)) {
    return { isArlington: true, source: "portalUrl" };
  }

  const agencyCode = `${input.project?.agency_code ?? input.project?.agencyCode ?? ""}`.trim();
  if (/^ARLINGTONCO$/i.test(agencyCode)) {
    return { isArlington: true, source: "agencyCode" };
  }

  const municipalityKey = `${input.project?.municipality_key ?? ""}`.trim();
  if (municipalityKey === "arlington_county_va") {
    return { isArlington: true, source: "project" };
  }

  if (input.portalType === "accela" && cred) {
    const jurisdiction = `${cred.jurisdiction ?? input.project?.jurisdiction ?? ""}`.trim();
    const profileName = `${cred.name ?? cred.profile_name ?? ""}`.trim();
    if (/\barlington\b/i.test(jurisdiction) || /\barlington county\b/i.test(profileName)) {
      return { isArlington: true, source: "credential" };
    }
  }

  if (portalDataIndicatesArlington(input.portalData)) {
    return { isArlington: true, source: "portalData" };
  }

  return { isArlington: false, source: null };
}

/** Minimal Accela portal_data shell for Arlington before the first scrape. */
export function buildEmptyArlingtonAccelaPortalShell(permitNumber?: string | null) {
  const pn = `${permitNumber ?? ""}`.trim();
  return {
    portalType: "accela",
    name: pn,
    projectNum: pn,
    description: "",
    location: "",
    dashboardStatus: "",
    tabs: {
      info: {
        fields: pn ? { record_number: pn } : {},
        keyValues: [],
        tables: [],
        jurisdiction: "arlington_county_va",
      },
      attachments: {
        tables: [],
        keyValues: [],
        jurisdiction: "arlington_county_va",
      },
      planReview: {
        jurisdiction: "arlington_county_va",
        tabs: {},
      },
      status: { departments: [] },
      inspections: { tables: [] },
      relatedRecords: { tables: [] },
      payments: { tables: [] },
      reports: { pdfs: [] },
    },
  };
}

export type PortalViewVariant =
  | "baltimore"
  | "fairfax"
  | "arlington"
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
  portalTypeFromData?: string | null,
  portalData?: unknown,
): PortalViewVariant {
  if (isBaltimorePortal(credential)) return "baltimore";
  if (isFairfaxPortal(credential)) return "fairfax";
  if (
    isArlingtonPortalContext({
      selectedCredential: credential,
      portalType: portalTypeFromData ?? null,
      portalData,
    }).isArlington
  ) {
    return "arlington";
  }
  if (portalTypeFromData === "accela") return "accela";
  if (portalTypeFromData === "projectdox") return "projectdox";
  const url = (credential?.login_url ?? "").toLowerCase();
  if (url.includes("accela.com")) return "accela";
  if (isProjectDoxUrl(credential?.login_url)) return "projectdox";
  return "generic";
}
