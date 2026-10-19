# 08 — Bugs, risks, and technical debt

**Extraction date:** 2026-10-19  
**Code:** `main` @ `fc74c35`

Confirmed means the defect is still visible in code or in the 2026-10-19 Railway snapshot. Suspected means an older audit reported it and this extraction did not re-test. Do not “fix” suspected items without reproducing them.

## Confirmed in code or infrastructure

| ID | Issue | Why it matters | Evidence |
|----|--------|----------------|----------|
| D-01 | Frontend Supabase URL and anon key are hardcoded | Vercel `VITE_SUPABASE_*` can disagree with the bundle. The prepared fix is unmerged | `src/lib/supabase.ts`. Branch `fix/frontend-supabase-env-config` @ `2a5bf81` |
| D-02 | `projects.portal_data` is not created by any migration in git | A fresh database built only from migrations will not match production. Scrapers write a column the repo does not define | `docs/current-data-model.md` §4; grep of `supabase/migrations` shows `portal_data_hash` only |
| D-03 | `profiles.subscription_*` used by auth and Stripe webhook, no migration found | Same class of drift as D-02 | `docs/current-data-model.md` §4 |
| D-04 | New Code Analyzer runs require `VITE_CODE_ANALYZER_ASYNC_V2=true` at build time | A correct worker deploy with a frontend build that lacks the flag throws before enqueue | `src/lib/codeAnalyzer/featureFlags.ts` |
| D-05 | Analyzer worker default `SCRAPER_SERVICE_URL` port does not match scraper default port | Local and misconfigured prod jobs call the wrong process | Worker source default `:3000` vs scraper `:3001` ([02](./02-SYSTEM-ARCHITECTURE.md)) |
| D-06 | Two Nixpacks recipes for the analyzer | Wrong service root deploys a worker that cannot import `findingQuality.js`, or deploys the worker instead of the scraper | Root `nixpacks.toml` vs `code-analyzer-worker/nixpacks.toml` |
| D-07 | Production `document-ingestion-worker` last SUCCESS deploy is 2026-08-04 | RAG ingestion may not contain later worker fixes. Development replica is offline | Railway CLI 2026-10-19 |
| D-08 | Development scraper last SUCCESS deploy is 2026-08-21. Analyzer worker is absent there | “Test on development” does not exercise current `main` | Railway CLI |
| D-09 | OCR is not implemented | Scanned plan sets ingest as low-text and ground poorly | `LOW_TEXT_MSG` in `document-ingestion-worker/worker.js` |
| D-10 | 36 Edge Functions set `verify_jwt = false`. 15 have no config entry. Per-handler auth was not re-audited | A function can be callable without a user JWT if the handler forgets its own check | `supabase/config.toml` |
| D-11 | September migrations say “DO NOT apply until reviewed,” including feature flags, module flags, notification cron, and drip cron | Applying them, or assuming they are already applied, can be wrong in either direction | Seven files listed in [04](./04-DATABASE-AND-SUPABASE.md) |
| D-12 | Placeholders still routed: permit queue, messages, glossary, utility coverage | Look like product, are not | `src/pages/placeholders/` |
| D-13 | Operations board mixes demo and real data | Numbers on `/operations` can be fictional | `operations-demo-data` import on `OperationsBoard.tsx` |
| D-14 | Baltimore `/baltimore/*` is a mock shell | Easy to confuse with the real Accela integration | `App.tsx` comment |
| D-15 | `PublicOnlyRoute` is documented and absent | Agents following `memory.md` or the July architecture doc will edit a file that does not exist | Grep of `src/` on 2026-10-19 |
| D-16 | Generated DB types lag migrations | Client code can omit new columns or invent old ones | `docs/current-data-model.md` |
| D-17 | CI does not run frontend tests, analyzer tests, or the full scraper suite | Regressions land on `main` | `.github/workflows/uci-security-tests.yml` only |
| D-18 | Document ingestion worker has no test script | Changes there are unguarded | `document-ingestion-worker/package.json` |
| D-19 | `scripts/test-intake-pipeline.js` has been a place an anon key was committed | Secret hygiene | Historical note in the history pass. Re-read the file before running or copying it. Do not quote the key |
| D-20 | Capacitor `server.url` still targets Lovable | A mobile build would not load the Vercel app | `capacitor.config.ts` |
| D-21 | Root README says Node 18+; images and workers expect Node 20 | Local “works on my machine” drift | `README.md` vs `nixpacks.toml` and diligence DEPLOY |
| D-22 | `npm run dev` starts the ingestion worker and not the analyzer worker | Analyzer bugs look like “jobs stuck pending” when only the default dev command is running | Root `package.json` |
| D-23 | Scraper `register-execution-routes.js` remains a very large module | Jurisdiction fixes have a wide blast radius. Extraction was an explicit backlog item (PP-016) and is not done | File size noted in the deployment pass |
| D-24 | Default project access after 2026-09-11 can grant write to active users beyond the original owner-only policies | A migration applied in prod changes who can update projects. A migration not applied means the code and the database disagree | `20260911170000_default_override_access_model.sql` |
| D-25 | QuickBooks unauthenticated status still reveals a connected boolean | Low-sensitivity reconnaissance. August backlog called the payload larger; later code narrowed it. Re-read `quickbooks.routes.js` before treating the August wording as current | History pass plus `TECHNICAL_REMEDIATION_BACKLOG.md` |

Startup logging in `src/main.tsx` was flagged in the August backlog as printing env presence. This extraction did not re-open that file to confirm the log lines. Treat the backlog item as **suspected** until read.

## Suspected (older audits, not re-tested)

| ID | Report | Source | Why it may still be open |
|----|--------|--------|--------------------------|
| S-01 | Portal harvest queue shows synced counts of zero because `useProjects` does not select `portal_data` | `docs/audits/portal-harvest-metrics-and-functionality-audit.md` (2026-07-28) | History pass did not find `portal_data` in `useProjects.ts` |
| S-02 | Portal report metrics double-count | Same audit | Not re-measured |
| S-03 | Scrape progress widget: stale jobs, sign-out gaps, duplicate toasts | `docs/audits/scraper-progress-widget-audit.md` (2026-07-30) | Not re-run |
| S-04 | Non-Arlington scrape cancel did not set in-memory `_cancelRequested` | `docs/audits/scraper-cancellation-audit.md` | Later cancellation module and tests exist. **Likely fixed in code.** Production behavior unknown |
| S-05 | ROI and marketing copy still contain placeholders | `memory.md` §9 | Not copy-edited in this pass |
| S-06 | Auto-enqueue of document ingestion after a scrape does not happen | PP-008 in the August upcoming-work doc | No scraper auto-enqueue was identified in this pass |
| S-07 | Permit wizard preflight fails if hosted schema lags migrations | `docs/audits/permit-filing-preflight-and-jurisdictions.md` | Depends on live schema |
| S-08 | UCI PEPCO document download is opt-in and defaults to list-only | `docs/audits/uci-pepco-document-download-audit.md` | Likely still intentional |

## Security risks (no exploit detail)

- Service-role key on Railway and in worker env is full database access. Compromise of one service is compromise of the project.
- Shared Supabase between Railway development and production, if still true, means a dev scraper bug writes production rows.
- `portal_credentials` stores jurisdiction passwords. Logs and error reports must not include them.
- Storage: `inspection-photos` is a public bucket in SQL. `ensureStorageBucket` in `register-execution-routes.js` creates `project-drawings` as public and flips an existing private bucket to public. Confirm the live bucket before adding sensitive drawings.
- Edge Functions with JWT verification off must implement their own auth. Webhooks (Stripe, UCI email) need signature or shared-secret checks. This extraction did not certify each handler.
- Cron invoke path uses the service-role key from Vault. A leaked Vault secret is production admin.
- Do not commit `.env`, Railway variable dumps, or Supabase secret lists.

## Data-loss and recovery gaps

From `docs/diligence-readiness/RESTORE.md` and `IN_FLIGHT_STATUS.md` (**HISTORICAL**, procedure still the right checklist):

- Database backups do not include Storage objects.
- A restore drill was still an open ops item in August.
- Migration lag between git and hosted SQL is unmeasured as of 2026-10-19.

## Technical debt that is accepted for now

- Mock operations-board sections, until a schema task exists.
- UCI synthetic providers and dry-run submission, until a live pilot is scheduled.
- Lovable reference tree in `reference/lovable-ui/` (large, not imported by the Vite app).
- `replit-agent` branch retained.
- Feature-flag admin page present but described as not in the main nav.

## Not debt

- `portal_data` JSON shape differing by jurisdiction. That is the contract.
- Separate DesignCheck page and Code Analyzer workflow. That was a product decision.
- `/__future` existing only on the parallel dev server.
