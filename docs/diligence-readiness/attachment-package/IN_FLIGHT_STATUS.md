# In-Flight Status

**Document date:** 2026-08-27  
**Audience:** Executive / handover (Ian)  
**Detail:** [docs/uci-action-items-status.md](../../uci-action-items-status.md)

---

## 1. Active work

| Area | Status | Notes |
|------|--------|-------|
| **Code Modification WIP** | On branch `wip/code-mod-uat-cleanup` (`edc20c4`, **pushed** to org) | UAT cleanup SQL + pipeline fixes; **not merged, not deployed** |
| **`feat/code-analyzer-async-v2`** | **Pushed** to org (`b8e1da5`) | Experimental async Code Mod / analyzer v2 — **~10 commits; not merged, not deployed** |
| **`replit-agent`** | Local branch + **git bundle archive** | Remote push failed (missing object in unrelated history); recoverable via bundle — see [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md) |
| **Diligence documentation** | Merged to `main` | This package |
| **Supabase env fix** | On `fix/frontend-supabase-env-config` (`2a5bf81`, **pushed**) | **Unmerged**, **not deployed** — Vercel variable names confirmed; **values** + smoke test before merge |

---

## 2. UCI — executive summary

| Statement | Classification |
|-----------|----------------|
| UCI prototype code is on `main`, org GitHub, Railway, and Supabase | **Verified** |
| Validated using **synthetic/mock** data (e.g. Highland Springs exercise) | **Verified** |
| Ready for client-team **live** use with real utility documents | **No** |
| Real-data hardening pilot | **Not started** — blocked on Ian's documents + scope in estimates §B |
| Live external submission | **Gated off** in code defaults — production env values require manual confirmation |
| Future live work uses org repo + Railway + Supabase | **Verified** — not Replit or personal namespace |

**Not ready for client-team live use** until pilot hardening completes.

---

## 3. What breaks first if development pauses

### PermitPilot

**First to degrade:** external jurisdiction and utility **portals** — the most change-sensitive production components.

| Risk area | What happens | Classification |
|-----------|--------------|----------------|
| **Portal UI / DOM changes** | Selectors, pagination, download endpoints, and response times change without notice | **Architectural exposure** — ongoing maintenance required |
| **Stale portal views** | Scraper returns outdated or partial permit status | **Verified historical risk** — addressed per-scraper with waits and retries; not eliminated |
| **Pagination / overwrite regressions** | Incomplete page capture or attachment overwrite in some scrape modes | **Verified defect class** — requires regression tests and monitoring |
| **Long-running attachment jobs** | Timeouts, skipped files, silent partial failure | **Verified exposure** — attachment failure visibility incomplete |
| **QuickBooks subscription** | Milestone invoicing blocked when Intuit company billing inactive | **Verified (2026-08-27)** — external blocker, not application defect |
| **Supabase Storage recovery** | Storage objects **not** in Postgres backups; separate recovery path required | **Verified gap** — see [RESTORE.md](./RESTORE.md) |
| **Documentation drift** | Deployed code advances while runbooks lag | **Operational risk** — mitigated by this diligence package on `main` |
| **OAuth / token lifecycle** | QuickBooks and Microsoft Graph sessions expire | **Verified exposure** — distinct from Stripe webhook URL configuration |
| **Frontend ↔ Railway URL** | Wrong `VITE_API_BASE_URL` breaks scraper/QB/UCI API calls | **Verified configuration dependency** |

**Do not shorten working portal waits without root-cause evidence** — some waits reflect verified slow portal behavior, not arbitrary delays.

**Mitigations still needed:** scraper regression tests, job monitoring, failed-job visibility, attachment failure alerts.

**Not production-impacting if paused:** `feat/code-analyzer-async-v2` and Code Mod WIP branches (isolated, not deployed).

### UCI

**First to stall:** live-data validation and hardening — the prototype **cannot progress** without Ian's original project/utility documents.

| Item | Detail |
|------|--------|
| **Current state** | Synthetic/mock-data prototype only — **not user-ready** |
| **Mock pipeline locations** | Railway `scraper-service/app/services/uci/` (mock chain defaults); frontend `/uci/*` surfaces; Supabase UCI tables populated with exercise/synthetic data |
| **What Ian must provide** | 2–3 real projects' original utility documents and expected extraction baselines |
| **What engineering must do next** | Secure intake, baseline runs, expected-vs-extracted comparison, reusable parser fixes — see [TECHNICAL_EFFORT_ESTIMATES.md](./TECHNICAL_EFFORT_ESTIMATES.md) §B |
| **Environment confirmation** | Live pilot runs in **org repo + Railway + Supabase** — **verified**; not Replit or personal namespace |
| **If work pauses after documents arrive** | Parser fixes and stage-flow hardening stall; synthetic demo remains usable but **misleading** if presented as production-ready |

---

## 4. QuickBooks / billing

- Railway backend only — **no n8n** workflows or JSON exports in repository
- Core hardening deployed (`a7ef113`); frontend auth fix deployed (`46b00bb`)
- Authenticated production **dry-run verified** (M1, $4,000, due 2026-09-10)
- Live customer/invoice creation **blocked** by inactive QuickBooks company subscription — **externally blocked**
- Post-restoration: retry single M1 live draft; verify duplicate protection; no manual DB reset needed
- See [QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md](./QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md) and [QUICKBOOKS_PRODUCTION_E2E.md](./QUICKBOOKS_PRODUCTION_E2E.md)

---

## 5. Migration / schema

Production Supabase migration lag vs git: **requires manual confirmation** via dashboard migration list — not verified by live schema inspection during this audit.

---

## 6. Platform retirement

| Platform | Status |
|----------|--------|
| Replit | **Retired** — no production dependency — archive via bundle — [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md) |
| Lovable | **Reference only** — exact duplicate docs consolidated — [LOVABLE_RETIREMENT_AUDIT.md](./LOVABLE_RETIREMENT_AUDIT.md) |

---

## 7. Open questions

- Vercel env **value** correctness (names confirmed for All Environments)
- Railway production values for UCI live flags
- Supabase Storage recovery mechanism (objects excluded from DB backups)
- QuickBooks live invoice operational proof (blocked on subscription restoration)
- Staging restore drill (not yet performed)
