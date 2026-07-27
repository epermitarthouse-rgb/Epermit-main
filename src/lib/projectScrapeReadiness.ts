import type { Project } from "@/types/project";

export type ProjectScrapeReadiness =
  | "Ready to Scrape"
  | "Missing Permit Number"
  | "Missing Portal Credential"
  | "Missing Jurisdiction"
  | "Setup Incomplete";

/**
 * Scrape readiness based on the real Intake Pipeline contract:
 * - projects.permit_number (sent as permitNumber to /api/scrape)
 * - projects.credential_id → portal_credentials.login_url (portal/jurisdiction resolution)
 * Jurisdiction text is helpful but not what selects the scraper — login_url does.
 */
export function getProjectScrapeReadiness(
  project: Pick<Project, "permit_number" | "credential_id" | "jurisdiction">,
): ProjectScrapeReadiness {
  const hasPermit = Boolean(String(project.permit_number ?? "").trim());
  const hasCredential = Boolean(project.credential_id);
  const hasJurisdiction = Boolean(String(project.jurisdiction ?? "").trim());

  // Scrape hard requirements: permit_number + credential_id (login_url selects portal).
  // Jurisdiction label is shown as incomplete until filled so the project card matches the workflow.
  if (!hasPermit && !hasCredential) return "Setup Incomplete";
  if (!hasPermit) return "Missing Permit Number";
  if (!hasCredential) return "Missing Portal Credential";
  if (!hasJurisdiction) return "Missing Jurisdiction";
  return "Ready to Scrape";
}

export function scrapeReadinessTone(
  readiness: ProjectScrapeReadiness,
): "good" | "warn" | "bad" | "default" {
  switch (readiness) {
    case "Ready to Scrape":
      return "good";
    case "Missing Permit Number":
    case "Missing Portal Credential":
      return "warn";
    case "Missing Jurisdiction":
      return "default";
    case "Setup Incomplete":
    default:
      return "bad";
  }
}
