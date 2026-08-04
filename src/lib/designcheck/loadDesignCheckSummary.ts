import { supabase } from "@/lib/supabase";
import {
  buildDesignCheckSummary,
  type DesignCheckAnnotationData,
  type DesignCheckProjectSummary,
} from "@/lib/designcheck/designCheckSummary";

export type LoadDesignCheckSummaryResult = {
  summary: DesignCheckProjectSummary | null;
  error: string | null;
};

/**
 * Load read-only DesignCheck readiness data for a project from document_annotations.
 * Same discovery filter as AIComplianceAnalyzer (compliance_issue / compliance_metadata).
 */
export async function loadDesignCheckSummary(
  projectId: string,
): Promise<LoadDesignCheckSummaryResult> {
  try {
    const { data: annotations, error } = await supabase
      .from("document_annotations")
      .select("id, document_id, updated_at, data")
      .eq("project_id", projectId)
      .not("document_id", "is", null);

    if (error) {
      return { summary: null, error: error.message };
    }

    const complianceRows = (annotations ?? []).filter((a) => {
      const d = (a?.data ?? {}) as DesignCheckAnnotationData;
      return Boolean(d?.compliance_issue || d?.compliance_metadata);
    });

    if (complianceRows.length === 0) {
      return { summary: null, error: null };
    }

    const docIds = Array.from(
      new Set(
        complianceRows
          .map((a) => a.document_id)
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
