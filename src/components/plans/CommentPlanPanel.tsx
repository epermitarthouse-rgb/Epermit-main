import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, MessageSquare } from "lucide-react";

export interface PanelComment {
  id: string;
  original_text: string;
  discipline: string;
  status: string;
  page_number: number | null;
  sheet_reference: string | null;
  code_reference: string | null;
  response_text: string | null;
}

interface CommentPlanPanelProps {
  comments: PanelComment[];
  currentPage: number;
  onNavigateToPage: (page: number) => void;
  className?: string;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status?.toLowerCase()) {
    case "approved":
      return "default";
    case "pending":
      return "secondary";
    case "rejected":
      return "destructive";
    default:
      return "outline";
  }
}

export function CommentPlanPanel({
  comments,
  currentPage,
  onNavigateToPage,
  className,
}: CommentPlanPanelProps) {
  const grouped = useMemo(() => {
    const map = new Map<number | null, PanelComment[]>();
    for (const c of comments) {
      const key = c.page_number;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }

    const sorted = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === null) return 1;
      if (b[0] === null) return -1;
      return a[0] - b[0];
    });

    return sorted;
  }, [comments]);

  const totalComments = comments.length;

  return (
    <div
      className={`flex flex-col h-full border-l bg-background ${className ?? ""}`}
      data-testid="comment-plan-panel"
    >
      <div className="flex items-center justify-between gap-2 p-3 border-b flex-wrap">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm" data-testid="text-panel-title">
            Comments by Page
          </span>
        </div>
        <Badge variant="secondary" data-testid="badge-total-comments">
          {totalComments} total
        </Badge>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {grouped.length === 0 && (
            <p
              className="text-sm text-muted-foreground text-center py-8"
              data-testid="text-no-comments"
            >
              No comments found
            </p>
          )}

          {grouped.map(([pageNum, pageComments]) => {
            const isCurrentPage = pageNum === currentPage;
            const pageLabel =
              pageNum !== null ? `Page ${pageNum}` : "Unassigned";

            return (
              <div key={pageNum ?? "unassigned"} className="mb-2">
                <button
                  type="button"
                  onClick={() => {
                    if (pageNum !== null) onNavigateToPage(pageNum);
                  }}
                  disabled={pageNum === null}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-left text-sm font-medium transition-colors ${
                    isCurrentPage
                      ? "bg-primary/10 text-primary"
                      : "hover-elevate"
                  }`}
                  data-testid={`button-page-group-${pageNum ?? "unassigned"}`}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5" />
                    <span>{pageLabel}</span>
                  </div>
                  <Badge
                    variant={isCurrentPage ? "default" : "secondary"}
                    data-testid={`badge-page-count-${pageNum ?? "unassigned"}`}
                  >
                    {pageComments.length}
                  </Badge>
                </button>

                <div className="ml-3 mt-1 space-y-1">
                  {pageComments.map((comment) => (
                    <Card
                      key={comment.id}
                      className={`p-2 cursor-pointer transition-colors ${
                        isCurrentPage
                          ? "border-primary/30 bg-primary/5"
                          : ""
                      }`}
                      onClick={() => {
                        if (comment.page_number !== null)
                          onNavigateToPage(comment.page_number);
                      }}
                      data-testid={`card-comment-${comment.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className="text-xs line-clamp-2 flex-1"
                          data-testid={`text-comment-preview-${comment.id}`}
                        >
                          {comment.original_text}
                        </p>
                        <Badge
                          variant={statusVariant(comment.status)}
                          className="shrink-0"
                          data-testid={`badge-comment-status-${comment.id}`}
                        >
                          {comment.status}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {comment.discipline && (
                          <Badge
                            variant="outline"
                            className="text-[10px]"
                            data-testid={`badge-comment-discipline-${comment.id}`}
                          >
                            {comment.discipline}
                          </Badge>
                        )}
                        {comment.sheet_reference && (
                          <span
                            className="text-[10px] text-muted-foreground"
                            data-testid={`text-comment-sheet-${comment.id}`}
                          >
                            Sheet: {comment.sheet_reference}
                          </span>
                        )}
                        {comment.code_reference && (
                          <span
                            className="text-[10px] text-muted-foreground"
                            data-testid={`text-comment-code-${comment.id}`}
                          >
                            {comment.code_reference}
                          </span>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
