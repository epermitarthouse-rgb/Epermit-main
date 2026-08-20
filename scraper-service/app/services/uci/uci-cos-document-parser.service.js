"use strict";

const { LOW_TEXT_OCR_THRESHOLD } = require("./uci-cos-constants.js");

/**
 * Strip HTML to plain text for COS letter parsing.
 * @param {string} htmlOrText
 */
function stripHtmlToText(htmlOrText) {
  const raw = String(htmlOrText || "");
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * @param {Buffer|Uint8Array|string} input
 * @param {{ pdfParse?: Function }} [deps]
 */
async function extractPdfText(input, deps = {}) {
  let buffer = input;
  if (typeof input === "string") {
    buffer = Buffer.from(input, "base64");
  }
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    return { text: "", method: "none", error: "invalid_pdf_input" };
  }

  try {
    const pdfParseModule = deps.pdfParse || require("pdf-parse");
    const pdfParseFn =
      typeof pdfParseModule === "function"
        ? pdfParseModule
        : pdfParseModule?.default || pdfParseModule?.PDFParse;
    if (typeof pdfParseFn !== "function") {
      return { text: "", method: "none", error: "pdf_parse_unavailable" };
    }
    const parsed = await pdfParseFn(Buffer.from(buffer));
    const text = String(parsed?.text || "").trim();
    return {
      text,
      method: "pdf_parse",
      page_count: Number(parsed?.numpages) || null,
      char_count: text.length,
    };
  } catch (err) {
    return {
      text: "",
      method: "none",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * OCR fallback for scanned / low-text PDFs.
 * Uses injected deps.ocrExtract when available; otherwise OpenAI OCR via PDF page render.
 * Marks ocr_required only when no OCR engine is configured or rendering fails.
 *
 * @param {object} params
 * @param {Buffer|Uint8Array} [params.buffer]
 * @param {string} [params.existingText]
 * @param {{ ocrExtract?: Function }} [params.deps]
 */
async function applyOcrFallback(params) {
  const { buffer, existingText = "", deps = {} } = params;
  const textLen = String(existingText || "").trim().length;

  if (textLen >= LOW_TEXT_OCR_THRESHOLD) {
    return {
      used: false,
      required: false,
      text: existingText,
      confidence: 1,
      method: "native_text",
    };
  }

  if (typeof deps.ocrExtract === "function" && buffer) {
    try {
      const ocr = await deps.ocrExtract({ buffer, existingText });
      const ocrText = String(ocr?.text || "").trim();
      const confidence = Number(ocr?.confidence);
      return {
        used: true,
        required: true,
        text: ocrText || existingText,
        confidence: Number.isFinite(confidence) ? confidence : 0.55,
        method: ocr?.method || "ocr",
        low_confidence: !(Number.isFinite(confidence) && confidence >= 0.75),
      };
    } catch (err) {
      return {
        used: false,
        required: true,
        text: existingText,
        confidence: 0.2,
        method: "ocr_failed",
        error: err instanceof Error ? err.message : String(err),
        low_confidence: true,
      };
    }
  }

  if (!deps.ocrExtract && buffer) {
    try {
      const { getDocumentFallbackConfig } = require("./uci-document-fallback-config.service.js");
      const { createOcrPageProcessor } = require("./uci-document-fallback-processors.service.js");
      const { renderPdfPageToPng } = require("./uci-pdf-page-render.service.js");
      const config = getDocumentFallbackConfig(process.env);
      const processor = createOcrPageProcessor(config);
      const rendered = await renderPdfPageToPng(Buffer.from(buffer), 1);
      if (rendered?.pngBuffer) {
        const result = await processor.processPage({
          image_base64: Buffer.from(rendered.pngBuffer).toString("base64"),
          image_mime_type: rendered.mimeType || "image/png",
          page_number: 1,
        });
        const ocrText = String(result?.page_text || "").trim();
        const confidence = Number(result?.average_confidence);
        return {
          used: true,
          required: true,
          text: ocrText || existingText,
          confidence: Number.isFinite(confidence) ? confidence : 0.55,
          method: "openai_ocr",
          low_confidence: !(Number.isFinite(confidence) && confidence >= 0.75),
        };
      }
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
      if (code !== "OCR_DISABLED" && code !== "OCR_NOT_CONFIGURED") {
        return {
          used: false,
          required: true,
          text: existingText,
          confidence: 0.2,
          method: "ocr_failed",
          error: err instanceof Error ? err.message : String(err),
          low_confidence: true,
        };
      }
    }
  }

  return {
    used: false,
    required: true,
    text: existingText,
    confidence: textLen > 0 ? 0.4 : 0.15,
    method: "ocr_required",
    low_confidence: true,
    note: "OCR engine not configured — human review required for scanned COS/design documents",
  };
}

/**
 * Build parseable text from a communication (+ optional attachment buffers).
 *
 * @param {object} params
 * @param {Record<string, unknown>} params.communication
 * @param {Array<{ name?: string, content_type?: string, buffer?: Buffer, base64?: string }>} [params.attachments]
 * @param {Record<string, unknown>} [params.deps]
 */
async function parseCosDesignDocuments(params) {
  const { communication, attachments = [], deps = {} } = params;
  const subject = String(communication.raw_subject || "");
  const bodyHtml = String(communication.raw_body || "");
  const bodyText = stripHtmlToText(bodyHtml);

  /** @type {Array<Record<string, unknown>>} */
  const document_refs = [];
  /** @type {Array<Record<string, unknown>>} */
  const per_document = [];
  /** @type {string[]} */
  const parts = [];

  if (subject) parts.push(`Subject: ${subject}`);
  if (bodyText) {
    parts.push(bodyText);
    const bodyRef = {
      kind: "communication_body",
      communication_id: communication.id ?? null,
      char_count: bodyText.length,
      method: bodyHtml.includes("<") ? "html_strip" : "plain_text",
    };
    document_refs.push(bodyRef);
    per_document.push({ ...bodyRef, text: bodyText });
  }

  const rawAttachments = Array.isArray(communication.raw_attachments)
    ? communication.raw_attachments
    : [];
  const attachmentInputs = attachments.length
    ? attachments
    : rawAttachments.map((a) =>
        a && typeof a === "object" ? /** @type {Record<string, unknown>} */ (a) : {},
      );

  /** @type {Record<string, unknown>} */
  let ocrMeta = { used: false, required: false };

  for (const att of attachmentInputs) {
    const name = String(att.name || att.filename || att.file_name || "attachment");
    const contentType = String(att.content_type || att.mime_type || "").toLowerCase();
    const projectDocumentId = att.project_document_id || null;
    const contentHash = att.content_hash || null;
    const looksPdf =
      contentType.includes("pdf") || /\.pdf$/i.test(name) || Boolean(att.buffer || att.base64);

    if (looksPdf && (att.buffer || att.base64 || att.content_base64)) {
      const input = att.buffer || att.base64 || att.content_base64;
      const pdfResult = await extractPdfText(/** @type {any} */ (input), deps);
      let text = pdfResult.text || "";
      const ocr = await applyOcrFallback({
        buffer: att.buffer
          ? Buffer.from(att.buffer)
          : typeof input === "string"
            ? Buffer.from(input, "base64")
            : undefined,
        existingText: text,
        deps,
      });
      ocrMeta = ocr;
      text = String(ocr.text || text);
      if (text) parts.push(text);
      const ref = {
        kind: "pdf_attachment",
        name,
        content_type: contentType || "application/pdf",
        method: pdfResult.method,
        project_document_id: projectDocumentId,
        content_hash: contentHash,
        ocr: {
          used: ocr.used,
          required: ocr.required,
          method: ocr.method,
          confidence: ocr.confidence,
          low_confidence: ocr.low_confidence === true,
        },
        char_count: text.length,
        page_count: pdfResult.page_count ?? null,
        error: pdfResult.error || ocr.error || null,
      };
      document_refs.push(ref);
      per_document.push({ ...ref, text });
    } else if (att.text || att.extracted_text) {
      const t = String(att.text || att.extracted_text);
      parts.push(t);
      const ref = {
        kind: "text_attachment",
        name,
        method: "provided_text",
        project_document_id: projectDocumentId,
        content_hash: contentHash,
        char_count: t.length,
      };
      document_refs.push(ref);
      per_document.push({ ...ref, text: t });
    } else if (name) {
      document_refs.push({
        kind: "attachment_meta",
        name,
        content_type: contentType || null,
        project_document_id: projectDocumentId,
        content_hash: contentHash,
        method: "metadata_only",
        note: "Attachment content not available for parsing",
      });
      per_document.push({
        kind: "attachment_meta",
        name,
        project_document_id: projectDocumentId,
        content_hash: contentHash,
        text: "",
      });
    }
  }

  const combined = parts.join("\n\n").trim();
  const uncertain =
    combined.length < LOW_TEXT_OCR_THRESHOLD ||
    ocrMeta.low_confidence === true ||
    ocrMeta.required === true;

  return {
    text: combined,
    document_refs,
    per_document,
    parse_meta: {
      char_count: combined.length,
      ocr: ocrMeta,
      uncertain,
      document_count: per_document.filter((d) => String(d.text || "").trim().length > 0).length,
      methods: document_refs.map((d) => d.method).filter(Boolean),
    },
  };
}

module.exports = {
  stripHtmlToText,
  extractPdfText,
  applyOcrFallback,
  parseCosDesignDocuments,
};
