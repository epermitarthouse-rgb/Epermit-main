import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const PREFERRED_FORMATS = ["pdf"];
const ACCEPTED_FORMATS = ["pdf", "jpg", "jpeg", "png", "tiff", "tif", "dwg", "dxf", "doc", "docx", "xls", "xlsx"];

const RESIDENTIAL_CHECKLIST = [
  { type: "plan", label: "Construction Plans / Drawings", required: true },
  { type: "cost_estimate", label: "Cost of Construction Estimate", required: true },
  { type: "contract", label: "Owner-Contractor Agreement / Contract", required: true },
];

const COMMERCIAL_CHECKLIST = [
  { type: "plan", label: "Construction Plans / Drawings", required: true },
  { type: "cost_estimate", label: "Cost of Construction Estimate", required: true },
  { type: "contract", label: "Owner-Contractor Agreement / Contract", required: true },
  { type: "specification", label: "Project Specifications", required: false },
];

const EIF_TRIGGER_SCOPES = [
  "demolition", "raze", "excavation", "underground storage",
  "hazardous", "asbestos", "lead", "environmental",
];

interface DocumentInput {
  name: string;
  url: string;
  size_bytes?: number;
  type?: string;
}

function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

function classifyDocumentType(filename: string, explicitType?: string): string {
  if (explicitType && ["plan", "cost_estimate", "contract", "eif", "checklist", "specification", "other"].includes(explicitType)) {
    return explicitType;
  }
  const lower = filename.toLowerCase();
  if (lower.includes("plan") || lower.includes("drawing") || lower.includes("floor") || lower.includes("elevation") || lower.includes("section")) return "plan";
  if (lower.includes("cost") || lower.includes("estimate") || lower.includes("budget")) return "cost_estimate";
  if (lower.includes("contract") || lower.includes("agreement") || lower.includes("proposal")) return "contract";
  if (lower.includes("eif") || lower.includes("environmental") || lower.includes("intake")) return "eif";
  if (lower.includes("checklist")) return "checklist";
  if (lower.includes("spec") || lower.includes("specification")) return "specification";
  return "other";
}

function validateDocument(doc: DocumentInput): { status: string; notes: string[] } {
  const notes: string[] = [];
  let status = "valid";
  const ext = getFileExtension(doc.name);

  if (!ext) {
    notes.push("File has no extension — cannot determine format");
    status = "invalid";
  } else if (!ACCEPTED_FORMATS.includes(ext)) {
    notes.push(`Unsupported file format: .${ext}. Accepted formats: ${ACCEPTED_FORMATS.join(", ")}`);
    status = "invalid";
  } else if (!PREFERRED_FORMATS.includes(ext)) {
    notes.push(`File is .${ext} — PDF is the preferred format for DOB submissions`);
  }

  if (doc.size_bytes !== undefined && doc.size_bytes !== null) {
    if (doc.size_bytes > MAX_FILE_SIZE_BYTES) {
      notes.push(`File size ${(doc.size_bytes / (1024 * 1024)).toFixed(1)}MB exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit`);
      status = "oversized";
    } else if (doc.size_bytes === 0) {
      notes.push("File appears to be empty (0 bytes)");
      status = "invalid";
    }
  }

  const nameParts = doc.name.replace(/\.[^/.]+$/, "");
  if (nameParts.length < 3) {
    notes.push("File name is too short — use descriptive naming (e.g., 'A1_Floor_Plan.pdf')");
  }
  if (/[^\w\s\-._()]/.test(nameParts)) {
    notes.push("File name contains special characters — use only letters, numbers, hyphens, and underscores");
  }

  return { status, notes };
}

function requiresEIF(scopeOfWork: string | undefined): boolean {
  if (!scopeOfWork) return false;
  const lower = scopeOfWork.toLowerCase();
  return EIF_TRIGGER_SCOPES.some((trigger) => lower.includes(trigger));
}

function getChecklist(propertyType: string | undefined): typeof RESIDENTIAL_CHECKLIST {
  if (propertyType?.toLowerCase() === "commercial") return COMMERCIAL_CHECKLIST;
  return RESIDENTIAL_CHECKLIST;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  console.log("[document-preparation-agent] start");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return new Response(
        JSON.stringify({ code: 500, message: "Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ code: 401, message: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace(/^\s*Bearer\s+/i, "").trim();

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const filingId = body.filing_id as string | undefined;
    const documents = (body.documents ?? []) as DocumentInput[];
    const scopeOfWork = body.scope_of_work as string | undefined;
    const propertyType = body.property_type as string | undefined;
    const reviewTrack = body.review_track as string | undefined;

    console.log("[document-preparation-agent] filing_id:", filingId, "docs:", documents.length, "scope:", scopeOfWork);

    if (!filingId) {
      return new Response(
        JSON.stringify({ code: 400, message: "filing_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: filing, error: filingError } = await supabase
      .from("permit_filings")
      .select("id, user_id, project_id")
      .eq("id", filingId)
      .single();

    if (filingError || !filing) {
      return new Response(
        JSON.stringify({ code: 404, message: "Filing not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (filing.user_id !== user.id) {
      return new Response(
        JSON.stringify({ code: 403, message: "Not authorized to access this filing" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: agentRun } = await supabase
      .from("agent_runs")
      .insert({
        filing_id: filingId,
        agent_name: "document_preparation",
        layer: 1,
        status: "running",
        input_data: { documents: documents.map((d) => d.name), scope_of_work: scopeOfWork, property_type: propertyType },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    const agentRunId = agentRun?.id;

    try {
      const validatedDocs: Array<{
        document_name: string;
        document_type: string;
        file_url: string;
        file_size_bytes: number | null;
        file_format: string;
        validation_status: string;
        validation_notes: string;
        upload_order: number;
      }> = [];

      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const { status, notes } = validateDocument(doc);
        const docType = classifyDocumentType(doc.name, doc.type);
        const ext = getFileExtension(doc.name);

        validatedDocs.push({
          document_name: doc.name,
          document_type: docType,
          file_url: doc.url,
          file_size_bytes: doc.size_bytes ?? null,
          file_format: ext || "unknown",
          validation_status: status,
          validation_notes: notes.join("; "),
          upload_order: i + 1,
        });
      }

      const checklist = getChecklist(propertyType);
      const checklistResults: Array<{ type: string; label: string; required: boolean; found: boolean; document_name?: string }> = [];
      const deficiencies: string[] = [];

      for (const item of checklist) {
        const matchingDoc = validatedDocs.find((d) => d.document_type === item.type && d.validation_status !== "invalid");
        checklistResults.push({
          type: item.type,
          label: item.label,
          required: item.required,
          found: !!matchingDoc,
          document_name: matchingDoc?.document_name,
        });
        if (item.required && !matchingDoc) {
          deficiencies.push(`Missing required document: ${item.label}`);
        }
      }

      const needsEIF = requiresEIF(scopeOfWork);
      let eifStatus = "not_required";
      if (needsEIF) {
        const existingEIF = validatedDocs.find((d) => d.document_type === "eif");
        if (existingEIF) {
          eifStatus = "provided";
        } else {
          eifStatus = "required_missing";
          deficiencies.push("Environmental Intake Form (EIF) is required for this scope of work but was not provided");
          validatedDocs.push({
            document_name: "Environmental_Intake_Form.pdf",
            document_type: "eif",
            file_url: "",
            file_size_bytes: null,
            file_format: "pdf",
            validation_status: "missing",
            validation_notes: "EIF required based on scope of work — must be completed and uploaded",
            upload_order: validatedDocs.length + 1,
          });
        }
      }

      let uploadManifest: Array<{ order: number; name: string; type: string }> | null = null;
      if (reviewTrack === "projectdox") {
        uploadManifest = validatedDocs
          .filter((d) => d.validation_status !== "invalid" && d.validation_status !== "missing")
          .sort((a, b) => {
            const typeOrder: Record<string, number> = { plan: 1, specification: 2, cost_estimate: 3, contract: 4, eif: 5, checklist: 6, other: 7 };
            return (typeOrder[a.document_type] ?? 99) - (typeOrder[b.document_type] ?? 99);
          })
          .map((d, idx) => ({ order: idx + 1, name: d.document_name, type: d.document_type }));
      }

      const docsToInsert = validatedDocs.map((d) => ({
        filing_id: filingId,
        document_name: d.document_name,
        document_type: d.document_type,
        file_url: d.file_url || null,
        file_size_bytes: d.file_size_bytes,
        file_format: d.file_format,
        validation_status: d.validation_status,
        validation_notes: d.validation_notes || null,
        upload_order: d.upload_order,
      }));

      if (docsToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from("filing_documents")
          .insert(docsToInsert);
        if (insertError) {
          console.error("[document-preparation-agent] insert error:", insertError);
          throw new Error(`Failed to store document records: ${insertError.message}`);
        }
      }

      const validCount = validatedDocs.filter((d) => d.validation_status === "valid").length;
      const invalidCount = validatedDocs.filter((d) => d.validation_status === "invalid" || d.validation_status === "oversized").length;
      const missingCount = validatedDocs.filter((d) => d.validation_status === "missing").length;

      const outputData = {
        total_documents: documents.length,
        valid_count: validCount,
        invalid_count: invalidCount,
        missing_count: missingCount,
        deficiencies,
        checklist_results: checklistResults,
        eif_status: eifStatus,
        upload_manifest: uploadManifest,
        documents: validatedDocs.map((d) => ({
          name: d.document_name,
          type: d.document_type,
          format: d.file_format,
          status: d.validation_status,
          notes: d.validation_notes,
          order: d.upload_order,
        })),
      };

      const agentStatus = deficiencies.length > 0 || invalidCount > 0 ? "completed" : "completed";

      if (agentRunId) {
        await supabase
          .from("agent_runs")
          .update({
            status: agentStatus,
            output_data: outputData,
            completed_at: new Date().toISOString(),
          })
          .eq("id", agentRunId);
      }

      console.log("[document-preparation-agent] complete. valid:", validCount, "invalid:", invalidCount, "missing:", missingCount, "deficiencies:", deficiencies.length);

      return new Response(
        JSON.stringify({
          filing_id: filingId,
          status: "completed",
          total_documents: documents.length,
          valid_count: validCount,
          invalid_count: invalidCount,
          missing_count: missingCount,
          deficiencies,
          checklist_results: checklistResults,
          eif_status: eifStatus,
          upload_manifest: uploadManifest,
          documents: outputData.documents,
          duration_ms: Date.now() - startTime,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (processingError) {
      const errorMessage = processingError instanceof Error ? processingError.message : "Unknown processing error";
      console.error("[document-preparation-agent] processing error:", errorMessage);

      if (agentRunId) {
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
          })
          .eq("id", agentRunId);
      }

      return new Response(
        JSON.stringify({
          filing_id: filingId,
          status: "failed",
          error: errorMessage,
          duration_ms: Date.now() - startTime,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("[document-preparation-agent] error:", error);
    return new Response(
      JSON.stringify({ code: 500, message: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
