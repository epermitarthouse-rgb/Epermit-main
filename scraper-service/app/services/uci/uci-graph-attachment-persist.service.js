"use strict";

/**
 * Persist Graph inbound email attachments via the existing project-documents pipeline.
 * No parallel storage system — Supabase `project-documents` bucket + `project_documents` rows.
 */

const crypto = require("crypto");
const path = require("path");
const {
  uploadBufferToSupabaseStorage,
  contentTypeFromStoragePath,
} = require("../../../shared/supabase-storage-upload.js");
const { emitUciEvent } = require("./uci-events.service.js");

const UCI_DOCUMENTS_STORAGE_BUCKET = "project-documents";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const SUPPORTED_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/html",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
]);

/**
 * @param {string | null | undefined} name
 * @param {string | null | undefined} contentType
 */
function isSupportedAttachment(name, contentType) {
  const ct = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (ct && SUPPORTED_CONTENT_TYPES.has(ct)) return true;
  const ext = path.extname(String(name || "")).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * @param {Buffer} buffer
 */
function computeContentHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * @param {string} fileName
 */
function sanitizeFileName(fileName) {
  return path
    .basename(String(fileName || "attachment.bin").replace(/[/\\?%*:|"<>]/g, "_"))
    .replace(/\s+/g, "_")
    .slice(0, 180);
}

/**
 * @param {object} opts
 */
function buildInboundStoragePath(opts) {
  const projectId = String(opts.projectId || "").trim();
  const coordinationId = String(opts.coordinationRecordId || "").trim();
  // Prefer short content-hash segments — Graph IDs are huge and brittle in storage keys.
  const hash = String(opts.contentHash || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .slice(0, 40);
  const messageKey = hash
    ? hash.slice(0, 16)
    : String(opts.messageId || "unknown")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 40);
  const attachmentKey = hash
    ? hash.slice(16, 32) || hash.slice(0, 16)
    : String(opts.attachmentId || "att")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 40);
  const safeName = sanitizeFileName(opts.fileName);
  if (!projectId || !coordinationId) return null;
  return ["uci", "inbound-email", projectId, coordinationId, messageKey, `${attachmentKey}_${safeName}`].join(
    "/",
  );
}

/**
 * Download a single Graph file attachment (includes contentBytes when fileAttachment).
 *
 * @param {string} accessToken
 * @param {string} messageId
 * @param {string} attachmentId
 * @param {typeof fetch} [fetchFn]
 */
async function fetchGraphAttachmentBinary(accessToken, messageId, attachmentId, fetchFn = fetch) {
  // Prefer metadata+contentBytes; avoid selecting @odata.type (can 400 on some tenants).
  const metaUrl =
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}` +
    `/attachments/${encodeURIComponent(attachmentId)}` +
    `?$select=id,name,contentType,size,contentBytes`;
  const res = await fetchFn(metaUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  /** @type {Record<string, unknown>} */
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }

  const name = json.name != null ? String(json.name) : "attachment.bin";
  const contentType =
    json.contentType != null
      ? String(json.contentType)
      : contentTypeFromStoragePath(name);
  const contentBytes = json.contentBytes != null ? String(json.contentBytes) : null;

  if (res.ok && contentBytes) {
    const buffer = Buffer.from(contentBytes, "base64");
    return {
      ok: true,
      name,
      contentType,
      size: buffer.length,
      buffer,
      content_hash: computeContentHash(buffer),
      attachment_id: String(json.id || attachmentId),
      odata_type: json["@odata.type"] != null ? String(json["@odata.type"]) : null,
    };
  }

  // Fallback: raw /$value stream (works when contentBytes omitted or select rejected)
  const valueUrl =
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}` +
    `/attachments/${encodeURIComponent(attachmentId)}/$value`;
  const valueRes = await fetchFn(valueUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (valueRes.ok) {
    const ab = await valueRes.arrayBuffer();
    const buffer = Buffer.from(ab);
    return {
      ok: true,
      name,
      contentType: contentType || valueRes.headers.get("content-type") || "application/octet-stream",
      size: buffer.length,
      buffer,
      content_hash: computeContentHash(buffer),
      attachment_id: String(json.id || attachmentId),
      odata_type: null,
      via: "dollar_value",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: `graph_attachment_fetch_${res.status}`,
      json,
      name,
      contentType,
      attachment_id: String(json.id || attachmentId),
    };
  }

  return {
    ok: false,
    status: valueRes.status,
    error: "missing_content_bytes",
    name,
    contentType,
    attachment_id: String(json.id || attachmentId),
  };
}

/**
 * List Graph attachment metadata for a message.
 *
 * @param {string} accessToken
 * @param {string} messageId
 * @param {typeof fetch} [fetchFn]
 */
async function listGraphAttachmentMeta(accessToken, messageId, fetchFn = fetch) {
  const url =
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments` +
    `?$select=id,name,contentType,size`;
  const res = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  /** @type {Record<string, unknown>} */
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    return { ok: false, status: res.status, attachments: [], error: text.slice(0, 300) };
  }
  const values = Array.isArray(json.value) ? json.value : [];
  return {
    ok: true,
    attachments: values.map((a) => ({
      id: a.id != null ? String(a.id) : null,
      name: a.name != null ? String(a.name) : null,
      contentType: a.contentType != null ? String(a.contentType) : null,
      size: a.size != null ? Number(a.size) : null,
      odata_type: a["@odata.type"] != null ? String(a["@odata.type"]) : null,
    })),
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function findExistingByGraphAttachmentId(supabase, params) {
  const { projectId, graphAttachmentId } = params;
  if (!graphAttachmentId) return null;
  const marker = `graph_attachment_id=${graphAttachmentId}`;
  const { data } = await supabase
    .from("project_documents")
    .select("*")
    .eq("project_id", projectId)
    .ilike("description", `%${marker}%`)
    .order("created_at", { ascending: false })
    .limit(1);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function findExistingByContentHash(supabase, params) {
  const { projectId, contentHash } = params;
  if (!contentHash) return null;
  const marker = `content_hash=${contentHash}`;
  const { data } = await supabase
    .from("project_documents")
    .select("*")
    .eq("project_id", projectId)
    .ilike("description", `%${marker}%`)
    .order("created_at", { ascending: false })
    .limit(1);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

/**
 * Persist one attachment buffer into project_documents (idempotent).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function persistAttachmentBuffer(supabase, params) {
  const {
    projectId,
    coordinationRecordId,
    mailboxUserId,
    messageId,
    attachmentId,
    fileName,
    contentType,
    buffer,
    contentHash,
    internetMessageId = null,
    conversationId = null,
    sender = null,
    receivedAt = null,
    synthetic = false,
  } = params;

  const existingByAtt = await findExistingByGraphAttachmentId(supabase, {
    projectId,
    graphAttachmentId: attachmentId,
  });
  if (existingByAtt) {
    return {
      persisted: false,
      deduped: true,
      reason: "graph_attachment_id",
      project_document: existingByAtt,
    };
  }

  const existingByHash = await findExistingByContentHash(supabase, {
    projectId,
    contentHash,
  });
  if (existingByHash) {
    return {
      persisted: false,
      deduped: true,
      reason: "content_hash",
      project_document: existingByHash,
    };
  }

  const storagePath = buildInboundStoragePath({
    projectId,
    coordinationRecordId,
    messageId,
    attachmentId,
    fileName,
    contentHash,
  });
  if (!storagePath) {
    return {
      persisted: false,
      deduped: false,
      reason: "invalid_storage_path",
      project_document: null,
    };
  }

  const resolvedType = (() => {
    const fromName = contentTypeFromStoragePath(fileName);
    const incoming = String(contentType || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (incoming && incoming !== "application/octet-stream") return contentType;
    if (fromName && fromName !== "application/octet-stream") return fromName;
    return incoming || "application/pdf";
  })();
  const uploadFn =
    typeof params.uploadBufferFn === "function"
      ? params.uploadBufferFn
      : uploadBufferToSupabaseStorage;
  const upload = await uploadFn({
    supabase,
    bucket: UCI_DOCUMENTS_STORAGE_BUCKET,
    storagePath,
    body: buffer,
    contentType: resolvedType,
    // Idempotent retries after partial failures must not 409 on existing objects.
    upsert: true,
  });

  if (!upload.ok) {
    // Race: object may already exist from concurrent poll
    if (/already exists|Duplicate|409/i.test(String(upload.errorMessage || ""))) {
      const raced = await findExistingByGraphAttachmentId(supabase, {
        projectId,
        graphAttachmentId: attachmentId,
      });
      if (raced) {
        return {
          persisted: false,
          deduped: true,
          reason: "storage_race",
          project_document: raced,
        };
      }
    }
    return {
      persisted: false,
      deduped: false,
      reason: "storage_upload_failed",
      error: upload.errorMessage || upload.errorCode,
      project_document: null,
    };
  }

  const description = [
    "UCI Stage 6 COS/design email attachment",
    synthetic ? "SYNTHETIC TEST — NOT A REAL UTILITY DOCUMENT" : null,
    `coordination_record_id=${coordinationRecordId}`,
    `graph_message_id=${messageId}`,
    internetMessageId ? `internet_message_id=${internetMessageId}` : null,
    conversationId ? `conversation_id=${conversationId}` : null,
    `graph_attachment_id=${attachmentId}`,
    `content_hash=${contentHash}`,
    sender ? `sender=${sender}` : null,
    receivedAt ? `received_at=${receivedAt}` : null,
    "evidence_role=class_of_service_or_design_review",
  ]
    .filter(Boolean)
    .join(" · ");

  const { data: doc, error } = await supabase
    .from("project_documents")
    .insert({
      project_id: projectId,
      user_id: mailboxUserId || null,
      file_name: sanitizeFileName(fileName),
      file_path: storagePath,
      file_size: buffer.length,
      file_type: resolvedType,
      document_type: "correspondence",
      version: 1,
      parent_document_id: null,
      description,
    })
    .select("*")
    .single();

  if (error) {
    return {
      persisted: false,
      deduped: false,
      reason: "project_documents_insert_failed",
      error: error.message,
      project_document: null,
    };
  }

  return {
    persisted: true,
    deduped: false,
    reason: "uploaded",
    project_document: doc,
  };
}

/**
 * Fetch + persist all Graph attachments for a matched communication.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function persistGraphAttachmentsForCommunication(supabase, params) {
  const {
    accessToken,
    communication,
    coordinationRecordId,
    projectId,
    mailboxUserId = null,
    normalized = {},
    fetchFn = fetch,
    deps = {},
  } = params;

  const messageId = String(
    communication.external_message_id || normalized.external_message_id || "",
  ).trim();
  if (!accessToken || !messageId) {
    return {
      ok: false,
      reason: "missing_token_or_message_id",
      attachments: [],
      unsupported: [],
      needs_human_attention: false,
    };
  }

  let metaList = Array.isArray(normalized.raw_attachments)
    ? normalized.raw_attachments.filter((a) => a && a.id)
    : Array.isArray(communication.raw_attachments)
      ? communication.raw_attachments.filter((a) => a && a.id)
      : [];

  const metaLooksDegraded =
    metaList.length === 0 ||
    metaList.some((a) => {
      const n = String(a.name || "");
      const ct = String(a.contentType || a.content_type || "");
      return (
        !n ||
        /^attachment(\.bin)?$/i.test(n) ||
        a.fetch_failed === true ||
        a.persisted === false ||
        (!a.project_document_id && a.unsupported !== true) ||
        (ct === "application/octet-stream" && !/\.(pdf|docx?|png|jpe?g|html?|txt)$/i.test(n))
      );
    });

  if (metaLooksDegraded) {
    const listed = await listGraphAttachmentMeta(accessToken, messageId, fetchFn);
    if (listed.ok && listed.attachments.length) {
      metaList = listed.attachments.filter((a) => a.id);
    }
  } else if (metaList.length === 0) {
    const listed = await listGraphAttachmentMeta(accessToken, messageId, fetchFn);
    if (listed.ok) metaList = listed.attachments.filter((a) => a.id);
  }

  if (metaList.length === 0) {
    return {
      ok: true,
      reason: "no_attachments",
      attachments: [],
      unsupported: [],
      needs_human_attention: false,
    };
  }

  /** @type {Array<Record<string, unknown>>} */
  const enriched = [];
  /** @type {Array<Record<string, unknown>>} */
  const unsupported = [];
  /** @type {Array<Record<string, unknown>>} */
  const buffersForParser = [];
  let needsHumanAttention = false;

  for (const meta of metaList) {
    const attachmentId = String(meta.id);
    const name = String(meta.name || "attachment.bin");
    const contentType = meta.contentType != null ? String(meta.contentType) : null;

    if (!isSupportedAttachment(name, contentType)) {
      const row = {
        id: attachmentId,
        name,
        contentType,
        size: meta.size ?? null,
        supported: false,
        unsupported: true,
        needs_human_attention: true,
        reason: "unsupported_attachment_type",
      };
      unsupported.push(row);
      enriched.push(row);
      needsHumanAttention = true;
      continue;
    }

    const downloaded =
      typeof deps.fetchAttachmentBinary === "function"
        ? await deps.fetchAttachmentBinary({
            accessToken,
            messageId,
            attachmentId,
            meta,
          })
        : await fetchGraphAttachmentBinary(accessToken, messageId, attachmentId, fetchFn);

    if (!downloaded.ok || !downloaded.buffer) {
      const row = {
        id: attachmentId,
        name: downloaded.name || name,
        contentType: downloaded.contentType || contentType,
        size: meta.size ?? null,
        supported: true,
        fetch_failed: true,
        error: downloaded.error || "download_failed",
        needs_human_attention: true,
      };
      enriched.push(row);
      needsHumanAttention = true;
      continue;
    }

    const preferredName =
      (downloaded.name &&
      downloaded.name !== "attachment.bin" &&
      !/^attachment\./i.test(String(downloaded.name))
        ? downloaded.name
        : null) ||
      name;
    const preferredType =
      (downloaded.contentType &&
      downloaded.contentType !== "application/octet-stream"
        ? downloaded.contentType
        : null) ||
      contentType ||
      contentTypeFromStoragePath(preferredName) ||
      "application/pdf";

    const persist = await persistAttachmentBuffer(supabase, {
      projectId,
      coordinationRecordId,
      mailboxUserId,
      messageId,
      attachmentId,
      fileName: preferredName,
      contentType: preferredType,
      buffer: downloaded.buffer,
      contentHash: downloaded.content_hash || computeContentHash(downloaded.buffer),
      internetMessageId: normalized.internet_message_id || null,
      conversationId: normalized.conversation_id || communication.thread_id || null,
      sender: normalized.sender || communication.sender || null,
      receivedAt: normalized.message_timestamp || communication.message_timestamp || null,
      synthetic:
        /SYNTHETIC\s+TEST/i.test(String(normalized.raw_subject || "")) ||
        /SYNTHETIC\s+TEST/i.test(String(normalized.raw_body || "")) ||
        /SYNTHETIC/i.test(String(preferredName)),
      uploadBufferFn: deps.uploadBufferFn,
    });

    if (persist.project_document?.id && coordinationRecordId) {
      try {
        const {
          classifyDocumentUtilityScope,
          shouldAutoIncludeDocument,
          linkProjectDocumentsToCoordination,
        } = require("./uci-coordination-document-links.service.js");
        const { getCoordinationRecordById } = require("./uci-records.service.js");
        const record = await getCoordinationRecordById(supabase, coordinationRecordId);
        if (record) {
          const classification = classifyDocumentUtilityScope(persist.project_document);
          const included = shouldAutoIncludeDocument({
            classification,
            recordUtilityType: record.utility_type,
            uploadedToRecord: false,
            inboundMatched: true,
          });
          await linkProjectDocumentsToCoordination(supabase, {
            coordinationRecordId,
            userId: mailboxUserId || null,
            projectDocumentIds: [String(persist.project_document.id)],
            includedInAnalysis: included,
            linkOrigin: "inbound",
            inbound: true,
          });
        }
      } catch {
        // Inbound persistence must not fail the Graph attachment write.
      }
    }

    const projectDoc = persist.project_document;
    const row = {
      id: attachmentId,
      name: preferredName,
      contentType: preferredType,
      size: downloaded.size ?? downloaded.buffer.length,
      supported: true,
      content_hash: downloaded.content_hash || computeContentHash(downloaded.buffer),
      project_document_id: projectDoc?.id ?? null,
      storage_path: projectDoc?.file_path ?? null,
      persisted: Boolean(persist.persisted || persist.deduped),
      deduped: Boolean(persist.deduped),
      dedupe_reason: persist.reason,
      persist_error: persist.error || null,
      evidence_role: "class_of_service_or_design_review",
    };
    enriched.push(row);

    if (projectDoc?.id && downloaded.buffer) {
      buffersForParser.push({
        name: preferredName,
        content_type: preferredType,
        buffer: downloaded.buffer,
        project_document_id: projectDoc.id,
        graph_attachment_id: attachmentId,
        content_hash: row.content_hash,
      });
    }
  }

  // Update communication raw_attachments + metadata
  const prevMeta =
    communication.agent_processed_metadata &&
    typeof communication.agent_processed_metadata === "object" &&
    !Array.isArray(communication.agent_processed_metadata)
      ? /** @type {Record<string, unknown>} */ (communication.agent_processed_metadata)
      : {};

  const { data: updated, error } = await supabase
    .from("coordination_communications")
    .update({
      raw_attachments: enriched,
      needs_human_attention:
        communication.needs_human_attention === true || needsHumanAttention
          ? true
          : communication.needs_human_attention,
      agent_processed_metadata: {
        ...prevMeta,
        graph_attachments: {
          processed_at: new Date().toISOString(),
          count: enriched.length,
          persisted_count: enriched.filter((a) => a.persisted).length,
          unsupported_count: unsupported.length,
          message_id: messageId,
        },
      },
    })
    .eq("id", String(communication.id))
    .select("*")
    .single();

  if (error) {
    return {
      ok: false,
      reason: "communication_update_failed",
      error: error.message,
      attachments: enriched,
      unsupported,
      parser_buffers: buffersForParser,
      needs_human_attention: needsHumanAttention,
      communication,
    };
  }

  emitUciEvent(
    "uci.communication.attachments_persisted",
    {
      communication_id: communication.id,
      coordination_record_id: coordinationRecordId,
      project_id: projectId,
      attachment_count: enriched.length,
      unsupported_count: unsupported.length,
      graph_message_id: messageId,
    },
    { supabase },
  );

  return {
    ok: true,
    reason: "processed",
    attachments: enriched,
    unsupported,
    parser_buffers: buffersForParser,
    needs_human_attention: needsHumanAttention,
    communication: updated || communication,
  };
}

/**
 * Resolve attachment buffers for Stage 6 parse from communication links.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} communication
 */
async function resolveCommunicationAttachmentBuffers(supabase, communication) {
  const raw = Array.isArray(communication.raw_attachments)
    ? communication.raw_attachments
    : [];
  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (const att of raw) {
    if (!att || typeof att !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (att);
    if (row.buffer || row.content_base64 || row.base64) {
      out.push({
        name: row.name || row.filename || row.file_name,
        content_type: row.contentType || row.content_type,
        buffer: row.buffer,
        base64: row.content_base64 || row.base64,
        project_document_id: row.project_document_id,
      });
      continue;
    }
    const docId = row.project_document_id ? String(row.project_document_id) : "";
    if (!docId) continue;

    const resolved = await resolveProjectDocumentBuffers(supabase, {
      projectId: communication.project_id ? String(communication.project_id) : null,
      projectDocumentIds: [docId],
    });
    out.push(...resolved);
  }

  return out;
}

/**
 * Load project_documents rows from storage for Stage 6 parse (upload / select-existing).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 * @param {string | null} [params.projectId]
 * @param {string[]} params.projectDocumentIds
 */
async function resolveProjectDocumentBuffers(supabase, params) {
  const ids = Array.isArray(params.projectDocumentIds)
    ? params.projectDocumentIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (!ids.length) return [];

  let query = supabase
    .from("project_documents")
    .select("id, file_name, file_path, file_type, project_id, description")
    .in("id", ids);
  if (params.projectId) {
    query = query.eq("project_id", String(params.projectId));
  }
  const { data: docs, error } = await query;
  if (error || !Array.isArray(docs)) return [];

  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const doc of docs) {
    if (!doc?.file_path) continue;
    const { data: blob, error: dlErr } = await supabase.storage
      .from(UCI_DOCUMENTS_STORAGE_BUCKET)
      .download(String(doc.file_path));
    if (dlErr || !blob) continue;
    const buffer = Buffer.from(await blob.arrayBuffer());
    out.push({
      name: doc.file_name,
      content_type: doc.file_type || contentTypeFromStoragePath(String(doc.file_name || "")),
      buffer,
      project_document_id: doc.id,
      content_hash: computeContentHash(buffer),
      description: doc.description || null,
    });
  }
  return out;
}

module.exports = {
  UCI_DOCUMENTS_STORAGE_BUCKET,
  SUPPORTED_CONTENT_TYPES,
  isSupportedAttachment,
  computeContentHash,
  fetchGraphAttachmentBinary,
  listGraphAttachmentMeta,
  persistAttachmentBuffer,
  persistGraphAttachmentsForCommunication,
  resolveCommunicationAttachmentBuffers,
  resolveProjectDocumentBuffers,
  buildInboundStoragePath,
};
