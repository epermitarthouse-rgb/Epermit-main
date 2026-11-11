# Phase 1 report: central permit repository and ingestion

Date: 2026-11-05 · Branch `feat/central-permit-repository` (uncommitted) · Level reached: **Locally tested**. Nothing applied to any Supabase project, deployed, scheduled or run against the portal.

## Outcome

All six Phase 1 validation requirements pass on real Postgres 16 (PGlite), including a replay of the full existing migration chain. 55 new tests pass; existing suites are unchanged from their pre-Phase-1 baseline.

| Requirement | Result | Evidence |
|---|---|---|
| 1. All 28 DC permits represented without duplication | Pass | Discovery creates 28 permits, 28 source links, status split 15/6/4/3; duplicate ids in a listing are rejected and rolled back |
| 2. Identical re-import produces no artificial changes | Pass | 0 change rows, 0 new snapshots, `updated_at` unchanged, only `last_seen_at` advances |
| 3. Failed or incomplete extraction preserves data | Pass | `failed`, `absent`, `partial`, suspicious-empty and count-mismatch sections keep all rows; null fields never overwrite; incomplete discovery never marks permits removed |
| 4. Unauthorized users cannot access restricted records or documents | Pass | 12-actor RLS matrix over all 15 tables and storage objects; writes and service RPCs denied to every `authenticated` user including admins |
| 5. Existing scraping, projects and Code Analyzer V2 unaffected | Pass (locally) | Fingerprint of every pre-existing column, policy, trigger, function and ACL identical before and after the migration; existing suites unchanged |
| 6. Migrations, ingestion and policies pass local tests | Pass | `npm run test:permit-sync` 55/55 |

## Components and changed files

New (all uncommitted):
- `supabase/migrations/20261111100000_central_permit_repository.sql` — tables, indexes, RLS, access functions, ingestion RPCs, audited admin RPCs, private bucket.
- `scraper-service/permit-sync/core/canonical.js` — canonical JSON, sha256, keyed items.
- `scraper-service/permit-sync/core/redact.js` — removes emails, phones, JWTs, signed URL parameters and contact keys from snapshots.
- `scraper-service/permit-sync/core/ingest.js` — batch/discovery builders, integrity guards, supabase-js RPC wrapper.
- `scraper-service/permit-sync/adapters/dc-projectdox/normalize.js` — DC normalizers (discovery, status, workflows, tasks, folders/files, reviews/responses, reports, info; ET→UTC).
- Tests: `tests/permit-repo-ingest.test.js` (10), `tests/permit-repo-rls.test.js` (8), `tests/permit-repo-chain.test.js` (3), `tests/permit-sync-normalize.test.js` (10); helpers `tests/helpers/permit-repo-db.js`, `permit-repo-fixtures.js`, `replay-migrations.js`.

Modified:
- `scraper-service/package.json` / `package-lock.json` — devDependency `@electric-sql/pglite@0.2.17`; new script `test:permit-sync`. The default `test` script is unchanged.
- `docs/permit-repository/{MASTER_PLAN,PROGRESS,DECISIONS,HANDOFF,EXTRACTION_SPEC_DC}.md`.

Not touched: Arlington, Montgomery, Howard and DC manual scrape code; `scrape_jobs` and related queue tables; `projects`; `portal_credentials` and its policies; Code Analyzer V2; frontend.

## Migration details

Tables (all new, RLS enabled): `permit_sync_sources`, `permits`, `permit_source_links`, `permit_section_state`, `permit_review_comments`, `permit_review_responses`, `permit_workflows`, `permit_tasks`, `permit_document_folders`, `permit_documents`, `permit_reports`, `permit_snapshots`, `permit_changes`, `permit_access_grants`, `project_permits`. Bucket `permit-documents` (private).

Key behaviour:
- Identity `(adapter_key, portal_record_id)`; child rows keyed by portal ids (FolderID, FileID per version, WFlowInstanceID, WFlowTaskID, `ref:<REF #>`).
- `apply_permit_sync_batch` (service role only) applies one permit atomically. The database computes the diff (D-015) and records `created`/`updated`/`removed`/`restored` with before/after values. Snapshots are deduplicated by `(permit, section, hash)`.
- Section semantics (D-016): only `ok` removes, and removal is soft. Empty `ok` while rows exist becomes `suspect_empty` unless confirmed.
- Field writes are whitelisted per table; protected columns (`download_status`, `storage_path`, identity, timestamps) cannot be set by a batch.
- Evidence tables are append-only against UPDATE, DELETE and TRUNCATE, including for the service role (D-020).
- Admin RPCs (`admin_grant_permit_access`, `admin_revoke_permit_access`, `admin_link_project_permit`, `admin_unlink_project_permit`, `admin_set_permit_sync_source`) require `admin`/`super_admin` and write `platform_audit_events`. Automation can only be enabled for encrypted (`pc_v:1:`) credentials and for one credential per portal login (D-018).

Backward-compatibility assessment: additive only. No existing table, column, policy, function or grant changes. That's proven by `permit-repo-chain.test.js`, which replays 169 real migrations and compares a fingerprint before and after. The only existing table with a similar name, `permit_filings`, is untouched. Nothing existing reads the new tables. Supabase's default `anon`/`authenticated` table privileges are explicitly revoked on the new tables.

Pre-existing finding (not changed): `20260911200000_super_admin_hierarchy.sql` adds the `super_admin` enum value and uses it in the same file. On a fresh database where the file runs as one transaction, Postgres rejects that (`unsafe use of new value`). Production already has the value, so this only affects fresh environments (`supabase db reset`, new preview branches).

## Security and data-integrity verification

- Access paths tested: admin, super_admin, credential `use` grant, credential `none` grant, inactive user with grant, permit grant, adapter grant, tenant grant via source credential, revoked grant, project member without grant, credential owner without grant row, unrelated user, anon.
- Revocation and suspension take effect on the next query.
- Storage: an object is readable only with permit access **and** a `permit_documents` row in state `stored` at that path. Orphan objects and objects for no-longer-stored documents stay hidden.
- Mutation testing: five deliberately broken migrations were each caught by the tests:
  - access function returns true
  - storage policy without the `stored` check
  - nulls overwrite stored values
  - `partial` sections remove rows
  - suspect-empty guard disabled
- Snapshots are redacted before storage, and comment/response rows carry role labels only (`reviewer_name`/`responder_name` are always null for DC).

## Gaps (what these tests do not prove)

- PGlite is Postgres 16; production Supabase may run a different major version. Supabase `auth` and `storage` schemas, pg_cron, pg_net, Vault and pgcrypto are stand-ins. Storage API behaviour (signed URLs, `owner` handling) is not exercised.
- Fixtures cover 3 of 28 permits in depth (one Resubmit with Reviews, one Approved with folders, and status JSON). Four permits use placeholder ids.
- Active-task field names and the time zone of portal dates are Unverified (spec items 4–5).
- RLS performance: policies call a SECURITY DEFINER function per row. This is fine at 28 permits and needs an `EXPLAIN` review on Supabase before any multi-account scale (Phase 4).
- No live data has been ingested, and nothing has run against Supabase. Passing local tests is not production readiness.

## Deployment readiness and outstanding approvals

Ready for review, not for deployment. Before A-1 (apply migration to production):
1. Review the migration SQL.
2. Apply it to a Supabase preview/staging branch.
3. Re-run the RLS matrix there with real JWTs.
4. Check the Postgres version.
5. Regenerate `src/integrations/supabase/types.ts` if the frontend will query the tables (Phase 3).

Approvals A-1 to A-7 are all still not granted (see `HANDOFF.md`). The MFA and session-lifetime questions remain Phase 2 blockers for unattended automation.
