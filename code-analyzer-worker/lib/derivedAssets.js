"use strict";

const { createHash } = require("crypto");

const BUCKET = "project-documents";

function buildDerivedStoragePath(projectId, contentHash, pageNumber, assetType, ext = "png") {
  const safeHash = contentHash.replace(/[^a-f0-9]/gi, "").slice(0, 64) || "unknown";
  return `${projectId}/derived/${safeHash}/p${pageNumber}_${assetType}.${ext}`;
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function upsertDerivedAsset(supabase, params) {
  const storagePath = buildDerivedStoragePath(
    params.projectId,
    params.contentHash,
    params.pageNumber,
    params.assetType,
    params.ext || "png",
  );

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, params.buffer, {
      contentType: params.mimeType || "image/png",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Derived asset upload failed: ${uploadError.message}`);
  }

  const row = {
    project_id: params.projectId,
    document_id: params.documentId,
    page_number: params.pageNumber,
    asset_type: params.assetType,
    content_hash: params.contentHash,
    storage_path: storagePath,
    mime_type: params.mimeType || "image/png",
    width: params.width ?? null,
    height: params.height ?? null,
    byte_size: params.buffer?.length ?? null,
    source_content_hash: params.sourceContentHash ?? null,
    metadata: params.metadata ?? {},
  };

  const { data, error } = await supabase
    .from("code_analyzer_derived_assets")
    .upsert(row, { onConflict: "document_id,page_number,asset_type,content_hash" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

module.exports = { BUCKET, buildDerivedStoragePath, hashBuffer, upsertDerivedAsset };
