"use strict";

/**
 * awaitPopupPage: click → page event without orphaning waitForEvent (Node 18 unhandled rejection).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { awaitPopupPage, isTimeoutError } = require("../lib/await-popup-page");

test("isTimeoutError recognises Playwright-shaped timeouts", () => {
  assert.equal(isTimeoutError({ name: "TimeoutError", message: "x" }), true);
  assert.equal(isTimeoutError(new Error("Timeout 25000ms exceeded while waiting for event \"page\"")), true);
  assert.equal(isTimeoutError(new Error("click failed")), false);
  assert.equal(isTimeoutError(null), false);
});

test("awaitPopupPage returns the opened page on success", async () => {
  const page = { id: "popup" };
  const context = {
    waitForEvent: async () => page,
  };
  const opened = await awaitPopupPage(context, async () => {}, { timeout: 1000, label: "test popup" });
  assert.equal(opened, page);
});

test("awaitPopupPage turns a waitForEvent timeout into a labelled Error (not an unhandled rejection)", async () => {
  const context = {
    waitForEvent: async () => {
      const err = new Error("Timeout 50ms exceeded while waiting for event \"page\"");
      err.name = "TimeoutError";
      throw err;
    },
  };
  await assert.rejects(
    () => awaitPopupPage(context, async () => {}, { timeout: 50, label: "DC project popup for BCIV" }),
    /DC project popup for BCIV did not open within 50ms/,
  );
});

test("awaitPopupPage drains waitForEvent when the click throws (no orphaned rejection)", async () => {
  let rejectWait;
  const context = {
    waitForEvent: () =>
      new Promise((_, reject) => {
        rejectWait = (err) => reject(err);
      }),
  };
  const clickErr = new Error("locator click: element is not attached");
  const run = awaitPopupPage(
    context,
    async () => {
      throw clickErr;
    },
    { timeout: 25000, label: "test popup" },
  );

  // Let the helper reach the drain await, then settle waitForEvent as a late timeout.
  await new Promise((r) => setImmediate(r));

  let unhandled = 0;
  const onUnhandled = () => {
    unhandled += 1;
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    const err = new Error("Timeout 25000ms exceeded while waiting for event \"page\"");
    err.name = "TimeoutError";
    rejectWait(err);
    const rejected = await run.then(
      () => null,
      (e) => e,
    );
    assert.equal(rejected, clickErr);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(unhandled, 0, "late waitForEvent timeout must be handled");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
