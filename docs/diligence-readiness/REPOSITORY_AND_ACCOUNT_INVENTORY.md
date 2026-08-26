# Repository and Account Inventory

**Audit date:** 2026-08-26  
**Local repository path:** `Epermit-main/`  
**Primary remote:** `git@github.com:epermitarthouse-rgb/Epermit-main.git`

---

## 1. GitHub repository ownership

| Fact | Status | Evidence |
|------|--------|----------|
| Organization repository | **Verified — client-owned** | Remote `origin` → `epermitarthouse-rgb/Epermit-main` |
| Current branch | `main` | `git status` |
| `main` sync with remote | Up to date (0 unpushed commits) | `git log @{u}..HEAD` empty |
| Railway deploy source | Same org repo, `main` branch | Railway deployment metadata `repo: epermitarthouse-rgb/Epermit-main`, commit `da66200` |

### Known ownership fact (provided)

- **GitHub:** client-owned (`epermitarthouse-rgb` organization) — **confirmed** via remote URL and Railway linkage.

---

## 2. Branches and work-in-progress sync

### 2.1 Local branches vs `origin`

| Branch | On remote? | Ahead of remote | Behind remote | Notes |
|--------|------------|-----------------|---------------|-------|
| `main` | Yes | 0 | 0 | Production Railway deploy target |
| `feat/code-analyzer-drawing-management` | Yes | 0 | 0 | Merged into main (per history) |
| `feat/lovable-ui-replication` | Yes | 0 | 0 | Last activity 2026-08-05 |
| `feat/uci-load-profile-document-scope` | Yes | 0 | 0 | |
| `feat/uci-operator-surface-readiness` | Yes | 0 | 0 | |
| `feat/uci-track-ab-backend` | Yes | 0 | 0 | |
| `feat/uci-track-ab-frontend` | Yes | 0 | 0 | |
| `feat/uci-track-ab-schema` | Yes | 0 | 0 | |
| `fix/uci-d13-classify-mock-chain` | Yes | 0 | 0 | |
| **`feat/code-analyzer-async-v2`** | **No** | **~10 commits** (local only) | N/A | Not pushed to org remote |
| **`replit-agent`** | **No** | N/A | N/A | Last commit 2026-03-15; legacy |

### 2.2 Remote-only branches (not checked out locally)

| Branch | Notes |
|--------|-------|
| `origin/feat/stage2-load-profile-readiness` | Exists on remote only; tip commit references gas load extraction / UAT-021–023 |

### 2.3 Uncommitted local work (not in any branch commit)

Modified (unstaged) on `main`:

- `scraper-service/app/services/compliance/code-mod-*.js` (4 files)
- `src/lib/codeModification/*.ts` (5 files)
- `scripts/code-mod-uat-cleanup.sql`

Untracked:

- `src/lib/codeModification/productionPipeline.test.ts`

**These changes are not on GitHub until committed and pushed.**

---

## 3. Secondary remotes

| Remote | URL | Purpose |
|--------|-----|---------|
| `origin` | `git@github.com:epermitarthouse-rgb/Epermit-main.git` | Primary — client org |
| `gitsafe-backup` | `git://gitsafe:5418/backup.git` | Local backup remote; **not** GitHub org |

**Manual confirmation required:** Who operates `gitsafe-backup` and whether it is still maintained.

---

## 4. Personal repository references

Code search for `github.com/` in application source (excluding `package-lock.json` sponsor URLs) found **no references to personal/non-org repositories** for PermitPilot runtime code.

The Lovable reference tree (`reference/lovable-ui/`) is an in-repo export, not an external personal repo dependency.

---

## 5. Replit dependency check

| Check | Result |
|-------|--------|
| `.replit`, `replit.nix`, Replit config files | **Not found** |
| Runtime imports / deploy config pointing to Replit | **Not found** |
| Git branch `replit-agent` | Local-only; last activity 2026-03-15 |

**Conclusion:** No evidence that production code or runtime dependencies remain on Replit. The `replit-agent` branch appears to be historical local work not pushed to the org repository.

---

## 6. Account and integration ownership

Legend: **Verified** = confirmed from live metadata or provided facts; **Inferred** = derived from config/code; **Manual confirmation required** = cannot verify account owner from repo/CLI alone.

| Service | Detectable config | Ownership status | Notes |
|---------|-------------------|------------------|-------|
| **GitHub** | `epermitarthouse-rgb/Epermit-main` | **Verified — client-owned** | Org remote + Railway repo linkage |
| **Railway** | Workspace `PermitPilot`, project `PermitPilot`, services `Epermit-main`, `document-ingestion-worker` | **Verified — client-owned** (provided) + CLI shows workspace access | Production URL: `https://epermit-main-production.up.railway.app` |
| **Vercel** | `vercel.json` in repo | **Inferred — private account** (provided) | `vercel whoami` / `vercel ls` failed: no CLI credentials on audit machine |
| **Supabase** | Project ref `eeqxyjrcldivtpikcpvk` in `supabase/config.toml` | **Manual confirmation required** | Org/billing owner not visible from repo alone |
| **QuickBooks (Intuit)** | OAuth in scraper; production `/api/quickbooks/status` returns `connected: true`, `environment: production` | **Manual confirmation required** | Realm ID present in API response; Intuit app owner = whoever created QB developer app |
| **Microsoft Graph** | `MS_GRAPH_*` env vars in `.env.example`; UCI mailbox OAuth | **Manual confirmation required** | Azure app registration owner not in repo |
| **Resend (email)** | Edge Functions use `RESEND_API_KEY`, `REPORTS_FROM_EMAIL` | **Manual confirmation required** | |
| **Stripe** | Edge Functions: checkout, webhook, customer portal | **Manual confirmation required** | |
| **Mapbox** | Edge Function `get-mapbox-token`; FE `mapbox-gl` | **Manual confirmation required** | Token via Edge Function, not committed |
| **OpenAI** | Scraper + Edge Functions + ingestion worker | **Manual confirmation required** | |
| **Anthropic** | Referenced in UCI classifier env comments (`.env.example`) | **Manual confirmation required** | Optional UCI path |
| **ElevenLabs** | Edge Function `elevenlabs-tts` | **Manual confirmation required** | |
| **Shovels** | Edge Function `shovels-api` | **Manual confirmation required** | |
| **Firecrawl** | Env name in codebase scan | **Manual confirmation required** | Usage scope not fully traced in this audit |
| **ngrok** | Dev script `npm run tunnel` | Dev-only | Not production |

### Provided ownership facts (recorded)

- GitHub: **client-owned**
- Railway: **client-owned**
- Vercel: **currently under a private account** (not verified via CLI during audit)

---

## 7. Push recommendations

### Should be pushed (non-destructive) after review

| Item | Destination | Risk |
|------|-------------|------|
| `feat/code-analyzer-async-v2` (~10 commits) | `origin` (new branch) | Low — new branch, no force push |
| Diligence docs under `docs/diligence-readiness/` | `origin/main` | Low — documentation only |

### Do not push without explicit approval

| Item | Reason |
|------|--------|
| Uncommitted Code Mod changes on `main` | User WIP; not part of diligence scope unless requested |
| `replit-agent` | Legacy; confirm relevance before publishing |

### No push performed for

- `feat/code-analyzer-async-v2` — listed here first per instructions; push only after destination confirmed (done: org repo confirmed).

---

## 8. UCI source in organization repository

| Check | Result |
|-------|--------|
| UCI runtime code in org repo | **Yes** — `scraper-service/app/services/uci/`, `src/components/uci/`, `src/lib/uciApi.ts`, migrations |
| UCI documentation in org repo | **Yes** — `uci/`, `docs/uci-action-items-status.md` |
| UCI-only external repo | **Not found** |

---

## 9. Items requiring manual confirmation

1. Supabase project billing/organization owner
2. Vercel project name, team/account, and production domain mapping
3. Intuit QuickBooks developer app and connected company ownership
4. Microsoft Azure app registration for Graph OAuth
5. Resend, Stripe, Mapbox, OpenAI, and other API account owners
6. Whether `gitsafe-backup` remote should remain configured
7. Whether `origin/feat/stage2-load-profile-readiness` should be merged or deleted
8. Whether `feat/code-analyzer-async-v2` should be pushed and/or merged to `main`
