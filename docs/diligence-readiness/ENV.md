# Environment Variables Inventory

**Document date:** 2026-08-26  
**Method:** Scan of `src/`, `scraper-service/`, `supabase/functions/`, `document-ingestion-worker/`, `.env.example` files, and `vite.config.parallel.ts`.

**Rule:** No secret values appear in this document. Storage location categories refer to the **shared password vault** unless noted.

Legend:

- **Required** — service fails or core feature breaks without it
- **Optional** — feature flags, dev tools, or fallbacks
- **Verified** — existence confirmed in repo templates or production HTTP behavior
- **Owner** — account requiring manual confirmation

---

## 1. Frontend (Vercel / Vite)

| Variable | Component | Environment | Purpose | Required | Storage | Verified | Owner |
|----------|-----------|-------------|---------|----------|---------|----------|-------|
| `VITE_SUPABASE_URL` | React app | prod, preview, dev | Supabase project URL | Optional* | Vault / Vercel | Yes (`.env`, hardcoded in `supabase.ts`) | Supabase |
| `VITE_SUPABASE_ANON_KEY` | React app | prod, preview, dev | Supabase anon JWT | Optional* | Vault / Vercel | Yes | Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Some components (TTS) | prod | Alternate anon key name | Optional | Vault / Vercel | In code refs | Supabase |
| `VITE_API_BASE_URL` | `scraperBaseUrl.ts` | prod, preview | Scraper/Railway API host | **Yes (prod)** | Vault / Vercel | Yes | Railway URL owner |
| `VITE_SCRAPER_USE_SAME_ORIGIN` | Vite parallel config | dev | Force same-origin `/api` proxy | Dev only | Build-time inject | Yes | N/A |
| `DEV` | Vite | dev | Development mode flag | Auto | — | Vite | N/A |

\*Hardcoded in `src/lib/supabase.ts` — env vars may be ignored by production bundle.

---

## 2. Scraper service (Railway — `Epermit-main`)

### Core

| Variable | Purpose | Required | Storage | Verified |
|----------|---------|----------|---------|----------|
| `PORT` | HTTP listen port | Auto (Railway) | Railway | Yes |
| `NODE_ENV` | Runtime mode | Optional | Railway | Yes |
| `RAILWAY_ENVIRONMENT` | Railway env marker | Auto | Railway | Yes |
| `RAILWAY_ENVIRONMENT_NAME` | Railway env name | Auto | Railway | Yes |
| `SUPABASE_URL` | Postgres/API URL | **Yes** | Vault / Railway | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin DB access | **Yes** | Vault / Railway | Yes |
| `SUPABASE_ANON_KEY` | Scripts using anon | Optional | Vault / Railway | Yes |
| `VITE_SUPABASE_ANON_KEY` | Verify scripts | Optional | Vault / Railway | Yes |

### AI / analysis

| Variable | Purpose | Required | Storage |
|----------|---------|----------|---------|
| `OPENAI_API_KEY` | Drawing analysis, UCI classifier, agents | **Yes** for AI features | Vault / Railway + Supabase secrets |

### Portal credentials encryption

| Variable | Purpose | Required | Storage |
|----------|---------|----------|---------|
| `PORTAL_CREDENTIALS_ENCRYPTION_KEY` | Encrypt portal passwords | **Yes** for filing/scrape with saved creds | Vault / Railway + Supabase Edge |

### Storage limits

| Variable | Purpose | Required | Storage |
|----------|---------|----------|---------|
| `SUPABASE_STORAGE_OBJECT_MAX_BYTES` | Max upload size (e.g. 200 MiB) | Optional | Railway |
| `ARLINGTON_FORCE_RETRY_OVERSIZED_PLAN_REVIEW_DOWNLOADS` | Retry oversized downloads | Optional | Railway |

### Playwright / scraper behavior

| Variable | Purpose | Required | Storage |
|----------|---------|----------|---------|
| `SCRAPER_HEADLESS` | Headless browser | Optional | Railway |
| `PLAYWRIGHT_HEADLESS` | Alias | Optional | Railway |
| `SCRAPER_FORCE_HEADED` | Debug | Optional | Railway |
| `SCRAPER_FORCE_HEADLESS` | Debug | Optional | Railway |
| `SCRAPER_DEBUG_ARTIFACTS` | Debug captures | Optional | Railway |
| `PLAYWRIGHT_BROWSERS_PATH` | Browser path | Optional | Docker/Railway |

### PGC / Montgomery / Howard portal overrides

| Variable | Purpose | Required | Storage |
|----------|---------|----------|---------|
| `PGC_BASE`, `PGC_WEBUI`, `PGC_API`, `PGC_WEBUI_BASE` | PGC URLs | Optional | Railway |
| `PGC_PORTAL_ORIGIN`, `PGC_PROJECTDOX_API_ORIGIN` | PGC origins | Optional | Railway |
| `PGC_EPLAN_EMAIL`, `PGC_EPLAN_PASSWORD`, `PGC_EPLAN_LOGIN_URL` | PGC login harness | Dev/harness | Vault / Railway |
| `PGC_TARGET_PERMIT`, `PGC_LOGIN_ONLY_HARNESS`, `PGC_DETAIL_OPEN_HARNESS` | Test harness | Dev | Railway |
| `MONTGOMERY_WEBUI_BASE`, `MONTGOMERY_DEBUG_*` | Montgomery | Optional | Railway |
| `HOWARD_WEBUI_BASE`, `HOWARD_DEBUG_*` | Howard | Optional | Railway |

### Arlington worker

| Variable | Purpose | Required | Storage |
|----------|---------|----------|---------|
| `ARLINGTON_DURABLE_WORKER_ENABLED` | Enable worker | Optional | Railway |
| `ARLINGTON_WORKER_POLL_MS` | Poll interval | Optional | Railway |

### QuickBooks

| Variable | Purpose | Required | Storage | Verified |
|----------|---------|----------|---------|----------|
| `QB_CLIENT_ID` | OAuth app id | **Yes** for QB | Vault / Railway | Yes |
| `QB_CLIENT_SECRET` | OAuth secret | **Yes** | Vault / Railway | Yes |
| `QB_REDIRECT_URI` | OAuth callback URL | **Yes** | Vault / Railway + Intuit console | Yes |
| `QB_ENV` | `sandbox` or `production` | **Yes** | Railway | Prod verified via API |
| `QB_MINOR_VERSION` | QBO API version | Optional (default 75) | Railway | Yes |
| `QB_SUCCESS_REDIRECT_URL` | Post-OAuth redirect | Optional | Railway | Yes |
| `QB_FAILURE_REDIRECT_URL` | OAuth error redirect | Optional | Railway | Yes |
| `QB_TOKEN_ENCRYPTION_KEY` | AES key for refresh tokens | **Yes** | Vault / Railway | Yes |
| `QB_DEFAULT_ITEM_ID` | Fallback line item | Optional | Railway | Yes |
| `QB_DEFAULT_ITEM_NAME` | Fallback item lookup | Optional | Railway | Yes |
| `QB_DEV_PAYLOAD_PREVIEW` | Enable dev preview route in prod | Optional | Railway | Yes |
| `QB_DEV_API_TEST` | Enable dev API test routes | Optional | Railway | Yes |

### Microsoft Graph (UCI mailbox)

| Variable | Purpose | Required | Storage |
|----------|---------|----------|---------|
| `MS_GRAPH_CLIENT_ID` | Azure app id | **Yes** for Graph | Vault / Railway + Azure |
| `MS_GRAPH_CLIENT_SECRET` | Azure secret | **Yes** | Vault / Railway |
| `MS_GRAPH_TENANT_ID` | Azure tenant | **Yes** | Vault / Railway |
| `MS_GRAPH_REDIRECT_URI` | OAuth callback | **Yes** | Vault / Railway + Azure |
| `MS_GRAPH_TOKEN_ENCRYPTION_KEY` | Token encryption | **Yes** | Vault / Railway |

### UCI feature flags (representative — see `.env.example` for full list)

| Variable | Purpose | Default behavior |
|----------|---------|------------------|
| `UCI_PEPCO_LIVE_SUBMISSION_ENABLED` | Live PEPCO portal submit | **false** |
| `UCI_EMAIL_LIVE_SUBMISSION_ENABLED` | Live Graph sendMail | **false** |
| `UCI_EMAIL_ALLOWED_SENDERS` | Allowlist when live | Empty |
| `UCI_EMAIL_ALLOWED_RECIPIENTS` | Allowlist when live | Empty |
| `UCI_AUTO_STAGE_TRANSITIONS` | Auto lifecycle advance | **false** |
| `UCI_DURABLE_JOBS_ENABLED` | Durable portal sync jobs | Must be `true` to enable |
| `UCI_DURABLE_WORKER_ENABLED` | Worker toggle | Optional |
| `UCI_WORKER_POLL_MS` | Worker poll | Optional |
| `UCI_GRAPH_INBOUND_POLLER_ENABLED` | Mailbox poller | **true** (disable explicitly) |
| `UCI_GRAPH_INBOUND_POLL_MS` | Poll interval (~45s) | Optional |
| `UCI_GRAPH_INBOUND_LOOKBACK_HOURS` | Mail lookback | Optional |
| `UCI_GRAPH_INBOUND_TOP` | Messages per poll | Optional |
| `UCI_LIFECYCLE_SCHEDULER_ENABLED` | Scheduler | **true** unless false |
| `UCI_LIFECYCLE_CATCHUP_MS` | Catch-up interval | Optional |
| `UCI_QB_RETRY_MS` | QB passthrough retry | Optional (5 min) |
| `UCI_EQUIPMENT_CHECKIN_HOUR_UTC` | Daily equipment check | Optional |
| `UCI_EMAIL_INBOUND_WEBHOOK_SECRET` | Webhook auth | Optional |
| `UCI_OPS_SWEEP_TOKEN` | Ops endpoint token | Optional |
| `UCI_CLEAN_SLATE_ALLOW_PRODUCTION` | Destructive reset guard | **false** |
| `UCI_TERRITORY_STORAGE_*` | Territory dataset in Storage | Optional |
| `UCI_TERRITORY_DATA_DIR` | Local territory files | Dev | 
| `UCI_TERRITORY_ALLOW_LOCAL_FALLBACK` | Local fallback | Optional |
| `UCI_GEOCODE_MIN_CONFIDENCE` | Geocode threshold | Optional |
| `UCI_NORMALIZED_SYNC_ENABLED` | Portal sync mode | **true** unless false |
| `UCI_PERSIST_LOCAL_DOCUMENTS` | Local doc persist | Optional |
| `UCI_RECOVERY_OPERATOR_USER_ID` | Recovery scripts | Scripts only |

### UCI document AI (commented in `.env.example` — enable explicitly)

| Variable | Purpose |
|----------|---------|
| `UCI_DOCUMENT_VISION_ENABLED` | GPT vision for docs |
| `UCI_DOCUMENT_OCR_ENABLED` | OCR fallback |
| `UCI_DOCUMENT_VISION_MAX_PAGES_PER_RUN` | Limit |
| `UCI_DOCUMENT_OCR_MAX_PAGES_PER_RUN` | Limit |
| `UCI_DOCUMENT_AI_TIMEOUT_MS` | Timeout |
| `UCI_DOCUMENT_AI_MAX_RETRIES` | Retries |
| `UCI_DOCUMENT_OCR_MIN_CONFIDENCE` | Threshold |
| `UCI_DOCUMENT_VISION_MODEL` | Model name |
| `UCI_DOCUMENT_OCR_MODEL` | Model name |
| `UCI_LLM_CLASSIFIER_*` | Stage 5 classifier tuning |
| `ANTHROPIC_API_KEY` | Optional classifier provider |
| `UCI_CLAUDE_CLASSIFIER_*` | Claude-specific |

### Diagnostics / dev

| Variable | Purpose |
|----------|---------|
| `ALLOW_DC_DIAGNOSTICS` | DC diagnostic routes |
| `EPERMIT_REPORT_SCREENSHOT_MODE` | Report screenshots |
| `EPERMIT_REPORT_SCREENSHOT_MAX_B64_CHARS` | Size limit |
| `PARALLEL_PORT` | Parallel dev server port |
| `SCRAPER_SERVICE_URL` | Internal URL ref |
| `VERIFY_PROJECT_ID`, `VERIFY_OWNER_ID`, `VERIFY_MEMBER_ID` | RLS verify scripts |

---

## 3. Document ingestion worker (Railway)

| Variable | Purpose | Required | Storage |
|----------|---------|----------|---------|
| `SUPABASE_URL` | DB/API | **Yes** | Vault / Railway |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin access | **Yes** | Vault / Railway |
| `OPENAI_API_KEY` | Embeddings | **Yes** | Vault / Railway |
| `INGESTION_POLL_INTERVAL_MS` | Poll interval | Optional | Railway |
| `INGESTION_CONCURRENCY` | Parallel jobs | Optional | Railway |
| `INGESTION_TEMP_DIR` | Temp files | Optional | Railway |
| `INGESTION_MIN_BACKOFF_MS` | Backoff | Optional | Railway |
| `INGESTION_MAX_BACKOFF_MS` | Backoff cap | Optional | Railway |

---

## 4. Supabase Edge Functions (secrets)

Set via `supabase secrets set`. Used across functions:

| Variable | Functions (examples) | Required | Storage |
|----------|---------------------|----------|---------|
| `SUPABASE_URL` | All | **Yes** | Auto in Edge |
| `SUPABASE_ANON_KEY` | Auth-verified functions | Often | Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Agents, webhooks | **Yes** | Vault / Supabase secrets |
| `OPENAI_API_KEY` | AI agents, analyze-drawing | **Yes** for AI | Vault / Supabase secrets |
| `RESEND_API_KEY` | Email functions | **Yes** for email | Vault / Supabase secrets |
| `RESEND_FROM_EMAIL` / `EMAIL_FROM` / `RESEND_FROM` | Sender addresses | **Yes** for email | Vault |
| `REPORTS_FROM_EMAIL` | Scheduled reports | **Yes** for reports | Vault |
| `APP_URL` / `SITE_URL` | Invitation links | **Yes** for invites | Vault |
| `STRIPE_SECRET_KEY` | Billing | **Yes** for Stripe | Vault / Supabase secrets |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | Webhook verify | **Yes** | Vault / Supabase secrets |
| `PORTAL_CREDENTIALS_ENCRYPTION_KEY` | permitwizard-execute | **Yes** for encrypted creds | Vault / Supabase secrets |
| `MAPBOX_PUBLIC_TOKEN` | get-mapbox-token | **Yes** for maps | Vault / Supabase secrets |
| `SHOVELS_API_KEY` / `SHOVEL_API_KEY` | shovels-api | If feature used | Vault |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_API_KEY_1` | elevenlabs-tts | If feature used | Vault |
| `FIRECRAWL_API_KEY` | If used by agent | Optional | Vault |

---

## 5. Inconsistencies and notes

| Issue | Detail |
|-------|--------|
| Duplicate Supabase config | Hardcoded `src/lib/supabase.ts` vs `VITE_SUPABASE_*` |
| Anon key naming | `VITE_SUPABASE_ANON_KEY` vs `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Shovels key name | Both `SHOVELS_API_KEY` and `SHOVEL_API_KEY` in scan |
| QB tokens in DB | Not env vars — encrypted in `quickbooks_connections` |
| Graph tokens | Stored in DB tables, not env |
| `.env` in repo working tree | Local file exists — **must not commit** |
| Production QB env | API returns `environment: production` — ensure `QB_ENV=production` on Railway |

---

## 6. Variables in `.env.example` but not referenced in runtime code scan

These appear in comments/templates only (may be planned or script-only):

- Some `UCI_DOCUMENT_*` and `UCI_LLM_CLASSIFIER_*` variants (present in `.env.example` comments)
- `UCI_CLAUDE_CLASSIFIER_*`

Treat as **optional until enabled in Railway production env**.

---

## 7. Verification status summary

| Location | Verified during audit |
|----------|----------------------|
| Railway production QB connection | **Yes** (HTTP status) |
| Railway env var values | **No** (dashboard not exported) |
| Vercel env vars | **No** (CLI not authenticated) |
| Supabase secrets list | **No** (CLI secrets not listed) |
| Local `.env` files | Existence only — values not documented |

---

## 8. Owner confirmation checklist

- [ ] Supabase project owner
- [ ] Vercel team/account owner
- [ ] Railway workspace owner (client — verified)
- [ ] Intuit developer app owner
- [ ] Azure AD app owner (Graph)
- [ ] Resend domain/account owner
- [ ] Stripe account owner
- [ ] OpenAI billing owner
- [ ] Mapbox account owner
- [ ] Shared vault administrator

---

## 9. Related documents

- Deploy: `DEPLOY.md`
- Architecture: `ARCHITECTURE.md`
- QuickBooks: `QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md`
