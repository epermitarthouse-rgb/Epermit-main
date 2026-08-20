"use strict";

/**
 * Generate a load-calculation worksheet PDF and attach it to the application package.
 */

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

function lineValue(entry) {
  if (entry == null) return "—";
  if (typeof entry === "object" && entry.value != null) {
    return `${entry.value}${entry.unit ? ` ${entry.unit}` : ""}`;
  }
  return String(entry);
}

/**
 * @param {object} params
 * @param {Record<string, unknown>} params.record
 * @param {Record<string, unknown>} params.application
 * @param {Record<string, unknown>} params.project
 */
async function buildLoadWorksheetPdf(params) {
  const { record, application, project } = params;
  const load =
    application?.load_summary && typeof application.load_summary === "object"
      ? application.load_summary
      : {};
  const calculated = load.calculated_values && typeof load.calculated_values === "object"
    ? load.calculated_values
    : {};

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 750;
  const write = (text, opts = {}) => {
    page.drawText(String(text || ""), {
      x: 48,
      y,
      size: opts.size || 11,
      font: opts.bold ? bold : font,
      color: rgb(0.1, 0.1, 0.12),
    });
    y -= opts.gap || 16;
  };

  write("UCI Load Calculation Worksheet", { bold: true, size: 16, gap: 22 });
  write(`Project: ${project?.name || project?.id || ""}`);
  write(`Utility type: ${record?.utility_type || ""}`);
  write(`Generated: ${new Date().toISOString().slice(0, 10)}`, { gap: 24 });
  write("Calculated values", { bold: true, gap: 18 });
  const keys = Object.keys(calculated);
  if (!keys.length) write("No calculated values available.");
  for (const key of keys) {
    write(`${key}: ${lineValue(calculated[key])}`);
  }
  const needs = Array.isArray(load.needs_verification) ? load.needs_verification : [];
  if (needs.length) {
    y -= 8;
    write("Needs verification", { bold: true });
    for (const flag of needs) write(`- ${flag}`);
  }
  const provenance = load.calculation_provenance;
  if (provenance && typeof provenance === "object") {
    y -= 8;
    write("Provenance", { bold: true });
    write(`Method: ${provenance.method || "—"}`);
    write(`Template: ${provenance.template_id || "—"} (${provenance.template_source || "—"})`);
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

function worksheetPersistError(message, code, extra = {}) {
  return Object.assign(new Error(message), {
    statusCode: extra.statusCode ?? 500,
    code,
    cause: extra.cause,
  });
}

/**
 * Generate the worksheet PDF, store it, persist project_documents row, and return a package slot.
 * Idempotent per project + document_type. Fails loudly when the document row cannot be persisted.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function attachLoadWorksheetToPackage(supabase, params) {
  const { record, project, loadSummary, userId = null } = params;
  const recordId = String(record?.id || "record");
  const projectId = record?.project_id != null ? String(record.project_id) : "";
  if (!projectId) {
    throw worksheetPersistError("project_id is required to attach load calculation worksheet", "WORKSHEET_PROJECT_REQUIRED", {
      statusCode: 400,
    });
  }

  const resolvedUserId =
    userId != null && String(userId).trim()
      ? String(userId).trim()
      : record?.user_id != null && String(record.user_id).trim()
        ? String(record.user_id).trim()
        : project?.user_id != null && String(project.user_id).trim()
          ? String(project.user_id).trim()
          : null;
  if (!resolvedUserId) {
    throw worksheetPersistError(
      "user_id is required to persist load calculation worksheet in project_documents",
      "WORKSHEET_USER_REQUIRED",
      { statusCode: 400 },
    );
  }

  const buffer = await buildLoadWorksheetPdf({
    record,
    project,
    application: { load_summary: loadSummary || {} },
  });
  const fileName = `uci-load-worksheet-${recordId.slice(0, 8)}.pdf`;
  /** @type {string | null} */
  let storagePath = null;

  try {
    const { storeUciPortalDocument } = require("./uci-document-storage.service.js");
    const stored = await storeUciPortalDocument({
      supabase,
      buffer,
      projectId,
      coordinationRecordId: recordId,
      providerSlug: String(record.provider_slug || "uci"),
      externalApplicationId: `load-worksheet-${recordId}`,
      documentName: "uci-load-calculation-worksheet.pdf",
      fileName,
      isPdf: true,
    });
    storagePath =
      stored?.fileEntry && typeof stored.fileEntry.storagePath === "string"
        ? stored.fileEntry.storagePath
        : null;
  } catch (storageErr) {
    throw worksheetPersistError(
      storageErr instanceof Error ? storageErr.message : "Failed to store load calculation worksheet",
      "WORKSHEET_STORAGE_FAILED",
      { cause: storageErr, statusCode: 500 },
    );
  }
  if (!storagePath) {
    throw worksheetPersistError(
      "Load calculation worksheet storage path missing after upload",
      "WORKSHEET_STORAGE_PATH_MISSING",
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("project_documents")
    .select("id")
    .eq("project_id", projectId)
    .eq("document_type", "load_calculation_worksheet")
    .limit(5);
  if (existingError) {
    throw worksheetPersistError(
      existingError.message || "Failed to look up existing load calculation worksheet",
      "WORKSHEET_DOCUMENT_LOOKUP_FAILED",
      { cause: existingError },
    );
  }

  const prior = Array.isArray(existing) ? existing[0] : null;
  /** @type {string | null} */
  let projectDocumentId = prior?.id ? String(prior.id) : null;

  if (!projectDocumentId) {
    const { data: inserted, error: insertError } = await supabase
      .from("project_documents")
      .insert({
        project_id: projectId,
        user_id: resolvedUserId,
        file_name: fileName,
        file_path: storagePath,
        file_size: buffer.length,
        file_type: "application/pdf",
        document_type: "load_calculation_worksheet",
        description: "Generated UCI load calculation worksheet",
      })
      .select("id")
      .single();
    if (insertError || !inserted?.id) {
      throw worksheetPersistError(
        insertError?.message || "Failed to persist load calculation worksheet in project_documents",
        "WORKSHEET_DOCUMENT_PERSIST_FAILED",
        { cause: insertError },
      );
    }
    projectDocumentId = String(inserted.id);
  }

  if (!projectDocumentId) {
    throw worksheetPersistError(
      "Load calculation worksheet missing project_document_id after persist",
      "WORKSHEET_DOCUMENT_ID_MISSING",
    );
  }

  return {
    key: "load_calculation_worksheet",
    label: "Load calculation worksheet",
    status: "attached",
    source: "generated_worksheet",
    generated: true,
    generated_by: "uci-load-worksheet",
    file_name: fileName,
    storage_path: storagePath,
    project_document_id: projectDocumentId,
    project_document: {
      id: projectDocumentId,
      document_type: "load_calculation_worksheet",
      file_name: fileName,
    },
  };
}

module.exports = {
  buildLoadWorksheetPdf,
  attachLoadWorksheetToPackage,
};
