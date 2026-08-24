"use strict";

function redactFetchTarget(urlLike) {
  try {
    const u = new URL(String(urlLike));
    return { host: u.host, protocol: u.protocol };
  } catch {
    return { host: "(invalid-url)", protocol: "" };
  }
}

function summarizeFetchError(err, urlLike) {
  const target = redactFetchTarget(urlLike);
  return {
    host: target.host,
    message: err instanceof Error ? err.message : String(err),
    code: err?.code || null,
  };
}

module.exports = { redactFetchTarget, summarizeFetchError };
