"use strict";

/**
 * Redact URL to host (+ path without query) for safe logging.
 * Never logs auth headers or query strings (signed URLs).
 */
function redactFetchTarget(urlLike) {
  try {
    const u = new URL(String(urlLike));
    return { host: u.hostname, path: u.pathname };
  } catch {
    return { host: "(invalid-url)", path: undefined };
  }
}

function summarizeCause(cause, depth = 0) {
  if (!cause || depth > 3) return null;
  if (typeof cause !== "object") {
    return { message: String(cause) };
  }

  return {
    name: cause.name,
    message: cause.message,
    code: cause.code,
    errno: cause.errno,
    hostname: cause.hostname,
    syscall: cause.syscall,
    address: cause.address,
    port: cause.port,
    cause: summarizeCause(cause.cause, depth + 1),
  };
}

/**
 * Build a safe, structured summary of a fetch / supabase transport error.
 */
function summarizeFetchError(err, urlLike) {
  const target = urlLike ? redactFetchTarget(urlLike) : null;
  const root = err instanceof Error ? err : new Error(String(err));
  const httpStatus =
    typeof err?.status === "number"
      ? err.status
      : typeof err?.statusCode === "number"
        ? err.statusCode
        : undefined;

  let bodyPrefix;
  const rawBody = err?.body ?? err?.details ?? err?.hint;
  if (typeof rawBody === "string" && rawBody.length > 0) {
    bodyPrefix = rawBody.slice(0, 200);
  }

  return {
    name: root.name,
    message: root.message,
    host: target?.host,
    path: target?.path,
    httpStatus,
    bodyPrefix,
    cause: summarizeCause(root.cause ?? err?.cause),
  };
}

function formatFetchErrorLine(summary) {
  const parts = [
    summary.name || "Error",
    summary.message || "unknown",
  ];
  if (summary.host) parts.push(`host=${summary.host}`);
  if (summary.cause?.code) parts.push(`cause.code=${summary.cause.code}`);
  if (summary.cause?.errno != null) parts.push(`cause.errno=${summary.cause.errno}`);
  if (summary.cause?.hostname) parts.push(`cause.hostname=${summary.cause.hostname}`);
  if (summary.httpStatus != null) parts.push(`http=${summary.httpStatus}`);
  if (summary.bodyPrefix) parts.push(`body=${JSON.stringify(summary.bodyPrefix)}`);
  return parts.join(" | ");
}

module.exports = {
  redactFetchTarget,
  summarizeFetchError,
  formatFetchErrorLine,
};
