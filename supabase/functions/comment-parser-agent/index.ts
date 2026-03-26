import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import OpenAI from "https://esm.sh/openai@4.28.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Reuse same output shape as parse-permit-comments
interface ParsedCommentItem {
  original_text: string;
  discipline: string;
  code_reference: string | null;
}

interface PortalPdf {
  fileName?: string;
  text?: string;
  pages?: number;
  error?: string;
}

interface PortalData {
  tabs?: {
    reports?: { pdfs?: PortalPdf[] };
  };
  meta?: {
    comment_parse_cursor?: { pdfIndex: number };
  };
}

/** Known report titles to exclude (exact match). */
const REPORT_TITLE_EXACT = new Set([
  "Current Project - All Uploaded Files with Sheet Sizes",
  "Plan Review - Department Review Status",
  "Plan Review - Review Comments",
  "Plan Review - Review Details",
  "Plan Review - Workflow Routing Slip",
  "Plan Review - Review Comments Report",
]);

/** Table header phrases (all-uppercase column headers). */
const TABLE_HEADER_PHRASES = new Set([
  "TASK", "TASK STATUS", "REVIEW STATUS", "CYCLE", "ASSIGNED", "ACCEPTED", "COMPLETED", "GROUP", "USER", "SUB TOTAL",
  "WORKFLOW ROUTING SLIP", "REVIEW COMMENTS", "DEPARTMENT", "STATUS", "REVIEWER",
]);

/** Workflow/routing slip noise. */
const ROUTING_SLIP_NOISE = new Set([
  "Upload and Submit", "Accepted", "SystemClosed", "Applicant",
]);

/** Metadata phrases: blocks containing any of these must never be inserted as comments. */
const METADATA_PHRASES = [
  "Created in ProjectDox version",
  "Report Generated:",
  "Workflow Started:",
  "Report date:",
  "Project Name:",
  "Upload and Submit",
  "Workflow Routing Slip",
];

/** Substrings that indicate a real review comment (requirement, instruction, code reference, action request). */
const REAL_COMMENT_SIGNALS = [
  "requirement", "instruction", "code reference", "action request",
  "IBC", "NEC", "DCMR", "NFPA", "provide", "submit", "revise", "correct", "address", "comply",
  "required", "section", "approval", "permit", "shall", "must ",
  "upload", "verify", "review", "code", "plan", "drawing", "sheet", "detail",
  "note", "show", "indicate", "ensure", "install", "comply", "violation",
  "inspection", "certificate", "stamp", "seal", "sign", "abatement", "lead",
  "plat", "survey", "zoning", "fire", "structural", "electrical", "plumbing",
  "mechanical", "energy", "egress", "occupancy", "load", "rating",
];

/** Date/time pattern (e.g. 07/30/2025 02:29 PM or 02/21/2026). */
const DATE_TIME_PATTERN = /^\d{1,2}\/\d{1,2}\/\d{2,4}(\s+\d{1,2}:\d{2}\s*(?:AM|PM))?$/i;

/** Duration pattern (e.g. 147 days 3.5 hrs). */
const DURATION_PATTERN = /^\d+\s*days?\s+[\d.]+\s*hrs?$/i;

function isNoiseBlock(block: string): boolean {
  const t = block.trim();
  const len = t.length;

  if (len === 0) return true;

  // 0. Minimum length: ignore blocks shorter than 15 characters
  if (len < 15) return true;

  // 0b. Metadata phrases: never treat as comment
  for (const phrase of METADATA_PHRASES) {
    if (t.includes(phrase)) return true;
  }

  // 1. Report titles and headers
  if (REPORT_TITLE_EXACT.has(t)) return true;
  if (t.startsWith("Plan Review -") && len < 60) return true;
  if (t.startsWith("Current Project -") && len < 80) return true;

  // 2. Report metadata
  if (t.startsWith("Report Generated:")) return true;
  if (t.startsWith("Project Name:") && len < 40) return true;
  if (t.startsWith("Workflow Started:")) return true;
  if (t.startsWith("Workflow:") && t.includes("Template -")) return true;
  if (t.startsWith("Review Type:") && len < 40) return true;
  if (t.startsWith("Number of Files:")) return true;
  if (t.startsWith("Total Review Comments:") && len < 40) return true;
  if (t.startsWith("Total Review Cycle:")) return true;
  if (t.startsWith("Days Calculated as:")) return true;
  if (t.startsWith("Elapsed Days:") || t.startsWith("Time Elapsed:")) return true;
  if (t.startsWith("Days with Jurisdiction:") || t.startsWith("Time with Jurisdiction:")) return true;
  if (t.startsWith("Days with Applicant") || t.startsWith("Time with Applicant:")) return true;
  if (t.startsWith("Completed Submission") || t.startsWith("Completed Plan Review:")) return true;
  if (t.includes("Created in ProjectDox version")) return true;
  if (t === "No data found." || t === "No data found") return true;

  // 3. Table headers (all words uppercase, matches known header phrases)
  const upper = t.toUpperCase();
  const words = upper.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.every((w) => /^[A-Z0-9]+$/.test(w))) {
    const joined = words.join(" ");
    if (TABLE_HEADER_PHRASES.has(joined) || Array.from(TABLE_HEADER_PHRASES).some((h) => joined.includes(h))) return true;
    if (words.length <= 4 && words.every((w) => w.length <= 15)) {
      if (["CYCLE", "DEPARTMENT", "STATUS", "REVIEWER", "REVIEW", "COMMENTS"].some((h) => joined.includes(h))) return true;
    }
  }

  // 4. Short metadata
  if (/^\d+$/.test(t)) return true;
  if (DATE_TIME_PATTERN.test(t)) return true;

  // 5. Workflow routing slip
  if (ROUTING_SLIP_NOISE.has(t)) return true;
  if (DURATION_PATTERN.test(t)) return true;
  if (len < 35 && /^[\w\s\-]+(?:LLC|Inc|Corp)?\.?$/i.test(t)) {
    if (t.includes("Commun-ET") || t.split(/\s+/).length <= 3) return true;
  }

  // 6. Combined report summary (contains both Report Generated and Days/Time)
  if (t.includes("Report Generated:") && (t.includes("Days Calculated as:") || t.includes("Time Elapsed:"))) return true;

  return false;
}

/** Split document text into candidate comment blocks (regex fallback). */
function splitIntoCommentBlocks(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const blocks: string[] = [];

  // Numbered items: 1. 2. or 1) 2) or • or -
  const numbered = normalized.split(/\n\s*(?:\d+[.)]\s*|\d+\s*[-)]\s*|[•\-*]\s+)/).map((s) => s.trim()).filter((s) => s.length > 15);
  if (numbered.length > 1) {
    blocks.push(...numbered);
    return blocks;
  }

  // Double newline as separator
  const byDouble = normalized.split(/\n\s*\n/).map((s) => s.trim()).filter((s) => s.length > 15);
  if (byDouble.length > 1) {
    blocks.push(...byDouble);
    return blocks;
  }

  // Single block if substantial
  if (normalized.length > 20) blocks.push(normalized);
  return blocks;
}

/** True if block looks like a real review comment (requirement, instruction, code reference, or action request). */
function looksLikeRealComment(block: string): boolean {
  const lower = block.trim().toLowerCase();
  if (lower.length < 15) return false;
  return REAL_COMMENT_SIGNALS.some((signal) => lower.includes(signal.toLowerCase()));
}

/** Filter out report titles, metadata, table headers, and other noise before LLM. Only keep blocks that look like real comments. */
function filterNoiseBlocks(blocks: string[]): string[] {
  return blocks
    .filter((b) => b.trim().length >= 15)
    .filter((b) => !isNoiseBlock(b))
    .filter((b) => looksLikeRealComment(b));
}

/** Classify comment text using same schema as parse-permit-comments (LLM). */
async function classifyCommentBlocks(
  openai: OpenAI,
  blocks: string[]
): Promise<ParsedCommentItem[]> {
  if (blocks.length === 0) return [];

  const systemPrompt = `You are parsing official plan review comments from a building permit review process. ONLY extract actual reviewer comments — these are instructions, requirements, or feedback from government reviewers to the applicant.

DO NOT include:
- Report titles or headers
- Metadata (dates, project numbers, file counts, reviewer names)
- Table column headers
- Workflow routing information (task names, statuses, dates)
- Footer text (like 'Created in ProjectDox')
- Summary statistics (elapsed days, review cycles)

Actual review comments typically:
- Reference specific code sections (e.g., DCMR, IBC, NEC)
- Request specific documents or actions from the applicant
- Describe deficiencies or required corrections
- Mention specific building disciplines (structural, MEP, zoning, etc.)

Your task:
1. Below is a list of raw text blocks. For each block that is an actual review comment, output one object with: "original_text" (cleaned comment text), "discipline" (exactly one of: Architecture, MEP, Structural, Zoning, Fire; use "MEP" for mechanical/electrical/plumbing), "code_reference" (e.g. "IBC 1004.3", "NFPA 101", or null if not present).
2. Return a JSON object with a single key "comments": an array of those objects.
3. If a block is not a real comment, omit it from the array.
Return ONLY valid JSON. No markdown. Example: {"comments":[{"original_text":"Provide 1-hour fire rating","discipline":"Fire","code_reference":"IBC 708.4"}]}`;

  const userContent = blocks.map((b, i) => `[${i + 1}]\n${b}`).join("\n\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) return [];

  let data: { comments?: ParsedCommentItem[] };
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }

  const comments = Array.isArray(data.comments) ? data.comments : [];
  return comments.map((c: Record<string, unknown>) => ({
    original_text: typeof c.original_text === "string" ? c.original_text : String(c.original_text ?? ""),
    discipline: typeof c.discipline === "string" ? c.discipline : "General",
    code_reference: typeof c.code_reference === "string" ? c.code_reference : null,
  }));
}

/** Normalize for duplicate check: trim and collapse whitespace. */
function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ code: 500, message: "OpenAI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      return new Response(
        JSON.stringify({ code: 500, message: "SUPABASE_URL or SUPABASE_ANON_KEY not configured" }),
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
    if (!token) {
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log("Authorization header present, validating JWT");

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.warn("JWT validation failed:", userError?.message ?? "No user");
      return new Response(
        JSON.stringify({ code: 401, message: "Invalid JWT" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log("JWT validated, user.id:", user.id);

    const body = await req.json().catch(() => ({}));
    const projectId = body.project_id as string | undefined;
    if (!projectId) {
      return new Response(
        JSON.stringify({ code: 400, message: "project_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const maxPdfs = typeof body.max_pdfs === "number" && body.max_pdfs > 0 ? Math.min(body.max_pdfs, 10) : 2;
    const maxComments = typeof body.max_comments === "number" && body.max_comments > 0 ? body.max_comments : undefined;
    const cursorBody = body.cursor as { pdfIndex?: number } | undefined;

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, user_id, portal_data")
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return new Response(
        JSON.stringify({ code: 404, message: "Project not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (project.user_id !== user.id) {
      return new Response(
        JSON.stringify({ code: 403, message: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const portalData = (project.portal_data as PortalData | null) ?? {};
    const pdfs = portalData.tabs?.reports?.pdfs ?? [];
    const pdfsWithTextRaw = pdfs.filter((p): p is PortalPdf & { text: string } => !!p.text && p.text.trim().length > 0);
    // Only the single "Plan Review - Review Comments" report (exclude Review Details, Routing Slip)
    const pdfsWithText = pdfsWithTextRaw.filter((p) => {
      const name = (p.fileName ?? "").toLowerCase();
      return name.includes("review comments") && !name.includes("review details") && !name.includes("routing slip");
    });
    const pdfsToProcess = pdfsWithText.slice(0, 1);

    if (pdfsToProcess.length === 0) {
      console.log("[DEBUG] comment-parser: no PDFs with 'Review Comments' in fileName, skipping");
      return new Response(
        JSON.stringify({
          parsed_count: 0,
          skipped_count: 0,
          insert_error_count: 0,
          next_cursor: { pdfIndex: 0 },
          done: true,
          total_pdfs: 0,
          message: "No PDFs with 'Review Comments' in fileName",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const totalPdfs = pdfsToProcess.length;

    const savedCursor = portalData.meta?.comment_parse_cursor;
    const startPdfIndex = cursorBody?.pdfIndex ?? savedCursor?.pdfIndex ?? 0;
    const safeStart = Math.max(0, Math.min(startPdfIndex, totalPdfs));

    console.log("[DEBUG] comment-parser: total PDFs:", totalPdfs, "startPdfIndex:", safeStart, "max_pdfs:", maxPdfs);

    if (totalPdfs === 0) {
      return new Response(
        JSON.stringify({
          parsed_count: 0,
          skipped_count: 0,
          insert_error_count: 0,
          next_cursor: { pdfIndex: 0 },
          done: true,
          total_pdfs: 0,
          message: "No PDFs with text in portal_data.tabs.reports.pdfs",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const firstPdf = pdfsToProcess[0];
    const firstText = (firstPdf.text ?? "").trim();
    if (firstText === "" || firstText.includes("No data found.")) {
      const mergedPortalData = {
        ...portalData,
        meta: { ...portalData.meta, comment_parse_cursor: null },
      };
      await supabase.from("projects").update({ portal_data: mergedPortalData }).eq("id", projectId);
      return new Response(
        JSON.stringify({
          parsed_count: 0,
          skipped_count: 0,
          insert_error_count: 0,
          next_cursor: { pdfIndex: totalPdfs },
          done: true,
          total_pdfs: totalPdfs,
          reason: "no_comments_in_portal",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const existingRows = await supabase
      .from("parsed_comments")
      .select("id, original_text")
      .eq("project_id", projectId);

    const existingData = existingRows.data ?? [];
    const existingCount = existingData.length;
    console.log("[DEBUG] comment-parser: existing rows for project:", existingCount);

    const existingNormalized = new Map<string, string>();
    for (const row of existingData) {
      const r = row as { id: string; original_text?: string };
      if (r.original_text) existingNormalized.set(normalizeText(r.original_text), r.id);
    }

    let parsedCount = 0;
    let skippedCount = 0;
    let insertErrorCount = 0;
    let processedPdfCount = 0;
    let nextPdfIndex = safeStart;

    for (let i = 0; i < maxPdfs && safeStart + i < totalPdfs; i++) {
      const pdfIndex = safeStart + i;
      const pdf = pdfsToProcess[pdfIndex];
      const pageNumber = pdfIndex + 1;
      const blocks = filterNoiseBlocks(splitIntoCommentBlocks(pdf.text));
      console.log("[DEBUG] comment-parser: PDF index", pdfIndex + 1, "/", totalPdfs, "blocks extracted:", blocks.length);

      if (blocks.length === 0) {
        nextPdfIndex = pdfIndex + 1;
        processedPdfCount++;
        continue;
      }

      const classified = await classifyCommentBlocks(openai, blocks);

      const SKIP_PHRASES = [
        "Created in ProjectDox version",
        "Report Generated:",
        "Report date:",
        "Project Name:",
        "Workflow Started:",
      ];
      const DATE_ONLY_PATTERN = /^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}/;

      let commentCountThisPdf = 0;
      for (const c of classified) {
        if (maxComments != null && parsedCount + skippedCount + insertErrorCount >= maxComments) break;
        const orig = c.original_text.trim();
        if (!orig) continue;

        const origTrimmed = orig.trim();
        if (
          SKIP_PHRASES.some((phrase) => origTrimmed.includes(phrase)) ||
          (origTrimmed.length < 30 && DATE_ONLY_PATTERN.test(origTrimmed))
        ) {
          skippedCount++;
          continue;
        }

        const key = normalizeText(orig);
        if (existingNormalized.has(key)) {
          skippedCount++;
          continue;
        }

        const { data: inserted, error: insertError } = await supabase.from("parsed_comments").insert({
          project_id: projectId,
          original_text: orig,
          discipline: null,
          code_reference: c.code_reference ?? null,
          page_number: pageNumber,
          status: "Pending",
        }).select("id").single();

        if (insertError) {
          console.error("Insert parsed_comment error:", insertError.message, insertError);
          insertErrorCount++;
          continue;
        }

        existingNormalized.set(key, inserted?.id ?? "");
        parsedCount++;
        commentCountThisPdf++;
      }

      nextPdfIndex = pdfIndex + 1;
      processedPdfCount++;
      console.log("[DEBUG] comment-parser: PDF", pdfIndex + 1, "inserted:", commentCountThisPdf, "running totals parsed:", parsedCount, "skipped:", skippedCount);

      const nextCursor = { pdfIndex: nextPdfIndex };
      const mergedPortalData = {
        ...portalData,
        meta: { ...portalData.meta, comment_parse_cursor: nextCursor },
      };
      const { error: updateErr } = await supabase
        .from("projects")
        .update({ portal_data: mergedPortalData })
        .eq("id", projectId);
      if (updateErr) console.warn("Failed to save cursor:", updateErr.message);
    }

    const done = nextPdfIndex >= totalPdfs;
    if (done) {
      const mergedPortalData = {
        ...portalData,
        meta: { ...portalData.meta, comment_parse_cursor: null },
      };
      await supabase.from("projects").update({ portal_data: mergedPortalData }).eq("id", projectId);
    }

    const nextCursor = { pdfIndex: nextPdfIndex };
    console.log("[DEBUG] comment-parser: chunk done parsed:", parsedCount, "skipped:", skippedCount, "insert_error:", insertErrorCount, "next_cursor:", nextCursor, "done:", done);

    return new Response(
      JSON.stringify({
        parsed_count: parsedCount,
        skipped_count: skippedCount,
        insert_error_count: insertErrorCount,
        next_cursor: nextCursor,
        done,
        total_pdfs: totalPdfs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in comment-parser-agent:", error);
    return new Response(
      JSON.stringify({ code: 500, message: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
