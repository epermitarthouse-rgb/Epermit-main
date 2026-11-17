// Run: node --import tsx --test supabase/functions/_shared/permitRepositoryComments.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  existingRef,
  formatRepositoryComment,
  hasHumanWork,
  normalizePortalStatus,
  planRepositoryCommentMerge,
  repositoryCommentHash,
  statusIsParserOwned,
  type ExistingParsedComment,
  type RepositoryComment,
  type RepositoryPermit,
} from "./permitRepositoryComments.ts";

const PROJECT = "ff193644-0000-4000-8000-000000000000";
const PERMIT = "06fa082e-0000-4000-8000-000000000000";
const PERMIT_B = "0b0b0b0b-0000-4000-8000-000000000000";
const NOW = "2026-11-17T05:00:00.000Z";

const permit = (id = PERMIT, reviews_complete = true): RepositoryPermit => ({ id, permit_number: "BCIV2500152", reviews_complete });

const comment = (ref: number, body: string, status = "Resolved", permitId = PERMIT): RepositoryComment => ({
  permit_id: permitId,
  portal_comment_key: `ref:${ref}`,
  ref_number: ref,
  cycle: ref,
  department: "DOEE",
  comment_type: "Comment",
  file_name: null,
  body,
  status,
  reviewed_at: "2026-03-01T15:00:00.000Z",
});

/** The shape of ff193644's six rows today: report-parsed, `ref: N` header, comment_number null, AI drafts. */
const legacyRow = (ref: number, discussion: string, over: Partial<ExistingParsedComment> = {}): ExistingParsedComment => ({
  id: `row-${ref}`,
  original_text: [
    `ref: ${ref}`,
    "cycle: 1",
    "reviewed_by: DOEE",
    "type: Comment",
    "filename: ",
    "full_discussion_text:",
    discussion,
    "status: Resolved",
    "source_report: Plan Review - Review Comments",
    "date_time: 03/01/2026 10:00 AM",
    "",
    "--- original_source_block ---",
    `${ref} ${discussion}`,
  ].join("\n"),
  comment_number: null,
  status: "Approved",
  ingest_source: "raw_ref",
  response_text: "AI draft response",
  response_status: null,
  approved_at: null,
  last_edited_by: null,
  ...over,
});

describe("status mapping and ownership", () => {
  it("maps portal statuses like the parser", () => {
    assert.equal(normalizePortalStatus("Resolved"), "Approved");
    assert.equal(normalizePortalStatus("Unresolved"), "Pending Review");
    assert.equal(normalizePortalStatus("Info Only"), "Pending");
    assert.equal(normalizePortalStatus(""), "Pending");
  });

  it("a status still equal to the mapped portal status is parser-owned; anything else is a person's choice", () => {
    assert.equal(statusIsParserOwned(legacyRow(1, "x")), true);
    assert.equal(statusIsParserOwned(legacyRow(1, "x", { status: "Ready for Review" })), false);
    assert.equal(statusIsParserOwned({ id: "a", original_text: "no header", status: "Pending" }), false, "unknown history is protected");
    assert.equal(statusIsParserOwned({ id: "a", original_text: "", status: "Pending Review", portal_status_raw: "Unresolved" }), true);
  });

  it("human work: a response, a response status, an approval or a human edit", () => {
    assert.equal(hasHumanWork({ id: "a", original_text: "" }), false);
    assert.equal(hasHumanWork({ id: "a", original_text: "", response_text: "  " }), false);
    assert.equal(hasHumanWork({ id: "a", original_text: "", response_text: "draft" }), true);
    assert.equal(hasHumanWork({ id: "a", original_text: "", response_status: "AI Generated" }), true);
    assert.equal(hasHumanWork({ id: "a", original_text: "", last_edited_by: "u" }), true);
  });

  it("reads the ref from comment_number, the header or an inline REF", () => {
    assert.equal(existingRef({ comment_number: "7", original_text: "" }), "7");
    assert.equal(existingRef({ comment_number: null, original_text: "ref: 03\ncycle: 1" }), "3");
    assert.equal(existingRef({ comment_number: null, original_text: "See REF #12 above" }), "12");
  });
});

describe("planRepositoryCommentMerge", () => {
  it("adopts the six legacy rows in place: no inserts, no text or status churn, nothing removed", () => {
    const bodies = ["Provide erosion plan.", "Stormwater sheet.", "Tree permit.", "Grading note.", "Soil report.", "Info for applicant."];
    const existing = bodies.map((b, i) => legacyRow(i + 1, b, i === 5 ? { status: "Pending", original_text: legacyRow(6, b).original_text!.replace("status: Resolved", "status: Info Only") } : {}));
    existing[0] = { ...existing[0], response_status: "AI Generated", last_edited_by: "user-1" };
    const comments = bodies.map((b, i) => comment(i + 1, b, i === 5 ? "Info Only" : "Resolved"));
    const plan = planRepositoryCommentMerge({ projectId: PROJECT, permits: [permit()], comments, existing, now: NOW });

    assert.equal(plan.inserts.length, 0);
    assert.deepEqual(plan.softRemovals, []);
    assert.equal(plan.stats.matched, 6);
    assert.equal(plan.stats.text_replaced, 0);
    assert.equal(plan.stats.text_change_flagged, 0);
    assert.equal(plan.stats.status_updated, 0);
    for (const u of plan.updates) {
      assert.equal(u.patch.portal_permit_id, PERMIT);
      assert.match(String(u.patch.portal_comment_key), /^ref:\d$/);
      assert.ok(!("original_text" in u.patch) && !("status" in u.patch));
      for (const k of ["response_text", "response_status", "assigned_to", "discipline", "code_reference", "approved_at", "approved_by"]) {
        assert.ok(!(k in u.patch), `${k} is never written`);
      }
    }
  });

  it("is idempotent: a second plan over the adopted rows writes nothing", () => {
    const c = [comment(1, "Provide erosion plan.")];
    const first = planRepositoryCommentMerge({ projectId: PROJECT, permits: [permit()], comments: c, existing: [legacyRow(1, "Provide erosion plan.")], now: NOW });
    const adopted = { ...legacyRow(1, "Provide erosion plan."), ...first.updates[0].patch } as ExistingParsedComment;
    const second = planRepositoryCommentMerge({ projectId: PROJECT, permits: [permit()], comments: c, existing: [adopted], now: NOW });
    assert.deepEqual(second.updates, []);
    assert.deepEqual(second.inserts, []);
  });

  it("formatting-only differences between the report and the JSON text do not count as a change", () => {
    const plan = planRepositoryCommentMerge({
      projectId: PROJECT,
      permits: [permit()],
      comments: [comment(1, "Provide an erosion  plan, see [email].")],
      existing: [legacyRow(1, "Provide an Erosion plan see a.b@dc.gov")],
      now: NOW,
    });
    assert.equal(plan.stats.text_change_flagged + plan.stats.text_replaced, 0);
  });

  it("a real text change on a row with a response is flagged, not overwritten", () => {
    const plan = planRepositoryCommentMerge({ projectId: PROJECT, permits: [permit()], comments: [comment(1, "Provide a revised erosion plan with silt fence.")], existing: [legacyRow(1, "Provide erosion plan.")], now: NOW });
    const p = plan.updates[0].patch;
    assert.ok(!("original_text" in p));
    assert.match(String(p.portal_latest_text), /revised erosion plan/);
    assert.equal(p.portal_changed_at, NOW);
    assert.equal(plan.stats.text_change_flagged, 1);
  });

  it("a real text change on an untouched row replaces the text in place (same id)", () => {
    const row = legacyRow(1, "Provide erosion plan.", { response_text: null });
    const plan = planRepositoryCommentMerge({ projectId: PROJECT, permits: [permit()], comments: [comment(1, "Provide a revised erosion plan.")], existing: [row], now: NOW });
    assert.equal(plan.updates[0].id, "row-1");
    assert.match(String(plan.updates[0].patch.original_text), /full_discussion_text:\nProvide a revised erosion plan\./);
    assert.equal(plan.stats.text_replaced, 1);
  });

  it("portal status changes update parser-owned statuses and keep a person's status", () => {
    const owned = legacyRow(1, "A", { status: "Approved" });
    const human = legacyRow(2, "B", { status: "Ready for Review" });
    const plan = planRepositoryCommentMerge({
      projectId: PROJECT,
      permits: [permit()],
      comments: [comment(1, "A", "Unresolved"), comment(2, "B", "Unresolved")],
      existing: [owned, human],
      now: NOW,
    });
    const byId = new Map(plan.updates.map((u) => [u.id, u.patch]));
    assert.equal(byId.get("row-1")!.status, "Pending Review");
    assert.ok(!("status" in byId.get("row-2")!));
    assert.equal(byId.get("row-2")!.portal_status_raw, "Unresolved");
    assert.equal(plan.stats.status_kept_human, 1);
  });

  it("new portal comments are inserted with portal identity; existing rows keep their ids", () => {
    const plan = planRepositoryCommentMerge({ projectId: PROJECT, permits: [permit()], comments: [comment(1, "A"), comment(7, "New comment", "Unresolved")], existing: [legacyRow(1, "A")], now: NOW });
    assert.equal(plan.inserts.length, 1);
    const ins = plan.inserts[0];
    assert.equal(ins.project_id, PROJECT);
    assert.equal(ins.portal_comment_key, "ref:7");
    assert.equal(ins.comment_number, "7");
    assert.equal(ins.status, "Pending Review");
    assert.equal(ins.ingest_source, "raw_ref");
    assert.equal(ins.discipline, null);
    assert.equal(ins.portal_content_hash, repositoryCommentHash(comment(7, "New comment", "Unresolved")));
  });

  it("a comment no longer on the portal is soft-marked, never deleted, and only when the listing was complete", () => {
    const existing = [legacyRow(1, "A"), legacyRow(2, "B")];
    const complete = planRepositoryCommentMerge({ projectId: PROJECT, permits: [permit()], comments: [comment(1, "A")], existing, now: NOW });
    assert.deepEqual(complete.softRemovals, ["row-2"]);
    const partial = planRepositoryCommentMerge({ projectId: PROJECT, permits: [permit(PERMIT, false)], comments: [comment(1, "A")], existing, now: NOW });
    assert.deepEqual(partial.softRemovals, []);
  });

  it("a soft-removed comment that reappears is restored", () => {
    const row = { ...legacyRow(2, "B"), portal_permit_id: PERMIT, portal_comment_key: "ref:2", portal_removed_at: "2026-11-01T00:00:00Z" };
    const plan = planRepositoryCommentMerge({ projectId: PROJECT, permits: [permit()], comments: [comment(2, "B")], existing: [row], now: NOW });
    assert.equal(plan.updates[0].patch.portal_removed_at, null);
    assert.equal(plan.stats.restored, 1);
  });

  it("with two linked permits, refs are not used to match legacy rows and legacy rows are never removed", () => {
    const plan = planRepositoryCommentMerge({
      projectId: PROJECT,
      permits: [permit(PERMIT), permit(PERMIT_B)],
      comments: [comment(1, "From permit A"), comment(1, "From permit B", "Unresolved", PERMIT_B)],
      existing: [legacyRow(1, "Something else entirely")],
      now: NOW,
    });
    assert.equal(plan.inserts.length, 2);
    assert.deepEqual(plan.softRemovals, []);
  });

  it("identity matches win over refs, so two permits' ref 1 map to their own rows", () => {
    const a = { ...legacyRow(1, "A"), id: "a", portal_permit_id: PERMIT, portal_comment_key: "ref:1" };
    const b = { ...legacyRow(1, "B"), id: "b", portal_permit_id: PERMIT_B, portal_comment_key: "ref:1" };
    const plan = planRepositoryCommentMerge({
      projectId: PROJECT,
      permits: [permit(PERMIT), permit(PERMIT_B)],
      comments: [comment(1, "A"), comment(1, "B", "Resolved", PERMIT_B)],
      existing: [a, b],
      now: NOW,
    });
    assert.equal(plan.inserts.length, 0);
    assert.equal(plan.stats.matched, 2);
  });

  it("manual letters and staging rows are never matched, updated or removed", () => {
    const manual = { ...legacyRow(1, "A"), id: "m", ingest_source: "manual_letter" };
    const staging = { ...legacyRow(2, "B"), id: "s", ingest_source: "raw_ref_staging" };
    const plan = planRepositoryCommentMerge({ projectId: PROJECT, permits: [permit()], comments: [comment(3, "C")], existing: [manual, staging], now: NOW });
    assert.deepEqual(plan.updates, []);
    assert.deepEqual(plan.softRemovals, []);
    assert.equal(plan.inserts.length, 1);
  });

  it("comments of permits that are not linked or not authorized are ignored", () => {
    const plan = planRepositoryCommentMerge({ projectId: PROJECT, permits: [permit()], comments: [comment(1, "x", "Resolved", PERMIT_B)], existing: [], now: NOW });
    assert.equal(plan.inserts.length, 0);
  });

  it("the persisted text is the layout the Response Matrix parses", () => {
    const t = formatRepositoryComment(comment(4, "Line one\nLine two", "Unresolved"), "B123");
    assert.match(t, /^ref: 4\ncycle: 4\nreviewed_by: DOEE\ntype: Comment\nfilename: \nfull_discussion_text:\nLine one\nLine two\nstatus: Unresolved\nsource_report: Permit B123\ndate_time: /);
  });
});

// Production finding (ff193644, 2026-11-17): the Review Comments report puts the whole discussion thread
// (reviewer comment, then each response with responder and date) in full_discussion_text, while the
// repository keeps only the reviewer comment in `body` (responses live in permit_review_responses).
// Synthetic text only.
describe("report-thread rows adopted from the repository (false 'Updated on portal')", () => {
  const body = "Provide the erosion and sediment control plan sheet.";
  const thread = [
    body,
    "Responded by: Applicant 03/02/2026 9:15 AM",
    "The sheet was added as C-301 in the resubmission.",
    "Responded by: Reviewer 03/05/2026 1:40 PM",
    "Accepted.",
  ].join("\n");

  it("does not flag a row whose stored thread starts with the unchanged portal comment", () => {
    const plan = planRepositoryCommentMerge({ projectId: PROJECT, permits: [permit()], comments: [comment(2, body)], existing: [legacyRow(2, thread)], now: NOW });
    assert.equal(plan.stats.text_change_flagged, 0);
    assert.equal(plan.stats.text_replaced, 0);
    const patch = plan.updates[0]?.patch ?? {};
    assert.equal("portal_latest_text" in patch, false);
    assert.equal("portal_changed_at" in patch, false);
    assert.equal(patch.portal_comment_key, "ref:2");
  });

  it("treats an e-mail in the report thread and a redaction in the repository comment as the same text", () => {
    const withEmail = `${body} Questions: reviewer@example.invalid\nResponded by: Applicant\nDone.`;
    const plan = planRepositoryCommentMerge({
      projectId: PROJECT,
      permits: [permit()],
      comments: [comment(2, `${body} Questions: [email]`)],
      existing: [legacyRow(2, withEmail)],
      now: NOW,
    });
    assert.equal(plan.stats.text_change_flagged, 0);
  });

  it("still flags a real change to the reviewer comment on a row with a thread", () => {
    const plan = planRepositoryCommentMerge({
      projectId: PROJECT,
      permits: [permit()],
      comments: [comment(2, "Provide the stormwater management plan sheet instead.")],
      existing: [legacyRow(2, thread)],
      now: NOW,
    });
    assert.equal(plan.stats.text_change_flagged, 1);
  });

  it("clears a false mark left by the earlier comparison once the row is adopted", () => {
    const c = comment(2, body);
    const marked = legacyRow(2, thread, {
      portal_permit_id: PERMIT,
      portal_comment_key: "ref:2",
      portal_content_hash: repositoryCommentHash(c),
      portal_status_raw: "Resolved",
      portal_latest_text: formatRepositoryComment(c, "BCIV2500152"),
      portal_changed_at: "2026-11-17T07:00:00.000Z",
    });
    const plan = planRepositoryCommentMerge({ projectId: PROJECT, permits: [permit()], comments: [c], existing: [marked], now: NOW });
    const patch = plan.updates[0]?.patch ?? {};
    assert.equal(patch.portal_latest_text, null);
    assert.equal(patch.portal_changed_at, null);
  });
});
