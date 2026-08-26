# Restore and Disaster Recovery

**Document date:** 2026-08-26  
**Scope:** Recovery procedures for PermitPilot from catastrophic loss. **No production restore test was performed.**

---

## 1. What must be backed up

| Asset | Criticality | Contents |
|-------|-------------|----------|
| **Supabase Postgres** | P0 | Projects, users, portal_data, UCI records, QB connection metadata, comments, jobs |
| **Supabase Storage** | P0 | `project-documents` and other buckets (uploads, UCI attachments, territory datasets) |
| **Git repository** | P0 | Application source, migrations, Edge Functions |
| **Environment variables** | P0 | Railway, Vercel, Supabase secrets, OAuth apps |
| **OAuth tokens** | P0 | QB encrypted refresh tokens in DB; Graph tokens in DB |
| **Intuit / Azure app configs** | P1 | OAuth client IDs, redirect URIs, scopes |
| **Railway service config** | P1 | Service definitions, env vars (infra as code partial) |
| **Vercel project config** | P1 | Domain, env vars, build settings |
| **Local scraper artifacts** | P2 | Ephemeral — downloads/, debug/ — not required for DR |

---

## 2. Verified existing backups

| Source | Verified? | Evidence |
|--------|-----------|----------|
| GitHub `epermitarthouse-rgb/Epermit-main` | **Yes** | Remote accessible; `main` at `da66200` |
| Supabase automated backups | **Not verified from repo** | Requires Supabase Dashboard access |
| Supabase PITR | **Not verified** | Plan-dependent |
| Storage object replication | **Not verified** | Dashboard / bucket policies |
| Railway snapshots | **Not verified** | Ephemeral disk not primary data store |
| Secondary git remote `gitsafe-backup` | **Exists locally** | `git://gitsafe:5418/backup.git` — operator unknown |
| Password vault | **Assumed** (client process) | Referenced in diligence instructions |

**Gap:** No repository document previously confirmed backup retention, RPO/RTO, or last successful restore test.

---

## 3. Where backups live

| Asset | Location |
|-------|----------|
| Source code | GitHub org + local clones |
| Database | Supabase cloud backup (confirm in dashboard) |
| Files | Supabase Storage (same project region) |
| Secrets | Shared password vault (categories in `ENV.md`) |
| QB refresh tokens | Postgres `quickbooks_connections.encrypted_refresh_token` |
| Portal credentials | Postgres `portal_credentials` (encrypted passwords) |

---

## 4. Backup ownership and retention

| System | Owner (status) | Retention |
|--------|----------------|-----------|
| GitHub | Client org — **verified** | Indefinite (git history) |
| Supabase | **Manual confirmation** | Per Supabase plan (check dashboard) |
| Railway | Client — **verified (provided)** | Deploy history; not a DB backup |
| Vercel | Private account — **provided** | Deployment history |
| Vault | **Manual confirmation** | Client policy |

Client dependency from UCI action-items: **retention, backup, and incident-response policy** remains P1 blocked item.

---

## 5. Source-code recovery

### From GitHub (preferred)

```bash
git clone git@github.com:epermitarthouse-rgb/Epermit-main.git
cd Epermit-main
git checkout main
```

### From local-only branches (if GitHub incomplete)

- `feat/code-analyzer-async-v2` — push to org remote before relying on DR
- Uncommitted Code Mod WIP on audit machine — **not recoverable from GitHub**

---

## 6. Supabase database recovery

### Option A: Point-in-time recovery (if enabled)

1. Supabase Dashboard → Database → Backups → PITR
2. Select timestamp before incident
3. Restore to **new project** or replace (destructive — requires approval)

### Option B: Scheduled backup restore

1. Dashboard → Backups → Download or restore latest daily backup
2. Prefer restore to **staging project** first for validation

### Option C: Rebuild from migrations (empty DB)

1. Create new Supabase project
2. `supabase link --project-ref <new-ref>`
3. `supabase db push` — applies all migrations from empty
4. **Data loss:** all production rows unless separately imported

**Never run destructive restore against production without explicit approval.**

---

## 7. Supabase Storage recovery

1. If bucket versioning enabled — restore prior object versions (dashboard)
2. If cross-region replication exists — failover per Supabase docs
3. If no backup — recover from:
   - Re-scrape portal attachments (partial)
   - Client-provided original uploads (manual)
   - UCI Graph re-ingest for mailbox attachments (if mail retained)

**Gap:** No verified Storage backup policy in repository.

---

## 8. Railway service recreation

1. Create Railway project in workspace `PermitPilot`
2. Add service from GitHub repo `epermitarthouse-rgb/Epermit-main`
3. Set root directory: `scraper-service`
4. Builder: Dockerfile (`scraper-service/Dockerfile`)
5. Copy all env vars from vault (`ENV.md` scraper section)
6. Deploy; verify URL (assign or restore custom domain)
7. Update Vercel `VITE_API_BASE_URL` if hostname changes

Repeat for `document-ingestion-worker` with its root directory and env vars.

---

## 9. Vercel frontend recreation

1. Import GitHub repo in Vercel (or transfer project from private account)
2. Framework preset: Vite
3. Build: `npm run build`, output `dist`
4. Set env vars from vault
5. Attach production domain
6. Deploy

---

## 10. Environment-variable recovery

1. Open shared password vault
2. Restore categories:
   - Vercel production/preview
   - Railway `Epermit-main` + `document-ingestion-worker`
   - Supabase Edge secrets
   - OAuth consoles (Intuit QB, Azure Graph) — redirect URIs must match new URLs if changed
3. Cross-check against `ENV.md` inventory
4. Rotate any credentials suspected compromised during incident

**Never store recovered secrets in git.**

---

## 11. Full recovery order (empty environment)

| Step | Action |
|------|--------|
| 1 | Restore or recreate Supabase project (DB + Storage) |
| 2 | Apply migrations if empty DB: `supabase db push` |
| 3 | Restore Storage objects from backup OR accept data gap |
| 4 | Set Supabase Edge secrets |
| 5 | Deploy Edge Functions from git |
| 6 | Recreate Railway scraper service + env vars |
| 7 | Recreate Railway ingestion worker |
| 8 | Verify scraper → Supabase connectivity |
| 9 | Recreate Vercel frontend + env vars |
| 10 | Re-run OAuth flows (QuickBooks, Microsoft Graph) if tokens lost |
| 11 | Reconfigure Stripe webhook URL if domain changed |
| 12 | Run validation checklist (§12) |
| 13 | Notify operators; disable live UCI submission until sign-off |

Estimated minimum time (with vault access and backups): **4–8 hours** engineering + Supabase restore window.

---

## 12. Restore validation checklist

- [ ] Supabase project health green
- [ ] User can log in (Auth)
- [ ] Project list loads with expected row counts (spot check)
- [ ] Storage document opens from UI
- [ ] Scraper root returns HTTP 200
- [ ] `/api/quickbooks/status` reflects expected connection (may need re-OAuth)
- [ ] Test scrape on non-production credential OR read-only portal session
- [ ] Edge function smoke test (e.g. scheduled report dry run)
- [ ] UCI dashboard loads coordination records
- [ ] No secrets in logs or public endpoints

---

## 13. Recovery gaps and manual prerequisites

| Gap | Impact |
|-----|--------|
| Supabase backup/PITR not verified | Unknown RPO/RTO |
| Storage backup policy unknown | File loss may be permanent |
| Vercel on private account | Slower handover if account inaccessible |
| QB/Graph tokens in DB only | Must re-OAuth if DB restore to empty |
| No automated infra-as-code for Railway/Vercel | Manual service recreation |
| Local-only git branches | Code loss if not pushed |
| Portal credentials in DB | Depend on DB backup quality |

---

## 14. Restore test status

### Test performed

**None.**

### Reason

- No disposable non-production Supabase project was confirmed accessible during audit
- Instructions prohibit destructive restore against production
- Creating new cloud resources was out of scope for read-only diligence

### Manual test still required

1. Provision **staging Supabase project** (or use Supabase branch if available on plan)
2. Restore latest backup to staging OR clone prod → staging via supported tooling
3. Point local scraper at staging credentials
4. Validate checklist §12
5. Document RPO/RTO from actual restore duration
6. Optional: Storage object restore drill for single bucket prefix

**Safest next action:** Client ops + engineering schedule staging restore with Supabase dashboard access and written approval scope.

---

## 15. Related documents

- Deploy: `DEPLOY.md`
- Environment variables: `ENV.md`
- Architecture: `ARCHITECTURE.md`
