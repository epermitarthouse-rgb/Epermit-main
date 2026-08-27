# Repository and Account Inventory

**Audit date:** 2026-08-27

Index: [README.md](./README.md)

---

## 1. GitHub

| Field | Status |
|-------|--------|
| Remote | `git@github.com:epermitarthouse-rgb/Epermit-main.git` |
| Ownership | **Client confirmed** + **verified** remote URL and Railway repo linkage |
| Org account ID / owner email | `[PLACEHOLDER — Javeria to insert]` |

---

## 2. WIP preservation status (2026-08-27)

| Item | Remote | Deploy | Notes |
|------|--------|--------|-------|
| **`wip/code-mod-uat-cleanup`** | **Yes** (`edc20c4`) | **No** | Code Mod UAT cleanup SQL |
| **`feat/code-analyzer-async-v2`** | **Yes** (`b8e1da5`) | **No** | Experimental async analyzer — not for production |
| **Code Mod pipeline WIP** | On `wip/code-mod-uat-cleanup` | **No** | Separate from `main` |
| **`replit-agent`** | **Bundle archive** | N/A | Remote push failed — see [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md) |

---

## 3. Branch sync (selected)

| Branch | Remote | Notes |
|--------|--------|-------|
| `main` | Yes | Production Railway target @ `331fa80` |
| `docs/diligence-readiness` | Yes | Merged to `main` |
| `fix/frontend-supabase-env-config` | Yes (`2a5bf81`) | **Unmerged**, **not deployed** |
| `fix/quickbooks-core-hardening` | Yes | Merged to `main` |
| `feat/uci-track-ab-*` | Yes | UCI Track A+B — unmerged feature branches |
| `origin/feat/stage2-load-profile-readiness` | Remote only | **Requires manual confirmation** before merge/delete |

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
| GitHub org | Yes | Yes (remote) | Account ID placeholder |
| Railway | Yes | Yes (CLI) | `[PLACEHOLDER — Javeria to insert]` |
| Vercel | Private account | **Partial** — env var **names** confirmed | **Yes** — value correctness, team access |
| Supabase | — | **Partial** — backups verified | **Yes** — full dashboard ownership |
| Intuit QuickBooks | — | Partial (status HTTP + dry-run) | **Yes** — subscription restoration |
| Microsoft Graph | — | **No** | **Yes** |
| Shared password vault | **Manually confirmed by Javeria** | **No** | Per-variable reconciliation |
| Resend / Stripe / OpenAI / Mapbox | — | **No** | **Yes** each |

**Accounts/API keys under developer email (not Ian's):** `[PLACEHOLDER — Javeria to insert list]`

Secrets: **manually confirmed by Javeria** stored in shared vault. Per-variable vault reconciliation: [ENV.md](./ENV.md).

---

## 7. UCI source

**Verified:** UCI runtime code and docs are in the organization repository (`scraper-service/app/services/uci/`, `src/components/uci/`, `uci/`, migrations). Live pilot will use org repo + Railway + Supabase — **not** Replit or personal namespace.

---

## 8. Related

- [IN_FLIGHT_STATUS.md](./IN_FLIGHT_STATUS.md)
- [RESTORE.md](./RESTORE.md)
