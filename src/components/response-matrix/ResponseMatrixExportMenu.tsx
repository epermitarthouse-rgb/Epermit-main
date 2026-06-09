import { useCallback, useState } from "react";
import { format } from "date-fns";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  buildResponseMatrixExportFilename,
  buildResponseMatrixExportRecords,
  chunkArray,
  EXPORT_BATCH_SIZE,
  exportResponseMatrixCsv,
  exportResponseMatrixXlsx,
  type ResponseMatrixExportComment,
  type ResponseMatrixProjectMeta,
} from "@/lib/responseMatrixExport";

const EXPORT_ERROR_TOAST =
  "Export failed. Please try again or contact support.";

interface ResponseMatrixExportMenuProps {
  projectId: string | null;
  rows: ResponseMatrixExportComment[];
}

async function fetchMarkupByCommentId(
  projectId: string,
  commentIds: string[],
): Promise<Record<string, string>> {
  const markupByCommentId: Record<string, string> = {};
  if (commentIds.length === 0) return markupByCommentId;

  for (const batch of chunkArray(commentIds, EXPORT_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("plan_markups")
      .select("comment_id, status")
      .eq("project_id", projectId)
      .in("comment_id", batch);

    if (error) {
      console.warn("[ResponseMatrixExport] plan_markups lookup failed:", error);
      continue;
    }

    for (const markup of data ?? []) {
      if (markup.comment_id) {
        markupByCommentId[markup.comment_id] = markup.status;
      }
    }
  }

  return markupByCommentId;
}

async function fetchSourceDocumentById(
  sourceDocumentIds: string[],
): Promise<Record<string, string>> {
  const sourceDocumentById: Record<string, string> = {};
  if (sourceDocumentIds.length === 0) return sourceDocumentById;

  for (const batch of chunkArray(sourceDocumentIds, EXPORT_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("project_documents")
      .select("id, file_name")
      .in("id", batch);

    if (error) {
      console.warn("[ResponseMatrixExport] project_documents lookup failed:", error);
      continue;
    }

    for (const doc of data ?? []) {
      sourceDocumentById[doc.id] = doc.file_name;
    }
  }

  return sourceDocumentById;
}

async function fetchExportContext(
  projectId: string,
  rows: ResponseMatrixExportComment[],
): Promise<{
  project: ResponseMatrixProjectMeta;
  markupByCommentId: Record<string, string>;
  sourceDocumentById: Record<string, string>;
}> {
  const projectRows = rows.filter((row) => row.project_id === projectId);
  const commentIds = projectRows.map((row) => row.id);
  const sourceDocumentIds = [
    ...new Set(projectRows.map((row) => row.source_document_id).filter(Boolean)),
  ] as string[];

  const projectResult = await supabase
    .from("projects")
    .select("name, permit_number, jurisdiction")
    .eq("id", projectId)
    .maybeSingle();

  if (projectResult.error) {
    console.warn("[ResponseMatrixExport] projects lookup failed:", projectResult.error);
  }

  const [markupByCommentId, sourceDocumentById] = await Promise.all([
    fetchMarkupByCommentId(projectId, commentIds),
    fetchSourceDocumentById(sourceDocumentIds),
  ]);

  const project: ResponseMatrixProjectMeta = {
    name: projectResult.data?.name?.trim() || "Project",
    permit_number: projectResult.data?.permit_number ?? null,
    jurisdiction: projectResult.data?.jurisdiction ?? null,
  };

  return { project, markupByCommentId, sourceDocumentById };
}

export function ResponseMatrixExportMenu({ projectId, rows }: ResponseMatrixExportMenuProps) {
  const [exporting, setExporting] = useState(false);
  const disabled = !projectId || rows.length === 0 || exporting;

  const runExport = useCallback(
    async (formatType: "csv" | "xlsx") => {
      if (!projectId) {
        toast.error("Select a project first");
        return;
      }
      const projectRows = rows.filter((row) => row.project_id === projectId);
      if (projectRows.length === 0) {
        toast.error("No comments to export");
        return;
      }

      setExporting(true);
      try {
        const { project, markupByCommentId, sourceDocumentById } = await fetchExportContext(
          projectId,
          projectRows,
        );
        const records = buildResponseMatrixExportRecords(
          projectRows,
          project,
          markupByCommentId,
          sourceDocumentById,
        );

        if (records.length === 0) {
          toast.error("No comments to export");
          return;
        }

        const filename = buildResponseMatrixExportFilename(project, formatType);

        if (formatType === "csv") {
          exportResponseMatrixCsv(records, filename);
        } else {
          exportResponseMatrixXlsx(records, filename);
        }

        toast.success(
          `Exported ${projectRows.length} comment${projectRows.length === 1 ? "" : "s"} as ${formatType.toUpperCase()} (${format(new Date(), "MMM d, yyyy")})`,
        );
      } catch (error) {
        console.error("Response Matrix export failed:", error);
        toast.error(EXPORT_ERROR_TOAST);
      } finally {
        setExporting(false);
      }
    },
    [projectId, rows],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          data-testid="button-response-matrix-export"
          className="shrink-0 border-cream-sunken"
          title={rows.length === 0 ? "No comments to export" : "Export current Response Matrix view"}
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          ) : (
            <Download className="h-4 w-4 mr-1.5" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={disabled}
          data-testid="menu-export-response-matrix-csv"
          onSelect={(event) => {
            event.preventDefault();
            void runExport("csv");
          }}
        >
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled}
          data-testid="menu-export-response-matrix-xlsx"
          onSelect={(event) => {
            event.preventDefault();
            void runExport("xlsx");
          }}
        >
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Export XLSX
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
