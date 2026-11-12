"use strict";

/**
 * Click → wait for a new page without leaving an unhandled waitForEvent rejection.
 *
 * Playwright's `context.waitForEvent("page", { timeout })` rejects on timeout. If the click
 * throws (stale locator, closed page) before that promise is awaited, Node 18 treats the later
 * timeout as an unhandled rejection and kills the process — which left a deep job leased and
 * `running` during the full-capture live test. Always attach a catch before clicking, and still
 * drain the promise when the click fails.
 */

function isTimeoutError(err) {
  return Boolean(
    err &&
      (err.name === "TimeoutError" ||
        /Timeout \d+ms exceeded/i.test(String(err.message || err))),
  );
}

/**
 * @param {{ waitForEvent: Function }} context
 * @param {() => Promise<unknown>} click
 * @param {{ timeout?: number, label?: string }} [opts]
 * @returns {Promise<any>} the opened page
 */
async function awaitPopupPage(context, click, opts = {}) {
  const timeout = Number.isInteger(opts.timeout) && opts.timeout > 0 ? opts.timeout : 25000;
  const label = String(opts.label || "popup");
  const popupPromise = context.waitForEvent("page", { timeout }).catch((err) => {
    if (isTimeoutError(err)) return null;
    throw err;
  });
  try {
    await click();
  } catch (err) {
    await popupPromise.catch(() => null);
    throw err;
  }
  const opened = await popupPromise;
  if (!opened) throw new Error(`${label} did not open within ${timeout}ms`);
  return opened;
}

module.exports = { awaitPopupPage, isTimeoutError };
