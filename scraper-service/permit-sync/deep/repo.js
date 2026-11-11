"use strict";

/**
 * Service-role reads and writes the deep pass needs (supabase-js implementation). Writes go through the
 * capture RPCs of the deep-capture migration; the only direct table reads are SELECTs. Storage uploads go
 * to the private bucket only (D-058).
 */

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { BUCKET } = require("./policy");

const CONTENT_TYPES = { ".pdf": "application/pdf", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".dwg": "application/acad", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".tif": "image/tiff", ".tiff": "image/tiff" };

function contentTypeFor(name) {
  return CONTENT_TYPES[path.extname(String(name || "")).toLowerCase()] || "application/octet-stream";
}

function fileDigest(localPath) {
  const buf = fs.readFileSync(localPath);
  return { buf, sha256: crypto.createHash("sha256").update(buf).digest("hex"), size: buf.length };
}

function supabaseDeepRepo(client) {
  const rows = async (q, what) => {
    const { data, error } = await q;
    if (error) throw new Error(`${what}: ${error.message}`);
    return data || [];
  };
  const rpc = async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };
  return {
    documents: (permitId) => rows(
      client.from("permit_documents").select("id, portal_file_id, file_name, size_bytes, download_permitted, download_status, storage_path, sha256").eq("permit_id", permitId).is("removed_at", null),
      "permit_documents"),
    reports: (permitId) => rows(
      client.from("permit_reports").select("id, report_key, name, content_status").eq("permit_id", permitId).is("removed_at", null),
      "permit_reports"),
    async deepState(permitId) {
      const r = await rows(client.from("permit_deep_state").select("section_hashes").eq("permit_id", permitId).limit(1), "permit_deep_state");
      return r[0] ? r[0].section_hashes : null;
    },
    async links(permitId) {
      const l = await rows(client.from("project_permits").select("project_id").eq("permit_id", permitId), "project_permits");
      if (!l.length) return [];
      const p = await rows(client.from("projects").select("id, user_id, permit_number, portal_data_hash, portal_data->permitRepositorySync").in("id", l.map((x) => x.project_id)), "projects");
      return p.map((x) => ({ projectId: x.id, ownerUserId: x.user_id, permitNumber: x.permit_number, portalDataHash: x.portal_data_hash, syncedHashes: (x.permitRepositorySync && x.permitRepositorySync.section_hashes) || null }));
    },
    async projectHash(projectId) {
      const r = await rows(client.from("projects").select("portal_data_hash").eq("id", projectId).limit(1), "projects");
      return r[0] ? r[0].portal_data_hash : null;
    },
    recordDocument: (a) => rpc("record_permit_document_capture", {
      p_document_id: a.documentId, p_status: a.status, p_storage_path: a.storagePath || null, p_sha256: a.sha256 || null,
      p_size_bytes: a.size ?? null, p_content_type: a.contentType || null, p_error: a.error || null, p_run_id: a.runId || null,
    }),
    recordReport: (permitId, reportKey, content, runId) => rpc("record_permit_report_content", { p_permit_id: permitId, p_report_key: reportKey, p_content: content, p_run_id: runId || null }),
    recordReportFailure: (permitId, reportKey, error) => rpc("record_permit_report_failure", { p_permit_id: permitId, p_report_key: reportKey, p_error: String(error || "failed").slice(0, 300) }),
    recordDeepPass: (permitId, hashes, runId) => rpc("record_permit_deep_pass", { p_permit_id: permitId, p_section_hashes: hashes, p_run_id: runId || null }),
  };
}

/** Private-bucket uploads (service role, upsert: paths are content- or FileID-addressed). Paths come from policy.documentPath / reportPath. */
function supabaseDeepStorage(client, bucket = BUCKET) {
  return {
    /** body = fileDigest(localPath) */
    async put(objectPath, { buf, sha256, size }, contentType) {
      const { error } = await client.storage.from(bucket).upload(objectPath, buf, { contentType, upsert: true });
      if (error) throw new Error(`storage upload: ${error.message}`);
      return { bucket, path: objectPath, sha256, size, contentType };
    },
  };
}

module.exports = { supabaseDeepRepo, supabaseDeepStorage, contentTypeFor, fileDigest };
