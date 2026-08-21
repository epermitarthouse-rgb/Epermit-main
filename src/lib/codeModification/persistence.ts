/**
 * Persist DC Code Modification forms and review rows.
 * Reviews are keyed by analysis run and replaced, not duplicated.
 */

import { supabase } from "@/lib/supabase";
import type { ProjectDocument } from "@/types/document";
import type { CodeModificationReview } from "./model";

export async function fetchModificationForms(projectId: string): Promise<ProjectDocument[]> {
  const { data, error } = await supabase
    .from("project_documents")
    .select("*")
    .eq("project_id", projectId)
    .eq("document_type", "code_modification_application")
    .is("parent_document_id", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as ProjectDocument[]) ?? [];
}

export async function fetchModificationReviewForRun(
  runId: string,
): Promise<CodeModificationReview | null> {
  const { data, error } = await supabase
    .from("code_modification_reviews")
    .select("*")
    .eq("run_id", runId)
    .maybeSingle();
  if (error) throw error;
  return (data as CodeModificationReview | null) ?? null;
}

export async function replaceModificationReview(
  review: Omit<CodeModificationReview, "id" | "created_at" | "updated_at">,
): Promise<CodeModificationReview> {
  const { error: deleteError } = await supabase
    .from("code_modification_reviews")
    .delete()
    .eq("run_id", review.run_id);
  if (deleteError) throw deleteError;

  const { data, error } = await supabase
    .from("code_modification_reviews")
    .insert({
      run_id: review.run_id,
      project_id: review.project_id,
      form_document_id: review.form_document_id,
      form_fingerprint: review.form_fingerprint,
      extracted_request: review.extracted_request,
      evidence: review.evidence,
      overall_status: review.overall_status,
      extraction_warnings: review.extraction_warnings,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CodeModificationReview;
}
