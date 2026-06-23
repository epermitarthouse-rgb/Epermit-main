import {
  flattenAndDedupePgcWorkflowBuckets,
  mapPgcWorkflowBucketsToStructuredRows,
  dedupeKeyForPgcDomRow,
} from "./mapPgcDomReviewToStructuredRows.ts";
import { mapMontgomeryStructuredRowsToPgcDeterministic } from "./mapMontgomeryStructuredRowsToDeterministic.ts";

const buckets = [
  {
    workflowName: "Show All",
    rows: [
      {
        correctionId: "100",
        refNumber: "3",
        cycle: "1",
        reviewer: "Reviewer A",
        correctionType: "Comment",
        fileName: "S1.pdf",
        commentText: "Comment three",
        status: "UnResolved",
      },
    ],
  },
];

const flat = flattenAndDedupePgcWorkflowBuckets(buckets);
if (flat.length !== 1) throw new Error("expected 1 flat row");

const structured = mapPgcWorkflowBucketsToStructuredRows(buckets);
if (structured.length !== 1) throw new Error("expected 1 structured row");

const deterministic = mapMontgomeryStructuredRowsToPgcDeterministic(structured);
if (deterministic.length !== 1) throw new Error("Montgomery mapper rejected PGC DOM row");
if (deterministic[0].ref !== "3") throw new Error("ref mismatch");
if (deterministic[0].discussion !== "Comment three") throw new Error("discussion mismatch");

if (!dedupeKeyForPgcDomRow(flat[0]).startsWith("cid:100")) {
  throw new Error("correctionId dedupe key expected");
}

console.log("mapPgcDomReviewToStructuredRows.selftest.ts: ok");
