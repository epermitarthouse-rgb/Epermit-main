"use strict";

const crypto = require("crypto");
const path = require("path");
const AdmZip = require("adm-zip");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const {
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
  getApplicationById,
} = require("./uci-application-builder.service.js");
const { getCoordinationRecordById } = require("./uci-records.service.js");
const { summarizePackageReview } = require("./uci-package-review.service.js");
const { UCI_DOCUMENTS_STORAGE_BUCKET } = require("./uci-document-storage.service.js");

const EXPORT_VERSION = "uci-agent-3-package-export-v1";
const STRUCTURED_JSON_VERSION = "uci-agent-3-structured-json-v2";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function packageContext(application) {
  if (
    !application ||
    String(application.record_source) !== "agent_draft" ||
    String(application.idempotency_key) !== APPLICATION_PACKAGE_IDEMPOTENCY_KEY
  ) {
    throw Object.assign(new Error("Application is not an Application Builder package"), {
      statusCode: 400,
      code: "NOT_APPLICATION_PACKAGE",
    });
  }
  const metadata = asObject(application.agent_draft_metadata);
  const pkg = asObject(metadata.application_package);
  return { metadata, pkg };
}

function isSyntheticPackage(pkg) {
  return String(pkg.checklist_mode ?? "") === "synthetic_test" || pkg.authoritative_requirements === false;
}

function packageLabel(pkg) {
  if (isSyntheticPackage(pkg)) {
    return String(pkg.checklist_label ?? pkg.label ?? "SYNTHETIC / TEST PACKAGE — NOT PROVIDER ISSUED");
  }
  return "Application Builder package";
}

function mappedValue(value) {
  if (value == null || value === "") return "Not mapped";
  if (typeof value !== "object" || Array.isArray(value)) return String(value);
  if (value.value != null) return `${String(value.value)}${value.unit ? ` ${String(value.unit)}` : ""}`;
  return Object.entries(value)
    .map(([key, nested]) => {
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        return `${key.replace(/_/g, " ")}: ${String(nested.value ?? "—")}${
          nested.unit ? ` ${String(nested.unit)}` : ""
        }`;
      }
      return `${key.replace(/_/g, " ")}: ${String(nested)}`;
    })
    .join("; ");
}

function friendlyFieldProvenance(field) {
  const source = String(field.source ?? "");
  if (source.startsWith("project.")) return "Project record";
  if (!source.startsWith("load_summary.verified_values")) return "Package source";
  const value = asObject(field.value);
  const evidence = Array.isArray(value.evidence_sources)
    ? value.evidence_sources.find((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    : null;
  const sourceDocument = String(evidence?.source_document_name ?? value.source_document_name ?? "").trim();
  const pageNumber = evidence?.page_number ?? value.page_number;
  return [
    "Load Profile Analyzer — Verified Input",
    sourceDocument || null,
    pageNumber != null && String(pageNumber).trim() ? `page ${String(pageNumber)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function friendlyDocumentSource(source) {
  if (source === "project_documents") return "PermitPilot upload";
  if (source === "pepco_portal") return "PEPCO portal";
  return String(source || "Unknown").replace(/_/g, " ");
}

async function loadPackageExportContext(supabase, params) {
  const application =
    params.application ?? (await getApplicationById(supabase, String(params.applicationId)));
  if (!application) {
    throw Object.assign(new Error("Application not found"), {
      statusCode: 404,
      code: "NOT_FOUND",
    });
  }
  const { metadata, pkg } = packageContext(application);
  const [record, projectResult] = await Promise.all([
    getCoordinationRecordById(supabase, String(application.coordination_record_id)),
    supabase
      .from("projects")
      .select("id, name, project_type, address, city, state, zip_code")
      .eq("id", String(application.project_id))
      .maybeSingle(),
  ]);
  if (projectResult.error || !projectResult.data) {
    throw Object.assign(new Error(projectResult.error?.message || "Project not found"), {
      statusCode: 404,
      code: "PROJECT_NOT_FOUND",
    });
  }
  return {
    application,
    metadata,
    pkg,
    record,
    project: projectResult.data,
    review: summarizePackageReview(application),
  };
}

function buildStructuredPackageExport(context, exportedAt = new Date().toISOString()) {
  const { application, metadata, pkg, record, project, review } = context;
  const synthetic = isSyntheticPackage(pkg);
  const address =
    asObject(pkg.project_address).formatted ||
    [project.address, project.city, project.state, project.zip_code].filter(Boolean).join(", ") ||
    null;
  return {
    export_version: STRUCTURED_JSON_VERSION,
    exported_at: exportedAt,
    read_only: true,
    artifact_type: "structured_package_record",
    suitable_for_utility_submission: false,
    submission_warning:
      "Structured JSON is an internal audit artifact, not a provider application or utility-submittable format.",
    label: packageLabel(pkg),
    synthetic_test: synthetic,
    authoritative_requirements: pkg.authoritative_requirements !== false,
    external_submission_allowed: false,
    lifecycle_advanced: false,
    project: {
      id: project.id,
      name: project.name ?? null,
      address,
      project_type: project.project_type ?? null,
    },
    coordination: {
      id: application.coordination_record_id,
      provider_slug: application.provider_slug,
      provider_name: record?.utility_providers?.name ?? null,
      utility_type: record?.utility_type ?? null,
      current_stage: record?.current_stage ?? null,
      current_stage_state: record?.current_stage_state ?? null,
    },
    package: {
      application_id: application.id,
      built_at: pkg.built_at ?? null,
      built_by_user_id: pkg.built_by_user_id ?? null,
      template_id: pkg.template_id ?? null,
      template_version: asObject(application.metadata).template_version ?? null,
      checklist_mode: pkg.checklist_mode ?? null,
      checklist_status: asObject(pkg.synthetic_checklist).status ?? null,
      package_status: pkg.package_status ?? null,
      draft_status: application.draft_status ?? null,
      missing_fields: clone(Array.isArray(pkg.missing_fields) ? pkg.missing_fields : []),
      missing_documents: clone(Array.isArray(pkg.missing_documents) ? pkg.missing_documents : []),
      field_results: clone(Array.isArray(pkg.field_results) ? pkg.field_results : []),
      signature_requirements: clone(
        Array.isArray(pkg.signature_requirements) ? pkg.signature_requirements : [],
      ),
      documents: clone(
        Array.isArray(application.package_documents) ? application.package_documents : [],
      ),
      verified_load_snapshot: clone(asObject(pkg.verified_load_snapshot)),
      review: clone(review),
      reviewed_snapshot: review.reviewed_snapshot ? clone(review.reviewed_snapshot) : null,
      validation: clone(asObject(metadata.submission)),
    },
  };
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function renderPackageSummaryPdf(context, generatedAt = new Date().toISOString()) {
  const { application, pkg, project, record, review } = context;
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize = [612, 792];
  const margin = 48;
  const width = pageSize[0] - margin * 2;
  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - margin;

  const ensureSpace = (needed = 24) => {
    if (y - needed >= margin) return;
    page = pdf.addPage(pageSize);
    y = pageSize[1] - margin;
  };
  const line = (text, options = {}) => {
    const font = options.bold ? bold : regular;
    const size = options.size ?? 9;
    const color = options.color ?? rgb(0.12, 0.16, 0.2);
    const indent = options.indent ?? 0;
    const lines = wrapText(text, font, size, width - indent);
    ensureSpace(lines.length * (size + 3) + 2);
    for (const wrapped of lines) {
      page.drawText(wrapped, { x: margin + indent, y, size, font, color });
      y -= size + 3;
    }
    y -= options.after ?? 2;
  };
  const heading = (text) => {
    ensureSpace(28);
    y -= 7;
    line(text, { size: 12, bold: true, color: rgb(0.08, 0.29, 0.42), after: 5 });
  };
  const field = (label, value) => line(`${label}: ${value == null || value === "" ? "—" : String(value)}`);

  line("APPLICATION PACKAGE SUMMARY", { size: 18, bold: true, color: rgb(0.04, 0.22, 0.34), after: 5 });
  line(packageLabel(pkg), {
    size: 11,
    bold: true,
    color: isSyntheticPackage(pkg) ? rgb(0.72, 0.19, 0.12) : rgb(0.12, 0.16, 0.2),
    after: 4,
  });
  line(
    isSyntheticPackage(pkg)
      ? "SYNTHETIC / TEST ONLY. Not provider-issued and not a utility application form."
      : "Cover summary only. Provider acceptance and submission requirements must be verified separately.",
    { bold: true, color: rgb(0.72, 0.19, 0.12), after: 8 },
  );

  heading("Package overview");
  field("Project", project.name);
  field("Address", asObject(pkg.project_address).formatted);
  field("Provider", record?.utility_providers?.name ?? application.provider_slug);
  field("Utility type", record?.utility_type);
  field("Package status", pkg.package_status);
  field("Review status", review.status);
  field("Built", pkg.built_at);
  field("Checklist/template", pkg.template_id);
  field("Template version", asObject(application.metadata).template_version);
  field("Checklist mode", pkg.checklist_mode);
  field("Summary generated", generatedAt);

  heading("Mapped fields and provenance");
  const fields = Array.isArray(pkg.field_results) ? pkg.field_results : [];
  if (!fields.length) line("No mapped fields recorded.");
  for (const item of fields) {
    line(`${item.label ?? item.key}: ${mappedValue(item.value)}`, { bold: true, after: 0 });
    line(`Status: ${item.status ?? "unknown"} · Source: ${friendlyFieldProvenance(item)}`, {
      indent: 12,
      color: rgb(0.3, 0.34, 0.38),
      after: 3,
    });
  }

  heading("Required documents and signatures");
  const documents = Array.isArray(application.package_documents) ? application.package_documents : [];
  if (!documents.length) line("No required documents recorded.");
  for (const document of documents) {
    line(`${document.label ?? document.key}: ${document.file_name ?? "Not attached"}`, {
      bold: true,
      after: 0,
    });
    line(
      [
        `Status: ${document.status ?? "unknown"}`,
        `Source: ${friendlyDocumentSource(document.source)}`,
        document.signature_required
          ? `Signature: ${document.signature_status ?? "unknown"}${
              document.signature_verified_at ? ` (${document.signature_verified_at})` : ""
            }`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      { indent: 12, color: rgb(0.3, 0.34, 0.38), after: 2 },
    );
    if (document.signature_review_note) {
      line(`Signature note: ${document.signature_review_note}`, { indent: 12, after: 2 });
    }
  }

  heading("Review and correction audit");
  field("Reviewer", review.reviewer_display ?? review.reviewed_by_user_id);
  field("Reviewed at", review.reviewed_at);
  field("Confirmed requirements", `${review.confirmed_count}/${review.total_count}`);
  const packageReview = asObject(pkg.package_review);
  if (packageReview.review_notes) field("Review notes", packageReview.review_notes);
  const corrections = Array.isArray(packageReview.correction_history)
    ? packageReview.correction_history
    : [];
  const itemNotes = Array.isArray(review.items)
    ? review.items.filter((item) => item.note)
    : [];
  if (!corrections.length && !itemNotes.length) line("No correction notes recorded.");
  for (const correction of corrections) {
    line(
      `${correction.at ?? "Unknown time"} · ${correction.reason ?? correction.note ?? "Correction requested"}`,
    );
  }
  for (const item of itemNotes) {
    line(`${item.kind}:${item.key} · ${item.status} · ${item.note}`);
  }

  heading("Reviewed snapshot");
  if (review.reviewed_snapshot) {
    field("Snapshot version", review.reviewed_snapshot.snapshot_version);
    field("Captured at", review.reviewed_snapshot.captured_at);
    field("Checklist version", review.reviewed_snapshot.checklist_version);
    field("Package review version", review.reviewed_snapshot.package_review_version);
  } else {
    line("No immutable reviewed snapshot exists. This package is not finally reviewed.");
  }

  heading("Artifact handling");
  line(
    "Original mapped source files are not merged, flattened, modified, or re-saved by this export. The Complete ZIP contains byte-for-byte downloaded originals under their original filenames.",
  );
  line("Structured JSON is an internal audit artifact and is not utility-submittable.");

  pdf.setTitle(`Application Package Summary — ${project.name ?? application.id}`);
  pdf.setSubject("Application Builder package summary and provenance");
  pdf.setProducer("PermitPilot UCI Application Builder");
  pdf.setCreationDate(new Date(generatedAt));
  return Buffer.from(await pdf.save());
}

function safeOriginalName(value, fallback) {
  const base = path.basename(String(value || fallback || "document.bin").replace(/\\/g, "/"));
  return base.replace(/[\u0000-\u001f]/g, "_") || String(fallback || "document.bin");
}

function safeSlotName(value, index) {
  return String(value || `document-${index + 1}`)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "") || `document-${index + 1}`;
}

async function downloadStorageBuffer(supabase, bucket, storagePath) {
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error || !data) {
    throw Object.assign(new Error(error?.message || "Mapped source document could not be downloaded"), {
      statusCode: 409,
      code: "PACKAGE_SOURCE_DOCUMENT_UNAVAILABLE",
    });
  }
  return Buffer.from(await data.arrayBuffer());
}

async function resolveMappedOriginals(supabase, context) {
  const { application, record } = context;
  const documents = (Array.isArray(application.package_documents) ? application.package_documents : []).filter(
    (document) => document && document.status === "attached",
  );
  const resolved = [];
  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    let buffer;
    let sourceReference;
    let originalName = safeOriginalName(document.file_name, `${document.key || "document"}.bin`);
    if (document.source === "project_documents") {
      const documentId = String(document.project_document_id ?? "").trim();
      if (!documentId) {
        throw Object.assign(new Error(`Mapped project document is missing an ID: ${document.key}`), {
          statusCode: 409,
          code: "PACKAGE_SOURCE_DOCUMENT_INVALID",
        });
      }
      const { data: projectDocument, error } = await supabase
        .from("project_documents")
        .select("id, project_id, file_name, file_path, file_type, file_size, created_at")
        .eq("id", documentId)
        .eq("project_id", String(application.project_id))
        .maybeSingle();
      if (error || !projectDocument) {
        throw Object.assign(new Error(error?.message || `Mapped project document not found: ${document.key}`), {
          statusCode: 409,
          code: "PACKAGE_SOURCE_DOCUMENT_UNAVAILABLE",
        });
      }
      originalName = safeOriginalName(projectDocument.file_name, originalName);
      buffer = await downloadStorageBuffer(
        supabase,
        UCI_DOCUMENTS_STORAGE_BUCKET,
        String(projectDocument.file_path),
      );
      sourceReference = {
        source: "project_documents",
        project_document_id: projectDocument.id,
        storage_bucket: UCI_DOCUMENTS_STORAGE_BUCKET,
        storage_path: projectDocument.file_path,
      };
    } else if (document.source === "pepco_portal") {
      const bucket = String(document.storage_bucket ?? UCI_DOCUMENTS_STORAGE_BUCKET);
      const storagePath = String(document.storage_path ?? "").trim();
      if (
        bucket !== UCI_DOCUMENTS_STORAGE_BUCKET ||
        !storagePath ||
        String(document.coordination_record_id ?? application.coordination_record_id) !==
          String(application.coordination_record_id) ||
        (record?.project_id && String(record.project_id) !== String(application.project_id))
      ) {
        throw Object.assign(new Error(`Mapped portal document storage is invalid: ${document.key}`), {
          statusCode: 409,
          code: "PACKAGE_SOURCE_DOCUMENT_INVALID",
        });
      }
      buffer = await downloadStorageBuffer(supabase, bucket, storagePath);
      sourceReference = {
        source: "pepco_portal",
        storage_bucket: bucket,
        storage_path: storagePath,
        external_application_id: document.external_application_id ?? null,
      };
    } else {
      throw Object.assign(new Error(`Unsupported mapped document source: ${document.source || "unknown"}`), {
        statusCode: 409,
        code: "PACKAGE_SOURCE_DOCUMENT_UNSUPPORTED",
      });
    }
    resolved.push({
      key: String(document.key ?? `document-${index + 1}`),
      label: document.label ?? null,
      original_file_name: originalName,
      archive_path: `source-documents/${safeSlotName(document.key, index)}/${originalName}`,
      size_bytes: buffer.length,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      signature_required: document.signature_required === true,
      signature_status: document.signature_status ?? null,
      source_reference: sourceReference,
      buffer,
    });
  }
  return resolved;
}

async function buildCompletePackageZip(supabase, context, generatedAt = new Date().toISOString()) {
  const [summaryPdf, originals] = await Promise.all([
    renderPackageSummaryPdf(context, generatedAt),
    resolveMappedOriginals(supabase, context),
  ]);
  const structured = buildStructuredPackageExport(context, generatedAt);
  const summaryHash = crypto.createHash("sha256").update(summaryPdf).digest("hex");
  const manifest = {
    manifest_version: EXPORT_VERSION,
    generated_at: generatedAt,
    package_application_id: context.application.id,
    label: packageLabel(context.pkg),
    synthetic_test: isSyntheticPackage(context.pkg),
    suitable_for_utility_submission: false,
    submission_readiness: isSyntheticPackage(context.pkg)
      ? "not_suitable_synthetic_test"
      : context.review.status === "reviewed"
        ? "requires_provider_acceptance"
        : "not_finally_reviewed",
    submission_note:
      "This ZIP preserves mapped source-document bytes. Utility acceptance still depends on authoritative provider requirements and delivery rules.",
    originals_preserved: true,
    signed_sources_modified: false,
    summary_pdf: {
      path: "package_summary.pdf",
      size_bytes: summaryPdf.length,
      sha256: summaryHash,
    },
    reviewed_snapshot: structured.package.reviewed_snapshot
      ? {
          snapshot_version: structured.package.reviewed_snapshot.snapshot_version ?? null,
          captured_at: structured.package.reviewed_snapshot.captured_at ?? null,
          reviewer: structured.package.reviewed_snapshot.reviewer ?? null,
          package_review_version:
            structured.package.reviewed_snapshot.package_review_version ?? null,
        }
      : null,
    source_documents: originals.map(({ buffer: _buffer, ...entry }) => entry),
  };
  const zip = new AdmZip();
  zip.addFile("package_summary.pdf", summaryPdf);
  zip.addFile("package_manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  zip.addFile("structured/package_record.json", Buffer.from(`${JSON.stringify(structured, null, 2)}\n`));
  if (structured.package.reviewed_snapshot) {
    zip.addFile(
      "metadata/reviewed_snapshot.json",
      Buffer.from(`${JSON.stringify(structured.package.reviewed_snapshot, null, 2)}\n`),
    );
  }
  for (const original of originals) {
    zip.addFile(original.archive_path, original.buffer);
  }
  return { buffer: zip.toBuffer(), manifest };
}

module.exports = {
  EXPORT_VERSION,
  STRUCTURED_JSON_VERSION,
  packageContext,
  isSyntheticPackage,
  friendlyFieldProvenance,
  buildStructuredPackageExport,
  loadPackageExportContext,
  renderPackageSummaryPdf,
  resolveMappedOriginals,
  buildCompletePackageZip,
};
