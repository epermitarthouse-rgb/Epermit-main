import { buildGroundedCommentContext } from "./groundedCommentContext.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const fire2Previous =
  "The floor layout plan doesn't include scaled and dimensioned seat count for 48. Nor is placard provided. Provide fully dimensioned floor layout per 2017 DCBC 1018.2, 2902.3.6, 1029.12.1, 1004.3, and IBC 2017 1108.2.9.1.";

const fire2 = buildGroundedCommentContext({
  original_text: "Please cloud corrections.",
  previous_comment_text: fire2Previous,
  discipline: "Fire",
  reviewer_name: "Luchi Lu",
  comment_number: "2",
  code_reference: "2017 DCBC 1018.2",
  code_references: '["2017 DCBC 2902.3.6","1004.3"]',
});

assert(fire2.retrieval_query_text.includes("floor layout"), "Fire 2 retrieval must include previous text");
assert(fire2.retrieval_query_text.includes("1018.2"), "Fire 2 retrieval must include code refs");
assert(fire2.prompt_comment_block.includes("Previous comment"), "Fire 2 prompt must label previous section");
assert(!fire2.prompt_comment_block.includes("See previous comment"), "No placeholder in prompt");

const struct1 = buildGroundedCommentContext({
  original_text: "Please cloud corrections.",
  previous_comment_text: "Provide structural calculations for mezzanine per 1704.3 and 1705.3.4.",
  discipline: "Structural",
  comment_number: "1",
});

assert(struct1.retrieval_query_text.includes("1704.3"), "Structural 1 retrieval must include previous text");

const placeholder = buildGroundedCommentContext({
  original_text: "See previous comment.",
  previous_comment_text: fire2Previous,
});

assert(placeholder.retrieval_query_text.includes("floor layout"), "Placeholder original still retrieves previous");
assert(placeholder.original_text === "", "Placeholder original stripped from active text");

console.log("groundedCommentContext.selftest.ts: all assertions passed");
