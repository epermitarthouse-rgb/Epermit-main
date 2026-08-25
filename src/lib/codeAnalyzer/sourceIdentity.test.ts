import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildExistingSourceIdentityIndex,
  computeSourceFileSha256,
  dedupeSheetsBySourcePage,
  existingSheetKeys,
  resolveExistingSourceDocumentId,
  sourceMetadataIdentityKey,
} from "./sourceIdentity.ts";

describe("sourceIdentity", () => {
  it("computes stable SHA-256 for identical file bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const a = new Blob([bytes], { type: "application/pdf" });
    const b = new Blob([bytes], { type: "application/pdf" });
    const hashA = await computeSourceFileSha256(a);
    const hashB = await computeSourceFileSha256(b);
    assert.equal(hashA, hashB);
    assert.match(hashA, /^[a-f0-9]{64}$/);
  });

  it("matches existing source by content hash before metadata fallback", () => {
    const index = buildExistingSourceIdentityIndex([
      {
        id: "src-1",
        file_name: "1513_P_St_MOCK_Conflict_Occupant_Load.pdf",
        file_size: 1200,
        contentSha256: "abc123",
      },
    ]);
    assert.equal(
      resolveExistingSourceDocumentId(index, {
        contentSha256: "abc123",
        fileName: "renamed.pdf",
        fileSize: 9999,
      }),
      "src-1",
    );
  });

  it("falls back to normalized filename + size when hash is unavailable", () => {
    const index = buildExistingSourceIdentityIndex([
      {
        id: "src-conflict",
        file_name: "1513_P_St_MOCK_Conflict_Occupant_Load.pdf",
        file_size: 1200,
      },
    ]);
    const metaKey = sourceMetadataIdentityKey(
      "1513_P_St_MOCK_Conflict_Occupant_Load.pdf",
      1200,
    );
    assert.equal(metaKey, "1200:1513_p_st_mock_conflict_occupant_load.pdf");
    assert.equal(
      resolveExistingSourceDocumentId(index, {
        contentSha256: "different-bytes",
        fileName: "1513_P_St_MOCK_Conflict_Occupant_Load.pdf",
        fileSize: 1200,
      }),
      "src-conflict",
    );
  });

  it("dedupes sheets by source document page", () => {
    const sheets = [
      { id: "a", source_document_id: "dup", page_number: 1 },
      { id: "b", source_document_id: "dup", page_number: 1 },
      { id: "c", source_document_id: "dup", page_number: 2 },
    ];
    assert.deepEqual(
      dedupeSheetsBySourcePage(sheets).map((s) => s.id),
      ["a", "c"],
    );
  });

  it("tracks existing sheet keys for skip-on-insert", () => {
    const keys = existingSheetKeys([
      { source_document_id: "src-1", page_number: 1 },
      { source_document_id: "src-1", page_number: 2 },
    ]);
    assert.equal(keys.has("src-1:1"), true);
    assert.equal(keys.has("src-1:2"), true);
    assert.equal(keys.has("src-1:3"), false);
  });
});
