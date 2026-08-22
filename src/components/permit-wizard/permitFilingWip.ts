/**
 * Permit Filing capability gates — split Layer 1 Pre-Flight from Layer 2–3 execution.
 *
 * Pre-Flight (agents 01–04): property, license, document, and classification analysis.
 * Execution (approve → portal submit → monitor): kept gated until production-ready.
 */

/** Layer 1: start Pre-Flight and view generated review packages. */
export const PERMIT_FILING_PREFLIGHT_ENABLED = true;

/** Layer 2–3: approve/reject, portal execution, submission, and monitoring. */
export const PERMIT_FILING_EXECUTION_ENABLED = true;

export const PERMIT_FILING_BETA_LABEL = 'Pre-Flight Beta';

export const PERMIT_FILING_BETA_NOTE =
  'Pre-Flight analysis and human review are available. Portal filing requires saved portal credentials.';

export const PERMIT_FILING_EXECUTION_TOOLTIP =
  'Approve or reject after reviewing the Pre-Flight package. Approval starts portal authentication and filing when credentials are configured.';

export const PERMIT_FILING_CREDENTIALS_REQUIRED_MESSAGE =
  'Portal credentials required before filing can continue.';

/** @deprecated Use {@link PERMIT_FILING_PREFLIGHT_ENABLED} — true when Pre-Flight start is blocked. */
export const PERMIT_FILING_WIP = !PERMIT_FILING_PREFLIGHT_ENABLED;

/** @deprecated Use {@link PERMIT_FILING_BETA_LABEL}. */
export const PERMIT_FILING_WIP_LABEL = PERMIT_FILING_BETA_LABEL;

/** @deprecated Use {@link PERMIT_FILING_BETA_NOTE}. */
export const PERMIT_FILING_WIP_NOTE = PERMIT_FILING_BETA_NOTE;

/** @deprecated Use {@link PERMIT_FILING_EXECUTION_TOOLTIP}. */
export const PERMIT_FILING_WIP_ACTION_TOOLTIP = PERMIT_FILING_EXECUTION_TOOLTIP;

/** @deprecated Pre-Flight start is no longer globally blocked. */
export const PERMIT_FILING_WIP_PREFLIGHT_TOOLTIP =
  'Starting the pre-flight pipeline is disabled while Permit Filing is work in progress. You can still open and review the UI.';
