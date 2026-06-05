import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  jsonResponse,
  requireAuthProjectAccess,
} from "../_shared/requireAuthProject.ts";
import { isIngestSupported } from "../_shared/documentIngestion.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const projectId = (body.project_id ?? body.projectId) as string | undefined;
    const documentId = (body.document_id ?? body.documentId) as string | undefined;

    const auth = await requireAuthProjectAccess(req, projectId);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    if (!documentId) {
      return jsonResponse({ error: "document_id is required" }, 400);
    }

    const { data: doc, error: docError } = await ctx.supabaseAdmin
      .from("project_documents")
      .select("id, project_id, user_id, file_name, file_type")
      .eq("id", documentId)
      .eq("project_id", ctx.projectId)
      .single();

    if (docError || !doc) {
      return jsonResponse({ error: "Document not found for this project" }, 404);
    }

    if (!isIngestSupported(doc.file_name, doc.file_type)) {
      await ctx.supabaseAdmin
        .from("project_documents")
        .update({
          ai_ingestion_status: "unsupported",
          ai_ingestion_error: "File type not supported for AI preparation. Use PDF or DOCX.",
          ai_ingested_at: null,
          ai_chunk_count: 0,
        })
        .eq("id", documentId);
      return jsonResponse({
        error: "Unsupported file type. Prepare PDF or DOCX documents only.",
        status: "unsupported",
      }, 400);
    }

    // Cancel stale pending jobs for the same document
    await ctx.supabaseAdmin
      .from("document_ingestion_jobs")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error: "Superseded by a new ingestion request",
      })
      .eq("document_id", documentId)
      .eq("status", "pending");

    const { data: job, error: jobError } = await ctx.supabaseAdmin
      .from("document_ingestion_jobs")
      .insert({
        project_id: ctx.projectId,
        document_id: documentId,
        user_id: ctx.user.id,
        status: "pending",
        progress: { phase: "queued" },
      })
      .select("id, status, created_at")
      .single();

    if (jobError || !job) {
      return jsonResponse({ error: jobError?.message ?? "Failed to enqueue ingestion job" }, 500);
    }

    await ctx.supabaseAdmin
      .from("project_documents")
      .update({
        ai_ingestion_status: "queued",
        ai_ingestion_error: null,
      })
      .eq("id", documentId);

    return jsonResponse({
      job_id: job.id,
      status: "queued",
      document_id: documentId,
      message: "Document queued for AI preparation. A background worker will process it.",
    });
  } catch (error) {
    console.error("ingest-project-document enqueue error:", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
