import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { describe, it } from "node:test";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}
import {
  buildPermitDownstreamRows,
  mapPermitDownstreamRows,
  normalizePermitCommentInputPart,
  permitCommentInputHash,
  permitCommentInputMaterial,
} from "./permitDownstreamMatrix";

describe("permit comment input hash", () => {
  it("matches the SQL input: space-only trim, collapsed whitespace, lower-cased labels", async () => {
    const input = {
      body: "  Hello   world\n",
      department: " Zoning ",
      commentType: "Correction",
      jurisdiction: "Washington DC",
    };
    const material = permitCommentInputMaterial(input);
    assert.equal(normalizePermitCommentInputPart(input.body, false), "Hello world ");
    assert.equal(material, ["Hello world ", "zoning", "correction", "washington dc"].join("\u001f"));
    const expected = createHash("sha256").update(material, "utf8").digest("hex");
    assert.equal(await permitCommentInputHash(input), expected);
    assert.equal(normalizePermitCommentInputPart("\tHello", false), " Hello");
  });
});

describe("mapPermitDownstreamRows", () => {
  const hash = "abc123";
  const comments = [
    {
      id: "c-old",
      portal_comment_key: "k-old",
      ref_number: 1,
      cycle: 1,
      department: "Fire",
      comment_type: "Note",
      file_name: "old.pdf",
      reviewed_at: "2026-01-01T00:00:00Z",
      body: "BODY-OLD",
      status: "Resolved",
    },
    {
      id: "c-live",
      portal_comment_key: "k-live",
      ref_number: 4,
      cycle: 2,
      department: "Zoning",
      comment_type: "Correction",
      file_name: "sheet.pdf",
      reviewed_at: "2026-02-02T00:00:00Z",
      body: "BODY-LIVE",
      status: "Unresolved",
    },
    {
      id: "c-gone",
      portal_comment_key: "k-gone",
      ref_number: 9,
      cycle: 2,
      body: "BODY-GONE",
      status: "Unresolved",
      removed_at: "2026-03-01T00:00:00Z",
    },
  ];
  const responses = [
    { id: "r2", comment_key: "k-live", seq: 2, responder_role: "Reviewer", responder_name: "HIDDEN", body: "REPLY-2", removed_at: null },
    { id: "r1", comment_key: "k-live", seq: 1, responder_role: "Applicant", body: "REPLY-1" },
    { id: "r-gone", comment_key: "k-live", seq: 3, body: "REPLY-GONE", removed_at: "2026-03-02T00:00:00Z" },
    { id: "r-other", comment_key: "k-old", seq: 1, body: "REPLY-OLD" },
  ];
  const insights = [
    {
      id: "i-ready",
      comment_id: "c-live",
      input_hash: hash,
      status: "ready",
      is_current: true,
      discipline: "Zoning",
      code_reference: "IBC 101",
      guidance_text: "GUIDE-LIVE",
    },
    {
      id: "i-stale",
      comment_id: "c-old",
      input_hash: "other-hash",
      status: "ready",
      is_current: true,
      discipline: "Electrical",
      code_reference: "NEC 210",
      guidance_text: "GUIDE-STALE",
    },
    {
      id: "i-old-version",
      comment_id: "c-live",
      input_hash: hash,
      status: "ready",
      is_current: false,
      discipline: "Mechanical",
      code_reference: "IMC 1",
      guidance_text: "GUIDE-OLD",
    },
    {
      id: "i-failed",
      comment_id: "c-live",
      input_hash: hash,
      status: "failed",
      is_current: true,
      discipline: "Plumbing",
      code_reference: "IPC 1",
      guidance_text: "GUIDE-FAILED",
    },
  ];

  it("maps the portal thread and only a ready current insight whose hash matches", () => {
    const rows = mapPermitDownstreamRows({
      comments,
      responses,
      insights,
      inputHashes: new Map([
        ["c-live", hash],
        ["c-old", hash],
      ]),
    });
    assert.deepEqual(rows.map((r) => r.id), ["c-live", "c-old"]);
    const live = rows[0];
    assert.equal(live.body, "BODY-LIVE");
    assert.equal(live.status, "Unresolved");
    assert.equal(live.refNumber, "4");
    assert.equal(live.cycle, "2");
    assert.equal(live.department, "Zoning");
    assert.equal(live.commentType, "Correction");
    assert.equal(live.fileName, "sheet.pdf");
    assert.deepEqual(live.responses.map((r) => r.body), ["REPLY-1", "REPLY-2"]);
    assert.equal(live.responses[0].role, "Applicant");
    assert.equal(JSON.stringify(live).includes("HIDDEN"), false);
    assert.equal(live.discipline, "Zoning");
    assert.equal(live.codeReference, "IBC 101");
    assert.equal(live.guidance, "GUIDE-LIVE");
    const stale = rows[1];
    assert.equal(stale.discipline, "");
    assert.equal(stale.codeReference, "");
    assert.equal(stale.guidance, "");
    assert.deepEqual(stale.responses.map((r) => r.body), ["REPLY-OLD"]);
    assert.equal(JSON.stringify(rows).includes("BODY-GONE"), false);
    assert.equal(JSON.stringify(rows).includes("REPLY-GONE"), false);
    assert.equal(JSON.stringify(rows).includes("GUIDE-STALE"), false);
    assert.equal(JSON.stringify(rows).includes("GUIDE-OLD"), false);
    assert.equal(JSON.stringify(rows).includes("GUIDE-FAILED"), false);
  });
});

describe("buildPermitDownstreamRows", () => {
  it("fills insight cells only when the computed hash matches a ready current row", async () => {
    const comment = {
      id: "c1",
      portal_comment_key: "k1",
      body: "BODY-A",
      department: "Zoning",
      comment_type: "Correction",
      status: "Open",
      cycle: 1,
      ref_number: 1,
    };
    const hash = await permitCommentInputHash({
      body: comment.body,
      department: comment.department,
      commentType: comment.comment_type,
      jurisdiction: "Washington DC",
    });
    const rows = await buildPermitDownstreamRows({
      comments: [comment],
      responses: [{ id: "r", comment_key: "k1", seq: 1, body: "REPLY-A" }],
      insights: [
        {
          id: "i",
          comment_id: "c1",
          input_hash: hash,
          status: "ready",
          is_current: true,
          discipline: "Zoning",
          code_reference: "IBC 101",
          guidance_text: "GUIDE-A",
        },
      ],
      jurisdiction: "Washington DC",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "Open");
    assert.equal(rows[0].discipline, "Zoning");
    assert.equal(rows[0].codeReference, "IBC 101");
    assert.equal(rows[0].guidance, "GUIDE-A");
    assert.deepEqual(rows[0].responses.map((r) => r.body), ["REPLY-A"]);

    const mismatched = await buildPermitDownstreamRows({
      comments: [comment],
      responses: [],
      insights: [
        {
          id: "i2",
          comment_id: "c1",
          input_hash: "not-the-hash",
          status: "ready",
          is_current: true,
          discipline: "Electrical",
          code_reference: "NEC",
          guidance_text: "NO",
        },
      ],
      jurisdiction: "Washington DC",
    });
    assert.equal(mismatched[0].discipline, "");
    assert.equal(mismatched[0].codeReference, "");
    assert.equal(mismatched[0].guidance, "");
  });
});
