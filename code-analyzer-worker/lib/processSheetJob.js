"use strict";

const { BUCKET } = require("./derivedAssets");
const { completeSheetJob, heartbeatSheetJob } = require("./sheetClaim");
const { downloadToTempFile, removeTempFile } = require("./download");
const { extractPdfPageText } = require("./pdfExtract");
const { classifySheetContent } = require("./classify");
const { isPdfFile } = require("./mediaType");
const {
  buildJurisdictionDiagnostics,
  resolveAnalysisJurisdiction,
  semanticDedupKey,
  dedupAgainstRun,
} = require("../../scraper-service/app/services/compliance/findingQuality.js");

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

function sheetFileNameFromRow(sheet) {
  const name = String(sheet?.file_name || sheet?.sheet_label || "").trim();
  return name || null;
}

/**
 * Annotation payload for one issue. sheet_file_name is the field readers use;
 * file_name is the same value for callers that read the document name off the row.
 */
function buildIssueAnnotationData({
  issue,
  codeType,
  sheetId,
  pageNumber,
  sourceDocumentId,
  sheetFileName,
}) {
  const name = sheetFileName || null;
  return {
    compliance_issue: true,
    codeType,
    ...issue,
    sheet_id: sheetId,
    page_number: pageNumber,
    source_document_id: sourceDocumentId,
    sheet_file_name: name,
    file_name: name,
    evidence_tier: issue.evidenceTier || "drawing",
    evidence_strength: issue.evidenceStrength || null,
    finding_type: issue.findingType || null,
    spec_references: issue.specReferences?.length ? issue.specReferences : null,
  };
}

async function fetchProjectJurisdiction(supabase, projectId) {
  const { data } = await supabase
    .from("projects")
    .select("jurisdiction, city, state")
    .eq("id", projectId)
    .maybeSingle();
  return data || {};
}

async function loadSheetPageText(supabase, sheet) {
  try {
    if (!sheet?.source_document_id) return "";
    const { data: doc } = await supabase
      .from("project_documents")
      .select("file_path, file_name, file_type")
      .eq("id", sheet.source_document_id)
      .maybeSingle();
    if (!doc?.file_path || !isPdfFile(doc.file_name, doc.file_type)) return "";
    const tempPath = await downloadToTempFile(supabase, doc.file_path, doc.file_name || "sheet.pdf");
    try {
      return await extractPdfPageText(tempPath, sheet.page_number || 1);
    } finally {
      await removeTempFile(tempPath);
    }
  } catch (err) {
    console.warn(
      "[code-analyzer-worker] sheet text extract failed:",
      err instanceof Error ? err.message : err,
    );
    return "";
  }
}

async function fetchProjectDocumentNameHints(supabase, projectId) {
  const { data } = await supabase
    .from("project_documents")
    .select("file_name")
    .eq("project_id", projectId)
    .limit(200);
  return (data || []).map((d) => d.file_name).filter(Boolean);
}

/**
 * @param {Record<string, unknown>} result
 * @param {string} analysisMode
 */
function extractResultForAnalysisMode(result, analysisMode) {
  if (result?.ibc && result?.local) {
    if (analysisMode === "local") {
      return {
        ...result.local,
        jurisdictionDiagnostics: result.jurisdictionDiagnostics,
        sheetReviewContext: result.local.sheetReviewContext,
      };
    }
    if (analysisMode === "ibc") {
      return {
        ...result.ibc,
        jurisdictionDiagnostics: result.jurisdictionDiagnostics,
        sheetReviewContext: result.ibc.sheetReviewContext,
      };
    }
    return {
      issues: [...(result.ibc.issues || []), ...(result.local.issues || [])],
      summary: result.ibc.summary,
      jurisdictionNotes: [result.ibc.jurisdictionNotes, result.local.jurisdictionNotes]
        .filter(Boolean)
        .join("\n"),
      jurisdictionDiagnostics: result.jurisdictionDiagnostics,
    };
  }
  return result;
}

async function loadRunSemanticDedupKeys(supabase, projectId, runId, codeType) {
  const { data } = await supabase
    .from("document_annotations")
    .select("data")
    .eq("project_id", projectId)
    .eq("analysis_run_id", runId)
    .eq("annotation_type", "text");

  const keys = new Set();
  for (const row of data || []) {
    const d = row.data || {};
    if (!d.compliance_issue || d.codeType !== codeType) continue;
    keys.add(semanticDedupKey(d));
  }
  return keys;
}

async function persistSheetFindings(supabase, params) {
  const {
    projectId,
    documentId,
    userId,
    runId,
    sheetId,
    pageNumber,
    sourceDocumentId,
    result,
    analysisMode,
    specChunkCount,
    sheetFileName,
    contentClass,
  } = params;

  const codeType =
    analysisMode === "local" ? "local" : analysisMode === "both" ? "both" : "ibc";
  const bundle = extractResultForAnalysisMode(result, analysisMode);
  const layerOrder = codeType === "ibc" ? 0 : codeType === "local" ? 1000 : 2000;

  const { data: priorRows } = await supabase
    .from("document_annotations")
    .select("id, data")
    .eq("project_id", projectId)
    .eq("document_id", documentId)
    .eq("analysis_run_id", runId);
  const priorIds = (priorRows || [])
    .filter((row) => {
      const d = row.data || {};
      return d.codeType === codeType || (d.compliance_metadata && d.codeType === codeType);
    })
    .map((row) => row.id);
  if (priorIds.length) {
    await supabase.from("document_annotations").delete().in("id", priorIds);
  }

  const existingKeys = await loadRunSemanticDedupKeys(supabase, projectId, runId, codeType);
  const issues = dedupAgainstRun(existingKeys, bundle.issues || []);

  await supabase.from("document_annotations").insert({
    project_id: projectId,
    document_id: documentId,
    user_id: userId,
    analysis_run_id: runId,
    annotation_type: "text",
    layer_order: layerOrder,
    data: {
      compliance_metadata: true,
      codeType,
      summary: bundle.summary,
      jurisdictionNotes: bundle.jurisdictionNotes,
      jurisdictionDiagnostics: bundle.jurisdictionDiagnostics || result.jurisdictionDiagnostics || null,
      sheetReviewContext: bundle.sheetReviewContext || null,
      spec_chunks_retrieved: specChunkCount ?? 0,
      sheet_id: sheetId,
      page_number: pageNumber,
      source_document_id: sourceDocumentId,
      sheet_file_name: sheetFileName,
      file_name: sheetFileName,
      content_class: contentClass || null,
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
      data: buildIssueAnnotationData({
        issue,
        codeType,
        sheetId,
        pageNumber,
        sourceDocumentId,
        sheetFileName,
      }),
    });
  }

  return issues.length;
}

async function refreshRunAnalysisCoverage(supabase, runId, projectId) {
  const { data: run } = await supabase
    .from("code_analyzer_runs")
    .select("index_completeness")
    .eq("id", runId)
    .single();
  if (!run) return;

  const { data: jobs } = await supabase
    .from("code_analyzer_sheet_jobs")
    .select("sheet_id, status, analysis_mode")
    .eq("run_id", runId);

  const sheetIds = [...new Set((jobs || []).map((j) => j.sheet_id).filter(Boolean))];
  const jobsBySheet = new Map();
  for (const j of jobs || []) {
    if (!j.sheet_id) continue;
    if (!jobsBySheet.has(j.sheet_id)) jobsBySheet.set(j.sheet_id, []);
    jobsBySheet.get(j.sheet_id).push(j);
  }

  const sheetsFullyCompleted = [];
  let sheetsPendingOrFailedCount = 0;
  for (const sheetId of sheetIds) {
    const sheetJobs = jobsBySheet.get(sheetId) || [];
    if (sheetJobs.length === 0) {
      sheetsPendingOrFailedCount += 1;
      continue;
    }
    if (sheetJobs.every((j) => j.status === "completed")) {
      sheetsFullyCompleted.push(sheetId);
    } else {
      sheetsPendingOrFailedCount += 1;
    }
  }

  const { data: sheets } = await supabase
    .from("code_analyzer_sheets")
    .select("id, file_name, excluded")
    .in("id", sheetIds.length ? sheetIds : ["00000000-0000-0000-0000-000000000000"]);
  const eligibleSheets = (sheets || []).filter((s) => !s.excluded);
  const eligibleSheetCount = eligibleSheets.length;

  const { data: issueRows } = await supabase
    .from("document_annotations")
    .select("data")
    .eq("project_id", projectId)
    .eq("analysis_run_id", runId)
    .eq("annotation_type", "text");

  const sheetsWithFindings = new Set();
  const analyzedFromMetadata = new Set();
  let specChunksUsed = 0;
  for (const row of issueRows || []) {
    const d = row.data || {};
    if (d.compliance_metadata && typeof d.spec_chunks_retrieved === "number") {
      specChunksUsed = Math.max(specChunksUsed, d.spec_chunks_retrieved);
    }
    if (d.compliance_metadata && d.sheet_id) {
      analyzedFromMetadata.add(d.sheet_id);
    }
    if (d.compliance_issue && d.sheet_id) {
      sheetsWithFindings.add(d.sheet_id);
    }
  }

  const completedSet = new Set(sheetsFullyCompleted);
  const withoutFindings = eligibleSheets
    .filter((s) => completedSet.has(s.id) && !sheetsWithFindings.has(s.id))
    .map((s) => s.file_name || s.id);

  const sheetsAnalyzedCount = sheetsFullyCompleted.length;
  const pendingOrFailed = sheetsPendingOrFailedCount;
  const prior = run.index_completeness && typeof run.index_completeness === "object" ? run.index_completeness : {};

  const analysisCoverage = {
    eligibleSheetCount,
    sheetsAnalyzed: sheetsAnalyzedCount,
    sheetsWithFindings: sheetsWithFindings.size,
    sheetsWithoutFindings: withoutFindings,
    sheetsPendingOrFailed: pendingOrFailed,
    sheetJobsTotal: (jobs || []).length,
    sheetJobsCompleted: (jobs || []).filter((j) => j.status === "completed").length,
    supportingSpecChunksUsed: specChunksUsed,
    updatedAt: new Date().toISOString(),
  };

  await supabase
    .from("code_analyzer_runs")
    .update({
      index_completeness: { ...prior, analysisCoverage },
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);
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
  const documentNameHints = await fetchProjectDocumentNameHints(supabase, job.project_id);
  const projectJurisdiction = await fetchProjectJurisdiction(supabase, job.project_id);
  const jurisdiction = resolveAnalysisJurisdiction({
    runJurisdiction: run.jurisdiction,
    projectJurisdiction: projectJurisdiction.jurisdiction,
    projectCity: projectJurisdiction.city,
    projectState: projectJurisdiction.state,
  });
  const jurisdictionDiagnostics = buildJurisdictionDiagnostics(jurisdiction, documentNameHints);
  const pageText = await loadSheetPageText(supabase, sheet);
  const contentClass = classifySheetContent({ text: pageText });
  const sheetFileName = sheetFileNameFromRow(sheet);

  const result = await callAnalyzeDrawing({
    imageBase64,
    imageType,
    jurisdiction,
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
    sheetTitle: sheetFileName,
    discipline: sheet.discipline,
    pageText,
    contentClass,
    jurisdictionDiagnostics,
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
    specChunkCount: specChunks.length,
    sheetFileName,
    contentClass,
  });

  await completeSheetJob(supabase, {
    jobId: job.id,
    workerId,
    status: "completed",
  });

  await refreshRunAnalysisCoverage(supabase, run.id, job.project_id);

  const { data: remaining } = await supabase
    .from("code_analyzer_sheet_jobs")
    .select("status")
    .eq("run_id", run.id);
  const allTerminal =
    (remaining || []).length > 0 &&
    (remaining || []).every((j) => j.status === "completed" || j.status === "failed");
  if (allTerminal) {
    await refreshRunAnalysisCoverage(supabase, run.id, job.project_id);
  }
}

module.exports = {
  processSheetJob,
  SHEET_CONCURRENCY,
  extractResultForAnalysisMode,
  refreshRunAnalysisCoverage,
  buildIssueAnnotationData,
  sheetFileNameFromRow,
};
