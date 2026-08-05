/**
 * Quick Scrape form/request identity.
 *
 * Selected project UUID is the source of truth. Permit number and credential
 * must always be derived from that project — never reused from a prior project's
 * local draft / fallback.
 */

export type QuickScrapeProjectFields = {
  id: string;
  permit_number?: string | null;
  credential_id?: string | null;
};

export type QuickScrapeFormFields = {
  projectId: string;
  permitNumber: string;
  credentialId: string;
};

export type QuickScrapeSubmitFields =
  | {
      ok: true;
      projectId: string;
      permitNumber: string;
      credentialId: string;
    }
  | {
      ok: false;
      reason:
        | "no_project"
        | "project_mismatch"
        | "missing_permit"
        | "missing_credential";
    };

/**
 * Sync header/form fields from the selected project.
 * Always replaces prior permit/credential — empty project fields clear the form.
 */
export function formFieldsFromSelectedProject(
  project: QuickScrapeProjectFields | null | undefined,
): QuickScrapeFormFields | null {
  if (!project?.id) return null;
  return {
    projectId: project.id,
    permitNumber: String(project.permit_number ?? "").trim(),
    credentialId: project.credential_id
      ? String(project.credential_id).trim()
      : "",
  };
}

/**
 * Resolve scrape submit identity from the selected project UUID.
 * Does not fall back to another project's permit or credential.
 */
export function resolveQuickScrapeSubmitFields(args: {
  selectedProjectId: string | null | undefined;
  selectedProject: QuickScrapeProjectFields | null | undefined;
}): QuickScrapeSubmitFields {
  const selectedProjectId = `${args.selectedProjectId ?? ""}`.trim() || null;
  if (!selectedProjectId) {
    return { ok: false, reason: "no_project" };
  }

  const project = args.selectedProject;
  if (!project || project.id !== selectedProjectId) {
    return { ok: false, reason: "project_mismatch" };
  }

  const permitNumber = String(project.permit_number ?? "").trim();
  if (!permitNumber) {
    return { ok: false, reason: "missing_permit" };
  }

  const credentialId = project.credential_id
    ? String(project.credential_id).trim()
    : "";
  if (!credentialId) {
    return { ok: false, reason: "missing_credential" };
  }

  return {
    ok: true,
    projectId: selectedProjectId,
    permitNumber,
    credentialId,
  };
}

/** Core scrape POST body identity fields (no scraper-mode extras). */
export function buildQuickScrapeRequestIdentity(args: {
  sessionId: string;
  userId: string;
  projectId: string;
  permitNumber: string;
}): {
  sessionId: string;
  permitNumber: string;
  userId: string;
  projectId: string;
} {
  return {
    sessionId: args.sessionId,
    permitNumber: String(args.permitNumber).trim(),
    userId: args.userId,
    projectId: args.projectId,
  };
}
