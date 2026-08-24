"use strict";

const { BUCKET } = require("./derivedAssets");
const { completeSheetJob, heartbeatSheetJob } = require("./sheetClaim");

const SCRAPER_BASE_URL = process.env.SCRAPER_SERVICE_URL || "http://localhost:3000";
const SHEET_CONCURRENCY = Math.max(1, Number(process.env.CODE_ANALYZER_SHEET_CONCURRENCY) || 3);

async function downloadDerivedAssetBuffer(supabase, storagePath) {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error) throw new Error(error.message);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function fetchSpecChunksForSheet(supabase, projectId, queryText, documentIds) {
  if (!queryText?.trim()) return [];

  const OpenAI = require("openai");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const openai = new OpenAI({ apiKey });
  const emb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: queryText.slice(0, 2000),
  });
  const vector = `[${emb.data[0].embedding.join(",")}]`;

  const { data, error } = await supabase.rpc("match_analyzer_spec_chunks", {
    p_project_id: projectId,
    p_query_embedding: vector,
    p_document_ids: documentIds?.length ? documentIds : null,
    p_match_count: 6,
  });

  if (error) {
    console.warn("[code-analyzer-worker] spec retrieval failed:", error.message);
    return [];
  }
  return data ?? [];
}

async function callAnalyzeDrawing(params) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${SCRAPER_BASE_URL}/api/analyze-drawing`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(params),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Analyze drawing failed (${response.status})`);
  }
  return body;
}

async function persistSheetFindings(supabase, params) {
  const { projectId, documentId, userId, runId, sheetId, pageNumber, sourceDocumentId, result, analysisMode } = params;

  await supabase
    .from("document_annotations")
    .delete()
    .eq("project_id", projectId)
    .eq("document_id", documentId)
    .eq("analysis_run_id", runId);

  const issues = result.issues || result.ibcIssues || [];
  const layerOrder = analysisMode === "ibc" ? 0 : 1000;

  await supabase.from("document_annotations").insert({
    project_id: projectId,
    document_id: documentId,
    user_id: userId,
    analysis_run_id: runId,
    annotation_type: "text",
    layer_order: layerOrder,
    data: {
      compliance_metadata: true,
      codeType: analysisMode,
      summary: result.summary,
      jurisdictionNotes: result.jurisdictionNotes,
      sheet_id: sheetId,
      page_number: pageNumber,
      source_document_id: sourceDocumentId,
    },
  });

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    await supabase.from("document_annotations").insert({
      project_id: projectId,
      document_id: documentId,
      user_id: userId,
      analysis_run_id: runId,
      annotation_type: "text",
      layer_order: layerOrder + i + 1,
      data: {
        compliance_issue: true,
        codeType: analysisMode,
        ...issue,
        sheet_id: sheetId,
        page_number: pageNumber,
        source_document_id: sourceDocumentId,
        evidence_tier: issue.evidenceTier || "drawing",
        spec_references: issue.specReferences || null,
      },
    });
  }
}

async function processSheetJob({ supabase, job, workerId, leaseTtlSeconds }) {
  const { data: run, error: runError } = await supabase
    .from("code_analyzer_runs")
    .select("*")
    .eq("id", job.run_id)
    .single();
  if (runError || !run) throw new Error("Run not found");

  const { data: sheet, error: sheetError } = await supabase
    .from("code_analyzer_sheets")
    .select("*")
    .eq("id", job.sheet_id)
    .single();
  if (sheetError || !sheet) throw new Error("Sheet not found");

  let imageBase64;
  let imageType = "image/png";
  let documentId = sheet.image_document_id;

  if (sheet.derived_asset_id) {
    const { data: asset } = await supabase
      .from("code_analyzer_derived_assets")
      .select("storage_path, mime_type")
      .eq("id", sheet.derived_asset_id)
      .single();
    if (asset?.storage_path) {
      const buffer = await downloadDerivedAssetBuffer(supabase, asset.storage_path);
      imageBase64 = buffer.toString("base64");
      imageType = asset.mime_type || "image/png";
      documentId = sheet.source_document_id;
    }
  }

  if (!imageBase64 && sheet.image_document_id) {
    const { data: doc } = await supabase
      .from("project_documents")
      .select("file_path, file_type")
      .eq("id", sheet.image_document_id)
      .single();
    if (doc?.file_path) {
      const buffer = await downloadDerivedAssetBuffer(supabase, doc.file_path);
      imageBase64 = buffer.toString("base64");
      imageType = doc.file_type || "image/png";
      documentId = sheet.image_document_id;
    }
  }

  if (!imageBase64) {
    throw new Error("No image available for sheet analysis");
  }

  await heartbeatSheetJob(supabase, job.id, workerId, leaseTtlSeconds);

  const queryText = [
    sheet.discipline,
    sheet.file_name,
    sheet.sheet_label,
    run.project_type,
    run.jurisdiction,
  ]
    .filter(Boolean)
    .join(" ");

  const specChunks = await fetchSpecChunksForSheet(supabase, job.project_id, queryText, null);

  const result = await callAnalyzeDrawing({
    imageBase64,
    imageType,
    jurisdiction: run.jurisdiction,
    projectType: run.project_type || "Commercial",
    codeYear: run.code_year || "2021",
    codeType: job.analysis_mode === "local" ? "local" : job.analysis_mode === "both" ? "both" : "ibc",
    analysisInstructions: run.analysis_instructions,
    specChunks: specChunks.map((c) => ({
      sectionNumber: c.section_number,
      sectionTitle: c.section_title,
      pageStart: c.page_start,
      pageEnd: c.page_end,
      text: c.chunk_text,
    })),
    sheetTitle: sheet.file_name,
    discipline: sheet.discipline,
  });

  await persistSheetFindings(supabase, {
    projectId: job.project_id,
    documentId: documentId || sheet.source_document_id,
    userId: run.user_id,
    runId: run.id,
    sheetId: sheet.id,
    pageNumber: sheet.page_number,
    sourceDocumentId: sheet.source_document_id,
    result,
    analysisMode: job.analysis_mode,
  });

  await completeSheetJob(supabase, {
    jobId: job.id,
    workerId,
    status: "completed",
  });
}

module.exports = { processSheetJob, SHEET_CONCURRENCY };
