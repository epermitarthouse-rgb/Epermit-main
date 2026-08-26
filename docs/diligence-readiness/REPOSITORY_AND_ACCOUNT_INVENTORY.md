# Repository and Account Inventory

**Audit date:** 2026-08-26

Index: [README.md](./README.md)

---

## 1. GitHub

| Field | Status |
|-------|--------|
| Remote | `git@github.com:epermitarthouse-rgb/Epermit-main.git` |
| Ownership | **Client confirmed** + **verified** remote URL and Railway repo linkage |

---

## 2. Protected / intentional local state

| Item | Policy |
|------|--------|
| **`feat/code-analyzer-async-v2`** | **Intentionally local-only** — no push/merge/archive action requested |
| **Code Modification WIP** | **Deliberate uncommitted work** — includes `scripts/code-mod-uat-cleanup.sql` and related Code Mod files on developer machine — **do not commit/push** as part of diligence |
| **`replit-agent`** | Local-only historical branch — assess via [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md) before any deletion |

---

## 3. Branch sync (selected)

| Branch | Remote | Notes |
|--------|--------|-------|
| `main` | Yes | Production Railway target |
| `docs/diligence-readiness` | Yes | This documentation package |
| `fix/frontend-supabase-env-config` | **Yes** (`origin`) | Commit `2a5bf81`; **pushed**, **unmerged**, **not deployed**; Vercel names confirmed; values + smoke test before merge |
| `feat/code-analyzer-async-v2` | **No** | By design |
| `origin/feat/stage2-load-profile-readiness` | Remote only | **Requires manual confirmation** before merge/delete |

**Do not recommend push** for async-v2 or Code Mod WIP.

---

## 4. Secondary remote

| Remote | URL | Owner |
|--------|-----|-------|
| `gitsafe-backup` | `git://gitsafe:5418/backup.git` | **Requires manual confirmation** |

---

## 5. Replit / Lovable

| Platform | Production dependency |
|----------|----------------------|
| Replit | **None verified** — [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md) |
| Lovable reference | **None verified** — [LOVABLE_RETIREMENT_AUDIT.md](./LOVABLE_RETIREMENT_AUDIT.md) |

---

## 6. Account ownership

| Service | Client confirmed | Live dashboard verified | Manual completion |
|---------|------------------|-------------------------|-------------------|
| GitHub org | Yes | Yes (remote) | — |
| Railway | Yes | Yes (CLI) | — |
| Vercel | Private account | **Partial** — frontend env var **names** client/dashboard confirmed; full project ownership transfer not verified | **Yes** — value correctness, team access |
| Supabase | — | **No** | **Yes** |
| Intuit QuickBooks | — | Partial (status HTTP) | **Yes** |
| Microsoft Graph | — | **No** | **Yes** |
| Shared password vault | **Yes** (in use) | **No** | **Yes** — admin, recovery access, completeness |
| Resend / Stripe / OpenAI / Mapbox | — | **No** | **Yes** each |

Secrets: **client confirmed** stored in shared vault. Per-variable vault reconciliation: **requires manual confirmation** ([ENV.md](./ENV.md)).

---

## 7. UCI source

**Verified:** UCI runtime code and docs are in the organization repository (`scraper-service/app/services/uci/`, `src/components/uci/`, `uci/`, migrations).

---

## 8. Related

- [IN_FLIGHT_STATUS.md](./IN_FLIGHT_STATUS.md)
- [RESTORE.md](./RESTORE.md)
