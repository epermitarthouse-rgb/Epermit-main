import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import {
  getProjectIdFromLocation,
  getProjectIdFromSearchParams,
} from "@/lib/projectIdFromUrl";

export { getProjectIdFromSearchParams, getProjectIdFromLocation } from "@/lib/projectIdFromUrl";

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
  // Keep subscription to router navigations; resolve from live location so project
  // selection updates stay visible before React Router searchParams catch up.
  void searchParams;
  const projectIdFromUrl = getProjectIdFromLocation();
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
