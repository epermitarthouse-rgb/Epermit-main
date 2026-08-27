# Environment Variables Inventory

**Document date:** 2026-08-26

**Client confirmed:** secrets stored in shared password vault (category-level).
**Per-variable vault reconciliation:** requires manual confirmation unless dashboard access proves otherwise.

**No secret values in this document.**

Index: [README.md](./README.md)

## Summary

| Metric | Count |
|--------|------:|
| Total unique variable names | 138 |
| Production-required secrets (category 1) | 16 |
| Production-required public configuration (category 2) | 4 |
| Optional feature flags (category 4) | 18 |
| Test/debug variables (categories 6–7) | 15 |
| Requiring dashboard/value confirmation | 134 |

### Category legend

1. Production-required secrets — **16** names
2. Production-required public configuration — **4** names
3. Optional feature configuration — **62** names
4. Feature flags — **18** names
5. Platform-provided variables — **9** names
6. Development/debug variables — **10** names
7. Test/script-only variables — **5** names
8. Deprecated aliases — **2** names
9. Template-only/planned variables — **12** names

## Vercel frontend variables (client/dashboard confirmed)

| Variable | Scope | Value status |
|----------|-------|--------------|
| `VITE_API_BASE_URL` | All Environments | Correctness requires confirmation; expected Railway production URL |
| `VITE_SUPABASE_URL` | All Environments | Correctness requires confirmation; expected project ref `eeqxyjrcldivtpikcpvk` |
| `VITE_SUPABASE_ANON_KEY` | All Environments | Correctness requires confirmation; must be public anon key (not service-role) |
| `VITE_API_BASE_URL` (second entry) | Preview only — branch `feat/lovable-ui-replication` | Likely obsolete; do not delete until Lovable preview formally retired — see [LOVABLE_RETIREMENT_AUDIT.md](./LOVABLE_RETIREMENT_AUDIT.md) |

## Prepared Supabase frontend fix (unmerged)

Branch `fix/frontend-supabase-env-config` (`2a5bf81`, pushed to `origin`): moves hardcoded frontend URL and anon key to Vite environment configuration. Vercel variable **names** are present; **values** must be confirmed correct before merge. Post-merge frontend smoke test required.

| Variable | Required | Notes |
|----------|----------|-------|
| `VITE_SUPABASE_URL` | **Yes** (after fix merge) | Replaces hardcoded configuration on `main` |
| `VITE_SUPABASE_ANON_KEY` | **Yes** | Canonical public anon key |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Optional alias | Accepted if anon key unset — **verified** in prepared `supabaseEnv.ts` |

## Alias resolution

| Names | Resolution |
|-------|------------|
| `VITE_SUPABASE_ANON_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Anon key wins; publishable is legacy alias (**prepared fix**) |
| `SHOVELS_API_KEY` / `SHOVEL_API_KEY` | Both referenced — **requires manual confirmation** which is canonical in production secrets |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_API_KEY_1` | Both referenced — **requires manual confirmation** |

## Critical: no service-role key in frontend

**Verified:** no `SUPABASE_SERVICE_ROLE_KEY` reference under `src/` on `main`.

## Complete inventory

| Variable | Component/service | Category | Required/optional | Default | Referenced in code | Present in template | Production configured | Sensitive | Vault entry status | Owner | Notes |
|----------|-------------------|----------|-------------------|---------|-------------------|---------------------|----------------------|-----------|-------------------|-------|-------|
| `ALLOW_DC_DIAGNOSTICS` | Railway scraper / scripts / other | 6. Development/debug variables | Optional | — | Yes | — | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `ANTHROPIC_API_KEY` | Supabase Edge Functions | 9. Template-only/planned variables | Optional | — | No | Comment only | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | Documented in scraper-service/.env.example comments only |
| `APP_URL` | Supabase Edge Functions | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `ARLINGTON_DURABLE_WORKER_ENABLED` | Railway scraper (portal/scrape) | 4. Feature flags | Optional (feature flag) | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `ARLINGTON_FORCE_RETRY_OVERSIZED_PLAN_REVIEW_DOWNLOADS` | Railway scraper (portal/scrape) | 4. Feature flags | Optional (feature flag) | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `ARLINGTON_WORKER_POLL_MS` | Railway scraper (portal/scrape) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `DEV` | Railway scraper (runtime) | 5. Platform-provided variables | Optional | — | Yes | — | Requires manual confirmation | No (platform/runtime) | Not applicable (platform-provided) | Requires manual confirmation | Vite built-in |
| `DISPLAY` | Railway scraper (runtime) | 5. Platform-provided variables | Optional | — | Yes | — | Requires manual confirmation | No (platform/runtime) | Not applicable (platform-provided) | Requires manual confirmation | — |
| `ELEVENLABS_API_KEY` | Supabase Edge Functions | 1. Production-required secrets | Required (production) | — | Yes | — | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `ELEVENLABS_API_KEY_1` | Supabase Edge Functions | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `EMAIL_FROM` | Railway scraper / scripts / other | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `EPERMIT_REPORT_SCREENSHOT_MAX_B64_CHARS` | Railway scraper / scripts / other | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `EPERMIT_REPORT_SCREENSHOT_MODE` | Railway scraper / scripts / other | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `FIRECRAWL_API_KEY` | Supabase Edge Functions | 1. Production-required secrets | Required (production) | — | Yes | — | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `HOWARD_DEBUG_STATUS_LINKS` | Railway scraper (portal/scrape) | 6. Development/debug variables | Optional | — | Yes | — | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `HOWARD_WEBUI_BASE` | Railway scraper (portal/scrape) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `INGESTION_CONCURRENCY` | Railway ingestion worker | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Yes | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `INGESTION_MAX_BACKOFF_MS` | Railway ingestion worker | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `INGESTION_MIN_BACKOFF_MS` | Railway ingestion worker | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `INGESTION_POLL_INTERVAL_MS` | Railway ingestion worker | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Yes | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `INGESTION_TEMP_DIR` | Railway ingestion worker | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Yes | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `MAPBOX_PUBLIC_TOKEN` | Supabase Edge Functions | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No (public/publishable by design) | Requires manual confirmation | Requires manual confirmation | — |
| `MONTGOMERY_DEBUG_STATUS_LINKS` | Railway scraper (portal/scrape) | 6. Development/debug variables | Optional | — | Yes | — | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `MONTGOMERY_DEBUG_TARGET_PERMIT` | Railway scraper (portal/scrape) | 6. Development/debug variables | Optional | — | Yes | — | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `MONTGOMERY_WEBUI_BASE` | Railway scraper (portal/scrape) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `MS_GRAPH_CLIENT_ID` | Railway scraper (Microsoft Graph) | 1. Production-required secrets | Required (production) | — | Yes | Yes | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `MS_GRAPH_CLIENT_SECRET` | Railway scraper (Microsoft Graph) | 1. Production-required secrets | Required (production) | — | Yes | Yes | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `MS_GRAPH_REDIRECT_URI` | Railway scraper (Microsoft Graph) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Yes | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `MS_GRAPH_TENANT_ID` | Railway scraper (Microsoft Graph) | 1. Production-required secrets | Required (production) | — | Yes | Yes | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `MS_GRAPH_TOKEN_ENCRYPTION_KEY` | Railway scraper (Microsoft Graph) | 1. Production-required secrets | Required (production) | — | Yes | Yes | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `NODE_ENV` | Railway scraper (runtime) | 5. Platform-provided variables | Optional | — | Yes | — | Requires manual confirmation | No (platform/runtime) | Not applicable (platform-provided) | Requires manual confirmation | — |
| `OPENAI_API_KEY` | Supabase Edge Functions | 1. Production-required secrets | Required (production) | — | Yes | Yes | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `PARALLEL_PORT` | Railway scraper / scripts / other | 5. Platform-provided variables | Optional | — | Yes | — | Requires manual confirmation | No (platform/runtime) | Not applicable (platform-provided) | Requires manual confirmation | — |
| `PGC_API` | Railway scraper (portal/scrape) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `PGC_BASE` | Railway scraper (portal/scrape) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `PGC_DETAIL_OPEN_HARNESS` | Railway scraper (portal/scrape) | 6. Development/debug variables | Optional | — | Yes | — | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `PGC_EPLAN_EMAIL` | Railway scraper (portal/scrape) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `PGC_EPLAN_LOGIN_URL` | Railway scraper (portal/scrape) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `PGC_EPLAN_PASSWORD` | Railway scraper (portal/scrape) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `PGC_LOGIN_ONLY_HARNESS` | Railway scraper (portal/scrape) | 6. Development/debug variables | Optional | — | Yes | — | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `PGC_PORTAL_ORIGIN` | Railway scraper (portal/scrape) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `PGC_PROJECTDOX_API_ORIGIN` | Railway scraper (portal/scrape) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `PGC_TARGET_PERMIT` | Railway scraper (portal/scrape) | 6. Development/debug variables | Optional | — | Yes | — | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `PGC_WEBUI` | Railway scraper (portal/scrape) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `PGC_WEBUI_BASE` | Railway scraper (portal/scrape) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `PLAYWRIGHT_BROWSERS_PATH` | Railway scraper | 5. Platform-provided variables | Optional | — | Yes | — | Requires manual confirmation | No (platform/runtime) | Not applicable (platform-provided) | Requires manual confirmation | — |
| `PLAYWRIGHT_HEADLESS` | Railway scraper | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `PORT` | Railway scraper (runtime) | 5. Platform-provided variables | Optional | — | Yes | — | Requires manual confirmation | No (platform/runtime) | Not applicable (platform-provided) | Requires manual confirmation | — |
| `PORTAL_CREDENTIALS_ENCRYPTION_KEY` | Supabase Edge Functions | 1. Production-required secrets | Required (production) | — | Yes | Yes | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `QB_CLIENT_ID` | Railway scraper (QuickBooks) | 1. Production-required secrets | Required (production) | — | Yes | Yes | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `QB_CLIENT_SECRET` | Railway scraper (QuickBooks) | 1. Production-required secrets | Required (production) | — | Yes | Yes | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `QB_DEFAULT_ITEM_ID` | Railway scraper (QuickBooks) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `QB_DEFAULT_ITEM_NAME` | Railway scraper (QuickBooks) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `QB_DEV_API_TEST` | Railway scraper (QuickBooks) | 6. Development/debug variables | Optional | — | Yes | Comment only | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `QB_DEV_PAYLOAD_PREVIEW` | Railway scraper (QuickBooks) | 6. Development/debug variables | Optional | — | Yes | Comment only | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `QB_ENV` | Railway scraper (QuickBooks) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Yes | **Verified production** (`QB_ENV=production`, connected) | No | Requires manual confirmation | Requires manual confirmation | — |
| `QB_FAILURE_REDIRECT_URL` | Railway scraper (QuickBooks) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Yes | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `QB_MINOR_VERSION` | Railway scraper (QuickBooks) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Yes | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `QB_REDIRECT_URI` | Railway scraper (QuickBooks) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Yes | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `QB_SUCCESS_REDIRECT_URL` | Railway scraper (QuickBooks) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Yes | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `QB_TOKEN_ENCRYPTION_KEY` | Railway scraper (QuickBooks) | 1. Production-required secrets | Required (production) | — | Yes | Yes | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | Encrypts refresh tokens **and** signs OAuth CSRF state (`qb-oauth-state.service.js`) |
| `RAILWAY_ENVIRONMENT` | Railway scraper (runtime) | 5. Platform-provided variables | Optional | — | Yes | — | Requires manual confirmation | No (platform/runtime) | Not applicable (platform-provided) | Requires manual confirmation | — |
| `RAILWAY_ENVIRONMENT_NAME` | Railway scraper (runtime) | 5. Platform-provided variables | Optional | — | Yes | — | Requires manual confirmation | No (platform/runtime) | Not applicable (platform-provided) | Requires manual confirmation | — |
| `REPORTS_FROM_EMAIL` | Supabase Edge Functions | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `RESEND_API_KEY` | Supabase Edge Functions | 1. Production-required secrets | Required (production) | — | Yes | — | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `RESEND_FROM` | Railway scraper / scripts / other | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `RESEND_FROM_EMAIL` | Railway scraper / scripts / other | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `SCRAPER_DEBUG_ARTIFACTS` | Railway scraper | 6. Development/debug variables | Optional | — | Yes | — | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `SCRAPER_FORCE_HEADED` | Railway scraper | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `SCRAPER_FORCE_HEADLESS` | Railway scraper | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `SCRAPER_HEADLESS` | Railway scraper | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `SCRAPER_SERVICE_URL` | Railway scraper | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `SHOVELS_API_KEY` | Supabase Edge Functions | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `SHOVEL_API_KEY` | Supabase Edge Functions | 8. Deprecated aliases | Optional | — | Yes | — | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | Deprecated alias of SHOVELS_API_KEY — confirm canonical name in production |
| `SITE_URL` | Supabase Edge Functions | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `STRIPE_SECRET_KEY` | Supabase Edge Functions | 1. Production-required secrets | Required (production) | — | Yes | — | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | Supabase Edge Functions | 1. Production-required secrets | Required (production) | — | Yes | — | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `SUPABASE_ANON_KEY` | Railway scraper / scripts / other | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No (public/publishable by design) | Requires manual confirmation | Requires manual confirmation | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Railway scraper / scripts / other | 1. Production-required secrets | Required (production) | — | Yes | Yes | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `SUPABASE_STORAGE_OBJECT_MAX_BYTES` | Railway scraper / scripts / other | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Yes | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `SUPABASE_TEST_EMAIL` | Railway scraper / scripts / other | 7. Test/script-only variables | Optional | — | Yes | — | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Test/script only |
| `SUPABASE_TEST_PASSWORD` | Railway scraper / scripts / other | 7. Test/script-only variables | Optional | — | Yes | — | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | Test/script only |
| `SUPABASE_URL` | Railway scraper / scripts / other | 2. Production-required public configuration | Required (production) | — | Yes | Yes | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_AUTO_STAGE_TRANSITIONS` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_CLAUDE_CLASSIFIER_ENABLED` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | No | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_CLAUDE_CLASSIFIER_MODEL` | Railway scraper (UCI) | 9. Template-only/planned variables | Optional | — | No | Comment only | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Documented in scraper-service/.env.example comments only |
| `UCI_CLEAN_SLATE_ALLOW_PRODUCTION` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_DOCUMENT_AI_MAX_RETRIES` | Railway scraper (UCI) | 9. Template-only/planned variables | Optional | — | No | Comment only | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Documented in scraper-service/.env.example comments only |
| `UCI_DOCUMENT_AI_TIMEOUT_MS` | Railway scraper (UCI) | 9. Template-only/planned variables | Optional | — | No | Comment only | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Documented in scraper-service/.env.example comments only |
| `UCI_DOCUMENT_OCR_ENABLED` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | No | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_DOCUMENT_OCR_MAX_PAGES_PER_RUN` | Railway scraper (UCI) | 9. Template-only/planned variables | Optional | — | No | Comment only | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Documented in scraper-service/.env.example comments only |
| `UCI_DOCUMENT_OCR_MIN_CONFIDENCE` | Railway scraper (UCI) | 9. Template-only/planned variables | Optional | — | No | Comment only | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Documented in scraper-service/.env.example comments only |
| `UCI_DOCUMENT_OCR_MODEL` | Railway scraper (UCI) | 9. Template-only/planned variables | Optional | — | No | Comment only | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Documented in scraper-service/.env.example comments only |
| `UCI_DOCUMENT_VISION_ENABLED` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | No | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_DOCUMENT_VISION_MAX_PAGES_PER_RUN` | Railway scraper (UCI) | 9. Template-only/planned variables | Optional | — | No | Comment only | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Documented in scraper-service/.env.example comments only |
| `UCI_DOCUMENT_VISION_MODEL` | Railway scraper (UCI) | 9. Template-only/planned variables | Optional | — | No | Comment only | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Documented in scraper-service/.env.example comments only |
| `UCI_DURABLE_JOBS_ENABLED` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_DURABLE_WORKER_ENABLED` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_EMAIL_ALLOWED_RECIPIENTS` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_EMAIL_ALLOWED_SENDERS` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_EMAIL_INBOUND_WEBHOOK_SECRET` | Railway scraper (UCI) | 1. Production-required secrets | Required (production) | — | Yes | Comment only | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `UCI_EMAIL_LIVE_SUBMISSION_ENABLED` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_EQUIPMENT_CHECKIN_HOUR_UTC` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_GEOCODE_MIN_CONFIDENCE` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_GRAPH_INBOUND_LOOKBACK_HOURS` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_GRAPH_INBOUND_POLLER_ENABLED` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_GRAPH_INBOUND_POLL_MS` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_GRAPH_INBOUND_TOP` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_LIFECYCLE_CATCHUP_MS` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_LIFECYCLE_SCHEDULER_ENABLED` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_LLM_CLASSIFIER_ENABLED` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | No | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_LLM_CLASSIFIER_MODEL` | Railway scraper (UCI) | 9. Template-only/planned variables | Optional | — | No | Comment only | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Documented in scraper-service/.env.example comments only |
| `UCI_LLM_CLASSIFIER_PROVIDER` | Railway scraper (UCI) | 9. Template-only/planned variables | Optional | — | No | Comment only | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Documented in scraper-service/.env.example comments only |
| `UCI_LLM_CLASSIFIER_TIMEOUT_MS` | Railway scraper (UCI) | 9. Template-only/planned variables | Optional | — | No | Comment only | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Documented in scraper-service/.env.example comments only |
| `UCI_NORMALIZED_SYNC_ENABLED` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_OPS_SWEEP_TOKEN` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `UCI_PEPCO_LIVE_SUBMISSION_ENABLED` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_PERSIST_LOCAL_DOCUMENTS` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_QB_RETRY_MS` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_RECOVERY_OPERATOR_USER_ID` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | Yes | Client confirmed (category); per-variable reconciliation required | Requires manual confirmation | — |
| `UCI_TERRITORY_ALLOW_LOCAL_FALLBACK` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_TERRITORY_BOUNDARY_BUFFER_MILES` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_TERRITORY_DATASET_VERSION` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_TERRITORY_DATA_DIR` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_TERRITORY_LOCAL_CACHE_DIR` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_TERRITORY_STORAGE_BUCKET` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_TERRITORY_STORAGE_ENABLED` | Railway scraper (UCI) | 4. Feature flags | Optional (feature flag) | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_TERRITORY_STORAGE_PREFIX` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | Comment only | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `UCI_WORKER_POLL_MS` | Railway scraper (UCI) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No | Requires manual confirmation | Requires manual confirmation | — |
| `USER` | Railway scraper (runtime) | 5. Platform-provided variables | Optional | — | Yes | — | Requires manual confirmation | No (platform/runtime) | Not applicable (platform-provided) | Requires manual confirmation | — |
| `VERIFY_MEMBER_ID` | Railway scraper / scripts / other | 7. Test/script-only variables | Optional | — | Yes | — | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Test/script only |
| `VERIFY_OWNER_ID` | Railway scraper / scripts / other | 7. Test/script-only variables | Optional | — | Yes | — | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Test/script only |
| `VERIFY_PROJECT_ID` | Railway scraper / scripts / other | 7. Test/script-only variables | Optional | — | Yes | — | Requires manual confirmation | No | Not applicable | Requires manual confirmation | Test/script only |
| `VITE_API_BASE_URL` | Frontend (Vite/Vercel) | 2. Production-required public configuration | Required (production) | — | Yes | Yes | Client/dashboard confirmed (names present in Vercel) | No (public in browser bundle) | Vercel names confirmed; values require confirmation | Requires manual confirmation | Expected target https://epermit-main-production.up.railway.app; Preview-only override exists for feat/lovable-ui-replication |
| `VITE_SCRAPER_USE_SAME_ORIGIN` | Frontend (Vite/Vercel) | 3. Optional feature configuration | Optional / context-dependent | — | Yes | — | Requires manual confirmation | No (public in browser bundle) | Requires manual confirmation | Requires manual confirmation | — |
| `VITE_SUPABASE_ANON_KEY` | Frontend (Vite/Vercel) | 2. Production-required public configuration | Required (production) | — | Yes | Yes | Client/dashboard confirmed (names present in Vercel) | No (public in browser bundle) | Vercel names confirmed; values require confirmation | Requires manual confirmation | Public anon/publishable key only; never service-role |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend (Vite/Vercel) | 8. Deprecated aliases | Optional | — | Yes | — | Requires manual confirmation | No (public in browser bundle) | Requires manual confirmation | Requires manual confirmation | Legacy alias for anon key in prepared fix branch |
| `VITE_SUPABASE_URL` | Frontend (Vite/Vercel) | 2. Production-required public configuration | Required (production) | — | Yes | Yes | Client/dashboard confirmed (names present in Vercel) | No (public in browser bundle) | Vercel names confirmed; values require confirmation | Requires manual confirmation | Expected project ref eeqxyjrcldivtpikcpvk; value correctness requires confirmation |

## Related

- [DEPLOY.md](./DEPLOY.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
