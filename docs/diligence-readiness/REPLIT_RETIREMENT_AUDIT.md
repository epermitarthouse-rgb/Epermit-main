# Replit Retirement Audit

**Audit date:** 2026-08-26  
**Classification:** **Archive/tag before deletion** (pending explicit approval)

---

## Summary

| Question | Verdict | Evidence |
|----------|---------|----------|
| Production Replit runtime dependency | **None verified** | No `.replit` on `main`; Railway + Vercel deploy paths in repo |
| Unique functionality on `replit-agent` not on `main` | **No verified runtime-unique application code** | `main` is 343 commits ahead; branch is a stale Replit-era snapshot |
| Useful audit/recovery value | **Historical only** | Replit config, pasted prompts, attached_assets |
| Safe to delete now | **No** — archive/tag first | Owner review required |

---

## Branch evidence

| Field | Value |
|-------|-------|
| Branch | `replit-agent` (local only) |
| Tip commit | `d867472` — *Update platform one-pager title for AI assistant* |
| Commits on `replit-agent` not in `main` | **399** |
| Commits on `main` not in `replit-agent` | **343** |
| Remote tracking | **None** — not on `origin` |
| Last branch activity (git) | Tip dated in 2026-03 era (stale relative to `main` at `f7b5f02`, 2026-08-26) |

**Verified from git:** branch exists locally; divergence counts from `git rev-list --count`.

---

## Replit-specific artifacts (on `replit-agent` only)

| Path | Purpose |
|------|---------|
| `.replit` | Replit run/deploy config — **verified** via `git show replit-agent:.replit` |
| `attached_assets/` | Pasted agent prompts and diagnostic exports |
| `.lovable/plan.md` | Lovable plan from Replit-era tree |
| `APP_SUMMARY.md`, `PROJECT_KNOWLEDGE_BASE.md`, `TECHNICAL_AUDIT_REPORT.md` | Historical summaries |

### `.replit` contents (verified excerpt — no secrets)

- Modules: `nodejs-20`, `postgresql-16`
- Run: scraper + Vite on port 8080
- Deployment target: `cloudrun`
- Build: `bun install` + `vite build` (superseded — **verified:** `main` uses npm; commit `aa2e74c` *remove bun lockfile and standardize build on npm*)

---

## Production / runtime dependency check (`main`)

| Check | Result |
|-------|--------|
| `.replit`, `replit.nix` on `main` | **Not present** |
| Code references to `replit.com` | **None found** in application source (verified ripgrep) |
| Deploy config (Railway/Vercel) | Points to GitHub + Docker/npm — **verified** `railway.toml`, `vercel.json` |
| Environment variables referencing Replit | **None found** in code scan |

---

## Unique commits — functional assessment

Sample commits present on `replit-agent` that predate current `main` evolution:

| Commit | Subject | Present on `main`? |
|--------|---------|-------------------|
| `4d42f47` / `b658939` | Fix Portal Data immediate display on project selection | **Superseded** — portal work continued on `main` with later scraper changes |
| `407d138` | Fix ProjectDox scraper portalType | **Superseded** — `memory.md` / current scrapers |
| `3488313` | Improve portal data display and credential handling | **Superseded** |

**Inferred:** Replit-branch fixes were early iterations; **`main` is the authoritative runtime line**. No commit was identified that adds a **currently missing** production module solely on `replit-agent`.

**Requiring manual confirmation:** line-by-line diff of any specific Replit-era file if legal/audit requires proof of feature parity.

---

## Documentation mentioning Replit

| Location | Status |
|----------|--------|
| Prior diligence docs (`fd49b29`) | Mentioned `replit-agent` branch — corrected in this pass |
| `README.md` on `main` | **No Replit deploy instructions** (verified) |
| Active runbooks | **None** describe Replit as current platform |

---

## Recommendation

1. **Tag** `replit-agent` tip (`d867472`) as `archive/replit-agent-2026-03` before any deletion.
2. **Do not delete** until stakeholder sign-off.
3. **Do not push** branch unless audit retention policy requires remote archive.
4. Update onboarding docs to state Railway (backend) + Vercel (frontend) only.

**Final classification:** **Archive/tag before deletion**
