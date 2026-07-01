import {
  BATCH_TIMEOUTS,
  BatchStageError,
  BatchStageTimeoutError,
  classifyBatchFailure,
  pendingFileStatusDisplay,
  withTimeout,
} from "./commentReviewBatchProcess";

async function runSelfTest() {
  const failures: string[] = [];

  function assert(condition: boolean, message: string) {
    if (!condition) failures.push(message);
  }

  try {
    await withTimeout(new Promise((resolve) => setTimeout(resolve, 50)), 10, "upload");
    failures.push("withTimeout should reject slow promises");
  } catch (err) {
    assert(err instanceof BatchStageTimeoutError, "timeout error type");
  }

  const conversionFailure = classifyBatchFailure(
    new BatchStageError("conversion", "Corrupt .DOC", "corrupt_doc"),
  );
  assert(conversionFailure.stage === "conversion", "conversion stage mapping");
  assert(conversionFailure.code === "corrupt_doc", "conversion code mapping");

  const timeoutFailure = classifyBatchFailure(new BatchStageTimeoutError("parsing"));
  assert(timeoutFailure.timedOut === true, "timeout flag");
  assert(timeoutFailure.stage === "parsing", "timeout stage");

  const successLabel = pendingFileStatusDisplay({
    id: "test",
    file: { name: "a.doc" } as File,
    status: "success",
    commentCount: 2,
  });
  assert(successLabel === "Complete · 2 comments", "success label");

  assert(BATCH_TIMEOUTS.upload === 60_000, "upload timeout");
  assert(BATCH_TIMEOUTS.conversion === 120_000, "conversion timeout");
  assert(BATCH_TIMEOUTS.extraction === 60_000, "extraction timeout");
  assert(BATCH_TIMEOUTS.parsing === 120_000, "parsing timeout");

  if (failures.length > 0) {
    console.error("[commentReviewBatchProcess.selftest] failures:", failures);
    process.exit(1);
  }

  console.log("[commentReviewBatchProcess.selftest] ok");
}

void runSelfTest();
