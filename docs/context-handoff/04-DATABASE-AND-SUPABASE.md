# 04 — Database and Supabase

**Extraction date:** 2026-10-19  
**Project ref:** `eeqxyjrcldivtpikcpvk` (**VERIFIED** `supabase/config.toml`).  
**Host:** `https://eeqxyjrcldivtpikcpvk.supabase.co` (public project URL; not a secret).

This extraction did **not** connect to the live database, did **not** run migrations, and did **not** call `supabase db dump`. Repository SQL is the schema definition. Hosted schema may differ. That difference is the main risk in this file.

## How schema is managed

- Source of truth in git: `supabase/migrations/` — **160 files**, filenames from `20260112060817_...sql` through `20260919010000_profiles_onboarding_completed.sql`.
- No Prisma or Drizzle.
- Generated TypeScript types are documented as stale relative to migrations (`docs/current-data-model.md` §4). Regenerate after any apply. Do not hand-edit types to “match” a guess.
- `config.toml` in this repo sets `project_id` and per-function `verify_jwt`. It does **not** contain `[auth]`, `[storage]`, or `[db]` blocks. Hosted Auth, SMTP, and storage settings are **UNKNOWN** from the repo.

## Auth model

| Piece | Behavior | Evidence |
|-------|----------|----------|
| Signup | Trigger `on_auth_user_created` → `handle_new_user()` inserts `profiles` | `20260112060817_0123b98a-9fff-4f8a-8087-f687d24a00bd.sql` |
| New-user onboarding flag | Later revision sets `onboarding_completed = false` | `20260919010000_profiles_onboarding_completed.sql` |
| Roles | Enum `app_role`: `admin`, `moderator`, `user`, later `super_admin` | `20260112170034_...sql`, `20260911200000_super_admin_hierarchy.sql` |
| Role check | `has_role(uid, app_role)` SECURITY DEFINER | Same role migration |
| Platform admin | `is_platform_admin` / `is_super_admin` | `20260911200000_super_admin_hierarchy.sql` |
| Deactivation | `profiles.access_status` (`active` / `deactivated`); `is_user_active` | `20260910120000_admin_governance_foundation.sql` |
| Admin-created users | `must_change_password`, `created_by_admin`, `password_changed_at` | `20260911140000_admin_created_user_password_flags.sql` |
| Frontend gate | `ProtectedLayoutRoute` signs out deactivated profiles and forces password change | `src/components/auth/ProtectedRoute.tsx` |

Frontend client: `src/lib/supabase.ts` hardcodes the project URL and the anon key (**VERIFIED** file; values intentionally omitted). Branch `fix/frontend-supabase-env-config` @ `2a5bf81` reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and is **not merged**. The anon key is public by design. The service-role key must never be bundled.

`memory.md` mentions `PublicOnlyRoute`. That component is not in `src/` on this commit. Do not recreate it unless a product task asks for a public-only redirect.

## Access control (RLS)

RLS is enabled on user-facing tables. Policies call SECURITY DEFINER helpers instead of repeating joins.

| Helper | Meaning | Where defined or last replaced |
|--------|---------|--------------------------------|
| `has_project_admin_access` | Owner or team admin | `20260113051923_026ba2e6-bca1-4c39-98ae-12c5745cd10e.sql` |
| `has_project_access` / `has_project_editor_access` | Resolved by `_resolve_project_access_level` | Replaced in the 2026-09-11 access-model chain, enforced by `20260911190000_enforce_default_override_has_project_access.sql` |
| `user_project_access_overrides` | Exceptions to the default | `20260911170000_default_override_access_model.sql` |
| `has_tenant_access` / `can_access_tenant` | Tenant membership; blocks demo↔production crossover except platform admins | `20260715140000_row2_tenant_foundation.sql` and later super-admin edits |
| `has_uci_row_access` / `has_uci_row_editor_access` | UCI rows follow project access | `20260911220000_uci_row_access_align_default_access.sql` |
| `_resolve_feature_access_level` / `assert_feature_access` | Per-feature none/read/write | Governance + `20260911150000_global_feature_permissions.sql` |
| `credential_has_grant` / `assert_credential_grant` | Sharing portal credentials | Governance foundation |
| `assert_scraped_data_access` | Jurisdiction/portal scrape scope | Governance foundation |

**Behavior change that is easy to miss:** after the 2026-09-11 migrations, an active user can have **default write access to projects** unless an override or deactivation denies it. That is broader than the original “owner or explicit team member” policies in the January `projects` table migration. Read `20260911170000_default_override_access_model.sql` before tightening or loosening project policies.

Service-role clients (scraper, both workers, many Edge Functions) bypass RLS. Their authorization has to be in function code or RPC guards (`_admin_require_platform_admin`, `_admin_require_backend_caller`).

Approval of a parsed-comment response is additionally enforced by trigger `enforce_parsed_comment_response_approval`, which requires project admin (`20260620120000_parsed_comments_response_approval.sql`).

## Important tables

Grouped by the migration that introduced them. Later migrations alter most of these.

| Table | Role | Creating migration |
|-------|------|--------------------|
| `profiles` | User profile | `20260112060817_...sql` |
| `user_roles` | Platform roles | `20260112170034_...sql` |
| `saved_calculations` | ROI calculator saves | `20260112060817_...sql` |
| `jurisdiction_subscriptions`, `jurisdiction_notifications` | Jurisdiction comms | `20260112063955_...sql` and neighbors |
| `projects` | Permit project | `20260113050946_...sql` |
| `project_documents` | File metadata | `20260113051524_...sql` |
| `project_team_members`, `project_invitations` | Sharing | `20260113051923_...sql` |
| `inspections`, `punch_list_items` | Field work | `20260113052641_...sql` |
| `portal_credentials` | Portal usernames and passwords | `20260210000000_portal_credentials.sql` |
| `parsed_comments` | Review comments | `20260210100000_parsed_comments.sql` |
| `permit_filings`, `agent_runs`, `municipality_configs` | Wizard | `20260307000003_permit_wizard_tables.sql` |
| `response_package_drafts`, `company_branding`, `plan_markups` | Response packages | `20260307000001` / `20260307000002` |
| `shadow_predictions`, `baseline_actions`, `audit_trail` | Shadow mode | `20260303000000_shadow_mode_schema.sql` |
| `quickbooks_connections` | OAuth tokens (service-role) | `20260505120000_quickbooks_oauth_foundation.sql` |
| `microsoft_mailbox_connections` | Graph OAuth | `20260519103000_microsoft_mailbox_connections.sql` |
| `utility_providers`, `coordination_*` | UCI | `20260509120000_uci_foundation.sql` plus many `202607*` / `202608*` alters |
| `project_document_chunks`, `document_ingestion_jobs` | RAG | `20260606140000_pgvector_document_ingestion.sql` |
| `scrape_jobs`, `scrape_events` | Durable scrape queue | `20260620140000_scrape_jobs_and_events.sql` |
| `scrape_file_results` | Per-file progress | `20260622120000_scrape_file_results.sql` |
| `tenants`, `tenant_memberships` | Multi-tenant | `20260715140000_row2_tenant_foundation.sql` |
| `code_analyzer_*` runs, sheets, jobs, segments | Analyzer v2 | `20260821120000_code_analyzer_runs_and_sheets.sql` and the `20260824*` chain |
| `governance_config`, `platform_audit_events`, permission tables | Admin v2 | `20260910120000_admin_governance_foundation.sql` |
| `feature_flags`, `feature_flag_audit` | Platform toggles | `20260918200000_feature_flags_platform_control.sql` |
| `notification_preferences` | Jurisdiction email prefs | `20260918210000_platform_notifications_production.sql` |

`contact_submissions` is referenced by product copy in places and was **not** found as `CREATE TABLE` under `supabase/migrations/` (**UNKNOWN** live table).

### Columns used by the app but not created in migrations

**VERIFIED** gap in the repo, **UNKNOWN** on the live database (`docs/current-data-model.md` §4, rechecked):

1. `projects.portal_data` (JSONB). The January `projects` CREATE has no such column. Migrations add `portal_data_hash` (`20260304000000_portal_data_hash_and_shadow_trigger.sql`) and mention `portal_data` in comments. Scrapers and viewers depend on the JSONB column. If it exists in production, it was added outside this migration history (dashboard SQL or a lost file).
2. `profiles.subscription_*`. `useAuth` and `stripe-webhook` use subscription fields. No matching migration was found.

Do not “fix” these by inventing a migration during an unrelated task. Confirm live columns first (`information_schema.columns`), then add a migration that matches reality (`ADD COLUMN IF NOT EXISTS`) if the column is missing from git only.

### Portal data contract

`portal_data` is JSONB and **not** one schema. Consumers:

- Generic ProjectDox viewers: tabs, key-values, tables, PDFs.
- `AccelaProjectView` when `portalData.portalType === "accela"`: `tabs.status`, `tabs.attachments`, `tabs.inspections`, `tabs.relatedRecords`, `tabs.payments`, `tabs.reports.pdfs`.
- Baltimore routing in `src/lib/portalView.ts` when the credential resolves as Baltimore.

Changing a scraper key without updating the viewer drops the field on screen. `memory.md` §5.

## Storage buckets (from migrations)

| Bucket | Public | Migration |
|--------|--------|-----------|
| `project-documents` | false | `20260113051524_...sql`. Later migrations allow PDF, DOCX, XLSX/CSV, legacy DOC, and raise the limit (250MB in `20260606150000_project_documents_250mb_limit.sql`) |
| `inspection-photos` | true | `20260116135308_...sql` |
| `exports` | false | `20260223000000_storage_exports_bucket.sql` |

Storage policies for `project-documents` were tightened for tenant/team access in `20260821150000_project_documents_tenant_team_rls.sql`.

**Not in main migrations:** a `signatures` bucket appears only under `reference/lovable-ui/`. Do not assume it exists in production.

**VERIFIED** in `scraper-service/app/register-execution-routes.js` (`STORAGE_BUCKET_SLUG`, `ensureStorageBucket`): if bucket `project-drawings` is missing, the scraper creates it with `public: true`. If it exists and is private, the same function calls `updateBucket(..., { public: true })`. No migration in this repo inserts that bucket. Whether production currently has the bucket is **UNKNOWN** until Storage is listed. Drawings in a public bucket are a security review item.

Supabase Storage is **not** included in database backups. `docs/diligence-readiness/RESTORE.md` is the recovery note. A database restore without a storage plan loses files.

## Edge Functions

51 directories with `index.ts` under `supabase/functions/`, plus `_shared/` which is not deployed as its own function.

`supabase/config.toml` sets `verify_jwt = false` for **36** functions. The 2026-08-27 production audit said all 51 were `verify_jwt = false`. That sentence is **stale**. The 15 functions with **no** config block (platform default **UNKNOWN** until deploy settings are read) are:

`check-portal-status`, `circuit-breaker-check`, `document-preparation-agent`, `export-weekly-report`, `fetch-permit-data`, `generate-response`, `license-validation-agent`, `parse-permit-comments`, `permit-classifier-agent`, `permit-status-monitor`, `permitwizard-execute`, `permitwizard-preflight`, `property-intelligence-agent`, `shadow-evaluator`, `shadow-metrics`.

Config comments say some AI functions verify JWTs themselves (ES256) because the platform verifier expected HS256. **Per-function auth was not re-audited in this extraction.** Assume `verify_jwt = false` means “the function must check the caller,” not “the function is public on purpose,” until the handler is read.

| Group | Functions |
|-------|-----------|
| Comment pipeline | `intake-pipeline-agent`, `comment-parser-agent`, `discipline-classifier-agent`, `context-reference-engine`, `auto-router-agent`, `guardian-quality-agent`, `parse-manual-comment-letter`, `parse-permit-comments`, `generate-response`, `generate-grounded-response` |
| Permit wizard agents | `permitwizard-preflight`, `permitwizard-execute`, `permit-classifier-agent`, `document-preparation-agent`, `license-validation-agent`, `property-intelligence-agent`, `validate-completeness-agent` |
| Drawing | `analyze-drawing` (Edge path; the V2 worker prefers the scraper route) |
| Ingestion trigger | `ingest-project-document` |
| Stripe | `create-checkout`, `customer-portal`, `stripe-webhook`, `check-subscription` |
| Email | `send-welcome-email`, `send-contact-email`, `send-project-team-invitation`, `send-inspection-reminders`, `send-deadline-reminders`, `send-checklist-report`, `send-checklist-signed-notification`, `send-epermit-status-email`, `send-jurisdiction-notification`, `process-drip-emails`, `admin-drip-campaigns`, `process-scheduled-notifications`, `process-scheduled-checklist-reports`, `retry-failed-report-emails`, `send-test-scheduled-report`, `export-weekly-report` |
| Integrations | `shovels-api`, `fetch-permit-data`, `get-mapbox-token`, `elevenlabs-tts`, `check-portal-status`, `permit-status-monitor`, `epermit-submit`, `validate-url` |
| Shadow / ops | `shadow-evaluator`, `shadow-metrics`, `circuit-breaker-check` |
| Export | `export-response-package` |

Deploy example from `memory.md` (only when a human asks to deploy functions):

```bash
supabase link --project-ref eeqxyjrcldivtpikcpvk
supabase functions deploy intake-pipeline-agent
```

Secrets are set with `supabase secrets set`. Names typically include `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Resend, Stripe. Never write the values into git.

## Scheduled jobs defined in SQL

Extensions `pg_cron` and `pg_net` are enabled in `20260113041221_32e4e45f-564e-41f4-943d-65b7cb4ea721.sql`.

| Job | Schedule | Target |
|-----|----------|--------|
| `process-scheduled-checklist-reports` | `*/15 * * * *` | Edge `process-scheduled-checklist-reports` via `invoke_process_scheduled_checklist_reports()` |
| `process-scheduled-notifications` | `*/5 * * * *` | `invoke_process_scheduled_notifications()` |
| `process-drip-emails` | `0 * * * *` | `invoke_process_drip_emails()` |

Schedules are wrapped so a local database without `pg_cron` skips them. Hosted install status is **UNKNOWN**.

Invoke helpers read Vault secrets `supabase_project_url` and `supabase_service_role_key` (`20260918240000_cron_vault_invoke_secrets.sql`, `20260918250000_cron_invoke_net_http_post.sql`). If those Vault secrets are missing, cron runs will not authenticate. Do not paste Vault contents into docs.

`send-inspection-reminders` and `send-deadline-reminders` have **no** `cron.schedule` in the migrations that were inventoried. An external scheduler may call them. **UNKNOWN**.

## RPCs worth knowing before writing SQL

| Area | Functions |
|------|-----------|
| Admin | `admin_get_effective_permissions`, `admin_overview_metrics`, `admin_list_member_directory`, `admin_list_audit_events`, `admin_deactivate_user`, `admin_activate_user`, `admin_set_feature_permission`, `admin_set_credential_grant`, `admin_set_scraped_data_scope`, `admin_copy_permissions` |
| Flags | `get_feature_flags`, `set_feature_flag` |
| Jurisdictions | `bulk_upsert_jurisdiction_volume`, `get_jurisdiction_subscription_count`, `upsert_notification_preferences`, `unsubscribe_jurisdiction_emails` |
| Invites | `create_project_team_invitation`, `accept_project_team_invitation`, `revoke_project_team_invitation`, `resend_project_team_invitation` |
| Scrape | `enqueue_or_get_arlington_scrape_job`, `claim_arlington_scrape_job`, `publish_scrape_event` |
| UCI jobs | `enqueue_or_get_uci_portal_sync_job`, `claim_uci_graph_inbound_mailbox`, `list_accessible_uci_projects` |
| Analyzer | `create_code_analyzer_run_async_v2`, `claim_code_analyzer_sheet_job`, `complete_code_analyzer_sheet_job`, `claim_code_analyzer_ingestion_job`, `create_code_modification_run_async_v2`, `match_analyzer_spec_chunks` |
| Reports | `claim_due_scheduled_checklist_reports` |
| QuickBooks | `claim_project_milestone_invoice` |

## Migrations whose headers say not to apply yet

These files contain “DO NOT apply” (or the same phrase). Read the header before `supabase db push`:

- `20260725040000_architecture_replication_checklist.sql`
- `20260805040000_scheduled_reports_cron_and_claim.sql`
- `20260918190000_jurisdiction_subscription_integrity_and_csv_rpc.sql`
- `20260918200000_feature_flags_platform_control.sql`
- `20260918210000_platform_notifications_production.sql`
- `20260918220000_module_feature_flags.sql`
- `20260918230000_onboarding_drip_cron.sql`

Whether any of them are already on the hosted database is **UNKNOWN**. Applying the rest of the 160 files blindly can duplicate cron jobs or turn on enforcement. The admin implementation note describes a `legacy` → `shadow` → `enforce` cutover (`docs/admin-dashboard/IMPLEMENTATION.md`). Production `enforce_mode` was not queried.

## Security requirements for future changes

- New tables that hold project data need RLS and should call `has_project_access` / editor helpers, not only `user_id = auth.uid()`, or team members will be locked out or, after the default-write model, over-exposed. Read the current helper before copying an old policy.
- Portal passwords in `portal_credentials` are sensitive. Do not log them. Do not return them to the browser except through the existing authenticated credential API.
- QuickBooks and Microsoft tokens are service-role data. Do not add anon SELECT policies.
- Edge Functions with `verify_jwt = false` need an explicit caller check (user JWT, service role, webhook signature, or cron secret). Adding a new function without that check is a defect.
- Do not put `SUPABASE_SERVICE_ROLE_KEY` in `VITE_*` or `src/`.
- `scripts/test-intake-pipeline.js` has historically embedded an anon key. Treat that file as debt. Do not add more keys to scripts.

## Related docs

- `docs/current-data-model.md` — table-oriented snapshot, 2026-07 era plus later notes. Use it as a map, then confirm the migration.
- `docs/admin-dashboard/ADMIN_DATA_AND_API_CONTRACTS.md` — admin RPC contracts (design).
- `docs/diligence-readiness/RESTORE.md` — backup and storage gap.
