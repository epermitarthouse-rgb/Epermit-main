# Priority 3: local integration verification

Date: 2026-11-06. Branch `feat/central-permit-repository` (HEAD `46ad9a4`, work uncommitted). Nothing deployed, committed, or run against the live portal.

## 1. Results

| Check | How | Result |
|---|---|---|
| Permit sync and repository | `npm run test:permit-sync` plus `tests/permit-sync-dc-dom.test.js` with `PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright"` | 94 + 21 = **115 pass**, 0 fail |
| Idempotency | `permit-sync-worker`: "end to end: 28 permits ingested through the guard; second run produces no changes"; `permit-repo-ingest`: "identical re-import produces no changes or snapshots" | Pass |
| Completeness | "discovery: all 28 DC permits represented once"; count parity downgrades to `partial` | Pass |
| Change tracking | "a real change is recorded once with before/after values"; "snapshots and change history are append-only" | Pass |
| Partial-extraction protection | "failed, absent, partial and suspicious-empty extractions preserve existing rows"; "discovery: incomplete or short listings never mark permits removed"; "a section failure keeps prior data…"; "Reviews: a failed corrections JSON read falls back to the SSRS report; both failing keeps stored comments" | Pass |
| Crash and resume | "crash mid-run: a new worker resumes from the checkpoint without duplicates" | Pass |
| Management Admin permissions (database) | `permit-repo-rls`: "Management Admin RPCs refuse non-admins and are audited for admins", 12-actor read matrix, anon denied, revocation immediate | Pass |
| Frontend permits, flags, nav | `node --import tsx --test` on `centralPermits`, `PermitRepositoryViews`, `featureFlags`, `moduleFeatureFlags`, `activeProjectSelection` | **84 pass** |
| Arlington (scraper `npm test`) | Arlington suites + `analyze-drawing` | 158/159; the failure is the pre-existing `analyze-drawing` prompt wording (baseline) |
| Manual scraping and other scraper suites | Every file in `scraper-service/tests` | 1608/1696. All 88 failures are in 21 UCI and drawing-analysis files. **The identical set fails on a clean HEAD worktree** (308 tests, 220 pass, 88 fail, same names). None of the 21 files reference permit code |
| Legacy code untouched | `git status` on `scraper-service/app`, `scrapers/`, `lib/`, `accela-scraper.js`, `pgc-eplan-scraper.js`, `server.js`, `supabase/functions`, `PortalDataViewer.tsx`, `code-analyzer-worker` | No changes |
| Code analyzer worker (CAV2) | `code-analyzer-worker npm test` | 75/76; "local permit sample" is the pre-existing baseline failure |
| Production build (PWA) | `vite build` into a temp dir, current tree and clean HEAD worktree | Both compile the app, then **both fail** in the PWA step with `ERR_REQUIRE_ESM` (`workbox-build` → `pretty-bytes`). Pre-existing |

### PWA build root cause

`node_modules/workbox-build/node_modules/pretty-bytes/` is an **empty directory**, last modified 2026-11-05 19:27. `package-lock.json` pins it at 5.6.0 (CommonJS). With the nested copy missing, Node resolves the top-level `pretty-bytes@6.1.1` (ESM-only) and `require()` fails. `package.json` and `package-lock.json` are unchanged from HEAD. The repo is correct; the local install is damaged. Fix: `npm ci` at the repo root (lockfile-faithful). Not run, because it changes installed dependencies; it needs the user's go-ahead.

## 2. Not verified locally

- **Dashboard with seeded data in a browser.** The frontend talks to Supabase (PostgREST and Auth). Local SQL runs on PGlite, which has no PostgREST, and Docker is not running. No local Supabase stack is available. The pages are covered by component render tests and data-layer tests only.
- **Management Admin through the UI.** Covered in the database (RLS and RPC tests), not clicked through in a browser, for the same reason.
- **Playwright `context.request` against the portal** (U-7 client side) and MFA/session lifetime (U-6). Need A-3.

## 3. Supervised A-3 live-run checklist (prepared, not executed)

Preconditions
1. User approves A-3 in writing for one run, one source, a named time window.
2. A-1 applied to a **staging** Supabase branch only, and the RLS matrix re-run there. Production untouched.
3. One DC `portal_credentials` row chosen as the source (D-018). The legacy DC manual scrape is not running on the same login during the window.
4. `PORTAL_CREDENTIALS_ENCRYPTION_KEY` present in the run environment; the credential is an encrypted envelope (D-024).
5. `PERMIT_SYNC_WORKER_ENABLED=true` and `PERMIT_SYNC_LIVE_PORTAL_APPROVED=A-3` set only in the operator's shell, not in any deployed service. `pg_cron` stays off (A-4).

Run (operator present)
6. Enqueue one job for the source with `admin_request_permit_sync`. Start one worker locally; watch `permit_sync_events`.
7. Stop immediately on: MFA or CAPTCHA (expected to park as `waiting_user`), any `safety_violation`, `SessionEnded`, or HTTP 429.
8. Limit to the dashboard plus one project first (11854) if the worker supports a permit filter; otherwise watch the first permit and cancel with `admin_cancel_permit_sync_job` if anything is off.

Verify
9. For 11854: 5 comments, unresolved 1 (DOEE EV), 32 drawings, 5 reports, Info values as in `DC_DEEP_EXTRACTION_REQUIREMENTS.md` §3.2. For 28933: comments from the JSON (38 observed).
10. Re-run once: zero changes and zero new snapshots.
11. Guard log (`guard.violations()`) is empty; no non-GET request; no export or download URL in the request log.
12. Record U-6 (MFA, session lifetime) and U-7 (cookie client) results in the spec; close or keep open.

Rollback
13. Disable the worker env flags; cancel open jobs. Staging data can be dropped. Nothing in production changes.
