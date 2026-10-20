import { supabase } from "@/lib/supabase";
import {
  buildGuidanceFromFeedback,
  canPromote,
  draftFromIssue,
  effectKindForCategory,
  evaluateExamples,
  exampleFromFeedback,
  validateProposed,
  CATEGORIES,
} from "@/lib/codeAnalyzer/learningLoopCore.mjs";

export { CATEGORIES, draftFromIssue, effectKindForCategory, validateProposed };

export interface LearningFeedbackRow {
  id: string;
  project_id: string;
  tenant_id: string | null;
  run_id: string | null;
  sheet_id: string | null;
  document_id: string | null;
  code_edition: string | null;
  jurisdiction: string | null;
  source_provision: string | null;
  category: string;
  status: string;
  source_kind: string;
  approval_basis: string | null;
  original_output: Record<string, unknown>;
  drawing_evidence: Record<string, unknown>;
  proposed_correction: Record<string, unknown>;
  reviewer_note: string | null;
  submitted_by: string;
  evidence_reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface LearningVersionRow {
  id: string;
  project_id: string;
  version_number: number;
  status: string;
  is_active: boolean;
  previous_version_id: string | null;
  evaluation: Record<string, unknown> | null;
  created_at: string;
}

function rpcError(error: { message?: string } | null, fallback: string) {
  if (!error) return null;
  return error.message || fallback;
}

export async function listLearningFeedback(projectId: string): Promise<LearningFeedbackRow[]> {
  const { data, error } = await supabase
    .from("code_analyzer_learning_feedback")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw error;
  return (data || []) as LearningFeedbackRow[];
}

export async function activeLearningVersion(projectId: string): Promise<LearningVersionRow | null> {
  const { data, error } = await supabase
    .from("code_analyzer_learning_versions")
    .select("id, project_id, version_number, status, is_active, previous_version_id, evaluation, created_at")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as LearningVersionRow | null) || null;
}

export async function submitLearningFeedback(payload: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.rpc("code_analyzer_learning_submit", { p_payload: payload });
  const message = rpcError(error, "Could not save the correction");
  if (message) throw new Error(message);
  return String(data);
}

export async function decideLearningFeedback(input: {
  feedbackId: string;
  action: "start_review" | "approve" | "reject" | "supersede";
  attestation?: boolean;
  approvalBasis?: string | null;
  reason?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("code_analyzer_learning_decide", {
    p_feedback_id: input.feedbackId,
    p_action: input.action,
    p_attestation: input.attestation === true,
    p_approval_basis: input.approvalBasis || null,
    p_reason: input.reason || null,
  });
  const message = rpcError(error, "Could not update the correction");
  if (message) throw new Error(message);
}

export function evaluationForFeedback(rows: LearningFeedbackRow[]) {
  const approved = rows.filter((row) => row.status === "approved");
  const built = approved.map((row) => ({ row, result: buildGuidanceFromFeedback(row) }));
  const ready = built.filter((item) => item.result.ok);
  const errors = built.flatMap((item) => item.result.errors || []);
  const guidance = ready.map((item) => item.result.guidance);
  const examples = ready.map((item) => exampleFromFeedback(item.row, item.result.guidance));
  const evaluation = evaluateExamples(examples, [], guidance);
  return { guidance, evaluation, errors, decision: canPromote(evaluation) };
}

export async function promoteLearning(projectId: string, rows: LearningFeedbackRow[]): Promise<string> {
  const { guidance, evaluation, decision, errors } = evaluationForFeedback(rows);
  if (errors.length || !decision.ok) {
    throw new Error(errors[0] || decision.reason || "This correction cannot be promoted.");
  }
  const { data, error } = await supabase.rpc("code_analyzer_learning_promote", {
    p_project_id: projectId,
    p_feedback_ids: guidance.map((item) => item.feedback_id),
    p_evaluation: evaluation,
  });
  const message = rpcError(error, "Could not promote learning");
  if (message) throw new Error(message);
  return String(data);
}

export async function rollbackLearning(projectId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("code_analyzer_learning_rollback", {
    p_project_id: projectId,
    p_reason: reason,
  });
  const message = rpcError(error, "Could not roll back learning");
  if (message) throw new Error(message);
}
