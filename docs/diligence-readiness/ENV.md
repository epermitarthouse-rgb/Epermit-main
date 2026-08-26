# Environment Variables Inventory

**Document date:** 2026-08-26
**Total names scanned:** 122

**Client confirmed:** secrets stored in shared password vault.
**Per-variable vault reconciliation:** requires manual confirmation unless dashboard access proves otherwise.

**No secret values in this document.**

Index: [README.md](./README.md)

## Prepared Supabase frontend fix (unmerged)

| Variable | Required | Notes |
|----------|----------|-------|
| `VITE_SUPABASE_URL` | **Yes** (after fix merge) | Replaces hardcoded URL on `main` |
| `VITE_SUPABASE_ANON_KEY` | **Yes** | Canonical public key |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Optional alias | Accepted if anon key unset — **verified** in prepared `supabaseEnv.ts` |

**Do not merge fix until Vercel production + preview define URL and anon key.**

## Alias resolution

| Names | Resolution |
|-------|------------|
| `VITE_SUPABASE_ANON_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Anon key wins; publishable is legacy alias (**prepared fix**) |
| `SHOVELS_API_KEY` / `SHOVEL_API_KEY` | Both referenced — **requires manual confirmation** which is canonical in production secrets |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_API_KEY_1` | Both referenced — **requires manual confirmation** |

## Critical: no service-role key in frontend

**Verified:** no `SUPABASE_SERVICE_ROLE_KEY` reference under `src/` on `main`.

## Complete inventory

| Variable | Component | Referenced in code | In template | Production configured | Vault entry confirmed | Owner | Notes |
|----------|-----------|-------------------|-------------|----------------------|----------------------|-------|-------|
| `ALLOW_DC_DIAGNOSTICS` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `APP_URL` | Supabase Edge Functions | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `ARLINGTON_DURABLE_WORKER_ENABLED` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `ARLINGTON_FORCE_RETRY_OVERSIZED_PLAN_REVIEW_DOWNLOADS` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `ARLINGTON_WORKER_POLL_MS` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `DEV` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation | Vite built-in |
| `DISPLAY` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `ELEVENLABS_API_KEY` | Supabase Edge Functions | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `ELEVENLABS_API_KEY_1` | Supabase Edge Functions | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `EMAIL_FROM` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `EPERMIT_REPORT_SCREENSHOT_MAX_B64_CHARS` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `EPERMIT_REPORT_SCREENSHOT_MODE` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `FIRECRAWL_API_KEY` | Supabase Edge Functions | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `HOWARD_DEBUG_STATUS_LINKS` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `HOWARD_WEBUI_BASE` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `INGESTION_CONCURRENCY` | Railway ingestion worker | Yes | document-ingestion-worker/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `INGESTION_MAX_BACKOFF_MS` | Railway ingestion worker | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `INGESTION_MIN_BACKOFF_MS` | Railway ingestion worker | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `INGESTION_POLL_INTERVAL_MS` | Railway ingestion worker | Yes | document-ingestion-worker/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `INGESTION_TEMP_DIR` | Railway ingestion worker | Yes | document-ingestion-worker/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `MAPBOX_PUBLIC_TOKEN` | Supabase Edge Functions | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `MONTGOMERY_DEBUG_STATUS_LINKS` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `MONTGOMERY_DEBUG_TARGET_PERMIT` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `MONTGOMERY_WEBUI_BASE` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `MS_GRAPH_CLIENT_ID` | Railway scraper (Microsoft Graph) | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `MS_GRAPH_CLIENT_SECRET` | Railway scraper (Microsoft Graph) | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `MS_GRAPH_REDIRECT_URI` | Railway scraper (Microsoft Graph) | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `MS_GRAPH_TENANT_ID` | Railway scraper (Microsoft Graph) | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `MS_GRAPH_TOKEN_ENCRYPTION_KEY` | Railway scraper (Microsoft Graph) | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `NODE_ENV` | Railway scraper (runtime) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `OPENAI_API_KEY` | Multi (scraper/worker/Edge) | Yes | .env | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PARALLEL_PORT` | Railway scraper (runtime) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PGC_API` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PGC_BASE` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PGC_DETAIL_OPEN_HARNESS` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `PGC_EPLAN_EMAIL` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PGC_EPLAN_LOGIN_URL` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PGC_EPLAN_PASSWORD` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PGC_LOGIN_ONLY_HARNESS` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `PGC_PORTAL_ORIGIN` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PGC_PROJECTDOX_API_ORIGIN` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PGC_TARGET_PERMIT` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PGC_WEBUI` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PGC_WEBUI_BASE` | Railway scraper (portal/scrape) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PLAYWRIGHT_BROWSERS_PATH` | Railway scraper | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PLAYWRIGHT_HEADLESS` | Railway scraper | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PORT` | Railway scraper (runtime) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `PORTAL_CREDENTIALS_ENCRYPTION_KEY` | Supabase Edge Functions | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `QB_CLIENT_ID` | Railway scraper (QuickBooks) | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `QB_CLIENT_SECRET` | Railway scraper (QuickBooks) | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `QB_DEFAULT_ITEM_ID` | Railway scraper (QuickBooks) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `QB_DEFAULT_ITEM_NAME` | Railway scraper (QuickBooks) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `QB_DEV_API_TEST` | Railway scraper (QuickBooks) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `QB_DEV_PAYLOAD_PREVIEW` | Railway scraper (QuickBooks) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation | Debug/script-only; dangerous if enabled in production |
| `QB_ENV` | Railway scraper (QuickBooks) | Yes | scraper-service/.env.example | Inferred (status endpoint reported production env) — **other QB_* not verified individually** | Client confirmed (category) | Requires manual confirmation |  |
| `QB_FAILURE_REDIRECT_URL` | Railway scraper (QuickBooks) | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `QB_MINOR_VERSION` | Railway scraper (QuickBooks) | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `QB_REDIRECT_URI` | Railway scraper (QuickBooks) | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `QB_SUCCESS_REDIRECT_URL` | Railway scraper (QuickBooks) | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `QB_TOKEN_ENCRYPTION_KEY` | Railway scraper (QuickBooks) | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `RAILWAY_ENVIRONMENT` | Railway scraper (runtime) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `RAILWAY_ENVIRONMENT_NAME` | Railway scraper (runtime) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `REPORTS_FROM_EMAIL` | Supabase Edge Functions | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `RESEND_API_KEY` | Supabase Edge Functions | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `RESEND_FROM` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `RESEND_FROM_EMAIL` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `SCRAPER_DEBUG_ARTIFACTS` | Railway scraper | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `SCRAPER_FORCE_HEADED` | Railway scraper | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `SCRAPER_FORCE_HEADLESS` | Railway scraper | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `SCRAPER_HEADLESS` | Railway scraper | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `SCRAPER_SERVICE_URL` | Railway scraper | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `SHOVELS_API_KEY` | Supabase Edge Functions | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `SHOVEL_API_KEY` | Supabase Edge Functions | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `SITE_URL` | Supabase Edge Functions | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `STRIPE_SECRET_KEY` | Supabase Edge Functions | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | Supabase Edge Functions | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `SUPABASE_ANON_KEY` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `SUPABASE_SERVICE_ROLE_KEY` | Multi (scraper/worker/Edge) | Yes | document-ingestion-worker/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `SUPABASE_STORAGE_OBJECT_MAX_BYTES` | Railway scraper / scripts / other | Yes | scraper-service/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `SUPABASE_TEST_EMAIL` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation | Test/script only |
| `SUPABASE_TEST_PASSWORD` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation | Test/script only |
| `SUPABASE_URL` | Multi (scraper/worker/Edge) | Yes | document-ingestion-worker/.env.example | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_AUTO_STAGE_TRANSITIONS` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_CLEAN_SLATE_ALLOW_PRODUCTION` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_DURABLE_JOBS_ENABLED` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_DURABLE_WORKER_ENABLED` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_EMAIL_ALLOWED_RECIPIENTS` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_EMAIL_ALLOWED_SENDERS` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_EMAIL_INBOUND_WEBHOOK_SECRET` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_EMAIL_LIVE_SUBMISSION_ENABLED` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_EQUIPMENT_CHECKIN_HOUR_UTC` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_GEOCODE_MIN_CONFIDENCE` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_GRAPH_INBOUND_LOOKBACK_HOURS` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_GRAPH_INBOUND_POLLER_ENABLED` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_GRAPH_INBOUND_POLL_MS` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_GRAPH_INBOUND_TOP` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_LIFECYCLE_CATCHUP_MS` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_LIFECYCLE_SCHEDULER_ENABLED` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_NORMALIZED_SYNC_ENABLED` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_OPS_SWEEP_TOKEN` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_PEPCO_LIVE_SUBMISSION_ENABLED` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_PERSIST_LOCAL_DOCUMENTS` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_QB_RETRY_MS` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_RECOVERY_OPERATOR_USER_ID` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_TERRITORY_ALLOW_LOCAL_FALLBACK` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_TERRITORY_BOUNDARY_BUFFER_MILES` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_TERRITORY_DATASET_VERSION` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_TERRITORY_DATA_DIR` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_TERRITORY_LOCAL_CACHE_DIR` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_TERRITORY_STORAGE_BUCKET` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_TERRITORY_STORAGE_ENABLED` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_TERRITORY_STORAGE_PREFIX` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `UCI_WORKER_POLL_MS` | Railway scraper (UCI) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `USER` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `VERIFY_MEMBER_ID` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `VERIFY_OWNER_ID` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `VERIFY_PROJECT_ID` | Railway scraper / scripts / other | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `VITE_API_BASE_URL` | Frontend (Vite/Vercel) | Yes | .env | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `VITE_SCRAPER_USE_SAME_ORIGIN` | Frontend (Vite/Vercel) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `VITE_SUPABASE_ANON_KEY` | Frontend (Vite/Vercel) | Yes | .env | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend (Vite/Vercel) | Yes | — | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |
| `VITE_SUPABASE_URL` | Frontend (Vite/Vercel) | Yes | .env | Requires manual confirmation | Client confirmed (category) | Requires manual confirmation |  |

## Template-only names (`.env.example` comments — may not appear in code scan)

Additional UCI document/LLM variables documented in `scraper-service/.env.example` comments (e.g. `UCI_DOCUMENT_VISION_ENABLED`, `ANTHROPIC_API_KEY`) — enable explicitly in Railway if used.

## Related

- [DEPLOY.md](./DEPLOY.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
