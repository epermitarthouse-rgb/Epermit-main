# Restore and Disaster Recovery

**Document date:** 2026-08-27  
**No restore test performed.** No destructive operations.

Index: [README.md](./README.md)

---

## 1. What must be backed up

| Asset | Priority |
|-------|----------|
| Supabase Postgres (data + auth users) | P0 |
| Supabase Storage objects | P0 |
| Git source (`epermitarthouse-rgb/Epermit-main`) | P0 |
| Environment variables / secrets | P0 |
| OAuth tokens in DB (QuickBooks, Graph) | P0 |
| Railway/Vercel project configuration | P1 |

---

## 2. Verified vs unverified backup mechanisms

| Mechanism | Status |
|-----------|--------|
| GitHub source | **Verified** — org repo accessible; WIP branches pushed (see inventory) |
| Shared password vault | **Manually confirmed by Javeria** — secrets stored in shared vault; per-variable reconciliation still recommended |
| Supabase automated **physical** backups | **Verified** — **7 daily backups** dated **2026-08-20 through 2026-08-26** |
| Supabase **PITR** | **Verified disabled** — paid add-on; **not enabled** on production project |
| Storage objects in DB backups | **Verified excluded** — Storage requires **separate** recovery path |
| Storage versioning / replication | **Requires manual confirmation** |
| Railway backups | Deploy history only — **not** database backup |
| Local `gitsafe-backup` remote | **Inferred** local backup — operator **requires manual confirmation** |

**Tested backup requirement:** **Incomplete** — no successful **restore drill** recorded.

---

## 3. Database vs Storage

| Layer | Recovery approach |
|-------|-------------------|
| **Postgres** | Supabase physical backups (7-day window verified); PITR **not** available unless purchased and enabled |
| **Storage** | **Separate from DB** — bucket restore/versioning **requires manual confirmation** |

**Critical:** `supabase db push` / migrations rebuild **schema only**. They do **not** restore:

- Production rows
- Auth users
- Storage objects
- OAuth connection rows with encrypted tokens
- External account configuration (Intuit, Azure, Stripe webhooks)

---

## 4. Source code recovery

```bash
git clone git@github.com:epermitarthouse-rgb/Epermit-main.git
```

### WIP branches on org remote (2026-08-27)

| Item | Remote status |
|------|---------------|
| `wip/code-mod-uat-cleanup` | **Pushed** — Code Mod UAT SQL |
| `feat/code-analyzer-async-v2` | **Pushed** — experimental; not for production |
| `replit-agent` | **Local + git bundle** — remote push failed; see [REPLIT_RETIREMENT_AUDIT.md](./REPLIT_RETIREMENT_AUDIT.md) |

---

## 5. Recovery order (empty environment)

1. Restore/recreate Supabase project (DB + Storage) — use verified physical backup or accept data gap
2. Apply migrations only if starting empty schema
3. Restore Storage objects from backup — or accept data gap (**verified gap** if only DB restored)
4. Set Edge Function secrets from **shared vault**
5. Deploy Edge Functions from git
6. Recreate Railway services + env from vault
7. Recreate Vercel project + env (including Supabase vars before Supabase fix merge)
8. Re-run OAuth (QuickBooks, Graph) if tokens not restored
9. Update Stripe webhook URL if domain changed
10. Run smoke checks ([DEPLOY.md](./DEPLOY.md) §8)

**Recovery time estimate:** **Not provided** — requires staging restore drill.

---

## 6. Additional recovery checks

After infrastructure restore, verify:

| Item | Why |
|------|-----|
| Edge Function JWT / auth settings | `supabase/config.toml` + in-code auth |
| Scheduled jobs / cron | e.g. scheduled reports migration |
| Webhooks | Stripe, UCI email inbound |
| OAuth redirect URIs | Intuit, Azure — must match URLs |
| RLS policies | Migrations applied completely |
| UCI live-submission env flags | Must default off unless approved |

---

## 7. Restore test status

| Field | Value |
|-------|-------|
| Test performed | **No** |
| Reason | No disposable non-production Supabase environment confirmed; production restore forbidden |
| Manual test required | Staging restore from latest backup; document RPO/RTO |

---

## 8. Related

- [DEPLOY.md](./DEPLOY.md)
- [ENV.md](./ENV.md)
- [TECHNICAL_REMEDIATION_BACKLOG.md](./TECHNICAL_REMEDIATION_BACKLOG.md)
