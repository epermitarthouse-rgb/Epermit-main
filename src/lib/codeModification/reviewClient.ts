/**
 * Client for POST /api/analyze-code-modification.
 * Separate from the standard /api/analyze-drawing vision client.
 */

import { supabase } from "@/lib/supabase";
import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";
import type { EvidenceFinding, ExtractedModificationRequest, OverallStatus } from "./model";
import { analyzerWorkflowFor } from "./workflow";

export interface CodeModificationSheetInput {
  id?: string;
  documentId?: string;
  fileName?: string;
  sheetLabel?: string;
  pageNumber: number;
  imageBase64?: string;
  imageType?: string;
  text?: string;
}

export interface CodeModificationReviewRequest {
  formPages?: { pageNumber: number; text: string }[];
  formPdfBase64?: string;
  formImages?: { pageNumber: number; imageBase64: string; imageType?: string }[];
  sheets?: CodeModificationSheetInput[];
  formDocument?: { id: string; fileName?: string };
  formDocuments?: Array<{ id: string; fileName?: string }>;
  excludedEvidenceDocumentIds?: string[];
  jurisdiction?: string | null;
  projectType?: string;
  codeYear?: string;
}

export interface CodeModificationReviewResult {
  extracted_request: ExtractedModificationRequest;
  evidence: EvidenceFinding[];
  overall_status: OverallStatus;
  extraction_warnings: string[];
  form_fingerprint?: string;
  sheet_warnings?: string[];
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function requestCodeModificationReview(
  params: CodeModificationReviewRequest,
): Promise<CodeModificationReviewResult> {
  const workflow = analyzerWorkflowFor("dc_code_modification", params.jurisdiction);
  if (!workflow.ok) {
    throw new Error("DC Code Modification Review is only available for District of Columbia projects.");
  }

  const {
    data: { session: authSession },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authSession?.access_token) {
    headers.Authorization = `Bearer ${authSession.access_token}`;
  }

  const response = await fetch(`${getScraperBaseUrl()}${workflow.endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      formPages: params.formPages,
      formPdfBase64: params.formPdfBase64,
      formImages: params.formImages,
      sheets: params.sheets ?? [],
      formDocument: params.formDocument,
      formDocuments: params.formDocuments,
      excludedEvidenceDocumentIds: params.excludedEvidenceDocumentIds ?? [],
      jurisdiction: params.jurisdiction,
      projectType: params.projectType,
      codeYear: params.codeYear,
    }),
  });

  let data: { error?: string } & Partial<CodeModificationReviewResult>;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Code modification review returned an invalid response (HTTP ${response.status})`);
  }

  if (!response.ok) {
    throw new Error(data?.error || `Code modification review failed (HTTP ${response.status})`);
  }
  if (data && typeof data === "object" && data.error) {
    throw new Error(typeof data.error === "string" ? data.error : "Code modification review failed");
  }
  if (!data.extracted_request || !Array.isArray(data.evidence) || !data.overall_status) {
    throw new Error("Code modification review returned an incomplete result");
  }

  return {
    extracted_request: data.extracted_request,
    evidence: data.evidence,
    overall_status: data.overall_status,
    extraction_warnings: data.extraction_warnings ?? [],
    form_fingerprint: data.form_fingerprint,
    sheet_warnings: data.sheet_warnings,
  };
}
