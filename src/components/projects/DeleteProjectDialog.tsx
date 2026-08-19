import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { Project } from "@/types/project";
import {
  formatUciDependencyBlockReason,
  getProjectUciDependencySummary,
  hasUciDependencies,
  type ProjectUciDependencySummary,
} from "@/lib/projectDestructiveSafety";

interface DeleteProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  onDelete: () => Promise<void>;
  onArchive: () => Promise<void>;
  loading?: boolean;
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  project,
  onDelete,
  onArchive,
  loading = false,
}: DeleteProjectDialogProps) {
  const [depsLoading, setDepsLoading] = useState(false);
  const [depsError, setDepsError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProjectUciDependencySummary | null>(null);
  const [confirmName, setConfirmName] = useState("");

  useEffect(() => {
    if (!open || !project?.id) {
      setSummary(null);
      setDepsError(null);
      setConfirmName("");
      return;
    }

    let cancelled = false;
    setDepsLoading(true);
    setDepsError(null);
    setConfirmName("");

    void getProjectUciDependencySummary(project.id)
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDepsError(
            err instanceof Error ? err.message : "Failed to check utility coordination history",
          );
          setSummary(null);
        }
      })
      .finally(() => {
        if (!cancelled) setDepsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, project?.id]);

  if (!project) return null;

  const blocked = summary ? hasUciDependencies(summary) : false;
  const nameMatches = confirmName.trim() === project.name.trim();
  const canDeleteEmpty = !depsLoading && !depsError && summary && !blocked && nameMatches;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {blocked ? "Archive project" : "Delete project"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              {depsLoading ? (
                <p className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking utility coordination history…
                </p>
              ) : null}

              {depsError ? (
                <p className="text-destructive">
                  {depsError}. Deletion is blocked until history can be verified.
                </p>
              ) : null}

              {blocked && summary ? (
                <>
                  <p className="text-foreground">{formatUciDependencyBlockReason(summary)}</p>
                  <p>
                    Archive hides &quot;{project.name}&quot; from active project lists while
                    preserving coordination, communications, and submission history.
                  </p>
                </>
              ) : null}

              {!depsLoading && !depsError && summary && !blocked ? (
                <>
                  <p>
                    This project has no utility coordination history. Permanent delete is
                    allowed only for empty / disposable projects and cannot be undone.
                  </p>
                  <p>
                    Type <span className="font-medium text-foreground">{project.name}</span>{" "}
                    to confirm deletion.
                  </p>
                  <Input
                    value={confirmName}
                    onChange={(event) => setConfirmName(event.target.value)}
                    placeholder="Project name"
                    autoComplete="off"
                    disabled={loading}
                  />
                </>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          {blocked ? (
            <AlertDialogAction onClick={() => void onArchive()} disabled={loading || depsLoading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Archive project
            </AlertDialogAction>
          ) : (
            <AlertDialogAction
              onClick={() => void onDelete()}
              disabled={loading || !canDeleteEmpty}
              className="bg-destructive hover:bg-destructive/90"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete permanently
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
