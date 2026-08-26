# Technical Remediation Backlog

**Audit date:** 2026-08-26  
**Status:** Documented only — **not implemented** in this task (except prepared Supabase env fix on separate branch).

| Scope key | Diligence sprint | Separate engineering |

---

## 1. QuickBooks invoice trigger authorization

| Field | Detail |
|-------|--------|
| Issue | `POST /api/quickbooks/invoice/trigger` accepts unauthenticated requests |
| Evidence | `scraper-service/app/routes/quickbooks.routes.js` — no JWT middleware on router |
| Impact | Unauthorized invoice creation if endpoint is reachable |
| Severity | **Critical** |
| Root cause | Known gap; not yet remediated |
| Investigation | Add auth middleware consistent with `/api/uci/*`; define admin vs project-owner policy |
| Acceptance criteria | Unauthenticated requests rejected; authorized users only; audit log of triggers |
| Scope | **Separate engineering** (post-diligence) |

---

## 2. QuickBooks OAuth state / CSRF validation

| Field | Detail |
|-------|--------|
| Issue | OAuth `state` parameter not validated on callback |
| Evidence | TODO comments in `quickbooks.routes.js` |
| Impact | CSRF on OAuth connect flow |
| Severity | **High** |
| Scope | **Separate engineering** |

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

## 5. PWA / workbox production build failure

| Field | Detail |
|-------|--------|
| Issue | `npm run build` fails at service worker generation (workbox/terser) |
| Evidence | Local build output 2026-08-26 — Vite bundle completes, SW step fails |
| Impact | **Complete production build fails locally** until fixed |
| Severity | **High** |
| Scope | **Diligence sprint** (verify on Vercel) + **Separate engineering** (fix) |

---

## 6. Supabase frontend hardcoded credentials

| Field | Detail |
|-------|--------|
| Issue | `src/lib/supabase.ts` on `main` embeds URL + anon key literals |
| Evidence | Source inspection on `main` at `f7b5f02` |
| Impact | Config drift; `.env` ignored; security hygiene |
| Severity | **High** |
| Root cause | Hardcoded literals bypass Vite env |
| Prepared fix | Branch `fix/frontend-supabase-env-config` (unmerged) |
| Acceptance criteria | Env-only config; Vercel vars confirmed before merge |
| Scope | **Diligence sprint** (prepare) + **Separate** (merge after Vercel confirmation) |

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
