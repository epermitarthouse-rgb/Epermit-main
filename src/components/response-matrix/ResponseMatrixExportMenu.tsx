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
  exportResponseMatrixCsv,
  exportResponseMatrixXlsx,
  type ResponseMatrixExportComment,
  type ResponseMatrixProjectMeta,
} from "@/lib/responseMatrixExport";

interface ResponseMatrixExportMenuProps {
  projectId: string | null;
  rows: ResponseMatrixExportComment[];
}

async function fetchExportContext(
  projectId: string,
  rows: ResponseMatrixExportComment[],
): Promise<{
  project: ResponseMatrixProjectMeta;
  markupByCommentId: Record<string, string>;
  sourceDocumentById: Record<string, string>;
}> {
  const commentIds = rows.map((row) => row.id);
  const sourceDocumentIds = [
    ...new Set(rows.map((row) => row.source_document_id).filter(Boolean)),
  ] as string[];

  const [projectResult, markupResult, documentsResult] = await Promise.all([
    supabase
      .from("projects")
      .select("name, permit_number, jurisdiction")
      .eq("id", projectId)
      .maybeSingle(),
    commentIds.length > 0
      ? supabase
          .from("plan_markups")
          .select("comment_id, status")
          .eq("project_id", projectId)
          .in("comment_id", commentIds)
      : Promise.resolve({ data: [], error: null }),
    sourceDocumentIds.length > 0
      ? supabase
          .from("project_documents")
          .select("id, file_name")
          .in("id", sourceDocumentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (projectResult.error) throw projectResult.error;
  if (markupResult.error) throw markupResult.error;
  if (documentsResult.error) throw documentsResult.error;

  const project: ResponseMatrixProjectMeta = {
    name: projectResult.data?.name?.trim() || "Project",
    permit_number: projectResult.data?.permit_number ?? null,
    jurisdiction: projectResult.data?.jurisdiction ?? null,
  };

  const markupByCommentId: Record<string, string> = {};
  for (const markup of markupResult.data ?? []) {
    markupByCommentId[markup.comment_id] = markup.status;
  }

  const sourceDocumentById: Record<string, string> = {};
  for (const doc of documentsResult.data ?? []) {
    sourceDocumentById[doc.id] = doc.file_name;
  }

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
      if (rows.length === 0) {
        toast.error("No comments to export");
        return;
      }

      setExporting(true);
      try {
        const { project, markupByCommentId, sourceDocumentById } = await fetchExportContext(
          projectId,
          rows,
        );
        const records = buildResponseMatrixExportRecords(
          rows,
          project,
          markupByCommentId,
          sourceDocumentById,
        );
        const filename = buildResponseMatrixExportFilename(project, formatType);

        if (formatType === "csv") {
          exportResponseMatrixCsv(records, filename);
        } else {
          exportResponseMatrixXlsx(records, filename);
        }

        toast.success(
          `Exported ${rows.length} comment${rows.length === 1 ? "" : "s"} as ${formatType.toUpperCase()} (${format(new Date(), "MMM d, yyyy")})`,
        );
      } catch (error) {
        console.error("Response Matrix export failed:", error);
        toast.error(error instanceof Error ? error.message : "Export failed");
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
          onClick={() => runExport("csv")}
          disabled={disabled}
          data-testid="menu-export-response-matrix-csv"
        >
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => runExport("xlsx")}
          disabled={disabled}
          data-testid="menu-export-response-matrix-xlsx"
        >
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Export XLSX
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
