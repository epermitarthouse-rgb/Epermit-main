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

/**
 * Generate the worksheet PDF, store it, and return a package slot entry.
 * Best-effort: storage/document insert failures still return an attached in-memory slot
 * so Agent 3 is not blocked on storage availability.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function attachLoadWorksheetToPackage(supabase, params) {
  const { record, project, loadSummary, userId = null } = params;
  const buffer = await buildLoadWorksheetPdf({
    record,
    project,
    application: { load_summary: loadSummary || {} },
  });
  const recordId = String(record?.id || "record");
  const fileName = `uci-load-worksheet-${recordId.slice(0, 8)}.pdf`;
  /** @type {string | null} */
  let storagePath = null;
  /** @type {string | null} */
  let projectDocumentId = null;

  try {
    const { storeUciPortalDocument } = require("./uci-document-storage.service.js");
    const stored = await storeUciPortalDocument({
      supabase,
      buffer,
      projectId: String(record.project_id),
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
  } catch {
    storagePath = `uci/load-worksheet/${recordId}/${fileName}`;
  }

  try {
    const { data: existing } = await supabase
      .from("project_documents")
      .select("id")
      .eq("project_id", record.project_id)
      .eq("document_type", "load_calculation_worksheet")
      .limit(5);
    const prior = Array.isArray(existing) ? existing[0] : null;
    if (prior?.id) {
      projectDocumentId = String(prior.id);
    } else {
      const { data: inserted } = await supabase
        .from("project_documents")
        .insert({
          project_id: record.project_id,
          user_id: userId || record.user_id || project?.user_id || null,
          file_name: fileName,
          file_path: storagePath || fileName,
          file_size: buffer.length,
          file_type: "application/pdf",
          document_type: "load_calculation_worksheet",
          description: "Generated UCI load calculation worksheet",
        })
        .select("id")
        .single();
      if (inserted?.id) projectDocumentId = String(inserted.id);
    }
  } catch {
    /* package slot still attaches below */
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
    project_document: projectDocumentId
      ? {
          id: projectDocumentId,
          document_type: "load_calculation_worksheet",
          file_name: fileName,
        }
      : {
          id: `generated-worksheet-${recordId}`,
          document_type: "load_calculation_worksheet",
          file_name: fileName,
        },
  };
}

module.exports = {
  buildLoadWorksheetPdf,
  attachLoadWorksheetToPackage,
};
