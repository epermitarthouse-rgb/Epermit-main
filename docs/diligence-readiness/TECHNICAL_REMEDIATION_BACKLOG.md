# Technical Remediation Backlog

**Audit date:** 2026-08-26  
**Updated:** 2026-08-27 — QuickBooks hardening items 1–3 **completed and deployed** (`a7ef113`, frontend `46b00bb`).

| Scope key | Diligence sprint | Separate engineering |

---

## 1. QuickBooks invoice trigger authorization

| Field | Detail |
|-------|--------|
| Issue | `POST /api/quickbooks/invoice/trigger` accepted unauthenticated requests |
| Remediation | Supabase JWT via `getAuthenticatedUser`; `has_project_editor_access` RPC; dry-run requires auth |
| Status | **Completed and deployed** (`a7ef113`) — **verified** in production dry-run and live attempt |
| Acceptance criteria | Unauthenticated → 401; viewer → 403; editor dry-run/live → reaches QuickBooks when connected |

---

## 2. QuickBooks OAuth state / CSRF validation

| Field | Detail |
|-------|--------|
| Issue | OAuth `state` parameter was not validated on callback |
| Remediation | `qb-oauth-state.service.js` — HMAC-signed state bound to user id, 15 min TTL, single-use nonce (in-process) |
| Status | **Completed and deployed** (`a7ef113`) |
| Note | OAuth `/start` requires authenticated user (`format=json` or redirect) |

---

## 3. QuickBooks `/status` information exposure

| Field | Detail |
|-------|--------|
| Issue | Public endpoint returned full realm id and environment |
| Remediation | Unauthenticated: `{ connected }` only; authenticated: masked realm, environment, token expiry |
| Status | **Completed and deployed** (`a7ef113`) |

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
