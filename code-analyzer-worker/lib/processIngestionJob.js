"use strict";

const { downloadToTempFile, removeTempFile } = require("./download");
const { extractPdfPagesFromFile } = require("./pdfExtract");
const { classifyDocument, shouldCreateAnalyzerSheets, shouldRasterizePage } = require("./classify");
const { rasterizePagePng, createThumbnail } = require("./rasterize");
const { hashBuffer, upsertDerivedAsset } = require("./derivedAssets");
const { releaseJob } = require("./claim");
const { getOpenAIClient } = require("./embed");
const { indexSpecificationDocument } = require("./specIndex");

const HEARTBEAT_EVERY_PAGES = Number(process.env.CODE_ANALYZER_HEARTBEAT_EVERY_PAGES) || 5;
const MAX_INTERNAL_PAGES = Number(process.env.CODE_ANALYZER_MAX_PAGES_PER_JOB) || 5000;
const CLASSIFY_SAMPLE_PAGES = 5;

async function updateJobProgress(supabase, jobId, patch) {
  await supabase.from("code_analyzer_ingestion_jobs").update(patch).eq("id", jobId);
}

async function upsertAnalyzerSheet(supabase, params) {
  const { data: existing } = await supabase
    .from("code_analyzer_sheets")
    .select("id")
    .eq("source_document_id", params.sourceDocumentId)
    .eq("page_number", params.pageNumber)
    .maybeSingle();

  const row = {
    project_id: params.projectId,
    source_document_id: params.sourceDocumentId,
    image_document_id: null,
    derived_asset_id: params.derivedAssetId ?? null,
    page_number: params.pageNumber,
    file_name: params.fileName,
    discipline: params.discipline ?? "general",
    sheet_label: params.sheetLabel ?? null,
    excluded: false,
    source_content_hash: params.sourceContentHash ?? null,
  };

  if (existing?.id) {
    const { error } = await supabase.from("code_analyzer_sheets").update(row).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return existing.id;
  }

  const { data, error } = await supabase.from("code_analyzer_sheets").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function processIngestionJob({ supabase, job, workerId, workerVersion, heartbeat }) {
  let tempPath = null;
  const stats = { processedPages: 0, failedPages: 0, totalPages: 0, sheetsCreated: 0 };
  const sampleTexts = [];
  const pageTexts = {};

  try {
    const { data: doc, error: docError } = await supabase
      .from("project_documents")
      .select(
        "id, project_id, file_name, file_path, file_type, document_type, content_hash, analyzer_class, analyzer_class_source, user_id",
      )
      .eq("id", job.document_id)
      .single();

    if (docError || !doc) throw new Error("Document record not found");

    await updateJobProgress(supabase, job.id, {
      progress_phase: "downloading",
      worker_version: workerVersion,
    });

    tempPath = await downloadToTempFile(supabase, doc.file_path, doc.file_name);

    let effectiveClass =
      doc.analyzer_class_source === "user"
        ? doc.analyzer_class
        : job.analyzer_class || doc.analyzer_class || null;
    let classificationDone = Boolean(
      effectiveClass && (doc.analyzer_class_source === "user" || job.analyzer_class),
    );
    let createSheets = false;
    let rasterize = false;
    const sourceContentHash = doc.content_hash || job.content_fingerprint || "";

    for await (const page of extractPdfPagesFromFile(tempPath, (_pageNum, total) => {
      stats.totalPages = total;
    })) {
      if (stats.totalPages > MAX_INTERNAL_PAGES) {
        throw new Error(`Document exceeds internal page limit (${MAX_INTERNAL_PAGES})`);
      }

      pageTexts[page.pageNumber] = page.text;

      if (!classificationDone && sampleTexts.length < CLASSIFY_SAMPLE_PAGES) {
        sampleTexts.push(page.text);
      }
      if (!classificationDone && sampleTexts.length >= CLASSIFY_SAMPLE_PAGES) {
        const classification = classifyDocument({
          fileName: doc.file_name,
          documentType: doc.document_type,
          samplePageTexts: sampleTexts,
        });
        effectiveClass = job.analyzer_class || doc.analyzer_class || classification.analyzerClass;
        createSheets = shouldCreateAnalyzerSheets(effectiveClass);
        rasterize = shouldRasterizePage(effectiveClass);
        classificationDone = true;

        await supabase
          .from("project_documents")
          .update({
            analyzer_class: effectiveClass,
            analyzer_class_source:
              doc.analyzer_class_source === "user"
                ? "user"
                : job.analyzer_class
                  ? "user"
                  : classification.source,
            analyzer_class_confidence: classification.confidence,
            analyzer_processing_status: "processing",
          })
          .eq("id", doc.id);

        await updateJobProgress(supabase, job.id, {
          progress_phase: "extracting",
          total_pages: stats.totalPages,
          analyzer_class: effectiveClass,
        });
      }

      try {
        if (heartbeat && page.pageNumber % HEARTBEAT_EVERY_PAGES === 0) {
          await heartbeat();
        }

        if (createSheets) {
          let derivedAssetId = null;
          if (rasterize) {
            await updateJobProgress(supabase, job.id, {
              progress_phase: "rasterizing",
              processed_pages: stats.processedPages,
            });
            const rendered = await rasterizePagePng(tempPath, page.pageNumber);
            const assetHash = hashBuffer(rendered.buffer);
            const asset = await upsertDerivedAsset(supabase, {
              projectId: doc.project_id,
              documentId: doc.id,
              pageNumber: page.pageNumber,
              assetType: "raster",
              contentHash: assetHash,
              buffer: rendered.buffer,
              width: rendered.width,
              height: rendered.height,
              sourceContentHash,
            });
            derivedAssetId = asset.id;
            try {
              const thumb = await createThumbnail(rendered.buffer);
              await upsertDerivedAsset(supabase, {
                projectId: doc.project_id,
                documentId: doc.id,
                pageNumber: page.pageNumber,
                assetType: "thumbnail",
                contentHash: hashBuffer(thumb),
                buffer: thumb,
                sourceContentHash,
              });
            } catch {
              /* optional thumbnail */
            }
          }

          await upsertAnalyzerSheet(supabase, {
            projectId: doc.project_id,
            sourceDocumentId: doc.id,
            pageNumber: page.pageNumber,
            fileName: doc.file_name,
            derivedAssetId,
            sourceContentHash,
          });
          stats.sheetsCreated += 1;
        }

        stats.processedPages += 1;
      } catch (pageErr) {
        stats.failedPages += 1;
        console.error(
          `[code-analyzer-worker] page ${page.pageNumber} failed:`,
          pageErr instanceof Error ? pageErr.message : pageErr,
        );
      }

      await updateJobProgress(supabase, job.id, {
        processed_pages: stats.processedPages,
        failed_pages: stats.failedPages,
        progress_detail: {
          sheets_created: stats.sheetsCreated,
          analyzer_class: effectiveClass,
          page: page.pageNumber,
        },
      });
    }

    if (!classificationDone) {
      const classification = classifyDocument({
        fileName: doc.file_name,
        documentType: doc.document_type,
        samplePageTexts: sampleTexts,
      });
      effectiveClass = job.analyzer_class || doc.analyzer_class || classification.analyzerClass;
      createSheets = shouldCreateAnalyzerSheets(effectiveClass);
      await supabase
        .from("project_documents")
        .update({
          analyzer_class: effectiveClass,
          analyzer_class_source: job.analyzer_class ? "user" : classification.source,
          analyzer_class_confidence: classification.confidence,
        })
        .eq("id", doc.id);
    }

    if (
      effectiveClass === "specification" ||
      effectiveClass === "supporting" ||
      effectiveClass === "report"
    ) {
      await updateJobProgress(supabase, job.id, { progress_phase: "indexing" });
      const openai = getOpenAIClient();
      const indexResult = await indexSpecificationDocument(supabase, openai, {
        projectId: doc.project_id,
        documentId: doc.id,
        userId: doc.user_id || job.user_id,
        fileName: doc.file_name,
        contentFingerprint: sourceContentHash,
        pageTexts,
      });
      stats.indexedSections = indexResult.sections;
      stats.indexedChunks = indexResult.chunks;
    }

    const finalStatus =
      stats.failedPages > 0 && stats.processedPages === 0
        ? "failed"
        : stats.failedPages > 0
          ? "partial"
          : "completed";

    await releaseJob(supabase, {
      jobId: job.id,
      workerId,
      status: finalStatus,
      progressPhase: "done",
      totalPages: stats.totalPages,
      processedPages: stats.processedPages,
      failedPages: stats.failedPages,
      progressDetail: {
        sheets_created: stats.sheetsCreated,
        analyzer_class: effectiveClass,
        indexed_sections: stats.indexedSections ?? 0,
        indexed_chunks: stats.indexedChunks ?? 0,
      },
    });

    console.log(
      `[code-analyzer-worker] ingestion ${job.id} ${finalStatus}: ${stats.processedPages}/${stats.totalPages} pages`,
    );
  } finally {
    await removeTempFile(tempPath);
  }
}

module.exports = { processIngestionJob };
