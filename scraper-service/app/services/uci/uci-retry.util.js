"use strict";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Three attempts with exponential backoff (0s, 1s, 2s by default).
 *
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, baseMs?: number }} [opts]
 * @returns {Promise<{ ok: true, result: T, attempts: number } | { ok: false, error: unknown, attempts: number }>}
 * @template T
 */
async function retryWithExponentialBackoff(fn, opts = {}) {
  const attempts = Number(opts.attempts) > 0 ? Number(opts.attempts) : 3;
  const baseMs = Number(opts.baseMs) >= 0 ? Number(opts.baseMs) : 1000;
  /** @type {unknown} */
  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const result = await fn(i);
      return { ok: true, result, attempts: i };
    } catch (err) {
      lastError = err;
      if (i < attempts) await delay(baseMs * i);
    }
  }
  return { ok: false, error: lastError, attempts };
}

module.exports = {
  retryWithExponentialBackoff,
  delay,
};
