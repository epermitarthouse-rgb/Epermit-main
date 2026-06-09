import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReviewTimer, type ReviewTimerHandle } from "@/components/shadow/ReviewTimer";
import { commentReviewToolbarBtn } from "@/lib/commentReviewToolbar";
import { CommentReviewExtractedRow } from "@/components/comment-review/CommentReviewExtractedRow";
import type { ParsedRow } from "@/lib/commentReviewUploadRow";
import { CheckCircle2, Loader2, Plus } from "lucide-react";

interface CommentReviewExtractedPanelProps {
  projectId: string;
  uploadRows: ParsedRow[];
  savedManualLetterCount: number;
  saving: boolean;
  parsing: boolean;
  timerRef: React.RefObject<ReviewTimerHandle>;
  onApproveAll: () => void;
  onAddComment: () => void;
  onClearReviewList: () => void;
  onEditRow: (row: ParsedRow) => void;
  onDeleteRow: (clientId: string) => void;
}

export function CommentReviewExtractedPanel({
  projectId,
  uploadRows,
  savedManualLetterCount,
  saving,
  parsing,
  timerRef,
  onApproveAll,
  onAddComment,
  onClearReviewList,
  onEditRow,
  onDeleteRow,
}: CommentReviewExtractedPanelProps) {
  return (
    <Card className="border-border/50 shadow-none dark:bg-obsidian/20">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-sm font-semibold">Extracted comments</CardTitle>
            <CardDescription className="text-xs">
              Review, edit, add, or delete comments before approving.
            </CardDescription>
          </div>
          <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <Button
                variant="gold"
                size="sm"
                onClick={onApproveAll}
                disabled={saving || uploadRows.length === 0}
                className={commentReviewToolbarBtn.primary}
              >
                {saving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                Approve All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onAddComment}
                disabled={saving || parsing}
                className={commentReviewToolbarBtn.secondary}
              >
                <Plus />
                Add Comment Manually
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ReviewTimer
                ref={timerRef}
                projectId={projectId}
                commentCount={uploadRows.length}
                compact
                className={commentReviewToolbarBtn.ghost}
              />
              {uploadRows.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClearReviewList}
                  disabled={saving || parsing}
                  className={commentReviewToolbarBtn.dangerGhost}
                >
                  Clear review list
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {uploadRows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/50 bg-muted/10 px-4 py-8 text-center text-xs text-muted-foreground dark:bg-obsidian-sunken/20">
            Parsed and pasted comments appear here for review.
            {savedManualLetterCount > 0
              ? ` ${savedManualLetterCount} comment${savedManualLetterCount !== 1 ? "s" : ""} already saved for the selected letter.`
              : ""}
          </p>
        ) : (
          <div className="max-h-[min(420px,55vh)] space-y-1.5 overflow-y-auto pr-0.5">
            {uploadRows.map((row) => (
              <CommentReviewExtractedRow
                key={row._clientId}
                row={row}
                onEdit={onEditRow}
                onDelete={onDeleteRow}
                disabled={saving || parsing}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
