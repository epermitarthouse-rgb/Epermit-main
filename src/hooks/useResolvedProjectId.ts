import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";

/** Read project ID from URL query (?projectId=, ?project=, ?project_id=). */
export function getProjectIdFromSearchParams(
  searchParams: URLSearchParams,
): string | null {
  const val =
    searchParams.get("projectId") ??
    searchParams.get("project") ??
    searchParams.get("project_id");
  return val && val !== "null" ? val : null;
}

/**
 * Resolves active project for manual workflows: URL param overrides sidebar selection.
 * When a URL param is present, syncs it into SelectedProjectContext (localStorage + ?projectId=).
 */
export function useResolvedProjectId(): {
  projectId: string | null;
  projectIdFromUrl: string | null;
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
} {
  const [searchParams] = useSearchParams();
  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const projectIdFromUrl = getProjectIdFromSearchParams(searchParams);
  const projectId = projectIdFromUrl ?? selectedProjectId;

  useEffect(() => {
    if (projectIdFromUrl && projectIdFromUrl !== selectedProjectId) {
      setSelectedProjectId(projectIdFromUrl);
    }
  }, [projectIdFromUrl, selectedProjectId, setSelectedProjectId]);

  return {
    projectId,
    projectIdFromUrl,
    selectedProjectId,
    setSelectedProjectId,
  };
}
