# Phase 2 Report — Worker, DC adapter, queue, downloads policy

Date: 2026-11-06 · Branch `feat/central-permit-repository` (uncommitted) · Level: **Locally tested against fixtures**. The live transport is **Implemented** only: it has never opened a portal session.

## Outcome
- A queued job runs end to end on PGlite: claim → login (fixture) → discovery (28/28) → per-permit sections → `apply_permit_sync_batch` → checkpoint/heartbeat → finish. A second run writes 0 changes and 0 snapshots.
- Crash mid-run and resume from checkpoint completes without duplicates; a guard violation ends the job `failed_unrecoverable`; MFA ends it `waiting_user` and pauses the source; an admin cancel stops the worker without it overwriting the cancellation.
- Phase 1 defect found and fixed: the encryption check never matched real stored credentials (D-024).

## Components and changed files
New (all uncommitted):
- `supabase/migrations/20261111100100_permit_sync_queue.sql`: jobs, append-only events, enqueue/claim/heartbeat/log/finish, admin request/cancel/resume (D-021).
- `scraper-service/permit-sync/core/errors.js`, `worker.js`, `downloads.js`.
- `scraper-service/permit-sync/adapters/dc-projectdox/adapter.js`, `routes.js`, `live-transport.js`.
- `scraper-service/permit-sync/worker-entry.js`.
- Tests: `permit-sync-queue`, `permit-sync-worker`, `permit-sync-live-transport`; helpers `dc-fixture-transport.js`, `permit-sync-rpc.js`.

Modified (Phase 2 work on files new in this branch):
- `supabase/migrations/20261111100000_central_permit_repository.sql`: `_permit_credential_is_encrypted` replaces the `LIKE 'pc_v:1:%'` check.
- `permit-sync/core/safety.js`: pager and `launchRemote` click rules; `dashboard_home` and `sso_hop` request rules (D-023).
- Test helpers and fixtures now use a real envelope shape.

No changes to `server.js`, `register-execution-routes.js`, Arlington, Montgomery or Howard code, or existing migrations.

## Migration details and backward compatibility
- Additive only: two new tables, new functions, no changes to existing objects. Re-runnable (`IF NOT EXISTS`, `CREATE OR REPLACE`).
- The chain test replays all 169 existing migrations plus both new ones on PGlite and fingerprints pre-existing columns, policies, triggers, function bodies/ACLs and table ACLs: identical before and after.
- RLS: jobs and events are readable by platform admins only; writes go through SECURITY DEFINER RPCs callable by the service role (worker) or admins (request/cancel/resume, audited). `_permit_sync_enqueue` is internal and denied to the service role.
- Not applied to any Supabase project (A-1). No cron (A-4).

## Tests
`cd scraper-service && npm run test:permit-sync`: **81 pass, 0 fail** (~40 s).
- Queue (7): one active job per source, dedup, SKIP LOCKED concurrency, lease expiry and reclaim, final-attempt expiry, holder-checked heartbeat/finish, cancel, backoff, auth-failure pause, refusing paused/unencrypted/disabled sources.
- Worker (5): full 28-permit run and idempotent re-run; crash/resume; safety abort; section and permit isolation plus `session_ended` retry; MFA → `waiting_user` and admin cancel.
- Live transport (10, pure functions): approval gate (no browser launched without A-3), auth-phase policy, read-phase routing, MFA/CAPTCHA/refused-login classification, HTTP status → error mapping, dashboard parsing parity with the existing reader, throttle, downloads policy, entrypoint gating, credential decryption with a real envelope.
- Safety (20): pager/`launchRemote` allow and deny cases, including handlers with appended calls, other paths, foreign hosts, non-numeric IDs.
- Envelope parity: SQL check equals JS `looksLikeEncryptedEnvelope` for real output and 8 edge cases.

Regression: scraper-service `npm test` 158/159, code-analyzer-worker `npm test` 75/76; same single pre-existing failures as before Phase 1.

## Gaps (what these tests do not prove)
- Nothing here has touched the live portal. Fixture payloads are redacted copies of Phase 0 observations; deep data exists only for 11854 and 11105.
- The Playwright login, SSO hop, dashboard paging and API calls in `live-transport.js` are untested code. Known unknowns for the first approved run:
  - which XHR paths the dashboard itself loads (unlisted DC paths are refused and fail the run);
  - whether B2C/Okta POSTs back to a DC callback path other than the three allowed;
  - whether any dashboard link uses `launchRemote('Frame.aspx?...')` (refused, D-023);
  - whether one `Session.SessionID` covers every project;
  - MFA on a fresh automated login, and session lifetime under automation.
- Reviews, Info, Reports and SSRS parsers are not implemented, so those sections will be `failed` on a live run. Status, workflows, tasks and files come from the observed JSON API.
- JSON date time zone is still assumed America/New_York (D-017).
- PGlite is real Postgres 16 but not Supabase: auth, storage and roles are stubs.

## Security and data-integrity verification
- Read-only: every browser request and every API call passes the guard; deny patterns run before allow rules; POST to DC hosts is refused in both phases except three OIDC callback paths during login; redirects are not followed for API calls.
- Login is attempted once per job; no Log Out click; no download (DC always skipped).
- The worker refuses plaintext credentials; the decrypted password is held in memory only and never logged. Stored messages pass through `safeMessage` (redaction). Page text used for MFA detection is never logged.
- Evidence tables stay append-only; failed sections write nothing; lost lease stops the worker without finishing.

## Deployment readiness and outstanding approvals
Not deployable yet. Required before any live use:
- A-1 apply migrations (recommend a preview branch first, re-run the RLS matrix there).
- A-2 encryption key in production and re-encryption of plaintext credentials.
- A-3 first live run. Recommended shape: one supervised run with the user present for MFA, discovery and JSON sections only, guard log reviewed afterwards.
- A-4 cron, A-5 worker service, A-7 policy review.
- Open: which DC `portal_credentials` row becomes the automation source (D-018).

## Next phase
Phase 3 (local only): central permit list and detail pages and admin pages behind the `central_permits` feature flag, reading RLS-scoped data.
