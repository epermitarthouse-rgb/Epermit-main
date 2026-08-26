# In-Flight Status

**Document date:** 2026-08-26  
**Audience:** Executive / handover (Ian)  
**Detail:** [docs/uci-action-items-status.md](../uci-action-items-status.md)

---

## 1. Active work

| Area | Status | Notes |
|------|--------|-------|
| **Code Modification WIP** | Deliberate local WIP, **uncommitted** | Pipeline-order + final-invariant fixes; **not deployed** |
| **`feat/code-analyzer-async-v2`** | **Intentionally local-only** | Owner decision; ~10 commits; **not on remote**; **no push/merge requested** |
| **Diligence documentation** | On branch `docs/diligence-readiness` | This package |
| **Supabase env fix** | Prepared on `fix/frontend-supabase-env-config` | **Unmerged** — Vercel vars required first |

---

## 2. UCI — executive summary

| Statement | Classification |
|-----------|----------------|
| UCI prototype code is on `main` and Railway | **Verified** |
| Validated using **synthetic/mock** data (e.g. Highland Springs exercise) | **Verified** |
| Ready for client-team **live** use with real utility documents | **No** |
| Real-data hardening pilot | **Not started** (awaiting Ian’s documents + scope in estimates §B) |
| Live external submission | **Gated off** in code defaults — **production env values require manual confirmation** |

**Not ready for client-team live use** until pilot hardening completes.

---

## 3. What stalls if development stops

1. Portal scraper maintenance (Playwright vs portal UI changes)
2. OAuth/token lifecycle (QuickBooks, Graph) — **distinct from** Stripe webhook URL configuration
3. Frontend ↔ Railway URL configuration (`VITE_API_BASE_URL`)
4. Uncommitted Code Mod WIP and local-only async-v2 branch (**local disk risk only** — not production)

**Not listed:** async-v2 branch does **not** affect production (isolated by design).

---

## 4. QuickBooks / billing

- Code deployed; production OAuth **connection state** visible via status endpoint (**verified** HTTP)
- Live invoice creation **not verified** in this audit
- See [QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md](./QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md)

---

## 5. Migration / schema

**Production Supabase migration lag:** **Requires manual confirmation** — not verified by live schema inspection during this audit.

---

## 6. Platform retirement

| Platform | Status |
|----------|--------|
| Replit | **Retired** — no production dependency — [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md) |
| Lovable | **Reference only** — [LOVABLE_RETIREMENT_AUDIT.md](./LOVABLE_RETIREMENT_AUDIT.md) |

---

## 7. Open questions

- Vercel production env parity
- Railway production values for UCI live flags
- Supabase backup/PITR availability
- QuickBooks live invoice operational proof
