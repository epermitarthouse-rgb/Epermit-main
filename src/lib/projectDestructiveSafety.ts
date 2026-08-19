import { supabase } from "@/lib/supabase";

export type ProjectUciDependencySummary = {
  coordinationRecords: number;
  harvestLinks: number;
  applications: number;
  communications: number;
  stageTransitions: number;
  submissionPreparations: number;
  transmissionAttempts: number;
  validationAttempts: number;
};

export const EMPTY_PROJECT_UCI_DEPENDENCY_SUMMARY: ProjectUciDependencySummary = {
  coordinationRecords: 0,
  harvestLinks: 0,
  applications: 0,
  communications: 0,
  stageTransitions: 0,
  submissionPreparations: 0,
  transmissionAttempts: 0,
  validationAttempts: 0,
};

async function countForProject(
  table: string,
  projectId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  if (error) {
    // Missing optional tables (pre-migration) must not block the safety gate open.
    const msg = String(error.message || "").toLowerCase();
    if (
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      msg.includes("does not exist") ||
      msg.includes("schema cache")
    ) {
      return 0;
    }
    throw error;
  }

  return count ?? 0;
}

/** True when any UCI coordination / submission history exists for the project. */
export function hasUciDependencies(summary: ProjectUciDependencySummary): boolean {
  return (
    summary.coordinationRecords > 0 ||
    summary.harvestLinks > 0 ||
    summary.applications > 0 ||
    summary.communications > 0 ||
    summary.stageTransitions > 0 ||
    summary.submissionPreparations > 0 ||
    summary.transmissionAttempts > 0 ||
    summary.validationAttempts > 0
  );
}

export function formatUciDependencyBlockReason(
  summary: ProjectUciDependencySummary,
): string {
  const parts: string[] = [];
  if (summary.coordinationRecords > 0) {
    parts.push(
      `${summary.coordinationRecords} utility coordination record${summary.coordinationRecords === 1 ? "" : "s"}`,
    );
  }
  if (summary.applications > 0) {
    parts.push(
      `${summary.applications} application/package row${summary.applications === 1 ? "" : "s"}`,
    );
  }
  if (summary.communications > 0) {
    parts.push(
      `${summary.communications} communication${summary.communications === 1 ? "" : "s"}`,
    );
  }
  if (summary.stageTransitions > 0) {
    parts.push(
      `${summary.stageTransitions} lifecycle transition${summary.stageTransitions === 1 ? "" : "s"}`,
    );
  }
  if (summary.harvestLinks > 0) {
    parts.push(
      `${summary.harvestLinks} portal harvest link${summary.harvestLinks === 1 ? "" : "s"}`,
    );
  }
  if (summary.submissionPreparations > 0 || summary.transmissionAttempts > 0) {
    parts.push("submission preparation/transmission history");
  }
  if (summary.validationAttempts > 0) {
    parts.push("validation history");
  }

  if (parts.length === 0) {
    return "This project has utility coordination history.";
  }

  return `Permanent deletion is blocked because this project has ${parts.join(", ")}. Deleting would cascade-wipe retained utility coordination and submission history. Archive the project instead.`;
}

/**
 * Load UCI dependency counts used to gate hard delete vs archive.
 */
export async function getProjectUciDependencySummary(
  projectId: string,
): Promise<ProjectUciDependencySummary> {
  const id = String(projectId || "").trim();
  if (!id) return { ...EMPTY_PROJECT_UCI_DEPENDENCY_SUMMARY };

  const [
    coordinationRecords,
    harvestLinks,
    applications,
    communications,
    stageTransitions,
    submissionPreparations,
    transmissionAttempts,
    validationAttempts,
  ] = await Promise.all([
    countForProject("coordination_records", id),
    countForProject("uci_portal_harvest_links", id),
    countForProject("coordination_applications", id),
    countForProject("coordination_communications", id),
    countForProject("coordination_stage_transitions", id),
    countForProject("submission_preparations", id),
    countForProject("submission_transmission_attempts", id),
    countForProject("submission_validation_attempts", id),
  ]);

  return {
    coordinationRecords,
    harvestLinks,
    applications,
    communications,
    stageTransitions,
    submissionPreparations,
    transmissionAttempts,
    validationAttempts,
  };
}

/** Package document Remove is locked once reviewed/submitted or submission history exists. */
export function isPackageDocumentRemovalLocked(application: {
  draft_status?: string | null;
  submitted_at?: string | null;
} | null | undefined): boolean {
  if (!application) return true;
  const status = String(application.draft_status || "");
  if (status === "reviewed" || status === "submitted") return true;
  if (application.submitted_at) return true;
  return false;
}

export const PACKAGE_DOCUMENT_REMOVAL_LOCKED_MESSAGE =
  "This package is reviewed or already has submission history. Destructive Remove is blocked — use Request changes / a new package to correct. Source documents stay on the project.";
