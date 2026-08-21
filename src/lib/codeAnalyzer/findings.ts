/**
 * Idempotent persistence of Code Analyzer findings for a run + sheet image.
 */
import { supabase } from "@/lib/supabase";
import type { ComplianceBatchAnalysisResult } from "@/lib/complianceBatchProcessor";

export interface SaveAnalyzerFindingsParams {
  userId: string;
  projectId: string;
  documentId: string;
  runId: string;
  result: ComplianceBatchAnalysisResult;
  jurisdiction: string;
  projectType: string;
  codeYear: string;
  sheetId?: string;
  pageNumber?: number;
  sourceDocumentId?: string;
}

/**
 * Replace findings for this run + image document so retries/reruns do not duplicate.
 */
export async function replaceComplianceFindingsForSheet(
  params: SaveAnalyzerFindingsParams,
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("document_annotations")
    .delete()
    .eq("project_id", params.projectId)
    .eq("document_id", params.documentId)
    .eq("analysis_run_id", params.runId);

  if (deleteError) throw deleteError;

  const layerOrder = params.result.codeType === "ibc" ? 0 : 1000;
  const runFields = {
    analysis_run_id: params.runId,
    sheet_id: params.sheetId,
    page_number: params.pageNumber,
    source_document_id: params.sourceDocumentId,
  };

  const { error: metaError } = await supabase.from("document_annotations").insert({
    project_id: params.projectId,
    document_id: params.documentId,
    user_id: params.userId,
    analysis_run_id: params.runId,
    annotation_type: "text",
    layer_order: layerOrder,
    data: {
      compliance_metadata: true,
      codeType: params.result.codeType,
      summary: params.result.summary,
      jurisdictionNotes: params.result.jurisdictionNotes,
      jurisdiction: params.jurisdiction,
      projectType: params.projectType,
      codeYear_meta: params.codeYear,
      ...runFields,
    },
  });
  if (metaError) throw metaError;

  for (let i = 0; i < params.result.issues.length; i++) {
    const issue = params.result.issues[i];
    const { error: issueError } = await supabase.from("document_annotations").insert({
      project_id: params.projectId,
      document_id: params.documentId,
      user_id: params.userId,
      analysis_run_id: params.runId,
      annotation_type: "text",
      layer_order: layerOrder + i + 1,
      data: {
        compliance_issue: true,
        codeType: params.result.codeType,
        id: issue.id,
        category: issue.category,
        title: issue.title,
        description: issue.description,
        severity: issue.severity,
        codeReference: issue.codeReference,
        codeYear: issue.codeYear,
        location: issue.location,
        suggestedFix: issue.suggestedFix,
        ...runFields,
      },
    });
    if (issueError) throw issueError;
  }
}

/** Pure helper: a retry for the same run+document should replace, not append. */
export function mergeFindingsAfterReplace<T extends { documentId: string; runId: string }>(
  existing: T[],
  next: T,
): T[] {
  return [...existing.filter((row) => !(row.documentId === next.documentId && row.runId === next.runId)), next];
}
