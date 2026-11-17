import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planPortalCommentRefresh, portalCommentKey, type PortalCommentRow } from "./portalCommentRefresh.ts";

/** The persisted shape (formatPgcDeterministicPersistedComment): a `ref: N` header line, then the fields. */
const persisted = (ref: number, discussion: string, status = "Unresolved") =>
  [
    `ref: ${ref}`,
    "cycle: 1",
    "reviewed_by: Zoning",
    "type: Comment",
    "filename: A-101.pdf",
    "full_discussion_text:",
    discussion,
    `status: ${status}`,
    "source_report: Plan Review - Review Comments",
    "date_time: 10/01/2026 9:00 AM",
    "",
    "--- original_source_block ---",
    `${ref} ${discussion}`,
  ].join("\n");

const DISCUSSIONS = [
  "Provide setback dimensions on the site plan.",
  "Show the egress path from the mezzanine; see REF #4 for the stair.",
  "Clarify the fire separation at grid C.",
  "Stair width does not meet the minimum.",
  "Provide the energy compliance form.",
  "Label all existing walls to remain.",
];

describe("portal comment refresh keying (6d)", () => {
  it("the real 6-row shape: old rows without comment_number update in place; nothing is deleted or re-inserted", () => {
    const old: (PortalCommentRow & { response_text: string })[] = DISCUSSIONS.map((d, i) => ({
      id: `old-${i + 1}`,
      comment_number: null,
      original_text: persisted(i + 1, d),
      page_number: null,
      status: "Pending Review",
      response_text: `Response ${i + 1}`,
    }));
    const staging: PortalCommentRow[] = DISCUSSIONS.map((d, i) => ({
      id: `stg-${i + 1}`,
      comment_number: String(i + 1),
      original_text: persisted(i + 1, d, i === 2 ? "Resolved" : "Unresolved"),
      page_number: 2,
      status: "Pending Review",
    }));
    const plan = planPortalCommentRefresh(old, staging);
    assert.equal(plan.updates.length, 6);
    assert.deepEqual(plan.removals, []);
    assert.deepEqual(plan.promotions, []);
    assert.deepEqual(plan.updates.map((u) => [u.oldId, u.stagingId]), DISCUSSIONS.map((_, i) => [`old-${i + 1}`, `stg-${i + 1}`]));
    assert.equal(plan.updates[1].oldId, "old-2", "an inline REF #4 in the discussion does not override the header ref");
    assert.equal(plan.updates[2].patch.original_text, staging[2].original_text, "the new text is written to the old row");
    assert.equal(plan.updates[0].patch.comment_number, "1");
    assert.ok(!("response_text" in plan.updates[0].patch), "response_text is never touched");
  });

  it("keys: comment_number, then the persisted ref header, then an inline REF, then the normalised text", () => {
    assert.equal(portalCommentKey({ comment_number: "7", original_text: persisted(3, "x") }), "ref:7");
    assert.equal(portalCommentKey({ comment_number: null, original_text: persisted(3, "x") }), "ref:3");
    assert.equal(portalCommentKey({ comment_number: "", original_text: "REF # 12 Provide setbacks" }), "ref:12");
    assert.equal(portalCommentKey({ comment_number: null, original_text: "  Provide\n setbacks " }), "text:Provide setbacks");
  });

  it("a removed comment is soft-marked, a new one promoted, and rows without refs still match by text", () => {
    const old: PortalCommentRow[] = [
      { id: "o1", original_text: persisted(1, "A") },
      { id: "o2", original_text: persisted(2, "B") },
      { id: "o3", original_text: "Free text comment\nwithout a ref" },
    ];
    const staging: PortalCommentRow[] = [
      { id: "s1", comment_number: "1", original_text: persisted(1, "A") },
      { id: "s3", original_text: "Free text comment without a ref" },
      { id: "s9", comment_number: "9", original_text: persisted(9, "New") },
    ];
    const plan = planPortalCommentRefresh(old, staging);
    assert.deepEqual(plan.updates.map((u) => [u.oldId, u.stagingId]), [["o1", "s1"], ["o3", "s3"]]);
    assert.deepEqual(plan.promotions, ["s9"]);
    assert.deepEqual(plan.removals, ["o2"]);
  });

  it("human work survives: a person's status, a responded comment's text, and already-removed rows", () => {
    const old: PortalCommentRow[] = [
      { id: "o1", original_text: persisted(1, "A"), status: "Ready for Review", response_text: "Our reply" },
      { id: "o2", original_text: persisted(2, "B"), status: "Pending Review" },
      { id: "o3", original_text: persisted(3, "C"), status: "Pending Review", portal_removed_at: "2026-11-01T00:00:00Z" },
    ];
    const staging: PortalCommentRow[] = [
      { id: "s1", comment_number: "1", original_text: persisted(1, "A, now with a new requirement", "Resolved"), status: "Approved" },
      { id: "s2", comment_number: "2", original_text: persisted(2, "B, reworded", "Resolved"), status: "Approved" },
    ];
    const plan = planPortalCommentRefresh(old, staging, "2026-11-17T00:00:00Z");
    const [u1, u2] = plan.updates;
    assert.ok(!("status" in u1.patch), "the person's status is kept");
    assert.ok(!("original_text" in u1.patch), "the responded comment's text is kept");
    assert.equal(u1.patch.portal_latest_text, staging[0].original_text);
    assert.equal(u1.patch.portal_changed_at, "2026-11-17T00:00:00Z");
    assert.equal(u1.patch.portal_status_raw, "Resolved");
    assert.equal(u2.patch.status, "Approved", "a parser-owned status follows the portal");
    assert.equal(u2.patch.original_text, staging[1].original_text, "an untouched row takes the new text");
    assert.deepEqual(plan.removals, [], "a row already marked removed is not marked again");
  });

  it("two staging rows never claim the same old row", () => {
    const old: PortalCommentRow[] = [{ id: "o1", original_text: persisted(1, "A") }];
    const staging: PortalCommentRow[] = [
      { id: "s1", comment_number: "1", original_text: persisted(1, "A") },
      { id: "s1b", comment_number: "1", original_text: persisted(1, "A (duplicate)") },
    ];
    const plan = planPortalCommentRefresh(old, staging);
    assert.deepEqual(plan.updates.map((u) => u.stagingId), ["s1"]);
    assert.deepEqual(plan.promotions, ["s1b"]);
  });
});
