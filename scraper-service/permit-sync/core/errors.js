"use strict";

/**
 * Error taxonomy for permit sync runs. `classify` maps any error to the outcome passed to
 * finish_permit_sync_job; unknown errors are treated as retryable transient failures.
 */

class PermitSyncError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code || "error";
    if (cause) this.cause = cause;
  }
}

/** A request or click was refused by the read-only guard. Never retried. */
class SafetyViolationError extends PermitSyncError {
  constructor(message, verdict) {
    super(message, { code: "safety_violation" });
    this.verdict = verdict;
  }
}
class AuthError extends PermitSyncError {
  constructor(message) { super(message, { code: "auth_failed" }); }
}
class MfaRequiredError extends PermitSyncError {
  constructor(message = "multi-factor authentication required") { super(message, { code: "mfa_required" }); }
}
class CaptchaError extends PermitSyncError {
  constructor(message = "CAPTCHA challenge shown") { super(message, { code: "captcha" }); }
}
class SessionEndedError extends PermitSyncError {
  constructor(message = "portal session ended") { super(message, { code: "session_ended" }); }
}
class RateLimitedError extends PermitSyncError {
  constructor(message = "portal rate limited the session", retryAfterSeconds = null) {
    super(message, { code: "rate_limited" });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
/** The portal returned something the adapter does not recognise (layout/API change). */
class PortalChangedError extends PermitSyncError {
  constructor(message) { super(message, { code: "portal_changed" }); }
}
class TransientError extends PermitSyncError {
  constructor(message) { super(message, { code: "transient" }); }
}
/** The worker lost its lease (cancelled or reclaimed); stop without finishing. */
class LeaseLostError extends PermitSyncError {
  constructor() { super("job lease lost", { code: "lease_lost" }); }
}

/**
 * @returns {{ outcome: string, code: string, retryable: boolean, retryAfterSeconds: number|null }}
 */
function classify(err) {
  if (err instanceof SafetyViolationError) return { outcome: "failed_unrecoverable", code: err.code, retryable: false, retryAfterSeconds: null };
  if (err instanceof MfaRequiredError || err instanceof CaptchaError) return { outcome: "waiting_user", code: err.code, retryable: false, retryAfterSeconds: null };
  if (err instanceof AuthError) return { outcome: "failed_unrecoverable", code: err.code, retryable: false, retryAfterSeconds: null };
  if (err instanceof PortalChangedError) return { outcome: "failed_unrecoverable", code: err.code, retryable: false, retryAfterSeconds: null };
  if (err instanceof RateLimitedError) return { outcome: "failed", code: err.code, retryable: true, retryAfterSeconds: err.retryAfterSeconds || 3600 };
  if (err instanceof SessionEndedError) return { outcome: "failed", code: err.code, retryable: true, retryAfterSeconds: null };
  if (err instanceof LeaseLostError) return { outcome: null, code: err.code, retryable: false, retryAfterSeconds: null };
  return { outcome: "failed", code: (err && err.code) || "transient", retryable: true, retryAfterSeconds: null };
}

/** Message safe to store: no credentials, tokens or emails. */
function safeMessage(err) {
  const { redactText } = require("./redact");
  return redactText(String((err && err.message) || err || "error")).slice(0, 500);
}

module.exports = {
  PermitSyncError,
  SafetyViolationError,
  AuthError,
  MfaRequiredError,
  CaptchaError,
  SessionEndedError,
  RateLimitedError,
  PortalChangedError,
  TransientError,
  LeaseLostError,
  classify,
  safeMessage,
};
