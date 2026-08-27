# Technical Remediation Backlog

**Audit date:** 2026-08-26  
**Status:** Documented only — **not implemented** in this task (except prepared Supabase env fix on separate branch).

| Scope key | Diligence sprint | Separate engineering |

---

## 1. QuickBooks invoice trigger authorization — **RESOLVED on `main` @ `a7ef113`**

| Field | Detail |
|-------|--------|
| Issue | ~~`POST /api/quickbooks/invoice/trigger` accepts unauthenticated requests~~ |
| Resolution | JWT middleware + `has_project_editor_access` deployed and verified in production dry-run (2026-08-27) |
| Evidence | `scraper-service/app/routes/quickbooks.routes.js`; `QUICKBOOKS_PRODUCTION_E2E.md` |
| Status | **Closed** — do not re-open unless regression found |

---

## 2. QuickBooks OAuth state / CSRF validation — **RESOLVED on `main` @ `a7ef113`**

| Field | Detail |
|-------|--------|
| Issue | ~~OAuth `state` parameter not validated on callback~~ |
| Resolution | HMAC-signed state with expiry and single-use nonce (`qb-oauth-state.service.js`) |
| Status | **Closed** |

---

## 3. QuickBooks `/status` information exposure

| Field | Detail |
|-------|--------|
| Issue | Public endpoint returns connection metadata (realm id, environment) |
| Evidence | Production HTTP 200 on `/api/quickbooks/status` |
| Impact | Reconnaissance; should require auth or return minimal public shape |
| Severity | **Medium** |
| Scope | **Separate engineering** |

---

## 4. US holiday business-day calendar

| Field | Detail |
|-------|--------|
| Issue | Due dates use weekdays only; US public holidays not excluded |
| Evidence | `qb-due-dates.js` — Mon–Fri only |
| Impact | Business/product decision — invoice due dates may differ from finance policy |
| Severity | **Low** (pending business decision) |
| Scope | **Separate engineering** after policy sign-off |

---

## 5. PWA / workbox production build — monitoring (not reproducible)

| Field | Detail |
|-------|--------|
| Issue | An earlier local build attempt failed during PWA/service-worker generation (workbox/terser) after the Vite bundle completed |
| Evidence | Initial diligence worktree build output 2026-08-26; **not reproduced** on clean `fix/frontend-supabase-env-config` worktree where complete production build passed |
| Impact | No currently reproducible repository build defect; Vercel build history still requires dashboard review |
| Severity | **Closed / monitoring** (was transient local failure) |
| Scope | **Monitoring only** — review Vercel build logs; no active engineering estimate |

> An earlier local build attempt failed during PWA/service-worker generation. The issue was not reproduced in the clean Supabase fix worktree, where the complete production build passed. Vercel build history still requires dashboard review, but there is no currently reproducible repository build defect.

---

## 6. Hardcoded Supabase frontend configuration

| Field | Detail |
|-------|--------|
| Issue | `src/lib/supabase.ts` on `main` embeds Supabase URL and anonymous key literals instead of Vite environment configuration |
| Evidence | Source inspection on `main`; prepared fix branch `fix/frontend-supabase-env-config` at `2a5bf81` (pushed to `origin`, unmerged, not deployed) |
| Impact | **Configuration drift and environment inconsistency** — root `.env` / Vercel values may not match bundled client behavior on `main` |
| Security note | The anonymous key is **browser-public by design**; **no service-role key** was found in frontend `src/` |
| Severity | **Medium** operational/configuration risk |
| Root cause | Hardcoded literals bypass Vite env on production line |
| Prepared fix | Moves URL and anon key to `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; Vercel variable **names** client/dashboard confirmed; **values** require confirmation before merge |
| Acceptance criteria | Env-only config on `main`; Vercel values confirmed correct; post-merge frontend smoke test |
| Scope | **Diligence sprint** (prepared) + **Separate** (merge after value confirmation) |

---

## 7. Supabase backup / PITR verification

| Field | Detail |
|-------|--------|
| Issue | Backup retention and PITR availability unverified from repository |
| Evidence | No dashboard access during audit |
| Impact | Unknown RPO/RTO |
| Severity | **High** |
| Scope | **Diligence sprint** (manual dashboard check) |

---

## 8. Supabase Storage backup verification

| Field | Detail |
|-------|--------|
| Issue | Object backup/versioning policy unverified |
| Evidence | Not in repo |
| Impact | File loss recovery uncertain |
| Severity | **High** |
| Scope | **Diligence sprint** |

---

## 9. Vercel ownership / team access

| Field | Detail |
|-------|--------|
| Issue | Frontend hosted under private account (client-confirmed); CLI not authenticated on audit machine |
| Evidence | `vercel whoami` failed; user confirmation |
| Impact | Handover and env var management risk |
| Severity | **High** |
| Scope | **Diligence sprint** (account decision) |

---

## 10. Edge Function JWT settings review

| Field | Detail |
|-------|--------|
| Issue | Many functions have `verify_jwt = false` in `supabase/config.toml` |
| Evidence | 51 function directories; config lists many with `verify_jwt = false` |
| Impact | Some validate JWT in code; others are webhooks/public — **requires per-function review** |
| Severity | **Medium–High** |
| Scope | **Separate engineering** security review |

---

## 11. UCI live-submission flag verification

| Field | Detail |
|-------|--------|
| Issue | Production Railway env values for live UCI flags not verified |
| Evidence | Code defaults off; production env not exported |
| Impact | Incorrect flag could enable live submission |
| Severity | **Critical** (if misconfigured) |
| Scope | **Diligence sprint** (Railway dashboard review) |

---

## 12. Frontend debug logging (`main.tsx`)

| Field | Detail |
|-------|--------|
| Issue | Console debug prints Supabase URL presence on startup |
| Evidence | `src/main.tsx` on `main` |
| Impact | Low security noise; removed in prepared env fix branch |
| Severity | **Low** |
| Scope | Addressed in **prepared Supabase fix branch** |
