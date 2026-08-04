import { Navigate, useSearchParams } from "react-router-dom";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { getProjectIdFromSearchParams } from "@/hooks/useResolvedProjectId";

/**
 * Compatibility redirect: Classified Comments UX lives on Response Matrix.
 * Preserves project_id from URL or sidebar selection.
 */
export default function ClassifiedComments() {
  const [searchParams] = useSearchParams();
  const { selectedProjectId } = useSelectedProject();
  const projectId = getProjectIdFromSearchParams(searchParams) ?? selectedProjectId;
  const to = projectId
    ? `/response-matrix?project_id=${encodeURIComponent(projectId)}`
    : "/response-matrix";
  return <Navigate to={to} replace />;
}
