import { FileSearch, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design/ProductPrimitives";

function withProjectId(path: string, projectId: string | null): string {
  if (!projectId) return path;
  const params = new URLSearchParams({ project_id: projectId });
  return `${path}?${params.toString()}`;
}

type CommentWorkflowEntryProps = {
  projectId: string | null;
  onNavigate: (path: string) => void;
  /** `toolbar` = compact CTAs for Response Matrix command bar; `panel` = legacy full block. */
  variant?: "panel" | "toolbar";
};

/**
 * Hub CTAs into Comment Review (upload/parse/approve).
 * Classified comments stay on Response Matrix — no separate classified CTA.
 */
export function CommentWorkflowEntry({
  projectId,
  onNavigate,
  variant = "panel",
}: CommentWorkflowEntryProps) {
  const commentReviewPath = withProjectId("/comment-review", projectId);

  const buttons = (
    <>
      <Button
        size="sm"
        variant={variant === "toolbar" ? "outline" : "default"}
        className="gap-1.5"
        onClick={() => onNavigate(commentReviewPath)}
        data-testid="matrix-upload-parse-comments"
      >
        <FileSearch className="h-4 w-4" />
        Upload &amp; Parse Comments
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => onNavigate(commentReviewPath)}
        data-testid="matrix-review-parsed-comments"
      >
        <ListChecks className="h-4 w-4" />
        Review Parsed Comments
      </Button>
    </>
  );

  if (variant === "toolbar") {
    return <div className="flex flex-wrap items-center gap-2">{buttons}</div>;
  }

  return (
    <Panel
      title="Comment workflow"
      eyebrow="Upload & parse"
      className="border-border/80"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground max-w-xl">
          Upload letters, load portal comments, parse, and approve extracted rows in Comment Review.
          Classified comments and drafting live in this matrix.
        </p>
        <div className="flex flex-wrap items-center gap-2 shrink-0">{buttons}</div>
      </div>
    </Panel>
  );
}
