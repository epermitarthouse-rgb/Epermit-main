import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { useProjects } from "@/hooks/useProjects";

interface ActiveProjectMismatchBannerProps {
  /** Project ID for the screen/modal the user is viewing (e.g. detail modal). */
  viewingProjectId: string;
  viewingProjectName?: string;
  className?: string;
}

export function useActiveProjectMismatch(viewingProjectId: string) {
  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const { projects } = useProjects();
  const viewingProject =
    projects.find((p) => p.id === viewingProjectId) ?? null;
  const activeProject =
    selectedProjectId != null
      ? projects.find((p) => p.id === selectedProjectId) ?? null
      : null;
  const isMismatch =
    !!viewingProjectId &&
    !!selectedProjectId &&
    viewingProjectId !== selectedProjectId;

  return {
    isMismatch,
    viewingProject,
    activeProject,
    setSelectedProjectId,
  };
}

export function ActiveProjectMismatchBanner({
  viewingProjectId,
  viewingProjectName,
  className,
}: ActiveProjectMismatchBannerProps) {
  const { isMismatch, viewingProject, activeProject, setSelectedProjectId } =
    useActiveProjectMismatch(viewingProjectId);

  if (!isMismatch) return null;

  const viewName =
    viewingProjectName?.trim() ||
    viewingProject?.name ||
    "this project";
  const activeName = activeProject?.name || "another project";

  return (
    <Alert
      variant="default"
      className={`border-warning/40 bg-warning/10 ${className ?? ""}`}
      data-testid="active-project-mismatch-banner"
    >
      <AlertTriangle className="h-4 w-4 text-warning" />
      <AlertTitle className="text-ink-primary-light">Active project mismatch</AlertTitle>
      <AlertDescription className="text-ink-secondary-light space-y-3">
        <p>
          You are viewing <strong>{viewName}</strong>, but Active Project is{" "}
          <strong>{activeName}</strong>. Documents uploaded here will belong to{" "}
          <strong>{viewName}</strong>, while Comment Review and Response Matrix
          use the sidebar Active Project unless you align them.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-warning/50"
          onClick={() => setSelectedProjectId(viewingProjectId)}
          data-testid="button-set-viewing-project-active"
        >
          Set {viewName} as Active Project
        </Button>
      </AlertDescription>
    </Alert>
  );
}

interface UploadMismatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewingProjectId: string;
  viewingProjectName?: string;
  onProceed: () => void;
}

export function UploadMismatchDialog({
  open,
  onOpenChange,
  viewingProjectId,
  viewingProjectName,
  onProceed,
}: UploadMismatchDialogProps) {
  const { viewingProject, activeProject, setSelectedProjectId } =
    useActiveProjectMismatch(viewingProjectId);

  const viewName =
    viewingProjectName?.trim() ||
    viewingProject?.name ||
    "this project";
  const activeName = activeProject?.name || "the sidebar Active Project";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="dialog-upload-project-mismatch">
        <AlertDialogHeader>
          <AlertDialogTitle>Active project mismatch</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span>
              You are about to upload to <strong>{viewName}</strong>, but Active
              Project is <strong>{activeName}</strong>.
            </span>
            <span>
              Comment Review and Response Matrix will use the Active Project unless
              you align them first.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
            onClick={(e) => {
              e.preventDefault();
              onProceed();
              onOpenChange(false);
            }}
          >
            Upload to {viewName} anyway
          </AlertDialogAction>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              setSelectedProjectId(viewingProjectId);
              onProceed();
              onOpenChange(false);
            }}
            data-testid="button-align-and-upload"
          >
            Set as Active and upload
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
