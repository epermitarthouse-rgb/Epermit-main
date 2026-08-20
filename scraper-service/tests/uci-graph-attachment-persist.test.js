"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  isSupportedAttachment,
  computeContentHash,
  persistAttachmentBuffer,
  persistGraphAttachmentsForCommunication,
  buildInboundStoragePath,
} = require("../app/services/uci/uci-graph-attachment-persist.service.js");
const {
  clearRecentUciEventsForTests,
} = require("../app/services/uci/uci-events.service.js");

beforeEach(() => clearRecentUciEventsForTests());

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createMockSupabase(tables) {
  return {
    storage: {
      from() {
        return {
          download: async () => ({ data: null, error: { message: "not found" } }),
        };
      },
    },
    from(table) {
      const store = tables[table] || (tables[table] = []);
      /** @type {Array<{ type: string, column: string, value?: unknown }>} */
      const filters = [];
      const state = {
        mode: "select",
        updatePatch: null,
        insertRow: null,
        orderCol: null,
        limitN: null,
        ilikeCol: null,
        ilikePat: null,
      };

      const matches = (row) =>
        filters.every((f) => {
          if (f.type === "eq") return String(row[f.column]) === String(f.value);
          if (f.type === "ilike") {
            const raw = String(row[f.column] || "").toLowerCase();
            const pat = String(f.value || "")
              .toLowerCase()
              .replace(/%/g, "");
            return raw.includes(pat);
          }
          return true;
        });

      const api = {
        select() {
          if (state.mode !== "insert" && state.mode !== "update") {
            state.mode = "select";
          }
          return api;
        },
        insert(row) {
          state.mode = "insert";
          state.insertRow = row;
          return api;
        },
        update(patch) {
          state.mode = "update";
          state.updatePatch = patch;
          return api;
        },
        eq(column, value) {
          filters.push({ type: "eq", column, value });
          return api;
        },
        ilike(column, value) {
          filters.push({ type: "ilike", column, value });
          return api;
        },
        order(col) {
          state.orderCol = col;
          return api;
        },
        limit(n) {
          state.limitN = n;
          return api;
        },
        maybeSingle: async () => {
          const rows = store.filter(matches);
          return { data: rows[0] || null, error: null };
        },
        single: async () => {
          if (state.mode === "insert") {
            const row = {
              id: `doc-${store.length + 1}`,
              created_at: new Date().toISOString(),
              ...state.insertRow,
            };
            store.push(row);
            return { data: row, error: null };
          }
          if (state.mode === "update") {
            const idx = store.findIndex(matches);
            if (idx < 0) return { data: null, error: { message: "not found" } };
            store[idx] = { ...store[idx], ...state.updatePatch };
            return { data: store[idx], error: null };
          }
          const rows = store.filter(matches);
          return { data: rows[0] || null, error: rows[0] ? null : { message: "not found" } };
        },
        then(resolve) {
          let rows = store.filter(matches);
          if (state.limitN != null) rows = rows.slice(0, state.limitN);
          return Promise.resolve(resolve({ data: rows, error: null }));
        },
      };
      return api;
    },
  };
}

describe("uci-graph-attachment-persist", () => {
  it("supports PDF and rejects unsupported types", () => {
    assert.equal(isSupportedAttachment("cos.pdf", "application/pdf"), true);
    assert.equal(isSupportedAttachment("scan.PNG", "image/png"), true);
    assert.equal(isSupportedAttachment("virus.exe", "application/octet-stream"), false);
    assert.equal(isSupportedAttachment("archive.zip", "application/zip"), false);
  });

  it("builds inbound storage paths under uci/inbound-email", () => {
    const p = buildInboundStoragePath({
      projectId: "proj-1",
      coordinationRecordId: "coord-1",
      messageId: "msg/abc",
      attachmentId: "att-1",
      fileName: "01_Synthetic_COS_Matching.pdf",
    });
    assert.match(String(p), /^uci\/inbound-email\/proj-1\/coord-1\//);
    assert.match(String(p), /01_Synthetic_COS_Matching\.pdf$/);
  });

  it("dedupes by graph_attachment_id and content_hash", async () => {
    const buffer = Buffer.from("%PDF-1.4 synthetic matching cos");
    const hash = computeContentHash(buffer);
    const tables = {
      project_documents: [
        {
          id: "existing-1",
          project_id: "proj-1",
          file_name: "01_Synthetic_COS_Matching.pdf",
          file_path: "uci/inbound-email/proj-1/coord-1/m/a_file.pdf",
          description: `graph_attachment_id=att-dup · content_hash=${hash}`,
        },
      ],
    };
    const supabase = createMockSupabase(tables);

    const byId = await persistAttachmentBuffer(supabase, {
      projectId: "proj-1",
      coordinationRecordId: "coord-1",
      mailboxUserId: "user-1",
      messageId: "msg-1",
      attachmentId: "att-dup",
      fileName: "01_Synthetic_COS_Matching.pdf",
      contentType: "application/pdf",
      buffer,
      contentHash: hash,
      synthetic: true,
    });
    assert.equal(byId.deduped, true);
    assert.equal(byId.reason, "graph_attachment_id");
    assert.equal(byId.project_document.id, "existing-1");

    const byHash = await persistAttachmentBuffer(supabase, {
      projectId: "proj-1",
      coordinationRecordId: "coord-1",
      mailboxUserId: "user-1",
      messageId: "msg-2",
      attachmentId: "att-new",
      fileName: "copy.pdf",
      contentType: "application/pdf",
      buffer,
      contentHash: hash,
      synthetic: true,
    });
    assert.equal(byHash.deduped, true);
    assert.equal(byHash.reason, "content_hash");
  });

  it("flags unsupported attachments for Needs Attention without silent drop", async () => {
    const tables = {
      coordination_communications: [
        {
          id: "comm-1",
          external_message_id: "graph-msg-1",
          raw_attachments: [],
          needs_human_attention: false,
          agent_processed_metadata: {},
        },
      ],
      project_documents: [],
    };
    const supabase = createMockSupabase(tables);

    const result = await persistGraphAttachmentsForCommunication(supabase, {
      accessToken: "tok",
      communication: tables.coordination_communications[0],
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      mailboxUserId: "user-1",
      normalized: {
        external_message_id: "graph-msg-1",
        raw_subject: "Highland Springs SYNTHETIC TEST",
        raw_attachments: [
          { id: "att-zip", name: "notes.zip", contentType: "application/zip", size: 12 },
          { id: "att-pdf", name: "cos.pdf", contentType: "application/pdf", size: 20 },
        ],
      },
      deps: {
        uploadBufferFn: async () => ({ ok: true }),
        fetchAttachmentBinary: async ({ attachmentId }) => {
          if (attachmentId === "att-pdf") {
            const buffer = Buffer.from("%PDF synthetic");
            return {
              ok: true,
              name: "cos.pdf",
              contentType: "application/pdf",
              buffer,
              content_hash: computeContentHash(buffer),
              size: buffer.length,
              attachment_id: attachmentId,
            };
          }
          return { ok: false, error: "should_not_download_zip" };
        },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.unsupported.length, 1);
    assert.equal(result.unsupported[0].reason, "unsupported_attachment_type");
    assert.equal(result.needs_human_attention, true);
    assert.ok(result.attachments.some((a) => a.unsupported === true));
    assert.ok(result.attachments.some((a) => a.project_document_id));
    assert.equal(tables.project_documents.length, 1);
  });
});
