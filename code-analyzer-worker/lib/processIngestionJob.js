"use strict";

const { downloadToTempFile, removeTempFile } = require("./download");
const { extractPdfPagesFromFile } = require("./pdfExtract");
const { rasterizePagePng, createThumbnail } = require("./rasterize");
const { hashBuffer, upsertDerivedAsset } = require("./derivedAssets");
const { releaseJob } = require("./claim");
const { getOpenAIClient } = require("./embed");
const { indexSpecificationDocument } = require("./specIndex");
const {
  classifyPage,
  buildSegmentsFromPageClasses,
  getPageClass,
  isMixedSegments,
  shouldCreateSheetsForPage,
  shouldRasterizeForPage,
  shouldIndexSpecForPage,
} = require("./segments");
const { classifyDocument } = require("./classify");

const HEARTBEAT_EVERY_PAGES = Number(process.env.CODE_ANALYZER_HEARTBEAT_EVERY_PAGES) || 5;
const MAX_INTERNAL_PAGES = Number(process.env.CODE_ANALYZER_MAX_PAGES_PER_JOB) || 5000;

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

async function loadDocumentSegments(supabase, documentId) {
  const { data } = await supabase
    .from("code_analyzer_document_segments")
    .select("page_start, page_end, analyzer_class, class_source")
    .eq("document_id", documentId)
    .order("page_start", { ascending: true });
  return data ?? [];
}

async function persistAutoSegments(supabase, projectId, documentId, segments) {
  for (const seg of segments) {
    await supabase.from("code_analyzer_document_segments").upsert(
      {
        project_id: projectId,
        document_id: documentId,
        page_start: seg.page_start,
        page_end: seg.page_end,
        analyzer_class: seg.analyzer_class,
        class_source: "auto",
        confidence: 0.75,
      },
      { onConflict: "document_id,page_start,page_end" },
    );
  }
}

async function processIngestionJob({ supabase, job, workerId, workerVersion, heartbeat }) {
  let tempPath = null;
  const stats = { processedPages: 0, failedPages: 0, totalPages: 0, sheetsCreated: 0 };
  const pageTexts = {};
  const pageClasses = {};

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
    const sourceContentHash = doc.content_hash || job.content_fingerprint || "";

    const pages = [];
    for await (const page of extractPdfPagesFromFile(tempPath, (_pageNum, total) => {
      stats.totalPages = total;
    })) {
      if (stats.totalPages > MAX_INTERNAL_PAGES) {
        throw new Error(`Document exceeds internal page limit (${MAX_INTERNAL_PAGES})`);
      }
      pages.push(page);
      pageTexts[page.pageNumber] = page.text;
      pageClasses[page.pageNumber] = classifyPage({
        pageNumber: page.pageNumber,
        text: page.text,
        fileName: doc.file_name,
        documentType: doc.document_type,
      }).analyzerClass;
    }

    const userSegments = doc.analyzer_class_source === "user" ? await loadDocumentSegments(supabase, doc.id) : [];
    let segments =
      userSegments.length > 0
        ? userSegments.map((s) => ({
            page_start: s.page_start,
            page_end: s.page_end,
            analyzer_class: s.analyzer_class,
          }))
        : buildSegmentsFromPageClasses(pageClasses);

    let effectiveClass =
      doc.analyzer_class_source === "user"
        ? doc.analyzer_class
        : job.analyzer_class || doc.analyzer_class || null;

    if (!effectiveClass) {
      if (isMixedSegments(segments)) {
        effectiveClass = "mixed";
      } else {
        const docLevel = classifyDocument({
          fileName: doc.file_name,
          documentType: doc.document_type,
          samplePageTexts: pages.slice(0, 5).map((p) => p.text),
        });
        effectiveClass = docLevel.analyzerClass;
        if (segments.length === 0 && stats.totalPages > 0) {
          segments = [{ page_start: 1, page_end: stats.totalPages, analyzer_class: effectiveClass }];
        }
      }
    }

    if (userSegments.length === 0 && isMixedSegments(segments)) {
      await persistAutoSegments(supabase, doc.project_id, doc.id, segments);
    }

    await supabase
      .from("project_documents")
      .update({
        analyzer_class: effectiveClass,
        analyzer_class_source: doc.analyzer_class_source === "user" ? "user" : "auto",
        analyzer_processing_status: "processing",
      })
      .eq("id", doc.id);

    await updateJobProgress(supabase, job.id, {
      progress_phase: "extracting",
      total_pages: stats.totalPages,
      analyzer_class: effectiveClass,
    });

    const specPageTexts = {};

    for (const page of pages) {
      const pageClass = getPageClass(page.pageNumber, segments, effectiveClass);
      try {
        if (heartbeat && page.pageNumber % HEARTBEAT_EVERY_PAGES === 0) {
          await heartbeat();
        }

        if (shouldIndexSpecForPage(pageClass)) {
          specPageTexts[page.pageNumber] = page.text;
        }

        if (shouldCreateSheetsForPage(pageClass)) {
          let derivedAssetId = null;
          if (shouldRasterizeForPage(pageClass)) {
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
              /* optional */
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
          page_class: pageClass,
          segments: segments.length,
        },
      });
    }

    if (Object.keys(specPageTexts).length > 0) {
      await updateJobProgress(supabase, job.id, { progress_phase: "indexing" });
      const openai = getOpenAIClient();
      const indexResult = await indexSpecificationDocument(supabase, openai, {
        projectId: doc.project_id,
        documentId: doc.id,
        userId: doc.user_id || job.user_id,
        fileName: doc.file_name,
        contentFingerprint: sourceContentHash,
        pageTexts: specPageTexts,
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
        segment_count: segments.length,
      },
    });
  } finally {
    await removeTempFile(tempPath);
  }
}

module.exports = { processIngestionJob };
