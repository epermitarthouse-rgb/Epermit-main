import { supabase } from "@/lib/supabase";
import {
  buildDesignCheckSummary,
  type DesignCheckProjectSummary,
} from "@/lib/designcheck/designCheckSummary";
import { filterAnnotationsForActiveAnalysis } from "@/lib/codeAnalyzer/model";

export type LoadDesignCheckSummaryResult = {
  summary: DesignCheckProjectSummary | null;
  error: string | null;
};

/**
 * Load read-only DesignCheck readiness data for a project from document_annotations.
 * Uses the current Code Analyzer run when one exists; ignores stale/superseded runs.
 * Legacy projects with no analyzer runs still hydrate un-versioned annotations.
 */
export async function loadDesignCheckSummary(
  projectId: string,
): Promise<LoadDesignCheckSummaryResult> {
  try {
    const { data: runs, error: runsError } = await supabase
      .from("code_analyzer_runs")
      .select("id, status")
      .eq("project_id", projectId);

    if (runsError) {
      return { summary: null, error: runsError.message };
    }

    const runRows = runs ?? [];
    const currentRun = runRows.find((r) => r.status === "current") ?? null;
    const hasAnalyzerRuns = runRows.length > 0;

    const { data: annotations, error } = await supabase
      .from("document_annotations")
      .select("id, document_id, updated_at, data, analysis_run_id")
      .eq("project_id", projectId)
      .not("document_id", "is", null);

    if (error) {
      return { summary: null, error: error.message };
    }

    const complianceRows = filterAnnotationsForActiveAnalysis(
      (annotations ?? []).map((a) => ({
        id: a.id,
        analysis_run_id: a.analysis_run_id as string | null,
        data: a.data,
        document_id: a.document_id,
        updated_at: a.updated_at,
      })),
      {
        currentRunId: currentRun?.id ?? null,
        hasAnalyzerRuns,
      },
    );

    if (complianceRows.length === 0) {
      return { summary: null, error: null };
    }

    const docIds = Array.from(
      new Set(
        complianceRows
          .map((a) => (a as { document_id?: string | null }).document_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );

    let documents: { id: string; file_name?: string | null }[] = [];
    if (docIds.length > 0) {
      const { data: docs, error: docsError } = await supabase
        .from("project_documents")
        .select("id, file_name")
        .in("id", docIds);

      if (docsError) {
        return { summary: null, error: docsError.message };
      }
      documents = docs ?? [];
    }

    return {
      summary: buildDesignCheckSummary(complianceRows, documents),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load DesignCheck summary";
    return { summary: null, error: message };
  }
}
