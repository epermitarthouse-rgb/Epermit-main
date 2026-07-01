"use strict";

const express = require("express");
const {
  requireAuthenticatedUser,
  requireProjectAccess,
} = require("../services/uci/uci-access.service.js");
const {
  convertLegacyDocBuffer,
  isLegacyDocFileName,
  isManualCommentLetterDocument,
  MAX_CONVERT_BYTES,
} = require("../services/documents/legacy-word-convert.service.js");

const BUCKET = "project-documents";

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabaseAdmin
 */
function createDocumentsRouter(supabaseAdmin) {
  const router = express.Router();

  router.post("/convert-legacy-word", async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req, supabaseAdmin);
      const { projectId, sourceDocumentId } = req.body ?? {};

      if (
        !projectId ||
        !sourceDocumentId ||
        typeof projectId !== "string" ||
        typeof sourceDocumentId !== "string"
      ) {
        return res.status(400).json({ error: "projectId and sourceDocumentId are required" });
      }

      await requireProjectAccess({
        supabase: supabaseAdmin,
        userId: user.id,
        projectId,
      });

      const { data: doc, error: docError } = await supabaseAdmin
        .from("project_documents")
        .select("id, project_id, user_id, file_name, file_path, file_type, document_type, description, file_size")
        .eq("id", sourceDocumentId)
        .eq("project_id", projectId)
        .maybeSingle();

      if (docError) {
        console.error("[convert-legacy-word] document lookup failed:", docError.message);
        return res.status(500).json({ error: "Failed to load document" });
      }
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }
      if (!isManualCommentLetterDocument(doc)) {
        return res.status(403).json({ error: "Conversion is limited to Comment Review uploads" });
      }
      if (!isLegacyDocFileName(doc.file_name)) {
        return res.status(400).json({ error: "Document is not a legacy .DOC file" });
      }
      if (typeof doc.file_size === "number" && doc.file_size > MAX_CONVERT_BYTES) {
        return res.status(400).json({ error: "File is too large to convert" });
      }

      const { data: blob, error: downloadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .download(doc.file_path);

      if (downloadError || !blob) {
        console.error("[convert-legacy-word] storage download failed:", downloadError?.message);
        return res.status(500).json({ error: "Failed to download document for conversion" });
      }

      const sourceBuffer = Buffer.from(await blob.arrayBuffer());
      const converted = await convertLegacyDocBuffer({
        buffer: sourceBuffer,
        originalFileName: doc.file_name,
      });

      return res.json({
        originalFileName: doc.file_name,
        convertedFileName: converted.convertedFileName,
        contentType: converted.contentType,
        fileBase64: converted.buffer.toString("base64"),
      });
    } catch (err) {
      const statusCode = err && err.statusCode ? err.statusCode : 500;
      const message =
        statusCode >= 500
          ? "Legacy Word conversion failed"
          : err instanceof Error
            ? err.message
            : "Legacy Word conversion failed";

      if (statusCode >= 500) {
        console.error("[convert-legacy-word] error:", err instanceof Error ? err.message : err);
      }

      return res.status(statusCode).json({ error: message });
    }
  });

  return router;
}

module.exports = { createDocumentsRouter };
