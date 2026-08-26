# Restore and Disaster Recovery

**Document date:** 2026-08-26  
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
| GitHub source | **Verified** — org repo accessible |
| Shared password vault | **Client confirmed** in use; **completeness and recovery access require manual confirmation** |
| Supabase automated backups | **Requires manual confirmation** — not verified from repo |
| Supabase PITR | **Requires manual confirmation** — plan-dependent; **do not assume available** |
| Storage versioning / replication | **Requires manual confirmation** |
| Railway backups | Deploy history only — **not** database backup |
| Local `gitsafe-backup` remote | **Inferred** local backup — operator **requires manual confirmation** |

**Tested backup requirement:** **Incomplete** — no successful restore drill recorded.

---

## 3. Database vs Storage

| Layer | Recovery approach |
|-------|-------------------|
| **Postgres** | Supabase backup/PITR if enabled; or migrations-only rebuild (schema only) |
| **Storage** | Separate from DB — bucket restore/versioning **requires manual confirmation** |

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

### Deliberately not on GitHub

| Item | Status |
|------|--------|
| `feat/code-analyzer-async-v2` | **Intentionally local-only** — excluded by owner decision; not protected on GitHub |
| Code Modification WIP | **Deliberate uncommitted local work** — not protected on GitHub |

---

## 5. Recovery order (empty environment)

1. Restore/recreate Supabase project (DB + Storage) — **requires manual confirmation** of method
2. Apply migrations only if starting empty schema
3. Restore Storage objects from backup — or accept data gap
4. Set Edge Function secrets from **shared vault** (**client confirmed**)
5. Deploy Edge Functions from git
6. Recreate Railway services + env from vault
7. Recreate Vercel project + env (including Supabase vars before Supabase fix merge)
8. Re-run OAuth (QuickBooks, Graph) if tokens not restored
9. Update Stripe webhook URL if domain changed
10. Run smoke checks ([DEPLOY.md](./DEPLOY.md) §8)

**Recovery time estimate:** **Not provided** — requires real drill ([§8](#8-restore-test-status)).

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
