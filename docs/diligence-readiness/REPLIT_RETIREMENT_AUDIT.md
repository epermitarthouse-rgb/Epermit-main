# Replit Retirement Audit

**Audit date:** 2026-08-26 (comprehensive comparison pass)  
**Classification:** **Technically safe to retire after approval and remote archive** (not a local tag alone)

---

## Summary

| Question | Verdict | Evidence |
|----------|---------|----------|
| Production Replit runtime dependency | **None verified** | No `.replit` on `main`; Railway + Vercel deploy paths in repo |
| Unique useful application functionality on `replit-agent` | **None verified** | Path-level diff shows only superseded landing pages, obsolete scraper scripts, debug artifacts, and historical docs |
| Useful audit/recovery value | **Historical only** | Replit config, pasted prompts (`attached_assets/`), early summaries |
| Safe to delete now | **No** — archive to client-controlled storage first | Unrelated history; 399 commits not represented on `main` |

---

## Branch evidence

| Field | Value |
|-------|-------|
| Branch | `replit-agent` (local only) |
| Tip commit | `d867472` — *Update platform one-pager title for AI assistant* |
| Commits on `replit-agent` not in `main` | **399** |
| Commits on `main` not in `replit-agent` | **344** |
| Shared commits (`git rev-list` intersection) | **0** — **unrelated histories** (no `git merge-base`) |
| `git cherry main replit-agent` (non-patch-equivalent) | **202** commits marked `+` |
| Remote tracking | **None** — not on `origin` |
| `main` tip (comparison date) | `0dfbb49` |

**Method note:** Because histories do not share a merge base, commit counts and `git cherry` measure **historical divergence**, not a simple fork behind/ahead of a common ancestor. **File-path tree comparison** is the authoritative check for missing production functionality.

---

## Comprehensive path comparison (read-only)

### Files existing only on `replit-agent` (by path)

| Category | Count | Assessment |
|----------|------:|------------|
| **Total unique paths** | **177** | Includes `attached_assets/` |
| Excluding `attached_assets/` | **96** | See appendix |
| `attached_assets/` (pasted prompts/diagnostics) | **81** | Historical agent context only |
| `src/` application modules | **3** | Superseded — see below |
| `scraper-service/` (non-image) | **4** | Obsolete Montgomery scripts + disk test artifact |
| `scraper-service/` debug PNG probes | **~65** | Debug screenshots — not runtime |
| `supabase/migrations` unique to Replit | **0** | **Verified** — no migration paths only on Replit |
| `supabase/.temp/*` | **7** | Local CLI temp files — should not ship |

### Application modules only on `replit-agent`

| Path | Equivalent on `main`? | Notes |
|------|----------------------|-------|
| `src/components/auth/PublicOnlyRoute.tsx` | **No file at this path** | `main` uses current auth/routing in `App.tsx` / route guards — Replit-era landing split |
| `src/pages/LandingPage.tsx` | **No file at this path** | Superseded by current marketing/home routes |
| `src/pages/CommunETLanding.tsx` | **No file at this path** | Superseded by current public pages |
| `scraper-service/montgomery-auth.js` | **Superseded** | Montgomery logic lives under `scraper-service/app/` on `main` (506 scraper paths vs 73 Replit-era layout) |
| `scraper-service/montgomery-filer.js` | **Superseded** | Same |
| `scraper-service/montgomery-submit.js` | **Superseded** | Same |

**Conclusion:** No production module was identified that exists **only** on `replit-agent` and is **required** by current Railway/Vercel deployments.

### Integrations / configuration only on Replit

| Path | Purpose |
|------|---------|
| `.replit` | Replit run/deploy config — **verified** via `git show replit-agent:.replit` |
| `.lovable/plan.md` | Lovable plan from Replit-era tree |
| `bun.lock` | Superseded — `main` standardized on npm (`aa2e74c`) |
| `replit.md`, `APP_SUMMARY.md`, `PROJECT_KNOWLEDGE_BASE.md`, audit reports | Historical documentation |

### Secret-bearing paths (names only — **no values**)

| Path | Risk |
|------|------|
| `attached_assets/Pasted-The-scraper-agent-pipeline-shows-No-portal-credentials-_*.txt` | May reference credential **topics** in pasted prompts — review before public archive |
| `attached_assets/Pasted-Two-changes-to-the-Settings-Portal-Credentials-page-CHA_*.txt` | Same |

No `.env` file paths were found unique to `replit-agent` in the path diff.

---

## Replit-specific artifacts (on `replit-agent` only)

| Path | Purpose |
|------|---------|
| `.replit` | Replit run/deploy config |
| `attached_assets/` | Pasted agent prompts and diagnostic exports (**81** files) |
| `.lovable/plan.md` | Lovable plan from Replit-era tree |
| `APP_SUMMARY.md`, `PROJECT_KNOWLEDGE_BASE.md`, `TECHNICAL_AUDIT_REPORT.md` | Historical summaries |

### `.replit` contents (verified excerpt — no secrets)

- Modules: `nodejs-20`, `postgresql-16`
- Run: scraper + Vite on port 8080
- Deployment target: `cloudrun`
- Build: `bun install` + `vite build` (superseded on `main`)

---

## Production / runtime dependency check (`main`)

| Check | Result |
|-------|--------|
| `.replit`, `replit.nix` on `main` | **Not present** |
| Code references to `replit.com` | **None found** in application source |
| Deploy config (Railway/Vercel) | Points to GitHub + Docker/npm — **verified** |
| Environment variables referencing Replit | **None found** in code scan |

---

## Sample non-patch-equivalent commits (historical — not missing features)

First entries from `git cherry -v main replit-agent` (unrelated history — treat as archive context, not merge candidates):

| Commit | Subject |
|--------|---------|
| `8fd39fa` | Remove test pipeline script and report |
| `05acc88` / `d20dcb3` | Update application structure and dependencies |
| `31cbc7c` | Saved progress at the end of the loop |
| `cb30d91` | Configure scraper service to use system Chromium |

**Inferred:** Replit-branch work is a **stale parallel history**. **`main` is the authoritative runtime line.**

---

## Recommendation

1. **Verdict:** **Technically safe to retire** `replit-agent` after explicit stakeholder approval — **no verified unique production functionality**.
2. **Do not rely on a local tag alone** — branch is local-only and histories are unrelated.
3. **Archive before deletion** (choose one, client-controlled):
   - Push annotated tag `archive/replit-agent-2026-03` at `d867472` to `origin` (or client archive remote); or
   - Create verified `git bundle` of `replit-agent` stored in client-controlled storage.
4. **Do not delete** in this diligence pass.
5. Update onboarding docs: Railway (backend) + Vercel (frontend) only.

**Final classification:** **Archive to client-controlled remote storage, then retire**

---

## Appendix: unique paths (excluding `attached_assets/`)

```
.lovable/plan.md
.replit
APP_SUMMARY.md
PROJECT_KNOWLEDGE_BASE.md
SPEC_COMPLIANCE_REPORT.md
TECHNICAL_AUDIT_REPORT.md
bun.lock
eslint.config.js
replit.md
scraper-service/montgomery-{auth,filer,submit}.js
scraper-service/*debug*.png, PROBE_*.png, grid_not_found.png, login_stuck.png
scripts/DEPLOY_AND_VERIFY.md
scripts/DISCIPLINE_CLASSIFIER_DEBUG_REPORT.md
src/components/auth/PublicOnlyRoute.tsx
src/pages/CommunETLanding.tsx
src/pages/LandingPage.tsx
supabase/.temp/* (7 CLI temp files)
```

**Full machine-readable list:** 177 paths via `comm -23 <(git ls-tree -r --name-only replit-agent) <(git ls-tree -r --name-only main)`.
