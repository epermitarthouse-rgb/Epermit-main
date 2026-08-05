/**
 * Portal Monitor scrape-mode menu resolution.
 * Options are derived from the linked portal credential (and Arlington portal_data
 * signals) — not from an in-progress scrape.
 */

import {
  isArlingtonPortalContext,
  isBaltimorePortal,
  isFairfaxPortal,
  isHowardProjectDoxPortalCredential,
  isMontgomeryProjectDoxPortalCredential,
  isPgcEplanPortalCredential,
  isWashingtonStyleProjectDoxCredential,
  type ArlingtonPortalContextInput,
  type PortalCredentialLike,
} from "@/lib/portalView";

/** React Query key prefix for the project's linked portal credential. */
export const SIDEBAR_PORTAL_CREDENTIAL_QUERY_KEY = "sidebar_portal_credential";

/** React Query key prefix for the dashboard selected-project row. */
export const DASHBOARD_SELECTED_PROJECT_QUERY_KEY = "dashboard_selected_project";

export type PortalMonitorScrapeMenu =
  | "pgc"
  | "montgomery"
  | "howard"
  | "arlington"
  | "baltimore"
  | "fairfax"
  | "washington_projectdox"
  | "generic";

export type ResolvePortalMonitorScrapeMenuInput = {
  credential: PortalCredentialLike | null | undefined;
  portalData?: unknown;
  project?: ArlingtonPortalContextInput["project"];
  portalUrl?: string | null;
};

/**
 * Which scrape-mode menu the Portal Monitor dropdown should show for a credential.
 * Order matches AgentWorkflowStatus branching (specialized portals before generic).
 */
export function resolvePortalMonitorScrapeMenu(
  input: ResolvePortalMonitorScrapeMenuInput,
): PortalMonitorScrapeMenu {
  const credential = input.credential ?? null;

  if (isPgcEplanPortalCredential(credential)) return "pgc";
  if (isMontgomeryProjectDoxPortalCredential(credential)) return "montgomery";
  if (isHowardProjectDoxPortalCredential(credential)) return "howard";

  if (
    isArlingtonPortalContext({
      selectedCredential: credential,
      portalUrl: input.portalUrl ?? credential?.login_url ?? null,
      portalType: "accela",
      portalData: input.portalData,
      project: input.project,
    }).isArlington
  ) {
    return "arlington";
  }

  if (isBaltimorePortal(credential)) return "baltimore";
  if (isFairfaxPortal(credential)) return "fairfax";
  if (isWashingtonStyleProjectDoxCredential(credential)) {
    return "washington_projectdox";
  }

  return "generic";
}
