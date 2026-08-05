import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Project } from "@/types/project";
import {
  buildPortalHarvestRow,
  indexLatestJobsByProject,
  type LatestScrapeJobSummary,
  type PortalHarvestRow,
} from "@/lib/portalHarvestMetrics";

export interface PortalHarvestEvidenceState {
  rows: PortalHarvestRow[];
  harvestedProjectIds: Set<string>;
  latestJobsByProject: Map<string, LatestScrapeJobSummary>;
  loading: boolean;
  error: string | null;
}

/**
 * Loads lightweight harvest evidence for the Portal Harvest queue without
 * selecting full portal_data JSON into the projects list.
 */
export function usePortalHarvestEvidence(projects: Project[]): PortalHarvestEvidenceState {
  const [harvestedIds, setHarvestedIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<LatestScrapeJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const projectIds = useMemo(() => projects.map((p) => p.id).filter(Boolean), [projects]);
  const projectIdsKey = projectIds.slice().sort().join(",");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (projectIds.length === 0) {
        if (!cancelled) {
          setHarvestedIds([]);
          setJobs([]);
          setLoading(false);
          setError(null);
        }
        return;
      }

      setLoading(true);
      try {
        const [harvestedRes, jobsRes] = await Promise.all([
          supabase.from("projects").select("id").in("id", projectIds).not("portal_data", "is", null),
          supabase
            .from("scrape_jobs")
            .select(
              "id, project_id, status, created_at, updated_at, completed_at, error_code, error_user_message",
            )
            .in("project_id", projectIds)
            .order("created_at", { ascending: false }),
        ]);

        if (cancelled) return;
        if (harvestedRes.error) throw harvestedRes.error;
        if (jobsRes.error) throw jobsRes.error;

        setHarvestedIds((harvestedRes.data ?? []).map((r) => r.id as string));
        setJobs((jobsRes.data ?? []) as LatestScrapeJobSummary[]);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load harvest evidence");
          setHarvestedIds([]);
          setJobs([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectIdsKey tracks membership
  }, [projectIdsKey]);

  const harvestedProjectIds = useMemo(() => new Set(harvestedIds), [harvestedIds]);
  const latestJobsByProject = useMemo(() => indexLatestJobsByProject(jobs), [jobs]);

  const rows = useMemo(() => {
    return projects.map((project) =>
      buildPortalHarvestRow({
        id: project.id,
        credential_id: project.credential_id,
        portal_status: project.portal_status,
        last_checked_at: project.last_checked_at,
        permit_number: project.permit_number,
        name: project.name,
        jurisdiction: project.jurisdiction,
        hasPortalData: harvestedProjectIds.has(project.id),
        latestJob: latestJobsByProject.get(project.id) ?? null,
      }),
    );
  }, [projects, harvestedProjectIds, latestJobsByProject]);

  return {
    rows,
    harvestedProjectIds,
    latestJobsByProject,
    loading,
    error,
  };
}
