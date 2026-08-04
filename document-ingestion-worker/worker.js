"use strict";

require("dotenv").config();

const { getSupabaseAdmin } = require("./lib/supabase");
const { downloadToTempFile, removeTempFile } = require("./lib/download");
const { extractPdfPagesFromFile } = require("./lib/pdfExtract");
const { extractDocxPage } = require("./lib/docxExtract");
const { chunkPage, isIngestSupported, vectorToPg } = require("./lib/chunk");
const { embedTexts, getOpenAIClient } = require("./lib/embed");

const POLL_MS = Number(process.env.INGESTION_POLL_INTERVAL_MS) || 3000;
const CONCURRENCY = Math.max(1, Number(process.env.INGESTION_CONCURRENCY) || 1);
const TEMP_DIR = process.env.INGESTION_TEMP_DIR || undefined;

const LOW_TEXT_MSG =
  "Document prepared with limited text. OCR may be needed for scanned/image-based sheets.";

let activeJobs = 0;

async function updateJob(supabase, jobId, fields) {
  await supabase.from("document_ingestion_jobs").update(fields).eq("id", jobId);
}

async function updateDocument(supabase, documentId, fields) {
  await supabase.from("project_documents").update(fields).eq("id", documentId);
}

async function claimNextJob(supabase) {
  const { data: pending, error } = await supabase
    .from("document_ingestion_jobs")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("[worker] poll error:", error.message);
    return null;
  }
  if (!pending?.length) return null;

  const candidate = pending[0];
  const now = new Date().toISOString();

  const { data: claimed, error: claimError } = await supabase
    .from("document_ingestion_jobs")
    .update({
      status: "processing",
      started_at: now,
      progress: { phase: "downloading" },
    })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (claimError || !claimed) return null;

  await updateDocument(supabase, claimed.document_id, {
    ai_ingestion_status: "processing",
    ai_ingestion_error: null,
  });

  return claimed;
}

async function insertChunkBatch(supabase, rows) {
  if (rows.length === 0) return;
  const { error } = await supabase.from("project_document_chunks").insert(rows);
  if (error) throw new Error(error.message);
}

async function processPageChunks(supabase, openai, job, doc, page, stats) {
  const prepared = chunkPage(page);
  if (prepared.length === 0) return;

  const texts = prepared.map((c) => c.chunkText);
  const embeddings = await embedTexts(openai, texts);

  const rows = prepared.map((chunk, i) => ({
    project_id: job.project_id,
    document_id: job.document_id,
    user_id: job.user_id,
    file_name: doc.file_name,
    document_type: doc.document_type,
    page_number: chunk.pageNumber,
    sheet_label: chunk.sheetLabel,
    sheet_title: chunk.sheetTitle,
    chunk_index: chunk.chunkIndex,
    chunk_text: chunk.chunkText,
    embedding: vectorToPg(embeddings[i]),
    metadata: { ...chunk.metadata, source_file: doc.file_name },
  }));

  await insertChunkBatch(supabase, rows);
  stats.totalChunks += rows.length;
}

async function processJob(job) {
  const supabase = getSupabaseAdmin();
  const openai = getOpenAIClient();
  let tempPath = null;

  const stats = {
    totalChunks: 0,
    processedPages: 0,
    failedPages: 0,
    lowTextPages: 0,
    totalPages: 0,
  };

  try {
    const { data: doc, error: docError } = await supabase
      .from("project_documents")
      .select("id, file_name, file_path, file_type, document_type")
      .eq("id", job.document_id)
      .single();

    if (docError || !doc) {
      throw new Error("Document record not found");
    }

    if (!isIngestSupported(doc.file_name, doc.file_type)) {
      throw new Error("Unsupported file type");
    }

    await supabase
      .from("project_document_chunks")
      .delete()
      .eq("document_id", job.document_id);

    await updateJob(supabase, job.id, { progress: { phase: "downloading" } });

    tempPath = await downloadToTempFile(supabase, doc.file_path, doc.file_name, TEMP_DIR);

    const lower = doc.file_name.toLowerCase();
    const isPdf = doc.file_type === "application/pdf" || lower.endsWith(".pdf");
    const isDocx =
      doc.file_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lower.endsWith(".docx");

    if (isPdf) {
      let totalPages = 0;

      for await (const page of extractPdfPagesFromFile(tempPath, (pageNum, total) => {
        totalPages = total;
        if (pageNum === 1) {
          updateJob(supabase, job.id, {
            total_pages: total,
            progress: { phase: "extracting", page: 0, total_pages: total },
          }).catch(() => {});
        }
      })) {
        if (stats.totalPages === 0 && totalPages > 0) {
          stats.totalPages = totalPages;
          await updateJob(supabase, job.id, { total_pages: totalPages });
        }

        try {
          if (page.lowText) stats.lowTextPages++;

          await updateJob(supabase, job.id, {
            processed_pages: stats.processedPages,
            progress: {
              phase: "embedding",
              page: page.pageNumber,
              total_pages: stats.totalPages || totalPages,
            },
          });

          await processPageChunks(supabase, openai, job, doc, page, stats);
          stats.processedPages++;
        } catch (pageErr) {
          stats.failedPages++;
          console.error(`[worker] page ${page.pageNumber} failed:`, pageErr.message);
        }

        await updateJob(supabase, job.id, {
          processed_pages: stats.processedPages,
          failed_pages: stats.failedPages,
          total_chunks: stats.totalChunks,
          progress: {
            phase: "extracting",
            page: page.pageNumber,
            total_pages: stats.totalPages || totalPages,
          },
        });
      }

      if (stats.totalPages === 0) stats.totalPages = totalPages;
    } else if (isDocx) {
      stats.totalPages = 1;
      await updateJob(supabase, job.id, {
        total_pages: 1,
        progress: { phase: "extracting", page: 1, total_pages: 1 },
      });

      const page = await extractDocxPage(tempPath);
      if (page.lowText) stats.lowTextPages = 1;
      await processPageChunks(supabase, openai, job, doc, page, stats);
      stats.processedPages = 1;
    } else {
      throw new Error("Unsupported file type");
    }

    const now = new Date().toISOString();
    let finalStatus = "completed";
    let docStatus = "completed";
    let errorMsg = null;

    if (stats.totalChunks === 0) {
      finalStatus = "failed";
      docStatus = "low_text";
      errorMsg = "Very little text extracted. Scanned PDF OCR is not enabled in this phase.";
    } else if (stats.lowTextPages > 0 && stats.lowTextPages >= Math.ceil((stats.totalPages || 1) * 0.3)) {
      finalStatus = stats.failedPages > 0 ? "partial" : "partial";
      docStatus = "partial";
      errorMsg = LOW_TEXT_MSG;
    } else if (stats.lowTextPages > 0 || stats.failedPages > 0) {
      finalStatus = "partial";
      docStatus = "partial";
      errorMsg = stats.lowTextPages > 0 ? LOW_TEXT_MSG : null;
      if (stats.failedPages > 0) {
        errorMsg = (errorMsg ? errorMsg + " " : "") + `${stats.failedPages} page(s) failed to process.`;
      }
    }

    await updateJob(supabase, job.id, {
      status: finalStatus,
      completed_at: now,
      total_pages: stats.totalPages,
      processed_pages: stats.processedPages,
      failed_pages: stats.failedPages,
      total_chunks: stats.totalChunks,
      error: errorMsg,
      progress: { phase: "done", total_chunks: stats.totalChunks },
    });

    await updateDocument(supabase, job.document_id, {
      ai_ingestion_status: docStatus,
      ai_ingested_at: now,
      ai_chunk_count: stats.totalChunks,
      ai_ingestion_error: errorMsg,
    });

    console.log(
      `[worker] job ${job.id} ${finalStatus}: ${stats.totalChunks} chunks, ${stats.processedPages}/${stats.totalPages} pages`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job ${job.id} failed:`, msg);

    const now = new Date().toISOString();
    await updateJob(supabase, job.id, {
      status: "failed",
      completed_at: now,
      error: msg,
      progress: { phase: "failed" },
    });
    await updateDocument(supabase, job.document_id, {
      ai_ingestion_status: "failed",
      ai_ingestion_error: msg,
    });
  } finally {
    await removeTempFile(tempPath);
  }
}

async function pollOnce() {
  if (activeJobs >= CONCURRENCY) return;

  const supabase = getSupabaseAdmin();
  const job = await claimNextJob(supabase);
  if (!job) return;

  activeJobs++;
  processJob(job)
    .catch((err) => console.error("[worker] unhandled job error:", err))
    .finally(() => {
      activeJobs--;
    });
}

async function main() {
  console.log("[document-ingestion-worker] started — polling for ingestion jobs", {
    pollMs: POLL_MS,
    concurrency: CONCURRENCY,
    tempDir: TEMP_DIR || "(system tmp)",
  });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY");
    process.exit(1);
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pollOnce();
    } catch (err) {
      console.error("[worker] poll loop error:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
