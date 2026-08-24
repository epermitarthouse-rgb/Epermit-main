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
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as ProjectDocument[]) ?? [];
}

export async function fetchModificationReviewDocumentIds(reviewId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("code_modification_review_documents")
    .select("document_id, sort_order")
    .eq("review_id", reviewId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => row.document_id as string);
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
  const review = (data as CodeModificationReview | null) ?? null;
  if (!review?.id) return review;

  const documentIds = await fetchModificationReviewDocumentIds(review.id);
  return {
    ...review,
    form_document_ids:
      documentIds.length > 0 ? documentIds : review.form_document_id ? [review.form_document_id] : [],
  };
}

export async function replaceModificationReview(
  review: Omit<CodeModificationReview, "id" | "created_at" | "updated_at">,
  documentIds: string[],
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

  const saved = data as CodeModificationReview;
  const uniqueDocumentIds = [...new Set(documentIds.filter(Boolean))];
  if (uniqueDocumentIds.length > 0) {
    const { error: linkError } = await supabase.from("code_modification_review_documents").insert(
      uniqueDocumentIds.map((documentId, index) => ({
        review_id: saved.id,
        document_id: documentId,
        sort_order: index,
      })),
    );
    if (linkError) throw linkError;
  }

  return {
    ...saved,
    form_document_ids: uniqueDocumentIds.length > 0 ? uniqueDocumentIds : [review.form_document_id],
  };
}
