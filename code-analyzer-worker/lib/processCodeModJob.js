"use strict";

const { downloadToTempFile, removeTempFile } = require("./download");
const { extractPdfPagesFromFile } = require("./pdfExtract");
const { rasterizePagePng } = require("./rasterize");
const { BUCKET } = require("./derivedAssets");
const { completeCodeModJob, claimCodeModJob } = require("./codeModClaim");

const SCRAPER_BASE_URL = process.env.SCRAPER_SERVICE_URL || "http://localhost:3000";
const SPARSE_TEXT_THRESHOLD = 40;

async function scraperPost(path, body) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${SCRAPER_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `${path} failed (${response.status})`);
  }
  return data;
}

async function downloadStorageBase64(supabase, storagePath, mimeType = "application/pdf") {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error) throw new Error(error.message);
  const buffer = Buffer.from(await data.arrayBuffer());
  return { base64: buffer.toString("base64"), mimeType, buffer };
}

async function getFormExtractionResult(supabase, runId) {
  const { data } = await supabase
    .from("code_analyzer_code_mod_jobs")
    .select("result")
    .eq("run_id", runId)
    .eq("job_type", "form_extraction")
    .eq("status", "completed")
    .maybeSingle();
  return data?.result ?? null;
}

async function siblingJobsReady(supabase, runId, mergeJobId) {
  const { data: jobs } = await supabase
    .from("code_analyzer_code_mod_jobs")
    .select("id, job_type, status")
    .eq("run_id", runId);

  const others = (jobs ?? []).filter((j) => j.id !== mergeJobId && j.job_type !== "merge_findings");
  if (others.length === 0) return false;
  return others.every((j) => ["completed", "failed", "cancelled"].includes(j.status));
}

async function processFormExtractionJob(supabase, job) {
  const formDocIds = job.payload?.form_document_ids || [];
  const formPages = [];
  const formImages = [];
  let pageOffset = 0;

  for (const docId of formDocIds) {
    const { data: doc } = await supabase
      .from("project_documents")
      .select("id, file_name, file_path, file_type, updated_at")
      .eq("id", docId)
      .single();
    if (!doc?.file_path) continue;

    const tempPath = await downloadToTempFile(supabase, doc.file_path, doc.file_name);
    try {
      let docPageCount = 0;
      for await (const page of extractPdfPagesFromFile(tempPath)) {
        docPageCount += 1;
        formPages.push({ pageNumber: pageOffset + page.pageNumber, text: page.text });
        if (page.text.length < SPARSE_TEXT_THRESHOLD) {
          const rendered = await rasterizePagePng(tempPath, page.pageNumber);
          formImages.push({
            pageNumber: pageOffset + page.pageNumber,
            imageBase64: rendered.buffer.toString("base64"),
            imageType: "image/png",
          });
        }
      }
      pageOffset += Math.max(docPageCount, 1);
    } finally {
      await removeTempFile(tempPath);
    }
  }

  const primaryFormId = formDocIds[0];
  const { data: primaryDoc } = await supabase
    .from("project_documents")
    .select("id, file_name, updated_at")
    .eq("id", primaryFormId)
    .single();

  const { data: run } = await supabase
    .from("code_analyzer_runs")
    .select("analysis_instructions")
    .eq("id", job.run_id)
    .single();

  return scraperPost("/api/analyze-code-modification/extract-form", {
    formPages,
    formImages: formImages.length ? formImages : undefined,
    formDocument: primaryDoc
      ? { id: primaryDoc.id, fileName: primaryDoc.file_name, updatedAt: primaryDoc.updated_at }
      : undefined,
    analysisInstructions: run?.analysis_instructions ?? null,
  }).then((extractResult) => ({
    extracted_request: extractResult.extracted_request,
    extraction_warnings: extractResult.extraction_warnings ?? [],
    form_fingerprint: extractResult.form_fingerprint ?? job.payload?.form_fingerprint ?? "",
    form_document_ids: formDocIds,
  }));
}

async function processEvidenceSheetJob(supabase, job) {
  const formResult = await getFormExtractionResult(supabase, job.run_id);
  if (!formResult?.extracted_request) {
    throw new Error("Form extraction not complete");
  }

  const { data: sheet } = await supabase
    .from("code_analyzer_sheets")
    .select("id, page_number, file_name, sheet_label, derived_asset_id, source_document_id, image_document_id")
    .eq("id", job.sheet_id)
    .single();
  if (!sheet) throw new Error("Evidence sheet not found");

  let imageBase64;
  let imageType = "image/png";
  let documentId = sheet.source_document_id;

  if (sheet.derived_asset_id) {
    const { data: asset } = await supabase
      .from("code_analyzer_derived_assets")
      .select("storage_path, mime_type")
      .eq("id", sheet.derived_asset_id)
      .single();
    if (asset?.storage_path) {
      const downloaded = await downloadStorageBase64(supabase, asset.storage_path, asset.mime_type || "image/png");
      imageBase64 = downloaded.base64;
      imageType = downloaded.mimeType;
    }
  } else if (sheet.image_document_id) {
    const { data: imageDoc } = await supabase
      .from("project_documents")
      .select("file_path, file_type")
      .eq("id", sheet.image_document_id)
      .single();
    if (imageDoc?.file_path) {
      const downloaded = await downloadStorageBase64(supabase, imageDoc.file_path, imageDoc.file_type || "image/png");
      imageBase64 = downloaded.base64;
      imageType = downloaded.mimeType;
      documentId = sheet.image_document_id;
    }
  }

  if (!imageBase64) throw new Error("No image available for evidence sheet");

  const { data: run } = await supabase
    .from("code_analyzer_runs")
    .select("analysis_instructions")
    .eq("id", job.run_id)
    .single();

  const reviewResult = await scraperPost("/api/analyze-code-modification/review-sheet", {
    extracted_request: formResult.extracted_request,
    sheet: {
      id: sheet.id,
      documentId,
      fileName: sheet.file_name,
      sheetLabel: sheet.sheet_label || sheet.file_name,
      pageNumber: sheet.page_number,
      imageBase64,
      imageType,
    },
    analysisInstructions: run?.analysis_instructions ?? null,
  });

  return {
    sheet_id: sheet.id,
    findings: reviewResult.findings ?? [],
    sheet_warnings: reviewResult.sheet_warnings ?? [],
  };
}

async function processMergeJob(supabase, job, workerId) {
  const ready = await siblingJobsReady(supabase, job.run_id, job.id);
  if (!ready) {
    await completeCodeModJob(supabase, {
      jobId: job.id,
      workerId,
      status: "queued",
      availableAt: new Date(Date.now() + 5000).toISOString(),
    });
    return;
  }

  const formResult = await getFormExtractionResult(supabase, job.run_id);
  if (!formResult?.extracted_request) {
    throw new Error("Form extraction missing for merge");
  }

  const { data: evidenceJobs } = await supabase
    .from("code_analyzer_code_mod_jobs")
    .select("result, status, sheet_id")
    .eq("run_id", job.run_id)
    .eq("job_type", "evidence_sheet");

  const sheetFindingsList = [];
  const sheetWarnings = [];
  const evidenceSheets = [];

  for (const ej of evidenceJobs ?? []) {
    if (ej.status === "completed" && ej.result) {
      sheetFindingsList.push(ej.result.findings || []);
      sheetWarnings.push(...(ej.result.sheet_warnings || []));
      const { data: sheet } = await supabase
        .from("code_analyzer_sheets")
        .select("id, page_number, file_name, sheet_label, source_document_id, image_document_id")
        .eq("id", ej.sheet_id)
        .maybeSingle();
      if (sheet) {
        evidenceSheets.push({
          id: sheet.id,
          documentId: sheet.image_document_id || sheet.source_document_id,
          pageNumber: sheet.page_number,
          fileName: sheet.file_name,
          sheetLabel: sheet.sheet_label || sheet.file_name,
        });
      }
    } else if (ej.status === "failed") {
      sheetWarnings.push(`Evidence sheet job ${ej.sheet_id} failed`);
    }
  }

  const { data: run } = await supabase.from("code_analyzer_runs").select("*").eq("id", job.run_id).single();
  if (!run) throw new Error("Run not found");

  const { data: allSheets } = await supabase
    .from("code_analyzer_sheets")
    .select("id, source_document_id, image_document_id, page_number, file_name, sheet_label, excluded")
    .eq("project_id", job.project_id);

  const merged = await scraperPost("/api/analyze-code-modification/merge", {
    extracted_request: formResult.extracted_request,
    sheetFindingsList,
    evidenceSheets,
    excludedFormSheetCount: Math.max(0, (allSheets ?? []).filter((s) => !s.excluded).length - evidenceSheets.length),
    sheets: allSheets ?? [],
    sheetWarnings,
  });

  const formDocIds = job.payload?.form_document_ids || formResult.form_document_ids || [];
  const primaryFormId = formDocIds[0] || run.form_document_id;

  await supabase.from("code_modification_reviews").delete().eq("run_id", job.run_id);

  const { data: reviewRow, error: reviewError } = await supabase
    .from("code_modification_reviews")
    .insert({
      run_id: job.run_id,
      project_id: job.project_id,
      form_document_id: primaryFormId,
      form_fingerprint: formResult.form_fingerprint || job.payload?.form_fingerprint || "",
      extracted_request: merged.extracted_request,
      evidence: merged.evidence,
      overall_status: merged.overall_status,
      extraction_warnings: merged.extraction_warnings ?? [],
    })
    .select("*")
    .single();
  if (reviewError) throw new Error(reviewError.message);

  const uniqueDocIds = [...new Set(formDocIds.filter(Boolean))];
  if (uniqueDocIds.length > 0) {
    await supabase.from("code_modification_review_documents").insert(
      uniqueDocIds.map((documentId, index) => ({
        review_id: reviewRow.id,
        document_id: documentId,
        sort_order: index,
      })),
    );
  }

  await completeCodeModJob(supabase, {
    jobId: job.id,
    workerId,
    status: "completed",
    result: { review_id: reviewRow.id, overall_status: merged.overall_status },
  });
}

async function processCodeModJob({ supabase, job, workerId }) {
  if (job.job_type === "merge_findings") {
    await processMergeJob(supabase, job, workerId);
    return;
  }

  if (job.job_type === "form_extraction") {
    const formResult = await processFormExtractionJob(supabase, job);
    await completeCodeModJob(supabase, {
      jobId: job.id,
      workerId,
      status: "completed",
      result: formResult,
    });
    return;
  }

  if (job.job_type === "evidence_sheet") {
    const formReady = await getFormExtractionResult(supabase, job.run_id);
    if (!formReady) {
      await completeCodeModJob(supabase, {
        jobId: job.id,
        workerId,
        status: "queued",
        availableAt: new Date(Date.now() + 3000).toISOString(),
      });
      return;
    }
    const sheetResult = await processEvidenceSheetJob(supabase, job);
    await completeCodeModJob(supabase, {
      jobId: job.id,
      workerId,
      status: "completed",
      result: sheetResult,
    });
  }
}

module.exports = { processCodeModJob, claimCodeModJob };
