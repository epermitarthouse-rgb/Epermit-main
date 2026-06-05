import {
  buildParserSummary,
  DOB_MCDONALDS_FIXTURE,
  parseManualCommentLetterDeterministic,
} from "./manualCommentLetterParse.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const comments = parseManualCommentLetterDeterministic(DOB_MCDONALDS_FIXTURE);
const summary = buildParserSummary(comments);

console.log("Parser summary:", JSON.stringify(summary, null, 2));
console.log(
  comments.map((c) => ({
    discipline: c.discipline,
    num: c.comment_number,
    reviewer: c.reviewer_name,
    comment: c.original_comment.slice(0, 60),
    hasPrev: Boolean(c.previous_comment_text),
  })),
);

assert(comments.length === 8, `Expected 8 comments, got ${comments.length}`);
assert(
  !comments.some((c) => /see previous comment/i.test(c.original_comment)),
  "No row should use See previous comment placeholder",
);

const doee = comments.filter((c) => c.reviewer_name === "Nykia Barnes");
const energy = comments.filter((c) => c.reviewer_name === "Rafael Palomino-Ramirez");
const fire = comments.filter((c) => c.discipline === "Fire");
const structural = comments.filter((c) => c.discipline === "Structural");

assert(doee.length === 1, `DOEE expected 1, got ${doee.length}`);
assert(energy.length === 1, `Energy expected 1, got ${energy.length}`);
assert(fire.length === 3, `Fire expected 3, got ${fire.length}`);
assert(structural.length === 3, `Structural expected 3, got ${structural.length}`);

const fire1 = fire.find((c) => c.comment_number === "1");
assert(fire1?.previous_comment_text?.includes("sprinkler"), "Fire Comment 1 missing previous text");
assert(fire1?.discipline === "Fire", "Fire Comment 1 wrong discipline");

const fire2 = fire.find((c) => c.comment_number === "2");
assert(fire2, "Fire Comment 2 missing");
assert(
  fire2?.previous_comment_text?.includes("floor layout"),
  "Fire Comment 2 missing full previous text",
);
assert(fire2?.original_comment.includes("Please cloud corrections"), "Fire Comment 2 active comment preserved");
assert(
  fire2?.code_references.some((r) => r.includes("1018.2")),
  "Fire Comment 2 missing code refs from previous text",
);

const fire3 = fire.find((c) => c.comment_number === "3");
assert(fire3?.discipline === "Fire", "Fire Comment 3 should be Fire discipline");
assert(fire3?.original_comment.includes("Response reads"), "Fire Comment 3 should keep Response reads narrative");
assert(fire3?.existing_response_text == null || fire3.existing_response_text === "", "Fire Comment 3 response should be blank");

const struct1 = structural.find((c) => c.comment_number === "1");
assert(struct1?.previous_comment_text?.includes("1704.3"), "Structural Comment 1 missing previous text");

const asciiComments = parseManualCommentLetterDeterministic(
  DOB_MCDONALDS_FIXTURE.replace(/–/g, "-"),
);
assert(asciiComments.length === 8, `ASCII hyphen fixture expected 8, got ${asciiComments.length}`);
assert(
  asciiComments.filter((c) => c.discipline === "Fire").length === 3,
  "ASCII hyphen Fire expected 3",
);

const previousOnly = parseManualCommentLetterDeterministic(`
Fire – Luchi Lu
- Comment 2:
[PREVIOUS COMMENT]
The floor layout plan doesn't include scaled and dimensioned seat count for 48. Nor is placard provided. Provide fully dimensioned floor layout per 2017 DCBC 1018.2 and 1004.3.
`);
assert(previousOnly.length === 1, "Previous-only comment expected 1 row");
assert(
  previousOnly[0].previous_comment_text?.includes("floor layout"),
  "Previous-only row should preserve full previous text",
);
assert(previousOnly[0].original_comment === "", "Previous-only row should have empty active comment");
assert(!/see previous comment/i.test(previousOnly[0].original_comment), "No placeholder");

console.log("manualCommentLetterParse.selftest.ts: all assertions passed");
