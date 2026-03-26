import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ShieldCheck, X, FileText, AlertTriangle } from "lucide-react";
import { PlanViewer } from "@/components/plans/PlanViewer";
import { RevisionCloudOverlay } from "@/components/plans/RevisionCloudOverlay";
import { CommentPlanPanel, type PanelComment } from "@/components/plans/CommentPlanPanel";
import { ArchitectApprovalDialog, useApprovalGate, SealWatermark } from "@/components/plans/ArchitectApprovalDialog";
import { useProjectDocuments } from "@/hooks/useProjectDocuments";

interface PlanMarkupWorkspaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  comments: PanelComment[];
  onApprovalChanged?: () => void;
}

export function PlanMarkupWorkspace({
  open,
  onOpenChange,
  projectId,
  comments,
  onApprovalChanged,
}: PlanMarkupWorkspaceProps) {
  const { documents, loading: docsLoading, getDownloadUrl } = useProjectDocuments(projectId);
  const { hasPendingMarkups, pendingCount, refetch: refetchApproval } = useApprovalGate(projectId);

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [approvalOpen, setApprovalOpen] = useState(false);

  const pdfDocuments = documents.filter(
    (d) => d.file_type === "application/pdf" || d.file_name?.toLowerCase().endsWith(".pdf")
  );

  useEffect(() => {
    if (open && pdfDocuments.length > 0 && !selectedDocId) {
      setSelectedDocId(pdfDocuments[0].id);
    }
  }, [open, pdfDocuments.length, selectedDocId]);

  useEffect(() => {
    if (!selectedDocId) {
      setDocumentUrl(null);
      return;
    }
    const doc = documents.find((d) => d.id === selectedDocId);
    if (!doc) return;

    let cancelled = false;
    setLoadingUrl(true);

    (async () => {
      const url = await getDownloadUrl(doc);
      if (!cancelled) {
        setDocumentUrl(url);
        setLoadingUrl(false);
        setCurrentPage(1);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDocId]);

  const handleApproved = useCallback(() => {
    refetchApproval();
    onApprovalChanged?.();
  }, [refetchApproval, onApprovalChanged]);

  const overlayComments = comments.map((c) => ({
    id: c.id,
    comment_number: c.id.slice(0, 6),
    comment_text: c.original_text,
    discipline: c.discipline,
  }));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-[95vw] w-[95vw] max-h-[90vh] h-[90vh] p-0 flex flex-col"
          data-testid="dialog-plan-markup-workspace"
        >
          <div className="flex items-center justify-between gap-3 p-3 border-b flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="font-semibold text-sm" data-testid="text-workspace-title">
                Plan Markup Workspace
              </span>

              {pdfDocuments.length > 0 && (
                <Select
                  value={selectedDocId ?? ""}
                  onValueChange={setSelectedDocId}
                >
                  <SelectTrigger className="w-[220px]" data-testid="select-plan-document">
                    <SelectValue placeholder="Select plan document" />
                  </SelectTrigger>
                  <SelectContent>
                    {pdfDocuments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.file_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {hasPendingMarkups && (
                <Badge variant="destructive" data-testid="badge-pending-markup-count">
                  {pendingCount} Unapproved
                </Badge>
              )}
              {!hasPendingMarkups && pendingCount === 0 && (
                <Badge variant="secondary" data-testid="badge-all-approved">
                  All Approved
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={() => setApprovalOpen(true)}
                disabled={!projectId}
                data-testid="button-workspace-approve"
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                Approve Markups
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                data-testid="button-close-workspace"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-w-0 relative">
              {docsLoading || loadingUrl ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : !documentUrl ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
                  <AlertTriangle className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground" data-testid="text-no-plan-document">
                    {pdfDocuments.length === 0
                      ? "No PDF plan documents found for this project. Upload plan documents first."
                      : "Select a plan document to view."}
                  </p>
                </div>
              ) : (
                <PlanViewer
                  documentUrl={documentUrl}
                  currentPage={currentPage}
                  onPageChange={setCurrentPage}
                  onTotalPagesChange={setTotalPages}
                  className="h-full"
                  overlayContent={(dims) => (
                    <>
                      <RevisionCloudOverlay
                        projectId={projectId}
                        documentId={selectedDocId ?? undefined}
                        pageNumber={currentPage}
                        width={dims.width}
                        height={dims.height}
                        comments={overlayComments}
                      />
                      <SealWatermark projectId={projectId} />
                    </>
                  )}
                />
              )}
            </div>

            <div className="w-[300px] shrink-0 border-l overflow-hidden">
              <CommentPlanPanel
                comments={comments}
                currentPage={currentPage}
                onNavigateToPage={setCurrentPage}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ArchitectApprovalDialog
        open={approvalOpen}
        onOpenChange={setApprovalOpen}
        projectId={projectId}
        onApproved={handleApproved}
      />
    </>
  );
}
