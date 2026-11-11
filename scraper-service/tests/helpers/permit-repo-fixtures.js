"use strict";

/**
 * Builds repository batches from the redacted Phase 0 DC fixtures.
 * Four inventory rows have no recorded ProjectID (see inventory.json); they get TEST-ONLY ids in the
 * "test-<permit>" form so all 28 records can be exercised. Production discovery reads the real id.
 */

const path = require("node:path");
const dc = require("../../permit-sync/adapters/dc-projectdox/normalize");
const { buildBatch, buildDiscovery } = require("../../permit-sync/core/ingest");

const FIX = path.join(__dirname, "..", "fixtures", "permit-sync", "dc");
const inventory = require(path.join(FIX, "inventory.json"));
const status = require(path.join(FIX, "workflow-status-resubmit.json"));
const folders = require(path.join(FIX, "project-folders-approved.json"));
const corrections = require(path.join(FIX, "corrections-resubmit.json"));

function inventoryRecords() {
  return inventory.records.map((r) =>
    dc.discoveryRecord({ ...r, projectId: r.projectId === null ? `test-${r.permit}` : r.projectId }),
  );
}

function discovery({ credentialId, runId = null, records = inventoryRecords(), complete = true, expectedTotal = inventory.totalRecords }) {
  return buildDiscovery({ adapterKey: dc.ADAPTER_KEY, credentialId, runId, records, complete, expectedTotal });
}

/** Full Resubmit batch for D2500488 (ProjectID 11854) built from the status + corrections fixtures. */
function resubmitBatch({ credentialId, runId = null, rows = corrections.rows, overrides = {}, capturedAt = "2026-11-05T15:00:00Z" } = {}) {
  const { comments, responses } = dc.reviewItems(rows);
  const sections = {
    status: { status: "ok", sourceKind: "json", fields: dc.statusFields(status), raw: status },
    reviews: {
      status: "ok",
      sourceKind: "html",
      tables: { permit_review_comments: comments, permit_review_responses: responses },
      raw: { rows },
    },
    tasks: {
      status: "ok",
      sourceKind: "json",
      tables: { permit_tasks: dc.taskItems(status.SubWorkflows[0].UncompletedTasks.map((t) => ({ ...t, WFlowInstanceID: 11975 }))) },
    },
    ...overrides,
  };
  return buildBatch({ adapterKey: dc.ADAPTER_KEY, credentialId, runId, capturedAt, portalRecordId: "11854", sections }).batch;
}

/** Files batch for B2407514 (ProjectID 11105): folder metadata + two document versions, downloads not permitted. */
function approvedFilesBatch({ credentialId, accountDownload = false, docs } = {}) {
  const files = {
    15: docs || [
      { FileID: 700101, Version: 1, FileName: "A-101.pdf", FileStatus: "Approved", FileSize: 2048, PageCount: 1, UploadDate: "2025-03-01T10:00:00" },
      { FileID: 700102, Version: 2, FileName: "A-101.pdf", FileStatus: "Approved V2", FileSize: 4096, PageCount: 1, UploadDate: "2025-04-01T10:00:00" },
    ],
  };
  const { folders: fo, documents } = dc.fileItems(folders.folders, files, { accountDownload });
  return buildBatch({
    adapterKey: dc.ADAPTER_KEY,
    credentialId,
    capturedAt: "2026-11-05T15:00:00Z",
    portalRecordId: "11105",
    sections: {
      files: { status: "ok", sourceKind: "json", tables: { permit_document_folders: fo, permit_documents: documents }, raw: folders },
    },
  }).batch;
}

module.exports = { inventory, status, corrections, folders, inventoryRecords, discovery, resubmitBatch, approvedFilesBatch };
